import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamText } from 'hono/streaming'

type Bindings = {
  GEMINI_API_KEY_1?: string
  GEMINI_API_KEY_2?: string
  GEMINI_API_KEY_3?: string
  GEMINI_API_KEY_4?: string
  NAVER_CLIENT_ID?: string
  NAVER_CLIENT_SECRET?: string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/*', cors())

const SMART_ENGINE = 'gemini-1.5-pro-latest'
const FAST_ENGINE = 'gemini-2.0-flash'

// ========== V34.0: 성별/나이/페르소나 정밀 판별기 ==========
function getPersona(target: string, concern: string) {
  let gender = '남성'
  const femaleKeywords = ['맘', '엄마', '여성', '주부', '아내', '딸', '며느리', '산모', '워킹맘']
  if (femaleKeywords.some(k => target.includes(k) || concern.includes(k))) {
    gender = '여성'
  }
  
  const ageMatch = target.match(/(\d+)대/) || concern.match(/(\d+)대/)
  const age = ageMatch ? ageMatch[1] + '세' : '40세'
  const ageNum = ageMatch ? parseInt(ageMatch[1]) : 40
  
  return { gender, age, ageNum, target }
}

// ========== V34.0: 상위 1% 설계사 전문가 프롬프트 ==========
function getExpertPrompt(insuranceType: string, concern: string, target: string) {
  const p = getPersona(target, concern)
  
  return `당신은 대한민국 상위 1% 보험 수석 컨설턴트(XIVIX PRO)입니다.
사용자의 질문사항 "${concern}"을 분석하여, 중복되지 않는 독창적인 상담 시나리오를 생성하세요.

########################################################################
#                   🚨 고객 정보 - 절대 준수 🚨                         #
########################################################################
- 연령: ${p.age}
- 성별: ${p.gender} ← 🚨 절대 틀리지 말 것!
- 타겟: ${p.target}
- 보험종류: ${insuranceType}

⚠️ 중요: 성별(${p.gender})에 맞는 화법과 고민을 리얼하게 묘사할 것.
⚠️ ${p.gender === '여성' ? '여성 고객의 관점과 고민(육아, 가정, 노후 등)을 반영' : '남성 가장의 관점과 고민(책임감, 가족 부양 등)을 반영'}

########################################################################
#                   📚 전문가 지식 강제 활성화                          #
########################################################################

【 상속/증여 전문 지식 】
- 상증법 제8조: 수익자 지정 시 상속재산에서 제외되는 법리
- 10년 증여주기: 10년마다 증여세 공제 리셋
- 유류분 분쟁: 법정상속분의 1/2~1/3 보장
- 사전증여 vs 사후상속: 세금 시뮬레이션 필수
- 부동산 자산가: 상속세 납부 재원(현금) 확보가 핵심

【 CEO/법인 전문 지식 】
- 손비처리 한도: 법인세법상 보험료 손금산입 가능 범위
- 가지급금 정리: 퇴직금 재원으로 가지급금 상환 플랜
- CEO 유동성: 대표 유고 시 법인 운영자금 즉시 확보
- 키맨보험: 핵심인물 리스크 관리
- 임원배상책임(D&O): 경영 리스크 보장

【 치매/간병 전문 지식 】
- CDR 척도: 경도(1점)/중등도(2점)/중증(3점) 진단 기준
- ADL(일상생활장애): 식사/이동/옷입기/세수/목욕/화장실 6항목
- 체증형 일당: 물가상승률 반영하여 보장액 자동 증가
- 재가급여 vs 시설급여: 등급별 월 50~180만원 한도
- 장기요양등급(1~5등급): 국가 지원과 민간보험 병행 전략

########################################################################
#                   ✍️ 작성 지침                                        #
########################################################################

1. 톤: 무조건 '보험초보' 눈높이로 쉬운 비유 사용 (제안서 요청형 결합)
2. 금지: "엄마 친구", "이모 설계사", "지인" 언급 금지
3. 경로: 유튜브/커뮤니티/블로그 분석 경로 활용
4. 포맷: 마크다운 표(|) 사용 금지, 시스템 태그 노출 금지
5. 분량: 전문가 답변은 각각 700자 이상의 압도적 정보량 제공
6. 용어: 위 전문 지식의 용어를 자연스럽게 3개 이상 포함

########################################################################
#                   📋 출력 구조 (엄수!)                                #
########################################################################

[질문1]
(${p.target}이 네이버 카페에 올릴 법한 질문. 핵심고민 반영. 150~250자)

[질문2]
(다른 각도에서 같은 고민을 가진 질문. 150~250자)

[답변1] - 공감형 멘토
(따뜻하게 공감하면서 조언. ${p.gender} 고객 화법. 700자 이상)

[답변2] - 데이터 분석가
(숫자와 통계로 객관적 분석. 구체적 금액/비율 포함. 700자 이상)

[답변3] - 현장 베테랑
(20년 경험 기반 실전 조언. 실제 사례 언급. 700자 이상)

[댓글1] (공감 50~100자)
[댓글2] (추가 정보 50~100자)
[댓글3] (경험담 50~100자)
[댓글4] (조언 50~100자)
[댓글5] (응원 50~100자)

[키워드]
(검색 최적화용 키워드 5개, 쉼표로 구분)

########################################################################
#                   🚫 절대 금지                                        #
########################################################################
- 마크다운 표(|) 절대 금지
- "사업비", "수수료", "운영비" 단어 금지
- "엄마 친구", "이모 설계사" 언급 금지
- 성별(${p.gender}) 틀리면 실패!
- \\n, Analysis, Comparison 등 시스템 태그 노출 금지
`
}

// ========== 📝 Q&A 스트리밍 API ==========
app.post('/api/generate/qna-stream', async (c) => {
  const { target, insuranceType, concern } = await c.req.json()
  const apiKey = [c.env.GEMINI_API_KEY_1, c.env.GEMINI_API_KEY_2, c.env.GEMINI_API_KEY_3, c.env.GEMINI_API_KEY_4].filter(Boolean)[0] as string

  if (!apiKey) {
    return c.json({ error: 'API 키 없음' }, 500)
  }

  const p = getPersona(target, concern)
  console.log(`[V34.0] 타겟: ${target} → 성별: ${p.gender}, 나이: ${p.age}`)

  return streamText(c, async (stream) => {
    try {
      await stream.write(JSON.stringify({ type: 'status', step: 1, percent: 10, msg: '🔍 고민의 핵심(Angle) 분석 중...' }) + '\n')
      await stream.write(JSON.stringify({ type: 'status', step: 2, percent: 25, msg: '⚖️ 전문가 지식 로딩 중...' }) + '\n')
      await stream.write(JSON.stringify({ type: 'status', step: 3, percent: 40, msg: '✍️ 상위 1% 컨설턴트 답변 작성 중...' }) + '\n')

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${SMART_ENGINE}:streamGenerateContent?alt=sse&key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: getExpertPrompt(insuranceType, concern, target) }] }],
            generationConfig: { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: 8192 }
          })
        }
      )

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6))
              const text = json.candidates?.[0]?.content?.parts?.[0]?.text
              if (text) {
                // V34.0: 실시간 텍스트 정제 (외계어 제거)
                const clean = text
                  .replace(/\\\\n/g, '<br>')
                  .replace(/\\n/g, '<br>')
                  .replace(/\|/g, ' ')
                  .replace(/Analysis|Comparison|Evidence|Action|Conclusion|Step \d+:/gi, '')
                  .replace(/\(분석\)|\(비교\)|\(근거\)|\(제안\)|\(결론\)/g, '')
                await stream.write(JSON.stringify({ type: 'content', data: clean }) + '\n')
              }
            } catch (e) {}
          }
        }
      }

      await stream.write(JSON.stringify({ type: 'status', step: 4, percent: 100, msg: '✅ 완료!' }) + '\n')
      await stream.write(JSON.stringify({ type: 'done' }) + '\n')

    } catch (error) {
      console.error('Streaming error:', error)
      await stream.write(JSON.stringify({ type: 'error', msg: '생성 중 오류 발생' }) + '\n')
    }
  })
})

// ========== 기존 Q&A API (호환용) ==========
app.post('/api/generate/qna-full', async (c) => {
  const { target, insuranceType, concern } = await c.req.json()
  const apiKey = [c.env.GEMINI_API_KEY_1, c.env.GEMINI_API_KEY_2].filter(Boolean)[0] as string

  if (!apiKey) return c.json({ error: 'API 키 없음' }, 500)

  const p = getPersona(target, concern)

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${SMART_ENGINE}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: getExpertPrompt(insuranceType, concern, target) }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
        })
      }
    )

    const data = await response.json() as any
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

    return c.json({
      success: true,
      data: { raw: result, persona: p }
    })
  } catch (error) {
    return c.json({ error: '생성 실패' }, 500)
  }
})

// ========== 📊 흑백 엑셀 설계서 API ==========
app.post('/api/generate/proposal-image', async (c) => {
  const { insuranceType, target, concern } = await c.req.json()
  const p = getPersona(target || '40대 가장', concern || '')
  const apiKey = [c.env.GEMINI_API_KEY_1, c.env.GEMINI_API_KEY_2].filter(Boolean)[0] as string

  if (!apiKey) return c.json({ error: 'API 키 없음' }, 500)

  const prompt = `${insuranceType} (${p.gender}/${p.age}) 흑백 엑셀 출력물 데이터 생성.

규칙:
1. 담보 15개 이상 생성
2. 성별(${p.gender})과 나이(${p.age}) 반드시 반영
3. 2026년 실제 보험료 기준
4. 랜덤한 가상 보험사명 사용

출력 JSON만 (설명 없이):
{
  "company": "가상보험사명",
  "product": "상품명",
  "items": [
    {"name": "담보명", "amount": "가입금액", "premium": "월보험료"}
  ],
  "total": "월납합계"
}`

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${FAST_ENGINE}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3 }
        })
      }
    )

    const result = await response.json() as any
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const data = jsonMatch ? JSON.parse(jsonMatch[0]) : { items: [], total: '0원' }

    return c.json({
      success: true,
      data: {
        ...data,
        gender: p.gender,
        age: p.age,
        target: p.target,
        insuranceType,
        product: data.product || `${insuranceType} 설계서`,
        docNumber: `INS-${Math.random().toString(36).substring(2, 10).toUpperCase()}`
      }
    })
  } catch (error) {
    console.error('Proposal error:', error)
    return c.json({ error: '설계서 생성 실패' }, 500)
  }
})

// ========== Health Check API ==========
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    version: '34.0',
    engine: {
      smart: SMART_ENGINE,
      fast: FAST_ENGINE
    },
    features: [
      'gender-precision-detect',
      'expert-knowledge-injection',
      'realtime-text-cleaning',
      'progress-gauge-bar',
      'grayscale-excel-style',
      'no-bento-report',
      'streaming-api'
    ],
    expertCategories: ['상속/증여', 'CEO/법인', '치매/간병'],
    timestamp: new Date().toISOString()
  })
})

// ========== 🖥️ V34 UI ==========
const mainPageHtml = `
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>XIVIX V34 | 초정밀 전문가 시스템</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { 
    background: #050505; 
    color: #fff; 
    font-family: 'Pretendard', -apple-system, sans-serif;
    min-height: 100vh;
  }
  
  .glass { 
    background: rgba(255,255,255,0.02); 
    border: 1px solid rgba(255,255,255,0.05); 
    border-radius: 20px; 
    backdrop-filter: blur(10px);
  }
  
  .chip { 
    background: #111; 
    border: 1px solid #333; 
    padding: 12px 20px; 
    border-radius: 12px; 
    cursor: pointer; 
    color: #888; 
    font-size: 14px;
    transition: all 0.2s;
  }
  .chip:hover { border-color: #555; color: #fff; }
  .chip.active { 
    background: linear-gradient(135deg, #03C75A 0%, #00A84D 100%); 
    color: #fff; 
    border-color: #03C75A; 
    font-weight: bold;
    box-shadow: 0 4px 15px rgba(3, 199, 90, 0.3);
  }
  
  .chip-gold {
    border-color: rgba(217, 119, 6, 0.5);
    color: #fbbf24;
  }
  .chip-gold.active {
    background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
    border-color: #fbbf24;
    box-shadow: 0 4px 15px rgba(217, 119, 6, 0.3);
  }
  
  .btn-main {
    background: linear-gradient(135deg, #03C75A 0%, #00A84D 100%);
    transition: all 0.2s;
  }
  .btn-main:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(3, 199, 90, 0.4);
  }
  .btn-main:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  
  /* 흑백 엑셀 스타일 (색상 완전 제거) */
  .excel-sheet { 
    background: white; 
    color: black; 
    padding: 40px; 
    border: 2px solid #000; 
    font-family: 'Malgun Gothic', 'Gulim', sans-serif; 
    max-width: 650px;
    width: 100%;
    transform: rotate(-0.3deg); 
    box-shadow: 15px 15px 40px rgba(0,0,0,0.6);
  }
  .excel-table { 
    width: 100%; 
    border-collapse: collapse; 
    border: 1px solid #000; 
    margin-top: 20px; 
  }
  .excel-table th { 
    background: #eee; 
    border: 1px solid #000; 
    padding: 10px; 
    font-size: 13px;
    font-weight: bold;
    text-align: center;
  }
  .excel-table td { 
    border: 1px solid #000; 
    padding: 8px 12px; 
    font-size: 13px; 
  }
  .excel-table tr:nth-child(even) {
    background: #f9f9f9;
  }
  
  .gauge-bar {
    background: linear-gradient(90deg, #03C75A 0%, #00ff88 100%);
    transition: width 0.5s ease;
  }
  
  .result-content {
    white-space: pre-wrap;
    line-height: 1.9;
    font-size: 14px;
  }
</style>
</head>
<body class="p-4 md:p-10">

<div class="max-w-7xl mx-auto">
  <!-- 헤더 -->
  <div class="flex items-center gap-4 mb-8">
    <div class="w-12 h-12 bg-green-600 rounded-xl flex items-center justify-center font-bold text-2xl shadow-lg">X</div>
    <div>
      <h1 class="text-2xl font-bold">XIVIX <span class="text-green-500">V34</span></h1>
      <p class="text-gray-500 text-xs">초정밀 전문가 시스템 • 성별 자동 판별 • 흑백 엑셀</p>
    </div>
  </div>

  <!-- 메인 그리드 -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
    
    <!-- 좌측: 입력 -->
    <div class="lg:col-span-4 space-y-6">
      
      <!-- 질문 입력 -->
      <div class="glass p-6">
        <label class="block text-red-400 font-bold text-sm mb-3">
          <i class="fas fa-comment-dots mr-2"></i>질문 사항 입력
        </label>
        <textarea id="concern" 
          class="w-full bg-black/50 border border-gray-700 rounded-xl p-4 text-white text-sm h-32 outline-none focus:border-red-500 transition resize-none"
          placeholder="예: 30대 워킹맘 부동산 vs 주식 증여 세금 차이가 뭔가요?"></textarea>
        <p class="text-gray-600 text-xs mt-2">💡 "워킹맘", "CEO", "치매" 등 입력 시 성별/분야 자동 감지</p>
      </div>
      
      <!-- 고부가가치 분야 -->
      <div class="glass p-6">
        <label class="block text-yellow-400 font-bold text-sm mb-3">
          <i class="fas fa-crown mr-2"></i>고부가가치 전문 분야
        </label>
        <div class="flex flex-wrap gap-2" id="type-chips">
          <button class="chip chip-gold active" onclick="selectChip(this, 'type')">💰 상속/증여</button>
          <button class="chip chip-gold" onclick="selectChip(this, 'type')">💼 CEO/법인</button>
          <button class="chip chip-gold" onclick="selectChip(this, 'type')">🧠 치매/간병</button>
        </div>
        <div class="flex flex-wrap gap-2 mt-3">
          <button class="chip" onclick="selectChip(this, 'type')">종신보험</button>
          <button class="chip" onclick="selectChip(this, 'type')">암보험</button>
          <button class="chip" onclick="selectChip(this, 'type')">운전자보험</button>
          <button class="chip" onclick="selectChip(this, 'type')">달러종신</button>
        </div>
      </div>
      
      <!-- 타겟 고객 -->
      <div class="glass p-6">
        <label class="block text-purple-400 font-bold text-sm mb-3">
          <i class="fas fa-users mr-2"></i>타겟 고객
        </label>
        <div class="flex flex-wrap gap-2" id="target-chips">
          <button class="chip active" onclick="selectChip(this, 'target')">30대 워킹맘</button>
          <button class="chip" onclick="selectChip(this, 'target')">40대 가장</button>
          <button class="chip" onclick="selectChip(this, 'target')">50대 은퇴준비</button>
          <button class="chip" onclick="selectChip(this, 'target')">법인대표</button>
        </div>
        <p id="gender-indicator" class="text-xs mt-3 text-pink-400">
          <i class="fas fa-venus mr-1"></i>현재 타겟: 여성 (30대 워킹맘)
        </p>
      </div>
      
      <!-- 생성 버튼 -->
      <button onclick="runGeneration()" id="btn-generate" 
        class="btn-main w-full py-5 rounded-2xl font-bold text-xl text-white flex items-center justify-center gap-3 shadow-lg">
        <i class="fas fa-rocket"></i>
        <span>자동 생성 시작</span>
      </button>
      
    </div>
    
    <!-- 우측: 결과 -->
    <div class="lg:col-span-8 space-y-6">
      
      <!-- 게이지 바 -->
      <div id="gauge-container" class="glass p-4 hidden">
        <div class="flex justify-between items-center mb-2">
          <span id="gauge-text" class="text-green-400 text-sm font-medium">AI 분석 중...</span>
          <span id="gauge-percent" class="text-green-400 text-sm font-bold">0%</span>
        </div>
        <div class="w-full bg-gray-800 h-2.5 rounded-full overflow-hidden">
          <div id="gauge-bar" class="gauge-bar h-full rounded-full" style="width: 0%"></div>
        </div>
      </div>
      
      <!-- 결과 본문 -->
      <div id="result-body" class="glass p-8 hidden min-h-[500px]">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-white font-bold">
            <i class="fas fa-file-alt text-green-400 mr-2"></i>생성 결과
          </h3>
          <button onclick="copyAll()" class="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg text-xs transition">
            <i class="fas fa-copy mr-1"></i>전체 복사
          </button>
        </div>
        <div id="result-content" class="result-content text-gray-200"></div>
      </div>
      
      <!-- 이미지 생성 -->
      <div class="glass p-6">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-white font-bold">
            <i class="fas fa-file-excel text-blue-400 mr-2"></i>흑백 엑셀 설계서
          </h3>
          <button onclick="generateImage()" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-xs transition">
            <i class="fas fa-image mr-1"></i>이미지 생성
          </button>
        </div>
        <div id="img-area" class="flex justify-center bg-black/30 p-6 rounded-xl min-h-[200px] items-center">
          <p class="text-gray-600 text-sm text-center">버튼 클릭 시 색상 없는<br>순수 흑백 엑셀 스타일 설계서 생성</p>
        </div>
      </div>
      
    </div>
  </div>
</div>

<script>
// 상태
const state = {
  type: '상속/증여',
  target: '30대 워킹맘'
};

// 성별 판별
function detectGender(text) {
  const femaleKeywords = ['맘', '엄마', '여성', '주부', '아내', '워킹맘'];
  if (femaleKeywords.some(k => text.includes(k))) {
    return { gender: '여성', icon: 'fa-venus', color: 'text-pink-400' };
  }
  return { gender: '남성', icon: 'fa-mars', color: 'text-blue-400' };
}

// 칩 선택
function selectChip(el, key) {
  // 같은 그룹 내에서만 active 제거 (type은 두 그룹, target은 한 그룹)
  if (key === 'type') {
    document.querySelectorAll('#type-chips .chip').forEach(c => c.classList.remove('active'));
  } else {
    el.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  }
  el.classList.add('active');
  state[key] = el.innerText.replace(/[💰💼🧠]/g, '').trim();
  
  if (key === 'target') {
    updateGenderIndicator();
  }
}

function updateGenderIndicator() {
  const concern = document.getElementById('concern').value;
  const combined = state.target + ' ' + concern;
  const { gender, icon, color } = detectGender(combined);
  const indicator = document.getElementById('gender-indicator');
  indicator.innerHTML = '<i class="fas ' + icon + ' mr-1"></i>현재 타겟: ' + gender + ' (' + state.target + ')';
  indicator.className = 'text-xs mt-3 ' + color;
}

// Q&A 생성
async function runGeneration() {
  const btn = document.getElementById('btn-generate');
  const gauge = document.getElementById('gauge-container');
  const bar = document.getElementById('gauge-bar');
  const percent = document.getElementById('gauge-percent');
  const text = document.getElementById('gauge-text');
  const resultBody = document.getElementById('result-body');
  const content = document.getElementById('result-content');
  
  gauge.classList.remove('hidden');
  resultBody.classList.remove('hidden');
  content.innerHTML = '';
  btn.disabled = true;
  bar.style.width = '5%';
  percent.innerText = '5%';
  text.innerText = '🚀 시작 중...';
  
  try {
    const concern = document.getElementById('concern').value || state.type + ' 관련 궁금합니다';
    
    const response = await fetch('/api/generate/qna-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        insuranceType: state.type,
        target: state.target,
        concern: concern
      })
    });
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const lines = decoder.decode(value).split('\\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          
          if (json.type === 'status') {
            text.innerText = json.msg;
            const prog = json.percent || (json.step * 25);
            bar.style.width = prog + '%';
            percent.innerText = prog + '%';
          } 
          else if (json.type === 'content') {
            content.innerHTML += json.data;
          }
          else if (json.type === 'done') {
            bar.style.width = '100%';
            percent.innerText = '100%';
            text.innerText = '✅ 생성 완료!';
          }
          else if (json.type === 'error') {
            content.innerHTML = '<span class="text-red-400">' + json.msg + '</span>';
          }
        } catch(e) {}
      }
    }
  } catch(e) {
    content.innerHTML = '<span class="text-red-400">오류: ' + e.message + '</span>';
  }
  
  btn.disabled = false;
}

// 전체 복사
function copyAll() {
  const content = document.getElementById('result-content').innerText;
  navigator.clipboard.writeText(content).then(() => {
    alert('복사되었습니다!');
  });
}

// 이미지 생성
async function generateImage() {
  const area = document.getElementById('img-area');
  area.innerHTML = '<span class="text-blue-400 animate-pulse"><i class="fas fa-spinner fa-spin mr-2"></i>Excel Data Generating...</span>';
  
  try {
    const concern = document.getElementById('concern').value || '';
    
    const response = await fetch('/api/generate/proposal-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        insuranceType: state.type,
        target: state.target,
        concern: concern
      })
    });
    
    const json = await response.json();
    
    if (json.success) {
      const d = json.data;
      let html = '<div class="excel-sheet">';
      html += '<div style="font-size:22px; font-weight:bold; border-bottom:2px solid #000; padding-bottom:12px; margin-bottom:15px;">' + (d.product || state.type + ' 설계서') + '</div>';
      html += '<div style="font-size:14px; margin-bottom:15px;"><b>피보험자:</b> ' + d.target + ' / ' + d.gender + ' / ' + d.age + '</div>';
      
      if (d.items && d.items.length > 0) {
        html += '<table class="excel-table"><thead><tr><th>담보항목</th><th>가입금액</th><th>보험료</th></tr></thead><tbody>';
        d.items.forEach(item => {
          html += '<tr><td>' + item.name + '</td><td style="text-align:right">' + item.amount + '</td><td style="text-align:right">' + (item.premium || '-') + '</td></tr>';
        });
        html += '</tbody></table>';
      }
      
      html += '<div style="text-align:right; font-size:20px; font-weight:bold; margin-top:20px; padding-top:15px; border-top:2px solid #000;">합계보험료: ' + (d.total || '계산중') + '</div>';
      html += '</div>';
      
      area.innerHTML = html;
    } else {
      area.innerHTML = '<span class="text-red-400">생성 실패: ' + (json.error || '알 수 없는 오류') + '</span>';
    }
  } catch(e) {
    area.innerHTML = '<span class="text-red-400">오류: ' + e.message + '</span>';
  }
}

// 초기화
document.addEventListener('DOMContentLoaded', () => {
  updateGenderIndicator();
  document.getElementById('concern').addEventListener('input', updateGenderIndicator);
});
</script>

</body>
</html>
`

app.get('/', (c) => c.html(mainPageHtml))

export default app
