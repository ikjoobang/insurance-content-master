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

// ⚡ [속도 엔진] 모델 이원화 전략
const FAST_MODEL = 'gemini-2.0-flash'  // 0.5초컷 (전략/데이터)
const SMART_MODEL = 'gemini-1.5-pro-latest' // 고지능 (글쓰기)

// API 키 관리
function getApiKey(env: Bindings): string {
  const keys = [env.GEMINI_API_KEY_1, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3, env.GEMINI_API_KEY_4, env.GEMINI_API_KEY].filter(Boolean) as string[];
  return keys[Math.floor(Math.random() * keys.length)];
}

// ⚡ Flash 모델 호출 함수 (속도용)
async function callFlash(prompt: string, key: string) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${FAST_MODEL}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3 } })
  });
  const data = await res.json() as any;
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// 📝 [Q&A 스트리밍 API] - 5초 반응 속도
app.post('/api/generate/qna-stream', async (c) => {
  const { target, tone, insuranceType, concern } = await c.req.json()
  const key = getApiKey(c.env)

  // 🧠 [청개구리 방지] 입력 텍스트 최우선 로직
  let finalType = insuranceType;
  if (concern.includes('달러')) finalType = '달러종신보험';
  else if (concern.includes('CEO') || concern.includes('법인')) finalType = 'CEO/법인플랜';
  else if (concern.includes('치매') || concern.includes('간병')) finalType = '치매/간병보험';
  else if (concern.includes('상속')) finalType = '상속/증여플랜';
  else if (concern.includes('유병자')) finalType = '유병자보험(3.5.5)';

  return streamText(c, async (stream) => {
    // 1. 시작 알림
    await stream.write(JSON.stringify({ type: 'status', msg: '🔍 키워드 분석 중...' }) + '\n');

    // 2. [병렬 처리] 키워드/제목은 Flash로 순식간에 생성
    const [keywords, title] = await Promise.all([
      callFlash(`"${finalType} ${concern}" 관련 검색 키워드 5개 JSON 배열로만 출력. 예: ["키워드1", "키워드2"]`, key),
      callFlash(`"${finalType} ${target}" 네이버 카페용 클릭 유도 제목 1개만 출력 (따옴표 없이)`, key)
    ]);

    await stream.write(JSON.stringify({ type: 'keywords', data: JSON.parse(keywords.match(/\[.*\]/s)?.[0] || '[]') }) + '\n');
    await stream.write(JSON.stringify({ type: 'title', data: title.trim() }) + '\n');
    await stream.write(JSON.stringify({ type: 'status', msg: '✍️ 전문가 답변 작성 중...' }) + '\n');

    // 3. [본문 작성] Pro 모델 스트리밍 (타자 효과)
    const prompt = `
    당신은 20년차 보험 전문가입니다.
    주제: ${finalType}
    고민: "${concern}"
    타겟: ${target} (톤: ${tone})

    [절대 규칙]
    1. "엄마 친구", "지인" 언급 금지.
    2. 마크다운 표(|) 사용 금지.
    3. 답변 3개는 각각 [팩트체크], [공감위로], [비교분석] 관점으로 작성.
    4. 각 답변 500자 이상.
    
    [출력 형식을 엄수하세요]
    [질문1] ...
    [질문2] ...
    [답변1] ...
    [답변2] ...
    [답변3] ...
    [댓글1] ...
    [댓글2] ...
    [댓글3] ...
    [댓글4] ...
    [댓글5] ...
    `;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${SMART_MODEL}:streamGenerateContent?alt=sse&key=${key}`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const json = JSON.parse(line.slice(6));
            const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) await stream.write(JSON.stringify({ type: 'content', data: text }) + '\n');
          } catch (e) {}
        }
      }
    }
    await stream.write(JSON.stringify({ type: 'done' }) + '\n');
  });
});

// 📊 [이미지 데이터 API] 흑백 엑셀 스타일 강제
app.post('/api/generate/proposal-image', async (c) => {
  const { insuranceType, companyName, customerAge } = await c.req.json();
  const key = getApiKey(c.env);

  const prompt = `
  ${insuranceType} (${companyName}) ${customerAge} 설계서 데이터 JSON 생성.
  * 저축/연금이면 '암/뇌/심장' 대신 '해지환급금 예시표' 데이터 생성.
  * 보장성이면 '진단비/수술비' 위주 생성 (15개 항목 이상).
  * 보험료는 2026년 물가 반영.
  출력: { "items": [ {"name":"항목명", "amount":"금액", "premium":"보험료"} ], "total": "총보험료" }
  `;
  
  const jsonStr = await callFlash(prompt, key);
  const data = JSON.parse(jsonStr.match(/\{[\s\S]*\}/)?.[0] || '{"items":[]}');

  return c.json({
    success: true,
    mode: 'universal-excel', // 흑백 모드 트리거
    data: {
      product: `${insuranceType} 플랜`,
      items: data.items,
      premium: data.total
    }
  });
});

// 🖥️ [UI 복구] V29 디자인 + V30 기능 통합 HTML
const mainPageHtml = `
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>XIVIX 콘텐츠 마스터</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://html2canvas.hertzen.com/dist/html2canvas.min.js"></script>
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
<style>
  body { background-color: #050505; color: #ffffff; font-family: 'Pretendard', sans-serif; }
  .glass-panel { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); backdrop-filter: blur(10px); border-radius: 12px; }
  
  /* 칩 버튼 스타일 */
  .chip { background: #1a1a1a; border: 1px solid #333; padding: 8px 16px; border-radius: 99px; font-size: 14px; color: #888; transition: all 0.2s; cursor: pointer; }
  .chip:hover { border-color: #555; color: #fff; }
  .chip.active { background: #03C75A; border-color: #03C75A; color: #fff; font-weight: bold; }
  
  /* 돈 되는 카테고리 강조 */
  .chip-premium { border: 1px solid #d97706; color: #fbbf24; background: rgba(217, 119, 6, 0.1); }
  .chip-premium.active { background: #d97706; color: #fff; }

  /* 흑백 엑셀 스타일 (이미지용) */
  .excel-sheet { background: white; color: black; padding: 30px; width: 600px; margin: 0 auto; font-family: 'Malgun Gothic', serif; transform: rotate(-0.5deg); box-shadow: 5px 5px 15px rgba(0,0,0,0.5); }
  .excel-header { background: #444; color: white; padding: 10px; font-weight: bold; text-align: center; border: 1px solid #000; }
  .excel-row { display: flex; justify-content: space-between; padding: 8px; border-bottom: 1px solid #ccc; border-left: 1px solid #000; border-right: 1px solid #000; }
  .excel-row:last-child { border-bottom: 1px solid #000; }
</style>
</head>
<body class="min-h-screen p-4 md:p-8">

<div class="max-w-6xl mx-auto">
  <div class="flex justify-between items-center mb-8">
    <div class="text-2xl font-bold text-green-500">XIVIX <span class="text-white text-sm font-normal">콘텐츠 마스터 V31</span></div>
    <div class="text-xs text-gray-500">Fast Engine Loaded ⚡</div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <div class="lg:col-span-1 space-y-6">
      <div class="glass-panel p-6">
        <label class="block text-sm font-bold text-red-400 mb-2">🔥 핵심 고민 (여기에 쓰면 무조건 반영)</label>
        <textarea id="concern" class="w-full bg-black/50 border border-gray-700 rounded-lg p-3 text-white h-32 focus:border-green-500 outline-none transition" placeholder="예: 달러종신 해지해야 할까요?"></textarea>
      </div>

      <div class="glass-panel p-6">
        <label class="block text-sm font-bold text-blue-400 mb-3">💰 보험 종류 (돈 되는 카테고리)</label>
        <div class="flex flex-wrap gap-2">
          <button class="chip active" onclick="setChip(this, 'type')">종신보험</button>
          <button class="chip" onclick="setChip(this, 'type')">암보험</button>
          <button class="chip" onclick="setChip(this, 'type')">운전자보험</button>
          <button class="chip chip-premium" onclick="setChip(this, 'type')">CEO/법인플랜</button>
          <button class="chip chip-premium" onclick="setChip(this, 'type')">치매/간병보험</button>
          <button class="chip chip-premium" onclick="setChip(this, 'type')">상속/증여플랜</button>
        </div>
      </div>

      <div class="glass-panel p-6">
        <label class="block text-sm font-bold text-gray-400 mb-3">🎯 타겟 고객</label>
        <div class="flex flex-wrap gap-2">
          <button class="chip active" onclick="setChip(this, 'target')">30대 직장인</button>
          <button class="chip" onclick="setChip(this, 'target')">40대 가장</button>
          <button class="chip" onclick="setChip(this, 'target')">50대 은퇴준비</button>
          <button class="chip" onclick="setChip(this, 'target')">자영업자</button>
        </div>
      </div>

      <button onclick="startGenerate()" id="gen-btn" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-xl shadow-lg transition transform active:scale-95">
        🚀 AI 자동 생성 (5초 컷)
      </button>
    </div>

    <div class="lg:col-span-2 space-y-6">
      <div id="result-header" class="hidden glass-panel p-4">
        <div id="res-keywords" class="flex flex-wrap gap-2 mb-3"></div>
        <h2 id="res-title" class="text-xl font-bold text-white leading-tight"></h2>
      </div>

      <div id="result-body" class="hidden glass-panel p-6 min-h-[300px]">
        <div id="stream-content" class="text-gray-300 whitespace-pre-wrap leading-relaxed"></div>
      </div>

      <div class="glass-panel p-6">
        <div class="flex justify-between items-center mb-4">
          <h3 class="font-bold text-white">📷 실사 설계서 (흑백)</h3>
          <button onclick="makeImage()" class="text-xs bg-gray-700 px-3 py-1 rounded hover:bg-gray-600">이미지 생성</button>
        </div>
        <div id="image-area" class="bg-gray-900 p-4 rounded flex justify-center overflow-hidden">
          <span class="text-gray-600 text-sm">위 버튼을 누르면 생성됩니다.</span>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
  let state = { type: '종신보험', target: '30대 직장인' };

  function setChip(el, key) {
    el.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    state[key] = el.innerText;
  }

  async function startGenerate() {
    const concern = document.getElementById('concern').value;
    const contentDiv = document.getElementById('stream-content');
    const btn = document.getElementById('gen-btn');
    
    document.getElementById('result-header').classList.remove('hidden');
    document.getElementById('result-body').classList.remove('hidden');
    contentDiv.innerHTML = '<span class="animate-pulse text-green-400">AI가 분석 중입니다...</span>';
    btn.disabled = true; btn.innerText = '작성 중...';

    try {
      const response = await fetch('/api/generate/qna-stream', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ ...state, insuranceType: state.type, concern, tone: '전문가' })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      contentDiv.innerHTML = ''; 

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\\n');
        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.type === 'content') {
              contentDiv.innerHTML += json.data.replace(/\\n/g, '<br>');
              window.scrollTo(0, document.body.scrollHeight);
            } else if (json.type === 'title') {
              document.getElementById('res-title').innerText = json.data;
            } else if (json.type === 'keywords') {
              document.getElementById('res-keywords').innerHTML = json.data.map(k => '<span class="text-xs bg-green-900 text-green-300 px-2 py-1 rounded">#' + k + '</span>').join('');
            }
          } catch(e) {}
        }
      }
    } catch(e) { contentDiv.innerHTML += '<br>[오류] 다시 시도해주세요.'; }
    finally { btn.disabled = false; btn.innerText = '🚀 AI 자동 생성 (5초 컷)'; }
  }

  async function makeImage() {
    const area = document.getElementById('image-area');
    area.innerHTML = '<span class="animate-pulse">데이터 수신 중...</span>';
    const res = await fetch('/api/generate/proposal-image', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ insuranceType: state.type, companyName: 'XIVIX생명', customerAge: '40세' })
    });
    const json = await res.json();
    
    if(json.success) {
      let html = '<div id="capture-target" class="excel-sheet">' +
        '<div class="excel-header">' + json.data.product + '</div>' +
        '<div style="padding:10px; font-size:12px; border-bottom:1px solid #000;">' +
          '고객: ' + state.target + ' | 납입: 20년납 | 만기: 종신' +
        '</div>';
      
      (json.data.items || []).forEach(function(item) {
        html += '<div class="excel-row">' +
          '<span>' + item.name + '</span>' +
          '<span style="font-weight:bold">' + item.amount + '</span>' +
        '</div>';
      });
      
      html += '<div style="margin-top:10px; text-align:right; font-weight:bold; font-size:18px;">월 ' + json.data.premium + '</div>' +
      '<div style="margin-top:20px; font-size:10px; color:#666;">※ 본 견적은 예시이며 실제와 다를 수 있습니다.</div></div>';
      
      area.innerHTML = html;
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
  version: '31.0',
  models: { fast: FAST_MODEL, smart: SMART_MODEL }
}));

export default app
