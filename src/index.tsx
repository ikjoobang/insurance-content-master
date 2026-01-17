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

// ⚡ V33.0 모델 설정
const FAST_MODEL = 'gemini-2.0-flash'      // 속도용 (키워드, JSON)
const SMART_MODEL = 'gemini-1.5-pro-latest' // 품질용 (글쓰기)

// API 키 관리
function getApiKey(env: Bindings): string {
  const keys = [env.GEMINI_API_KEY_1, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3, env.GEMINI_API_KEY_4, env.GEMINI_API_KEY].filter(Boolean) as string[]
  return keys[Math.floor(Math.random() * keys.length)] || ''
}

// ========== V33.0: 성별 및 타겟 정밀 분석기 ==========
function analyzeTarget(target: string): { gender: string, age: string, ageNum: number, occupation: string } {
  let gender = '남성'
  // 여성 키워드 감지 (워킹맘, 엄마, 주부 등)
  if (target.includes('맘') || target.includes('엄마') || target.includes('여성') || 
      target.includes('주부') || target.includes('아내') || target.includes('워킹맘') ||
      target.includes('딸') || target.includes('며느리')) {
    gender = '여성'
  }
  
  const ageMatch = target.match(/(\d+)대/)
  const ageNum = ageMatch ? parseInt(ageMatch[1]) : 40
  const age = ageNum + '세'
  
  // 직업 추출
  let occupation = '직장인'
  if (target.includes('워킹맘')) occupation = '워킹맘'
  else if (target.includes('가장')) occupation = '가장'
  else if (target.includes('자영업')) occupation = '자영업자'
  else if (target.includes('대표') || target.includes('CEO')) occupation = '법인대표'
  else if (target.includes('은퇴')) occupation = '은퇴준비자'
  else if (target.includes('주부')) occupation = '전업주부'
  
  return { gender, age, ageNum, occupation }
}

// ========== V33.0: 고부가가치 4대장 전문가 프롬프트 ==========
function getExpertSystemPrompt(insuranceType: string, target: string, concern: string): string {
  const { gender, age, occupation } = analyzeTarget(target)
  
  let expertLogic = ''
  
  // 상속/증여 전문가 로직
  if (insuranceType.includes('상속') || insuranceType.includes('증여')) {
    expertLogic = `
【 역할: 상속/증여 전문 세무 컨설턴트 (25년 경력) 】

■ 핵심 논리:
- 수익률이 아니라 '상속세 납부 재원(현금)' 마련이 목적입니다.
- "부동산 물려줘도 세금 낼 현금 없으면 집 팔아야 합니다."
- 보험금은 '수익자 지정' 시 상속재산에서 제외되는 법리(상증법 제8조)를 활용하세요.

■ 필수 전문용어 (자연스럽게 3개 이상 사용):
- 10년 증여주기, 유류분 분쟁, 자금출처 소명, 비과세 현금 자산
- 상속세율(10~50%), 사전증여, 세무조사 리스크

■ 2026년 핵심 수치:
- 상속세율: 1억 이하 10%, 30억 초과 50%
- 연간 증여세 면제: 성인 자녀 5천만원(10년간), 미성년 2천만원
- 종신보험 활용: 사망보험금을 상속세 납부재원으로 활용

■ 절대 금지: 사업비, 수수료, 단순 저축, 투자 추천
`
  }
  // CEO/법인 전문가 로직
  else if (insuranceType.includes('CEO') || insuranceType.includes('법인')) {
    expertLogic = `
【 역할: 법인 영업 전문 수석 언더라이터 (20년 경력) 】

■ 핵심 논리:
- 개인 보장이 아닌 '법인세 절세'와 '가업 승계' 관점으로 접근하세요.
- "대표님 개인 돈으로 보험 들지 마세요. 법인 비용(손비처리)으로 법인세를 아끼고, 
   나중에 그 돈을 '사망퇴직금'으로 전환하여 유족에게 넘기는 플랜이 핵심입니다."

■ 필수 전문용어 (자연스럽게 3개 이상 사용):
- 손비처리 한도, 가지급금 정리, CEO 유동성, 임원배상책임(D&O)
- 키맨보험(핵심인물보험), 퇴직급여충당금, 법인세 절세

■ 문제 시나리오:
1. 대표 유고 시 → 법인 운영자금 급필요 → 키맨보험 필요
2. 퇴직연금 부족 → 손비처리 가능한 보험으로 충당
3. 가업승계 → 증여세 재원을 종신보험으로 마련

■ 절대 금지: 사업비, 수수료, 개인보험처럼 설명
`
  }
  // 치매/간병 전문가 로직
  else if (insuranceType.includes('치매') || insuranceType.includes('간병')) {
    expertLogic = `
【 역할: 노후 케어 전문 설계사 (15년 경력, 요양보호사 자격 보유) 】

■ 핵심 논리:
- 국가 지원의 한계와 '물가상승률'에 따른 보장 가치 하락 방어가 핵심입니다.
- "지금 10만원 일당은 20년 뒤 간병인 1시간 비용도 안 됩니다."
- 무조건 보장액이 늘어나는 '체증형'과 나라에서 주는 혜택 외에 '재가급여'를 현금으로 받는 게 핵심입니다.

■ 필수 전문용어 (자연스럽게 3개 이상 사용):
- CDR 척도(경도1/중등도2/중증3), ADL(일상생활장애 6항목)
- 체증형 일당, 시설급여 vs 재가급여, 장기요양등급(1~5등급)

■ 2026년 핵심 수치:
- 요양병원 월 평균: 150~250만원 (급식+요양+간병)
- 재가급여 한도: 등급별 월 50~180만원
- 간병인 일당: 12~18만원 (서울 기준, 연 5~10% 상승 중)
- 치매 유병률: 65세 이상 10%, 85세 이상 40%

■ 절대 금지: 사업비, 수수료, "나중에 해도 돼요" (조기 가입 중요성 강조!)
`
  }
  // 일반 보험 (종신, 암 등)
  else {
    expertLogic = `
【 역할: 20년차 보험 전문가 (종합 컨설턴트) 】

■ 핵심 논리:
- 고객의 현실적인 고민에 공감하면서 전문적인 조언을 제공합니다.
- 2026년 최신 트렌드와 약관 기준으로 설명합니다.
- 구체적인 수치와 사례로 신뢰감을 줍니다.

■ 2026년 보험 트렌드:
- 비갱신형 필수화 (갱신형 보험료 폭등 문제)
- 통합 보장 (암+뇌+심장 패키지)
- 실손보험 4세대 전환

■ 절대 금지: 사업비, 수수료, 운영비, 엄마 친구 설계사
`
  }

  return `${expertLogic}

########################################################################
#                   🚨 V33.0 절대 규칙 (ABSOLUTE RULES) 🚨              #
########################################################################

■ 고객 페르소나 (반드시 반영!):
- 나이: ${age} (${target})
- 성별: ${gender} ← 🚨 절대 틀리지 말 것!
- 직업/상황: ${occupation}

■ 핵심 고민 (모든 답변에 반영!):
"${concern}"

■ 보험 종류:
"${insuranceType}"

########################################################################
#                      📝 출력 형식 (엄수!)                             #
########################################################################

다음 형식으로만 출력하세요. 설명이나 구분선 없이 태그와 내용만!

[질문1]
(${target}이 네이버 카페에 올릴 법한 질문. 핵심고민 "${concern}" 반영. 150~250자)

[질문2]
(다른 각도에서 같은 고민을 가진 질문. 150~250자)

[답변1] - 공감형 멘토
(따뜻하게 공감하면서 조언. ${gender} 고객에게 맞는 말투. 500자 이상)

[답변2] - 데이터 분석가
(숫자와 통계로 객관적 분석. 구체적 금액/비율 포함. 500자 이상)

[답변3] - 현장 베테랑
(20년 경험 기반 실전 조언. 실제 사례 언급. 500자 이상)

[댓글1]
(질문자에게 공감하는 짧은 댓글. 50~100자)

[댓글2]
(추가 정보 제공하는 댓글. 50~100자)

[댓글3]
(경험담 공유하는 댓글. 50~100자)

[댓글4]
(조언하는 댓글. 50~100자)

[댓글5]
(응원하는 댓글. 50~100자)

########################################################################
#                      🚫 금지 사항                                     #
########################################################################
- 마크다운 표(|) 절대 금지
- "엄마 친구", "이모 설계사" 언급 금지
- "사업비", "수수료", "운영비" 단어 금지
- 성별(${gender}) 틀리면 실패!
`
}

// ========== V33.0: 텍스트 정리 함수 ==========
function cleanText(text: string): string {
  if (!text) return ''
  return text
    .replace(/\\n/g, '<br>')
    .replace(/\|/g, '<br>')
    .replace(/\+[-=]+\+/g, '<br>')
    .replace(/={3,}/g, '<br>')
    .replace(/\(Analysis\)/gi, '')
    .replace(/\(Comparison\)/gi, '')
    .replace(/\(Evidence\)/gi, '')
    .replace(/\(Action\)/gi, '')
    .replace(/\(Conclusion\)/gi, '')
    .replace(/#{1,6}\s*/g, '')
    .replace(/\*{2,}/g, '')
    .replace(/(<br>){3,}/g, '<br><br>')
    .trim()
}

// ========== 📝 Q&A 스트리밍 API ==========
app.post('/api/generate/qna-stream', async (c) => {
  const { target, tone, insuranceType, concern } = await c.req.json()
  const apiKey = getApiKey(c.env)
  
  if (!apiKey) {
    return c.json({ error: 'API 키가 설정되지 않았습니다.' }, 500)
  }

  // V33.0: 입력 텍스트에서 보험종류 자동 감지 (청개구리 방지)
  let finalType = insuranceType
  if (concern) {
    if (concern.includes('달러')) finalType = '달러종신보험'
    else if (concern.includes('CEO') || concern.includes('법인') || concern.includes('대표')) finalType = 'CEO/법인플랜'
    else if (concern.includes('치매') || concern.includes('간병') || concern.includes('요양')) finalType = '치매/간병보험'
    else if (concern.includes('상속') || concern.includes('증여')) finalType = '상속/증여 재원 플랜'
    else if (concern.includes('유병자') || concern.includes('3.5.5')) finalType = '유병자보험'
  }

  const { gender, age } = analyzeTarget(target)
  console.log(`[V33.0] 타겟 분석: ${target} → 성별: ${gender}, 나이: ${age}`)

  return streamText(c, async (stream) => {
    try {
      // 1단계: 시작
      await stream.write(JSON.stringify({ 
        type: 'status', 
        step: 1, 
        percent: 10,
        msg: '🔍 1단계: 타겟 및 고민 분석 중...' 
      }) + '\n')
      
      // 2단계: 전략 수립
      await stream.write(JSON.stringify({ 
        type: 'status', 
        step: 2, 
        percent: 25,
        msg: `⚖️ 2단계: ${finalType} 최적 로직 설계 중...` 
      }) + '\n')

      // 3단계: 콘텐츠 생성 시작
      await stream.write(JSON.stringify({ 
        type: 'status', 
        step: 3, 
        percent: 40,
        msg: '✍️ 3단계: 전문가 답변 작성 중...' 
      }) + '\n')

      // 프롬프트 생성
      const prompt = getExpertSystemPrompt(finalType, target, concern)

      // Gemini Pro 스트리밍 호출
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${SMART_MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { 
              temperature: 0.7, 
              topK: 40, 
              topP: 0.95, 
              maxOutputTokens: 8192 
            }
          })
        }
      )

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`)
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
                await stream.write(JSON.stringify({ 
                  type: 'content', 
                  data: text 
                }) + '\n')
              }
            } catch (e) {
              // JSON 파싱 실패 무시
            }
          }
        }
      }

      // 완료
      await stream.write(JSON.stringify({ 
        type: 'status', 
        step: 4, 
        percent: 100,
        msg: '✅ 완료!' 
      }) + '\n')
      
      await stream.write(JSON.stringify({ type: 'done' }) + '\n')

    } catch (error) {
      console.error('Streaming error:', error)
      await stream.write(JSON.stringify({ 
        type: 'error', 
        msg: '생성 중 오류가 발생했습니다.' 
      }) + '\n')
    }
  })
})

// ========== 기존 Q&A API (호환용) ==========
app.post('/api/generate/qna-full', async (c) => {
  const { target, tone, insuranceType, concern } = await c.req.json()
  const apiKey = getApiKey(c.env)
  
  if (!apiKey) {
    return c.json({ error: 'API 키 없음' }, 500)
  }

  const { gender, age } = analyzeTarget(target)
  const prompt = getExpertSystemPrompt(insuranceType, target, concern)

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${SMART_MODEL}:generateContent?key=${apiKey}`,
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
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

    // 파싱
    const q1Match = result.match(/\[질문1\]([\s\S]*?)(?=\[질문2\]|\[답변|\[댓글|$)/)
    const q2Match = result.match(/\[질문2\]([\s\S]*?)(?=\[답변|\[댓글|$)/)
    const a1Match = result.match(/\[답변1\]([\s\S]*?)(?=\[답변2\]|\[댓글|$)/)
    const a2Match = result.match(/\[답변2\]([\s\S]*?)(?=\[답변3\]|\[댓글|$)/)
    const a3Match = result.match(/\[답변3\]([\s\S]*?)(?=\[댓글|$)/)
    const commentMatches = result.matchAll(/\[댓글(\d)\]([\s\S]*?)(?=\[댓글|\[|$)/g)
    const comments: string[] = []
    for (const m of commentMatches) {
      comments.push(cleanText(m[2].trim()))
    }

    return c.json({
      success: true,
      data: {
        questions: [
          cleanText(q1Match?.[1]?.trim() || ''),
          cleanText(q2Match?.[1]?.trim() || '')
        ],
        answers: [
          cleanText(a1Match?.[1]?.trim() || ''),
          cleanText(a2Match?.[1]?.trim() || ''),
          cleanText(a3Match?.[1]?.trim() || '')
        ],
        comments,
        meta: { gender, age, insuranceType, target }
      }
    })
  } catch (error) {
    console.error('QnA error:', error)
    return c.json({ error: '생성 실패' }, 500)
  }
})

// ========== 📊 설계서 이미지 데이터 API ==========
app.post('/api/generate/proposal-image', async (c) => {
  const { insuranceType, companyName, customerAge, customerGender, monthlyPremium, target } = await c.req.json()
  const apiKey = getApiKey(c.env)
  
  // V33.0: target에서 성별/나이 자동 추출
  const analyzed = target ? analyzeTarget(target) : { gender: customerGender || '남성', age: customerAge || '40', ageNum: 40 }
  const gender = customerGender || analyzed.gender
  const age = customerAge || analyzed.age

  const prompt = `${insuranceType} (${gender}/${age}) 설계서 JSON 생성.
  
핵심 규칙:
1. 담보 15개 이상 생성
2. 성별(${gender})과 나이(${age}) 반드시 반영
3. 2026년 물가 기준 보험료 산정
4. 저축/연금보험이면 해지환급금 예시표로 대체

출력 형식 (JSON만 출력, 설명 없이):
{
  "product": "상품명",
  "items": [
    {"name": "담보명", "amount": "가입금액", "premium": "월보험료", "isHighlight": true/false}
  ],
  "total": "월납합계",
  "badPoints": ["문제점1", "문제점2"]
}`

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${FAST_MODEL}:generateContent?key=${apiKey}`,
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
      mode: 'universal-excel',
      data: {
        ...data,
        gender,
        age,
        companyName: companyName || '삼성생명',
        insuranceType,
        product: data.product || `${insuranceType} 마스터 플랜`,
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
    version: '33.0',
    features: [
      'gender-auto-detect',
      'progress-gauge-bar',
      'expert-prompt-v33',
      'inheritance-tax-logic',
      'ceo-corporate-logic',
      'nursing-care-logic',
      'streaming-api',
      'universal-excel-style',
      'no-bento-report'
    ],
    models: {
      fast: FAST_MODEL,
      smart: SMART_MODEL
    },
    highValueCategories: ['상속/증여', 'CEO/법인플랜', '치매/간병보험'],
    timestamp: new Date().toISOString()
  })
})

// ========== 🖥️ V33 UI (게이지 바 강화 + 리포트 삭제) ==========
const mainPageHtml = `
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>XIVIX 콘텐츠 마스터 V33</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://html2canvas.hertzen.com/dist/html2canvas.min.js"></script>
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { 
    background: #050505; 
    color: #ffffff; 
    font-family: 'Pretendard', -apple-system, sans-serif;
    min-height: 100vh;
  }
  
  /* 글래스 패널 */
  .glass-panel {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(10px);
    border-radius: 16px;
  }
  
  /* 칩 버튼 */
  .chip {
    background: #111;
    border: 1px solid #333;
    padding: 10px 16px;
    border-radius: 10px;
    font-size: 13px;
    color: #888;
    cursor: pointer;
    transition: all 0.2s;
  }
  .chip:hover {
    border-color: #555;
    color: #fff;
  }
  .chip.active {
    background: linear-gradient(135deg, #03C75A 0%, #00A84D 100%);
    border-color: #03C75A;
    color: #fff;
    font-weight: 600;
  }
  
  /* 프리미엄 칩 (황금색) */
  .chip-gold {
    border: 1px solid rgba(217, 119, 6, 0.5);
    color: #fbbf24;
    background: rgba(217, 119, 6, 0.1);
  }
  .chip-gold:hover {
    border-color: rgba(251, 191, 36, 0.7);
    color: #fde68a;
    background: rgba(217, 119, 6, 0.2);
  }
  .chip-gold.active {
    background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
    border-color: #fbbf24;
    color: #fff;
    box-shadow: 0 0 15px rgba(217, 119, 6, 0.4);
  }
  
  /* 메인 버튼 */
  .btn-primary {
    background: linear-gradient(135deg, #03C75A 0%, #00A84D 100%);
    border-radius: 12px;
    font-weight: 600;
    transition: all 0.2s;
  }
  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(3, 199, 90, 0.3);
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
  
  /* 게이지 바 */
  .gauge-bar {
    background: linear-gradient(90deg, #03C75A 0%, #00ff88 100%);
    transition: width 0.5s ease;
  }
  
  /* 흑백 엑셀 스타일 */
  .excel-sheet {
    background: white;
    color: black;
    padding: 30px;
    width: 100%;
    max-width: 600px;
    font-family: 'Malgun Gothic', 'Gulim', sans-serif;
    transform: rotate(-0.5deg);
    box-shadow: 8px 10px 25px rgba(0,0,0,0.5);
    border: 1px solid #ccc;
  }
  .excel-header {
    background: #444;
    color: white;
    padding: 12px;
    font-weight: bold;
    text-align: center;
    border: 1px solid #000;
    font-size: 16px;
  }
  .excel-row {
    display: flex;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid #ddd;
    border-left: 1px solid #000;
    border-right: 1px solid #000;
    font-size: 12px;
  }
  .excel-row:last-child {
    border-bottom: 1px solid #000;
  }
  .excel-row.highlight {
    background: #ffffcc;
  }
  
  /* 결과 영역 */
  .result-content {
    white-space: pre-wrap;
    line-height: 1.8;
    font-size: 14px;
  }
  .result-content [class*="질문"], .result-content [class*="답변"], .result-content [class*="댓글"] {
    display: block;
    margin: 15px 0;
  }
  
  /* 복사 버튼 */
  .copy-btn {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .copy-btn:hover {
    background: rgba(255,255,255,0.2);
  }
</style>
</head>
<body class="p-4 md:p-8">

<div class="max-w-7xl mx-auto">
  <!-- 헤더 -->
  <div class="flex justify-between items-center mb-8">
    <div>
      <h1 class="text-2xl font-bold">
        <span class="text-green-500">XIVIX</span>
        <span class="text-white text-sm font-normal ml-2">콘텐츠 마스터 V33</span>
      </h1>
      <p class="text-gray-500 text-xs mt-1">성별 자동 판별 • 게이지 바 • 고부가가치 프롬프트</p>
    </div>
    <div class="text-xs text-gray-600">
      <i class="fas fa-bolt text-yellow-500 mr-1"></i>Fast Engine Loaded
    </div>
  </div>

  <!-- 메인 그리드 -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
    
    <!-- 좌측: 입력 패널 -->
    <div class="lg:col-span-4 space-y-5">
      
      <!-- 핵심 고민 -->
      <div class="glass-panel p-5">
        <label class="block text-red-400 font-bold text-sm mb-3">
          <i class="fas fa-fire mr-1"></i>핵심 고민 (입력 우선)
        </label>
        <textarea id="concern" 
          class="w-full bg-black/50 border border-gray-700 rounded-xl p-4 text-white text-sm h-28 focus:border-green-500 outline-none transition resize-none"
          placeholder="예: 워킹맘인데 아이 증여 방법이 궁금해요"></textarea>
        <p class="text-gray-600 text-xs mt-2">💡 "달러", "CEO", "치매", "상속" 입력 시 자동 감지</p>
      </div>
      
      <!-- 보험 종류 -->
      <div class="glass-panel p-5">
        <label class="block text-blue-400 font-bold text-sm mb-3">
          <i class="fas fa-shield-alt mr-1"></i>보험 종류
        </label>
        <div class="flex flex-wrap gap-2" id="type-chips">
          <button class="chip active" onclick="selectChip(this, 'type')">종신보험</button>
          <button class="chip" onclick="selectChip(this, 'type')">암보험</button>
          <button class="chip" onclick="selectChip(this, 'type')">실손보험</button>
          <button class="chip" onclick="selectChip(this, 'type')">운전자보험</button>
          <button class="chip" onclick="selectChip(this, 'type')">달러종신</button>
          <button class="chip chip-gold" onclick="selectChip(this, 'type')">💰 상속/증여</button>
          <button class="chip chip-gold" onclick="selectChip(this, 'type')">💼 CEO/법인</button>
          <button class="chip chip-gold" onclick="selectChip(this, 'type')">🧠 치매/간병</button>
        </div>
      </div>
      
      <!-- 타겟 고객 -->
      <div class="glass-panel p-5">
        <label class="block text-purple-400 font-bold text-sm mb-3">
          <i class="fas fa-users mr-1"></i>타겟 고객
        </label>
        <div class="flex flex-wrap gap-2" id="target-chips">
          <button class="chip" onclick="selectChip(this, 'target')">20대 사회초년생</button>
          <button class="chip active" onclick="selectChip(this, 'target')">30대 워킹맘</button>
          <button class="chip" onclick="selectChip(this, 'target')">40대 가장</button>
          <button class="chip" onclick="selectChip(this, 'target')">50대 은퇴준비</button>
          <button class="chip" onclick="selectChip(this, 'target')">법인대표</button>
          <button class="chip" onclick="selectChip(this, 'target')">전업주부</button>
        </div>
        <p id="gender-indicator" class="text-xs mt-3 text-pink-400">
          <i class="fas fa-venus mr-1"></i>현재 타겟: 여성 (워킹맘)
        </p>
      </div>
      
      <!-- 생성 버튼 -->
      <button onclick="runGeneration()" id="btn-generate" 
        class="btn-primary w-full py-4 text-white font-bold text-base flex items-center justify-center gap-2">
        <i class="fas fa-magic"></i>
        <span>Q&A 자동 생성</span>
      </button>
      
    </div>
    
    <!-- 우측: 결과 패널 -->
    <div class="lg:col-span-8 space-y-5">
      
      <!-- 게이지 바 -->
      <div id="gauge-container" class="glass-panel p-4 hidden">
        <div class="flex justify-between items-center mb-2">
          <span id="gauge-text" class="text-green-400 text-sm font-medium">분석 중...</span>
          <span id="gauge-percent" class="text-green-400 text-sm font-bold">0%</span>
        </div>
        <div class="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
          <div id="gauge-bar" class="gauge-bar h-full rounded-full" style="width: 0%"></div>
        </div>
      </div>
      
      <!-- 결과 본문 -->
      <div id="result-body" class="glass-panel p-6 hidden min-h-[400px]">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-white font-bold">
            <i class="fas fa-comment-dots text-green-400 mr-2"></i>생성 결과
          </h3>
          <button onclick="copyAll()" class="copy-btn">
            <i class="fas fa-copy mr-1"></i>전체 복사
          </button>
        </div>
        <div id="result-content" class="result-content text-gray-300"></div>
      </div>
      
      <!-- 이미지 생성 -->
      <div class="glass-panel p-6">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-white font-bold">
            <i class="fas fa-image text-emerald-400 mr-2"></i>설계서 이미지
          </h3>
          <button onclick="generateImage()" class="copy-btn">
            <i class="fas fa-file-image mr-1"></i>이미지 생성
          </button>
        </div>
        <div id="image-area" class="flex justify-center bg-black/30 p-6 rounded-xl min-h-[200px]">
          <p class="text-gray-600 text-sm">버튼을 클릭하면 흑백 엑셀 스타일 설계서가 생성됩니다</p>
        </div>
      </div>
      
    </div>
  </div>
</div>

<script>
// 상태 관리
const state = {
  type: '종신보험',
  target: '30대 워킹맘'
};

// 성별 판별 함수
function detectGender(target) {
  if (target.includes('맘') || target.includes('엄마') || target.includes('여성') || 
      target.includes('주부') || target.includes('아내')) {
    return { gender: '여성', icon: 'fa-venus', color: 'text-pink-400' };
  }
  return { gender: '남성', icon: 'fa-mars', color: 'text-blue-400' };
}

// 칩 선택
function selectChip(el, key) {
  const container = el.parentElement;
  container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  state[key] = el.innerText.replace(/[💰💼🧠]/g, '').trim();
  
  // 타겟 선택 시 성별 표시 업데이트
  if (key === 'target') {
    const { gender, icon, color } = detectGender(state.target);
    document.getElementById('gender-indicator').innerHTML = 
      '<i class="fas ' + icon + ' mr-1"></i>현재 타겟: ' + gender + ' (' + state.target + ')';
    document.getElementById('gender-indicator').className = 'text-xs mt-3 ' + color;
  }
}

// 텍스트 정리
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\\\\n/g, '<br>')
    .replace(/\\n/g, '<br>')
    .replace(/\\|/g, '<br>')
    .replace(/#{1,6}\\s*/g, '')
    .replace(/\\*{2,}/g, '')
    .replace(/(<br>){3,}/g, '<br><br>');
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
  
  // UI 초기화
  gauge.classList.remove('hidden');
  resultBody.classList.remove('hidden');
  content.innerHTML = '';
  btn.disabled = true;
  bar.style.width = '5%';
  percent.innerText = '5%';
  text.innerText = '🚀 시작 중...';
  
  try {
    const response = await fetch('/api/generate/qna-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...state,
        insuranceType: state.type,
        concern: document.getElementById('concern').value || state.type + ' 관련 궁금한 점이 있어요'
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
            content.innerHTML += cleanText(json.data);
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
    content.innerHTML = '<span class="text-red-400">오류 발생: ' + e.message + '</span>';
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
  const area = document.getElementById('image-area');
  area.innerHTML = '<span class="text-green-400 animate-pulse"><i class="fas fa-spinner fa-spin mr-2"></i>설계서 데이터 생성 중...</span>';
  
  try {
    const response = await fetch('/api/generate/proposal-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        insuranceType: state.type,
        target: state.target
      })
    });
    
    const json = await response.json();
    
    if (json.success) {
      const d = json.data;
      let html = '<div class="excel-sheet">';
      html += '<div class="excel-header">' + (d.product || state.type + ' 마스터 플랜') + '</div>';
      html += '<div style="padding:15px 12px; font-size:12px; border-bottom:1px solid #000; border-left:1px solid #000; border-right:1px solid #000;">';
      html += '피보험자: ' + state.target + ' / ' + d.gender + ' / ' + d.age;
      html += '</div>';
      
      if (d.items && d.items.length > 0) {
        d.items.forEach((item, i) => {
          const cls = item.isHighlight ? 'excel-row highlight' : 'excel-row';
          html += '<div class="' + cls + '">';
          html += '<span>' + item.name + '</span>';
          html += '<span style="font-weight:bold;">' + item.amount + '</span>';
          html += '</div>';
        });
      }
      
      html += '<div style="text-align:right; padding:15px; font-size:18px; font-weight:bold; border:1px solid #000; border-top:2px solid #000;">';
      html += '월 납입보험료: ' + (d.total || '계산 중');
      html += '</div>';
      html += '</div>';
      
      area.innerHTML = html;
    } else {
      area.innerHTML = '<span class="text-red-400">생성 실패</span>';
    }
  } catch(e) {
    area.innerHTML = '<span class="text-red-400">오류: ' + e.message + '</span>';
  }
}

// 초기화
document.addEventListener('DOMContentLoaded', () => {
  selectChip(document.querySelector('#target-chips .chip.active'), 'target');
});
</script>

</body>
</html>
`

app.get('/', (c) => c.html(mainPageHtml))

export default app
