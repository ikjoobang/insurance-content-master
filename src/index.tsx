import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamText } from 'hono/streaming'

type Bindings = {
  GEMINI_API_KEY?: string
  GEMINI_API_KEY_1?: string
  GEMINI_API_KEY_2?: string
  GEMINI_API_KEY_3?: string
  GEMINI_API_KEY_4?: string
  NAVER_CLIENT_ID?: string
  NAVER_CLIENT_SECRET?: string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/*', cors())

// ========== [핵심] 속도 최적화 모델 설정 ==========
// 논리/분석/데이터추출 -> Flash (0.5초)
// 최종 글쓰기 -> Pro (퀄리티)
const GEMINI_FLASH_MODEL = 'gemini-2.0-flash' 
const GEMINI_PRO_MODEL = 'gemini-1.5-pro-latest' 

// API 키 로테이션
let currentKeyIndex = 0
function getGeminiKeys(env: Bindings): string[] {
  const keys: string[] = []
  if (env.GEMINI_API_KEY_1) keys.push(env.GEMINI_API_KEY_1)
  if (env.GEMINI_API_KEY_2) keys.push(env.GEMINI_API_KEY_2)
  if (env.GEMINI_API_KEY_3) keys.push(env.GEMINI_API_KEY_3)
  if (env.GEMINI_API_KEY_4) keys.push(env.GEMINI_API_KEY_4)
  if (keys.length === 0 && env.GEMINI_API_KEY) keys.push(env.GEMINI_API_KEY)
  return keys
}

function getNextGeminiKey(keys: string[]): string {
  if (keys.length === 0) return ''
  const key = keys[currentKeyIndex % keys.length]
  currentKeyIndex = (currentKeyIndex + 1) % keys.length
  return key
}

// Flash 모델 호출 (속도용)
async function callGeminiFlash(prompt: string, apiKeys: string[]): Promise<string> {
  const apiKey = getNextGeminiKey(apiKeys)
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FLASH_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } // 토큰 줄여서 속도 향상
        })
      }
    )
    const data = await response.json() as any
    return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  } catch (e) {
    console.error('Flash API Error', e)
    return ''
  }
}

// Pro 모델 호출 (퀄리티용)
async function callGeminiPro(prompt: string, apiKeys: string[]): Promise<string> {
  const apiKey = getNextGeminiKey(apiKeys)
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_PRO_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
        })
      }
    )
    const data = await response.json() as any
    return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  } catch (e) {
    return ''
  }
}

// ========== [수정] 네이버 검색 (타임아웃 적용으로 속도 개선) ==========
async function searchNaverKeywords(query: string, clientId: string, clientSecret: string): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2초 넘으면 바로 포기 (속도 우선)
    
    const response = await fetch(
      `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(query)}&display=10&sort=sim`,
      {
        headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
        signal: controller.signal
      }
    )
    clearTimeout(timeoutId);
    
    if (!response.ok) return []
    const data = await response.json() as any
    // ... 키워드 추출 로직 ...
    return (data.items || []).map((i:any) => i.title.replace(/<[^>]*>/g, '')).slice(0, 5);
  } catch {
    return []
  }
}

// ========== [핵심] Q&A 생성 API (스트리밍 + 병렬처리 + 하이브리드) ==========
app.post('/api/generate/qna-stream', async (c) => {
  const { target, tone, insuranceType, concern } = await c.req.json()
  const keys = getGeminiKeys(c.env)
  
  // [입력 우선 법칙] 사용자가 쓴 글이 있으면 버튼 무시
  let finalType = insuranceType;
  if (concern.includes('달러')) finalType = '달러종신보험';
  else if (concern.includes('CEO') || concern.includes('법인')) finalType = 'CEO/법인플랜';
  else if (concern.includes('치매') || concern.includes('간병')) finalType = '치매/간병보험';
  else if (concern.includes('상속')) finalType = '상속세재원마련';

  return streamText(c, async (stream) => {
    // 1. [즉시 응답] 시작 신호
    await stream.write(JSON.stringify({ type: 'progress', step: 1, message: '분석 시작...' }) + '\n')

    // 2. [병렬 처리] 키워드 추출(Flash) + 제목 생성(Flash) 동시 실행
    const kwPromise = callGeminiFlash(`보험 키워드 5개 JSON 배열로: ${finalType} ${target} ${concern}`, keys);
    const titlePromise = callGeminiFlash(`네이버 카페용 어그로 제목 1개만(따옴표없이): ${finalType} ${concern} ${target}`, keys);
    
    const [kwRes, titleRes] = await Promise.all([kwPromise, titlePromise]);
    
    await stream.write(JSON.stringify({ type: 'keywords', data: JSON.parse(kwRes.match(/\[.*\]/s)?.[0] || '[]') }) + '\n')
    await stream.write(JSON.stringify({ type: 'title', data: titleRes }) + '\n')
    await stream.write(JSON.stringify({ type: 'progress', step: 2, message: '본문 작성 중...' }) + '\n')

    // 3. [본문 작성] Pro 모델로 한 번에 작성 (스트리밍)
    // * 중요: 답변 길이 700자 이상 강제
    const prompt = `
    당신은 20년차 보험 전문가입니다.
    주제: ${finalType}
    고민: "${concern}"
    타겟: ${target} (톤: ${tone})

    [지시사항]
    1. 마크다운 표(|) 절대 금지. 줄글로 작성.
    2. 답변은 반드시 3가지 관점(팩트/공감/비교)으로 작성.
    3. 각 답변은 **최소 700자 이상** 상세하게.
    4. "엄마 친구", "지인" 언급 금지.
    5. JSON 형식이 아니라, 사람이 읽는 줄글 형식으로 바로 출력.
    
    [출력 순서]
    [질문1] ...
    [질문2] ...
    [답변1] ...
    [답변2] ...
    [답변3] ...
    [댓글1] ... (5개)
    `;

    // Gemini Streaming 호출
    const apiKey = getNextGeminiKey(keys);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_PRO_MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    
    // 청크 단위로 클라이언트에 쏘기 (타자 효과)
    while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // SSE 포맷 파싱해서 텍스트만 추출 후 전송
        const lines = chunk.split('\n');
        for (const line of lines) {
            if(line.startsWith('data: ')) {
                try {
                    const json = JSON.parse(line.slice(6));
                    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
                    if(text) await stream.write(JSON.stringify({ type: 'chunk', data: text }) + '\n');
                } catch(e) {}
            }
        }
    }
    
    await stream.write(JSON.stringify({ type: 'complete' }) + '\n');
  });
});

// ========== [수정] 이미지 데이터 생성 (흑백 엑셀 강제) ==========
app.post('/api/generate/proposal-image', async (c) => {
    const { insuranceType, companyName, customerAge } = await c.req.json();
    const keys = getGeminiKeys(c.env);

    // AI에게 그림 그리라고 안 함. 데이터만 Flash로 빠르게 뽑음.
    const prompt = `
    보험 설계서 데이터 JSON 생성.
    상품: ${insuranceType} (${companyName})
    고객: ${customerAge}
    
    규칙:
    1. 담보는 15개 이상.
    2. 보험료는 2026년 기준 현실적으로.
    3. 저축성 보험이면 '암/뇌/심장' 특약 빼고 '해지환급금 예시표' 데이터 넣을 것.

    출력 포맷(JSON):
    { "items": [ {"name":"담보명", "amount":"금액", "premium":"보험료"} ], "premium": "총보험료" }
    `;

    const jsonStr = await callGeminiFlash(prompt, keys);
    const data = JSON.parse(jsonStr.match(/\{[\s\S]*\}/)?.[0] || '{"items":[]}');

    return c.json({
        success: true,
        mode: 'universal-excel', // ★ 핵심: 흑백 엑셀 모드 강제
        data: {
            company: companyName,
            productFull: `${insuranceType} 맞춤 플랜`,
            premium: data.premium || '산출 중',
            items: data.items,
            style: 'universal-excel' // 프론트엔드에서 이 값을 보고 흑백 렌더링
        }
    });
});


// ========== [UI] 메인 페이지 HTML (돈 되는 버튼 추가) ==========
const mainPageHtml = `
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>XIVIX 보험 콘텐츠 마스터 V30</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
<script src="https://html2canvas.hertzen.com/dist/html2canvas.min.js"></script>
<style>
  body { background: #111; color: white; font-family: sans-serif; }
  .chip { background: #333; border: 1px solid #555; padding: 8px 12px; border-radius: 20px; cursor: pointer; color: #ddd; margin: 4px; font-size: 14px; }
  .chip.active { background: #03C75A; color: white; border-color: #03C75A; font-weight: bold; }
  .chip-premium { border: 1px solid #FFD700; color: #FFD700; background: #332b00; } /* 고부가가치 강조 */
  .chip-premium.active { background: #FFD700; color: #000; }
  
  /* 흑백 엑셀 스타일 (강제 적용) */
  .excel-style {
      background: white; color: black; padding: 20px; font-family: 'Malgun Gothic', sans-serif;
      border: 1px solid #999; transform: rotate(-0.5deg); /* 리얼함 추가 */
      box-shadow: 5px 5px 15px rgba(0,0,0,0.3);
  }
  .excel-header { background: #444; color: white; font-weight: bold; padding: 10px; text-align: center; }
  .excel-row { border-bottom: 1px solid #ccc; display: flex; justify-content: space-between; padding: 8px; }
  .excel-row:nth-child(even) { background: #f9f9f9; }
</style>
</head>
<body class="p-4 max-w-4xl mx-auto">

<h1 class="text-2xl font-bold mb-4 text-green-500">XIVIX 콘텐츠 마스터 <span class="text-xs text-gray-500">V30 (Speed Fix)</span></h1>

<div class="bg-gray-900 p-6 rounded-xl border border-gray-800 mb-6">
    
    <div class="mb-6">
        <label class="block text-sm font-bold text-red-400 mb-2">🔥 핵심 고민 (입력 시 자동 감지)</label>
        <textarea id="concern" class="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white h-24" placeholder="예: 달러종신 해지해야 할까요? (여기에 쓰면 버튼 선택 무시하고 이거 기준으로 나옵니다)"></textarea>
    </div>

    <div class="mb-6">
        <label class="block text-sm font-bold text-blue-400 mb-2">💰 보험 종류 (돈 되는 카테고리)</label>
        <div class="flex flex-wrap" id="insurance-chips">
            <button class="chip" onclick="sel(this)">종신보험</button>
            <button class="chip" onclick="sel(this)">암보험</button>
            <button class="chip" onclick="sel(this)">운전자보험</button>
            <button class="chip chip-premium" onclick="sel(this)">CEO/법인플랜</button>
            <button class="chip chip-premium" onclick="sel(this)">치매/간병보험</button>
            <button class="chip chip-premium" onclick="sel(this)">상속/증여플랜</button>
            <button class="chip chip-premium" onclick="sel(this)">유병자(3.5.5)</button>
        </div>
    </div>

    <div class="mb-6">
        <label class="block text-sm font-bold text-green-400 mb-2">🎯 타겟 고객</label>
        <div class="flex flex-wrap" id="target-chips">
            <button class="chip active" onclick="selT(this)">30대 직장인</button>
            <button class="chip" onclick="selT(this)">40대 가장</button>
            <button class="chip" onclick="selT(this)">50대 은퇴준비</button>
            <button class="chip" onclick="selT(this)">자영업자</button>
            <button class="chip" onclick="selT(this)">법인대표(CEO)</button>
        </div>
    </div>

    <button onclick="startGen()" id="btn-gen" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-xl text-lg transition-all">
        🚀 AI 자동 생성 시작 (5초 컷)
    </button>
</div>

<div id="result-area" class="hidden">
    <div class="bg-gray-800 p-6 rounded-xl border border-gray-700 mb-6">
        <h3 class="text-xl font-bold mb-4 text-white">📝 생성된 콘텐츠</h3>
        <div id="stream-output" class="text-gray-300 whitespace-pre-wrap leading-relaxed"></div>
    </div>

    <div class="bg-gray-800 p-6 rounded-xl border border-gray-700">
        <div class="flex justify-between items-center mb-4">
            <h3 class="text-xl font-bold text-white">📷 설계서 이미지 (흑백 실사)</h3>
            <button onclick="makeImage()" class="bg-blue-600 px-4 py-2 rounded text-sm">이미지 생성</button>
        </div>
        <div id="image-preview" class="bg-gray-900 p-4 min-h-[300px] flex justify-center items-center">
            <div class="text-gray-500">위 '이미지 생성' 버튼을 누르세요</div>
        </div>
    </div>
</div>

<script>
    let selectedInsurance = '종신보험';
    let selectedTarget = '30대 직장인';

    function sel(el) {
        document.querySelectorAll('#insurance-chips .chip').forEach(c => c.classList.remove('active'));
        el.classList.add('active');
        selectedInsurance = el.innerText;
    }
    function selT(el) {
        document.querySelectorAll('#target-chips .chip').forEach(c => c.classList.remove('active'));
        el.classList.add('active');
        selectedTarget = el.innerText;
    }

    // 스트리밍 생성 함수
    async function startGen() {
        const concern = document.getElementById('concern').value;
        const output = document.getElementById('stream-output');
        const btn = document.getElementById('btn-gen');
        
        document.getElementById('result-area').classList.remove('hidden');
        output.innerHTML = '<span class="animate-pulse">AI가 분석 중입니다...</span>';
        btn.disabled = true; btn.innerText = '생성 중...';

        try {
            const response = await fetch('/api/generate/qna-stream', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    concern, 
                    insuranceType: selectedInsurance, 
                    target: selectedTarget,
                    tone: '전문적인'
                })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            output.innerHTML = ''; // 초기화

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value);
                const lines = chunk.split('\\n');
                for (const line of lines) {
                    if (line.startsWith('{')) {
                        try {
                            const json = JSON.parse(line);
                            if (json.type === 'chunk') {
                                // 실시간 타자 효과
                                output.innerHTML += json.data.replace(/\\n/g, '<br>');
                                window.scrollTo(0, document.body.scrollHeight);
                            } else if (json.type === 'progress') {
                                output.innerHTML = '<span class="text-green-400">' + json.message + '</span><br>' + output.innerHTML;
                            } else if (json.type === 'title') {
                                output.innerHTML += '<h2 class="text-xl font-bold text-yellow-400 mb-4">' + json.data + '</h2>';
                            }
                        } catch(e) {}
                    }
                }
            }
        } catch (e) {
            output.innerHTML += '<br>[오류 발생] 다시 시도해주세요.';
        } finally {
            btn.disabled = false; btn.innerText = '🚀 AI 자동 생성 시작 (5초 컷)';
        }
    }

    // 이미지 생성 (데이터만 받아서 프론트에서 그림)
    async function makeImage() {
        const preview = document.getElementById('image-preview');
        preview.innerHTML = '<span class="animate-pulse">설계서 데이터 수신 중...</span>';
        
        const res = await fetch('/api/generate/proposal-image', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ insuranceType: selectedInsurance, companyName: 'XIVIX생명', customerAge: '40세' })
        });
        const json = await res.json();
        
        if(json.success) {
            // 흑백 엑셀 스타일 렌더링
            let html = '<div id="capture-target" class="excel-style">' +
                '<div class="excel-header">' + json.data.productFull + '</div>' +
                '<div style="padding:10px; font-size:12px;">' +
                    '고객: ' + selectedTarget + ' | 보험료: <b>' + json.data.premium + '</b>' +
                '</div>' +
                '<div style="border-top:2px solid #000; margin-top:10px;">';
            
            (json.data.items || []).forEach(function(item) {
                html += '<div class="excel-row">' +
                    '<span>' + item.name + '</span>' +
                    '<span style="font-weight:bold">' + item.amount + '</span>' +
                '</div>';
            });
            html += '</div><div style="margin-top:15px; font-size:11px; color:#666;">※ 본 견적은 예시입니다.</div></div>';
            
            preview.innerHTML = html;
        }
    }
</script>
</body>
</html>
`;

app.get('/', (c) => c.html(mainPageHtml));

// Health Check
app.get('/api/health', (c) => c.json({ 
  status: 'ok', 
  version: '30.0',
  models: { flash: GEMINI_FLASH_MODEL, pro: GEMINI_PRO_MODEL }
}));

export default app
