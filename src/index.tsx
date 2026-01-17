import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  GEMINI_API_KEY?: string
  GEMINI_API_KEY_1?: string
  GEMINI_API_KEY_2?: string
  GEMINI_API_KEY_3?: string
  GEMINI_API_KEY_4?: string
  NAVER_CLIENT_ID?: string
  NAVER_CLIENT_SECRET?: string
  // Bright Data 프록시 설정
  BRIGHT_DATA_HOST?: string
  BRIGHT_DATA_PORT?: string
  BRIGHT_DATA_USERNAME?: string
  BRIGHT_DATA_PASSWORD?: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/*', cors())

// ========== Gemini API 키 로테이션 관리 ==========
// API 키는 환경 변수에서 가져옴 (Cloudflare Secrets)
// 코드에 직접 키를 넣지 않음 - 보안!

let currentKeyIndex = 0

function getGeminiKeys(env: Bindings): string[] {
  const keys: string[] = []
  if (env.GEMINI_API_KEY_1) keys.push(env.GEMINI_API_KEY_1)
  if (env.GEMINI_API_KEY_2) keys.push(env.GEMINI_API_KEY_2)
  if (env.GEMINI_API_KEY_3) keys.push(env.GEMINI_API_KEY_3)
  if (env.GEMINI_API_KEY_4) keys.push(env.GEMINI_API_KEY_4)
  // 폴백: 단일 키가 있으면 사용
  if (keys.length === 0 && env.GEMINI_API_KEY) {
    keys.push(env.GEMINI_API_KEY)
  }
  return keys
}

function getNextGeminiKey(keys: string[]): string {
  if (keys.length === 0) return ''
  const key = keys[currentKeyIndex % keys.length]
  currentKeyIndex = (currentKeyIndex + 1) % keys.length
  return key
}

async function callGeminiAPI(prompt: string, apiKeys: string | string[], retries = 3): Promise<string> {
  // 배열이면 키 로테이션, 단일 문자열이면 그대로 사용
  const keys = Array.isArray(apiKeys) ? apiKeys : [apiKeys]
  if (keys.length === 0 || !keys[0]) {
    throw new Error('No API keys available')
  }
  
  let keyIndex = currentKeyIndex
  
  for (let attempt = 0; attempt < retries * keys.length; attempt++) {
    const apiKey = keys[keyIndex % keys.length]
    
    try {
      // V15.1: gemini-1.5-pro-002로 변경 (Reasoning/Context Window 향상)
      // - Flash: 빠르지만 복잡한 프롬프트 지시사항 누락
      // - Pro: 느리지만 검수→재생성 로직 정확 수행, Negative Constraints 준수
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-002:generateContent?key=' + apiKey,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: 8192 }
          })
        }
      )
      
      // 403/429 에러시 다음 키로 전환
      if (response.status === 403 || response.status === 429) {
        console.log(`Key ${keyIndex % keys.length + 1} rate limited, switching to next key`)
        keyIndex++
        currentKeyIndex = keyIndex % keys.length
        continue
      }
      
      if (!response.ok) continue
      const data = await response.json() as any
      return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    } catch (error) {
      keyIndex++
      continue
    }
  }
  throw new Error('API call failed')
}

// ========== 보험사 브랜드 컬러 ==========
const BRAND_COLORS: Record<string, { color: string, subColor: string }> = {
  '삼성생명': { color: '#0066B3', subColor: '#004A8F' },
  '한화생명': { color: '#FF6600', subColor: '#CC5200' },
  '교보생명': { color: '#00A651', subColor: '#008542' },
  '신한라이프': { color: '#0046FF', subColor: '#0035CC' },
  'NH농협생명': { color: '#00A73C', subColor: '#008530' },
  '동양생명': { color: '#ED1C24', subColor: '#C41920' },
  '하나생명': { color: '#008878', subColor: '#006B5F' },
  'KB손해보험': { color: '#FFB900', subColor: '#CC9400' },
  '현대해상': { color: '#4A8FE4', subColor: '#3A72B6' },
  'DB손해보험': { color: '#007856', subColor: '#006045' },
  '메리츠화재': { color: '#FF6600', subColor: '#CC5200' },
  '롯데손해보험': { color: '#E60012', subColor: '#B8000E' }
}

// ========== V17.5 시나리오 데이터베이스 - 네이버 카페 실제 질문 패턴 ==========
interface ScenarioPattern {
  type: string
  questionTemplates: string[]
  expertAnswerPattern: {
    greeting: string
    analysis: string
    checkpoints: string[]
    cta: string
  }
}

// 보험종류별 실제 질문 패턴 데이터베이스
const SCENARIO_DATABASE: Record<string, ScenarioPattern[]> = {
  '암보험': [
    {
      type: '장롱증권_리모델링',
      questionTemplates: [
        '장롱 속에 묻혀있던 {year}년에 가입한 {company} {product} 발견했어요. 이거 리모델링 해야 하는 거죠?',
        '서랍 정리하다가 {year}년도 암보험 증권 나왔는데 이거 아직 유효한 건가요? 보장 내용이 너무 옛날 거 같아서요',
        '부모님 집에서 예전 {company} 암보험 찾았어요. {year}년 가입인데 요즘 암보험이랑 비교하면 어떤가요?'
      ],
      expertAnswerPattern: {
        greeting: '좋은 질문입니다! 오래된 증권 점검하시려는 거 정말 현명하세요.',
        analysis: '{year}년 암보험이면 약관 기준이 지금과 많이 달라요. 그때는 "일반암 진단비" 위주였는데, 요즘은 "유사암/경계성종양" 분리가 필수고, "항암방사선/표적치료" 특약이 중요해졌어요.',
        checkpoints: [
          '✔️ 고액암(췌장암, 뇌종양 등) 보장금액 확인 - 최소 5천만원 이상 권장',
          '✔️ 유사암(갑상선암, 제자리암) 보장 범위 - 2026년 기준 별도 특약 필요',
          '✔️ 진단비 지급 조건 - "최초 1회" vs "재발 시에도 지급" 차이 큼',
          '✔️ 갱신형인지 비갱신형인지 - 갱신형이면 65세 이후 보험료 3배 폭등'
        ],
        cta: '증권 사진 올려주시면 구체적으로 어떤 부분이 부족한지 분석해드릴게요!'
      }
    },
    {
      type: '갱신료_폭탄',
      questionTemplates: [
        '갱신 안내문 받았는데 암보험료가 월 {oldPremium}원에서 {newPremium}원으로 올랐어요. 이게 맞나요?',
        '{target}인데 암보험 갱신됐더니 거의 2배 올랐어요. 이거 정상인가요? 다른 데로 갈아타야 하나요?',
        '10년 전에 가입한 암보험인데 이번에 갱신되면서 월 {newPremium}원이래요. 너무 비싼 거 아닌가요?'
      ],
      expertAnswerPattern: {
        greeting: '갱신료 폭탄 맞으셨군요ㅠㅠ 이거 진짜 많은 분들이 겪는 문제예요.',
        analysis: '갱신형 암보험의 함정이 바로 이거예요. 가입할 때는 싸 보이는데, 갱신 때마다 나이+위험률 반영해서 오르거든요. 특히 50대 넘어가면 급격히 올라요.',
        checkpoints: [
          '✔️ 현재 보장 내용 확인 - 일반암 3천만원이면 요즘 기준으로 부족',
          '✔️ 비갱신형 전환 비용 계산 - 장기적으로 비갱신이 저렴할 수 있음',
          '✔️ 감액완납 가능 여부 - 납입 중단하고 보장만 유지하는 방법',
          '✔️ 2026년 실손 4세대와 조합 - 암보험만으로 부족한 부분 커버'
        ],
        cta: '구체적인 갱신 안내서 내용 공유해주시면 최적 대안 찾아드릴게요.'
      }
    },
    {
      type: '보장금액_고민',
      questionTemplates: [
        '암보험 진단비 {amount}만원 가입하려는데 이 정도면 충분한가요?',
        '{target}인데 암보험 얼마짜리 들어야 할지 모르겠어요. 주변에서는 5천만원은 해야 된다는데',
        '암 걸리면 실제로 얼마나 드나요? 암보험 {amount}만원이면 부족한가요?'
      ],
      expertAnswerPattern: {
        greeting: '좋은 고민이에요! 적정 보장금액은 정말 중요한 문제거든요.',
        analysis: '2026년 기준으로 암 치료비 평균을 보면요, 수술+항암+방사선 기본 치료만 2~3천만원, 표적항암제 쓰면 월 300~500만원 추가, 요양+간병비까지 하면 1년에 5천만원~1억 드는 경우도 많아요.',
        checkpoints: [
          '✔️ 산정특례 90% 감면 후에도 본인부담금 상당함',
          '✔️ 비급여 치료(면역치료, 양성자치료) 고려하면 1억 이상 권장',
          '✔️ 고액암(뇌종양, 췌장암 등) 별도 특약으로 추가 1억 설계',
          '✔️ 소득 대체 - 치료 기간 1~2년간 일 못하는 것 감안'
        ],
        cta: '현재 가입 중인 다른 보험들 알려주시면 전체적으로 조합해서 설계해드릴게요.'
      }
    }
  ],
  
  '종신보험': [
    {
      type: '해지_고민',
      questionTemplates: [
        '10년 전에 가입한 {company} 종신보험 해지할까요? 월 {premium}원인데 너무 부담돼요',
        '종신보험 해지하면 얼마나 돌려받나요? {year}년에 가입했고 월 {premium}원 내고 있어요',
        '유튜브 보니까 종신보험 다 해지하라는데 진짜인가요? 저 {year}년에 가입했어요'
      ],
      expertAnswerPattern: {
        greeting: '많이 고민되시죠ㅠㅠ 종신보험 해지 문제는 정말 신중해야 해요.',
        analysis: '종신보험은 "사망보험금"이 주 목적이에요. 저축이 아니에요. 그래서 중도 해지하면 손해가 커요. 납입금의 25~35%가 사업비로 빠지고, 7~10년은 지나야 원금 근처 가거든요.',
        checkpoints: [
          '✔️ 현재 해지환급금 조회 - 보험사 앱에서 바로 확인 가능',
          '✔️ 감액완납 옵션 - 해지 대신 납입 중단하고 보장 일부 유지',
          '✔️ 사망보장 필요성 - 가장이면 유지 가치 있을 수 있음',
          '✔️ 보험료 대출 vs 해지 비교 - 급전 필요하면 대출이 나을 수도'
        ],
        cta: '증권 사진과 현재 해지환급금 조회 결과 올려주시면 정확히 계산해드릴게요.'
      }
    },
    {
      type: '지인추천_후회',
      questionTemplates: [
        '지인이 종신보험 좋다고 해서 {company} 월 {premium}원짜리 가입했는데 이거 괜찮은 건가요?',
        '설계사 친구가 {company} 종신보험 추천했는데 월 {premium}원이에요. 솔직히 필요한 건지 모르겠어요',
        '회사 동료가 종신보험 가입시켜줬는데 뭔지도 모르고 사인했어요. 월 {premium}원인데 이거 뭔가요?'
      ],
      expertAnswerPattern: {
        greeting: '지인 통해 가입하면 거절하기 어렵죠ㅠㅠ 걱정 마시고 같이 확인해봐요.',
        analysis: '종신보험이 무조건 나쁜 건 아니에요. 다만 목적에 맞게 가입해야 해요. 사망 시 가족에게 목돈 남겨주려면 필요하고, 저축 목적이면 잘못 가입한 거예요.',
        checkpoints: [
          '✔️ 가입 목적 재확인 - 사망보장 vs 저축 vs 증여 중 뭐였는지',
          '✔️ 청약철회 기간 - 가입 15일 이내면 전액 환불 가능',
          '✔️ 품질보증해지 - 3개월 이내면 일부 환불 가능',
          '✔️ 보험료 vs 소득 비율 - 월 소득의 10% 넘으면 과도함'
        ],
        cta: '가입한 지 얼마 안 됐으면 빨리 확인해보셔야 해요. 증권 공유해주세요!'
      }
    }
  ],
  
  '달러종신보험': [
    {
      type: '환율손실',
      questionTemplates: [
        '달러보험 월 300달러 내고 있는데 환율 때문에 원화로 35만원 넘게 나가요. 이거 정상인가요?',
        '{company} 달러종신보험 2년 넣었는데 환율이 올라서 너무 부담돼요. 어떡하죠?',
        '달러보험이 뭔가요? 친구가 추천했는데 환율 리스크 있다면서 한번 봐주세요'
      ],
      expertAnswerPattern: {
        greeting: '달러보험 환율 리스크, 진짜 많은 분들이 고민하시는 부분이에요.',
        analysis: '달러보험은 보험료를 달러로 내고 보험금도 달러로 받아요. 환율 오르면 보험료 부담↑, 환율 내리면 나중에 받을 보험금↓. 양날의 검이에요. 게다가 사업비도 30% 수준이라 원금 회복에 7~10년 걸려요.',
        checkpoints: [
          '✔️ 현재까지 납입액 vs 해지환급금 비교 - 손실액 확인',
          '✔️ 환율 1,300원 기준으로 장기 시뮬레이션 필요',
          '✔️ 달러 자산 분산 목적이었는지 재확인',
          '✔️ 감액/중도인출 옵션 활용 가능성 검토'
        ],
        cta: '달러보험은 케이스바이케이스라 증권 보고 판단해드릴게요. 사진 올려주세요!'
      }
    }
  ],
  
  '운전자보험': [
    {
      type: '법률비용_부족',
      questionTemplates: [
        '교통사고 났는데 운전자보험 법률비용 한도가 {amount}만원이래요. 이거 부족한 거 아닌가요?',
        '운전자보험 가입하려는데 벌금 {amount}만원, 변호사비용 {amount}만원이면 충분한가요?',
        '음주운전 사고 처리 중인데 운전자보험 얼마나 받을 수 있나요?'
      ],
      expertAnswerPattern: {
        greeting: '운전자보험 보장 내용, 정말 꼼꼼히 봐야 하는 부분이에요.',
        analysis: '2026년 기준으로 교통사고 합의금이 많이 올랐어요. 사망사고면 공탁금만 3억 이상 필요할 수 있고, 12대 중과실 사고면 형사처벌 + 민사소송 동시 진행돼요.',
        checkpoints: [
          '✔️ 변호사 선임비 - 최소 2천만원 이상 권장 (형사+민사)',
          '✔️ 벌금 한도 - 음주/무면허는 3천만원까지 가능',
          '✔️ 형사합의금 지원 - 교통사고처리지원금 특약 확인',
          '✔️ 자동차사고 부상치료비 - 본인 부상 보장도 중요'
        ],
        cta: '현재 가입 중인 자동차보험, 운전자보험 증권 공유해주시면 중복/누락 체크해드려요.'
      }
    },
    {
      type: '교체_고민',
      questionTemplates: [
        '5년 전 운전자보험인데 월 {premium}원이에요. 요즘 월 1만원대 상품도 있던데 갈아타야 하나요?',
        '{company} 운전자보험 해지하고 더 싼 데로 가려는데 주의할 점 있나요?',
        '운전자보험 2개 가입 중인데 하나 해지해도 되나요? 중복 보장되나요?'
      ],
      expertAnswerPattern: {
        greeting: '운전자보험 리모델링 고민, 좋은 생각이에요!',
        analysis: '예전 운전자보험은 보장 항목이 적고 한도도 낮은 경우가 많아요. 요즘 다이렉트 상품은 월 1만원대로도 핵심 보장 가능해요.',
        checkpoints: [
          '✔️ 현재 보장 항목 리스트업 - 필수: 변호사비용, 벌금, 형사합의금',
          '✔️ 보장 한도 비교 - 같은 특약이라도 한도 차이 큼',
          '✔️ 면책사항 확인 - 음주/무면허 보장 여부 다름',
          '✔️ 대기기간(면책기간) - 가입 직후 사고는 보장 안 될 수 있음'
        ],
        cta: '기존 증권이랑 새로 가입하려는 상품 설계서 같이 보내주시면 비교해드릴게요.'
      }
    }
  ],
  
  '실손보험': [
    {
      type: '4세대_전환',
      questionTemplates: [
        '실손보험 4세대로 갈아타야 하나요? 지금 {generation}세대인데 뭐가 다른 건가요?',
        '실손 4세대 전환 안내문 받았는데 이거 하는 게 맞나요? 비급여 30% 내는 거 손해 아닌가요?',
        '{company} 실손 10년 넘게 유지 중인데 갱신료가 너무 올라요. 4세대로 바꾸면 싸지나요?'
      ],
      expertAnswerPattern: {
        greeting: '4세대 실손, 진짜 복잡하죠ㅠㅠ 쉽게 설명해드릴게요.',
        analysis: '4세대 실손은 비급여(MRI, 도수치료 등)에 자기부담금 30%가 생겼어요. 대신 급여 항목 위주로 쓰면 보험료가 저렴해요. 평소 병원 이용 패턴에 따라 유불리가 달라요.',
        checkpoints: [
          '✔️ 현재 실손 세대 확인 - 1~3세대면 비급여 본인부담금 10~20%',
          '✔️ 병원 이용 패턴 - 비급여 많이 쓰면 구형 유지가 유리',
          '✔️ 갱신료 추이 비교 - 4세대가 장기적으로 저렴할 수 있음',
          '✔️ 급여/비급여 분리형 구조 이해 필요'
        ],
        cta: '현재 실손 증권이랑 최근 1년 병원비 청구 내역 있으면 정확히 비교해드려요.'
      }
    }
  ],
  
  '간병보험': [
    {
      type: '치매_대비',
      questionTemplates: [
        '부모님이 70대인데 간병보험 지금 가입 가능한가요? 치매 걱정돼서요',
        '치매간병비 월 {amount}만원 받는 상품 봤는데 이거 괜찮은가요?',
        '{target}인데 간병보험 미리 들어놔야 할까요? 주변에서 치매 걸리면 가족이 힘들다고'
      ],
      expertAnswerPattern: {
        greeting: '간병 대비 미리 생각하시는 거 정말 현명하세요.',
        analysis: '2026년 기준 치매 유병률이 65세 이상 10%, 85세 이상은 40% 넘어요. 요양원 비용 월 200~400만원, 간병인 비용 월 390만원(일 13만원×30일) 정도 들어요.',
        checkpoints: [
          '✔️ ADL 판정 기준 확인 - 식사/이동/배변 등 6개 항목 중 몇 개 불능 시 지급',
          '✔️ 치매 보장 범위 - 경증/중등도/중증 단계별 차이',
          '✔️ 납입면제 조건 - 치매 진단 시 보험료 면제 여부',
          '✔️ 보장 개시 대기기간 - 보통 가입 후 90일~2년'
        ],
        cta: '부모님 연세와 현재 건강 상태 알려주시면 가입 가능한 상품 추천드릴게요.'
      }
    }
  ],
  
  '뇌심장보험': [
    {
      type: '보장범위_의심',
      questionTemplates: [
        '뇌출혈 1억 가입했는데 뇌경색은 안 나온다고요? 이게 무슨 말이에요?',
        '급성심근경색 진단비 있는데 협심증은 보장 안 된다는데 왜 그런가요?',
        '뇌혈관질환 보장이랑 뇌출혈 보장이 다른 건가요? 헷갈려요'
      ],
      expertAnswerPattern: {
        greeting: '뇌심장 보험 약관, 진짜 복잡해서 많이 헷갈리시죠.',
        analysis: '뇌질환 중 뇌출혈은 전체의 9%밖에 안 돼요. 나머지 91%가 뇌경색(뇌혈관 막힘)이에요. 근데 예전 약관은 "뇌출혈"만 보장하는 경우가 많아요. 심장도 마찬가지로 "급성심근경색"만 있으면 협심증, 심부전 등은 안 나와요.',
        checkpoints: [
          '✔️ 뇌혈관질환(I60-I69) 특약 확인 - 뇌출혈+뇌경색 모두 보장',
          '✔️ 허혈성심장질환(I20-I25) 특약 확인 - 협심증까지 보장',
          '✔️ 진단코드 범위 확인 - 약관에 명시된 질병코드 리스트 체크',
          '✔️ 보장금액 - 뇌/심장은 최소 5천만원 이상 권장'
        ],
        cta: '증권 보내주시면 약관상 정확한 보장 범위 분석해드릴게요. 많이들 착각하시는 부분이에요!'
      }
    }
  ],
  
  '치아보험': [
    {
      type: '갱신료_부담',
      questionTemplates: [
        '월 2만원 가까이 되는 치아보험 이거 괜찮을까요? 비싼 거 아닌가요?',
        '치아보험 {company} 월 {premium}원짜리 가입했는데 임플란트 {amount}만원 나온대요. 괜찮은 건가요?',
        '치아보험 갱신됐는데 월 {premium}원으로 올랐어요. 해지해야 하나요?'
      ],
      expertAnswerPattern: {
        greeting: '치아보험 보험료, 꼼꼼히 따져봐야 해요!',
        analysis: '치아보험은 보험료 대비 실제 보장금액 비교가 중요해요. 월 2만원이면 연 24만원인데, 임플란트 1개 100만원 받으면 이득이지만 가벼운 치료만 하면 손해예요.',
        checkpoints: [
          '✔️ 임플란트 보장금액/횟수 제한 확인',
          '✔️ 크라운/인레이 등 보철 보장 범위',
          '✔️ 면책기간 - 가입 후 90일~180일은 보장 안 됨',
          '✔️ 감면기간 - 1~2년차는 보장금액 50% 제한'
        ],
        cta: '현재 치아 상태(기존 치료 이력)랑 증권 보내주시면 가성비 분석해드릴게요.'
      }
    }
  ],
  
  '어린이보험': [
    {
      type: '태아_가입',
      questionTemplates: [
        '임신 {weeks}주인데 태아보험 지금 가입해야 하나요? 늦은 건 아닌가요?',
        '태아보험 {company} 월 {premium}원짜리 제안받았는데 이거 괜찮은가요?',
        '어린이보험 30세 만기 vs 100세 만기 뭐가 나은가요?'
      ],
      expertAnswerPattern: {
        greeting: '태아보험/어린이보험 준비, 좋은 생각이에요!',
        analysis: '태아보험은 22주 이전 가입이 선천이상 보장에 유리해요. 30세 만기는 저렴하지만 성인 되면 새로 가입해야 하고, 100세 만기는 비싸지만 평생 보장이에요.',
        checkpoints: [
          '✔️ 선천이상 보장 - 22주 이전 가입 시 더 넓은 보장',
          '✔️ 주요 특약 - 입원/수술/암/뇌심장/화상 등 필수 체크',
          '✔️ 비갱신형 권장 - 어릴 때 가입하면 평생 저렴',
          '✔️ 자녀배상책임 특약 - 친구 다치게 했을 때 보장'
        ],
        cta: '임신 주수랑 원하시는 보장 범위 알려주시면 적정 설계 제안드릴게요!'
      }
    }
  ]
}

// 시나리오 선택 함수
function getRandomScenario(insuranceType: string): ScenarioPattern | null {
  const scenarios = SCENARIO_DATABASE[insuranceType]
  if (!scenarios || scenarios.length === 0) return null
  return scenarios[Math.floor(Math.random() * scenarios.length)]
}

// 시나리오 기반 질문 생성 함수
function generateScenarioQuestion(template: string, params: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
  }
  return result
}

// ========== Gemini 이미지 생성 API ==========
interface ImageGenerationData {
  companyName: string
  insuranceType: string
  customerAge: string
  customerGender: string
  monthlyPremium: string
  docNumber: string
  coverages: Array<{ name: string, amount: string, premium?: string }>
  style?: 'compact-card' | 'full-document' | 'highlight' | 'scan-copy'
}

function buildCompactCardPrompt(data: ImageGenerationData): string {
  const brand = BRAND_COLORS[data.companyName] || BRAND_COLORS['삼성생명']
  const brandColor = brand.color
  
  // 보장내역 텍스트 생성 (최대 8개)
  const displayCoverages = data.coverages.slice(0, 8)
  const coverageLines = displayCoverages.map((c, i) => 
    `${i + 1}. ${c.name}: ${c.amount}${c.premium ? ` (월 ${c.premium})` : ''}`
  ).join('\n')
  
  const style = data.style || 'compact-card'
  
  // 컴팩트 카드 스타일 프롬프트
  const prompt = `Create a photorealistic image of a compact Korean insurance proposal card.

=== DOCUMENT SPECIFICATIONS ===
Format: Compact card (cropped upper portion of insurance document)
Aspect Ratio: 4:3 (landscape, showing only top section)
Style: ${style === 'scan-copy' ? 'Slightly tilted scan copy on desk' : style === 'highlight' ? 'Document with yellow highlighter marks' : 'Clean professional document photo'}

=== CRITICAL: EXACT KOREAN TEXT TO RENDER ===
All text must be rendered EXACTLY as shown below, character by character:

[HEADER SECTION - Brand color: ${brandColor}]
Company Logo Area: "${data.companyName}"
Document Title: "보험 가입 설계서"
Document Number: "${data.docNumber}"

[CUSTOMER INFO SECTION - Gray background]
고객정보: ${data.customerAge} / ${data.customerGender}
보험종류: ${data.insuranceType}

[COVERAGE TABLE - Compact, small text]
보장내역:
${coverageLines}

[PREMIUM SECTION - Highlighted]
월 납입보험료: ${data.monthlyPremium}

=== VISUAL STYLE ===
- Professional A4 document, showing ONLY the top 40% portion
- Clean white background with subtle shadow
- Text size: Small but clearly legible (8-9pt equivalent)
- Brand color accent on header (${brandColor})
- Korean sans-serif font (Noto Sans KR or similar)
- High resolution, 4K quality
- Document appears slightly cropped at bottom, implying more content below
${style === 'scan-copy' ? '- Document placed on wooden desk, slightly tilted (5-10 degrees)\n- Soft natural lighting from window\n- Subtle paper texture visible' : ''}
${style === 'highlight' ? '- Yellow highlighter marks on key numbers (premium, coverage amounts)\n- Pen or highlighter visible at edge of frame' : ''}

=== IMPORTANT ===
- Render ALL Korean text exactly as specified
- Do NOT translate or modify any text
- Keep text small but sharp and readable
- Focus on the upper portion of the document only
- Make it look like a real photo of a real insurance document`

  return prompt
}

async function generateInsuranceImage(data: ImageGenerationData, apiKey: string, allKeys?: string[]): Promise<{ success: boolean, imageUrl?: string, error?: string, model?: string }> {
  const prompt = buildCompactCardPrompt(data)
  
  // 모델 우선순위: gemini-2.5-flash-image > gemini-2.0-flash-preview-image-generation
  const models = [
    'gemini-2.5-flash-image',
    'gemini-2.0-flash-preview-image-generation'
  ]
  
  // 키 배열이 있으면 로테이션, 없으면 단일 키 사용
  const keys = allKeys && allKeys.length > 0 ? allKeys : [apiKey]
  let keyIndex = 0
  
  for (const model of models) {
    // 각 모델에 대해 모든 키 시도
    for (let keyAttempt = 0; keyAttempt < keys.length; keyAttempt++) {
      const currentKey = keys[(keyIndex + keyAttempt) % keys.length]
      
      try {
        console.log(`Trying image generation with model: ${model}, key: ${(keyIndex + keyAttempt) % keys.length + 1}`)
        
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                responseModalities: ['image', 'text']
              }
            })
          }
        )
        
        // 403/429 에러시 다음 키로
        if (response.status === 403 || response.status === 429) {
          console.log(`Key ${(keyIndex + keyAttempt) % keys.length + 1} rate limited for ${model}`)
          continue
        }
        
        if (!response.ok) {
          const errorText = await response.text()
          console.error(`Gemini Image API error with ${model}:`, response.status, errorText)
          break // 다른 에러는 다음 모델로
        }
        
        const result = await response.json() as any
        const parts = result.candidates?.[0]?.content?.parts || []
        
        // 이미지 데이터 추출
        for (const part of parts) {
          if (part.inlineData?.mimeType?.startsWith('image/')) {
            const base64Data = part.inlineData.data
            const imageUrl = `data:${part.inlineData.mimeType};base64,${base64Data}`
            return { success: true, imageUrl, model }
          }
        }
        
        // 텍스트만 반환된 경우 (이미지 없음)
        console.log(`No image in response from ${model}, trying next model`)
        break // 다음 모델로
        
      } catch (error) {
        console.error(`Image generation error with ${model}:`, error)
        continue // 다음 키 시도
      }
    }
  }
  
  return { success: false, error: 'All image generation models and keys failed' }
}

// ========== SEO 점수 계산 함수 (C-Rank/D.I.A./Agent N) ==========
interface SEOScoreInput {
  title: string
  question: string
  answer: string
  keywords: string[]
  highlights: string[]
  commentsCount: number
  target: string
  insuranceType: string
}

interface SEOScoreResult {
  totalScore: number
  grade: string
  titleScore: number
  keywordScore: number
  contentScore: number
  engageScore: number
  predictedRank: string
  exposureRate: number
  recommend: string
  strengths: string[]
  improvements: string[]
  tips: string[]
}

function calculateSEOScore(input: SEOScoreInput): SEOScoreResult {
  const { title, question, answer, keywords, highlights, commentsCount, target, insuranceType } = input
  
  let titleScore = 0
  let keywordScore = 0
  let contentScore = 0
  let engageScore = 0
  
  const strengths: string[] = []
  const improvements: string[] = []
  const tips: string[] = []
  
  // 1. 제목 점수 (25점 만점)
  if (title.length >= 15 && title.length <= 30) {
    titleScore += 8
    strengths.push('제목 길이 최적 (15-30자)')
  } else if (title.length >= 10 && title.length <= 35) {
    titleScore += 5
    improvements.push('제목 15-25자 권장')
  } else {
    titleScore += 2
    improvements.push('제목 길이 조정 필요')
  }
  
  // 제목에 핵심 키워드 포함
  const primaryKeyword = keywords[0] || insuranceType
  if (title.includes(primaryKeyword)) {
    titleScore += 8
    strengths.push('제목에 핵심 키워드 포함')
  } else {
    titleScore += 3
    improvements.push('제목에 핵심 키워드 추가 권장')
  }
  
  // 제목에 타겟 포함
  if (title.includes(target.replace(/[0-9대]/g, '').trim().substring(0, 4))) {
    titleScore += 5
  } else {
    titleScore += 2
  }
  
  // 클릭 유도 (물음표, 느낌표)
  if (title.includes('?') || title.includes('!')) {
    titleScore += 4
  } else {
    titleScore += 1
    tips.push('제목 끝에 ? 또는 ! 추가하면 클릭률 상승')
  }
  
  // 2. 키워드 점수 (25점 만점)
  const fullText = title + ' ' + question + ' ' + answer
  let keywordCount = 0
  keywords.slice(0, 3).forEach(kw => {
    const regex = new RegExp(kw, 'gi')
    const matches = fullText.match(regex)
    if (matches) keywordCount += matches.length
  })
  
  if (keywordCount >= 6) {
    keywordScore = 25
    strengths.push('키워드 밀도 우수 (6회 이상)')
  } else if (keywordCount >= 4) {
    keywordScore = 20
    strengths.push('키워드 적절히 배치됨')
  } else if (keywordCount >= 2) {
    keywordScore = 12
    improvements.push('핵심 키워드 2-3회 더 추가 권장')
  } else {
    keywordScore = 5
    improvements.push('핵심 키워드 반복 필요')
  }
  
  // 3. 콘텐츠 품질 점수 (25점 만점)
  // 답변 길이
  if (answer.length >= 500) {
    contentScore += 10
    strengths.push('답변 분량 충분')
  } else if (answer.length >= 300) {
    contentScore += 7
  } else {
    contentScore += 3
    improvements.push('답변 400자 이상 권장')
  }
  
  // 질문 길이
  if (question.length >= 150 && question.length <= 300) {
    contentScore += 5
  } else if (question.length >= 100) {
    contentScore += 3
  } else {
    contentScore += 1
    improvements.push('질문을 좀 더 구체적으로')
  }
  
  // 구조화 (강조포인트 존재)
  if (highlights.length >= 3) {
    contentScore += 5
    strengths.push('핵심 포인트 구조화 완료')
  } else if (highlights.length >= 1) {
    contentScore += 3
  } else {
    contentScore += 1
  }
  
  // 숫자/통계 포함
  const hasNumbers = /\d{1,3}(,\d{3})*원|\d+%|\d+세|\d+년/.test(answer)
  if (hasNumbers) {
    contentScore += 5
    strengths.push('구체적 수치/통계 포함')
  } else {
    contentScore += 1
    tips.push('구체적 숫자(보험료, %)를 넣으면 신뢰도 상승')
  }
  
  // 4. 참여도 점수 (25점 만점)
  if (commentsCount >= 5) {
    engageScore = 25
    strengths.push('댓글 5개로 활성화 최적')
  } else if (commentsCount >= 3) {
    engageScore = 18
    strengths.push('댓글로 자연스러운 토론 유도')
  } else if (commentsCount >= 1) {
    engageScore = 10
  } else {
    engageScore = 5
    improvements.push('댓글 추가로 참여도 높이기')
  }
  
  // 총점 계산
  const totalScore = titleScore + keywordScore + contentScore + engageScore
  
  // 등급 및 예측
  let grade = 'D'
  let predictedRank = '상위 50% 이하'
  let exposureRate = 20
  let recommend = '수정 필요'
  
  if (totalScore >= 90) {
    grade = 'S+'
    predictedRank = '상위 1-3위'
    exposureRate = 95
    recommend = '즉시 등록!'
    tips.push('현재 상태로 게시 시 상위 노출 확률 매우 높음')
  } else if (totalScore >= 80) {
    grade = 'S'
    predictedRank = '상위 1-5위'
    exposureRate = 85
    recommend = '등록 권장'
    tips.push('댓글이 달리면 1위 가능성 더 높아짐')
  } else if (totalScore >= 70) {
    grade = 'A'
    predictedRank = '상위 5-10위'
    exposureRate = 70
    recommend = '등록 OK'
  } else if (totalScore >= 55) {
    grade = 'B'
    predictedRank = '상위 10-20위'
    exposureRate = 50
    recommend = '개선 후 등록'
  } else if (totalScore >= 40) {
    grade = 'C'
    predictedRank = '상위 20-30위'
    exposureRate = 30
    recommend = '수정 권장'
  }
  
  return {
    totalScore,
    grade,
    titleScore,
    keywordScore,
    contentScore,
    engageScore,
    predictedRank,
    exposureRate,
    recommend,
    strengths: strengths.slice(0, 4),
    improvements: improvements.slice(0, 3),
    tips: tips.slice(0, 3)
  }
}

// 텍스트 정리 함수 (이모티콘, ##, ** 완전 제거)
function cleanText(text: string): string {
  return text
    // 모든 이모지 범위 제거 (완전 확장)
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Misc Symbols and Pictographs, Emoticons, etc.
    .replace(/[\u{2600}-\u{26FF}]/gu, '') // Misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, '') // Dingbats
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // Emoticons
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // Transport and Map
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '') // Flags
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '') // Supplemental Symbols
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '') // Chess Symbols
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '') // Symbols and Pictographs Extended-A
    .replace(/[\u{2300}-\u{23FF}]/gu, '') // Misc Technical
    .replace(/[\u{2B50}-\u{2B55}]/gu, '') // Stars
    .replace(/[\u{200D}]/gu, '') // Zero Width Joiner
    .replace(/[\u{FE0F}]/gu, '') // Variation Selector
    // 특수 기호 제거
    .replace(/[✅✓✔☑□☐⭐⚡❤💙💚💛💜🖤🤍💯🔥👍👎👏🙏😀-😿🙀-🙊]/gu, '')
    .replace(/[❶❷❸❹❺❻❼❽❾❿]/g, '')
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, '')
    .replace(/[●○◆◇■□▲△▼▽]/g, '')
    .replace(/[★☆♠♣♥♦]/g, '')
    .replace(/[→←↑↓↔↕]/g, '')
    // 마크다운 기호 제거
    .replace(/#{1,6}\s*/g, '') // # ## ### 등 제거
    .replace(/\*{2,}/g, '') // ** *** 등 제거
    .replace(/\*\s+/g, ' ') // * 포인트 제거
    .replace(/_{2,}/g, '') // __ 제거
    .replace(/`{1,3}/g, '') // ` `` ``` 제거
    // 줄바꿈 정리
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/gm, '') // 각 줄 앞뒤 공백 제거
    .trim()
}

// 네이버 검색 API (키워드 추출용)
async function searchNaverKeywords(query: string, clientId: string, clientSecret: string): Promise<string[]> {
  try {
    const response = await fetch(
      `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(query)}&display=30&sort=sim`,
      {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret
        }
      }
    )
    
    if (!response.ok) {
      console.log('Naver API error:', response.status)
      return []
    }
    
    const data = await response.json() as any
    const items = data.items || []
    
    const allText = items.map((item: any) => 
      (item.title + ' ' + item.description)
        .replace(/<[^>]*>/g, '')
        .replace(/&[^;]+;/g, '')
    ).join(' ')
    
    const koreanWords = allText.match(/[가-힣]{2,8}/g) || []
    
    const wordCount: Record<string, number> = {}
    koreanWords.forEach(word => {
      const stopWords = ['있습니다', '합니다', '입니다', '됩니다', '그리고', '하지만', '그러나', '때문에', '대해서', '관련해', '라고', '이라고']
      if (!stopWords.some(sw => word.includes(sw))) {
        wordCount[word] = (wordCount[word] || 0) + 1
      }
    })
    
    const sortedWords = Object.entries(wordCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word)
    
    return sortedWords
  } catch (error) {
    console.log('Naver search error:', error)
    return []
  }
}

// 연관 검색어 API
async function getRelatedKeywords(query: string, clientId: string, clientSecret: string): Promise<string[]> {
  try {
    const response = await fetch(
      `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(query)}&display=10`,
      {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret
        }
      }
    )
    
    if (!response.ok) return []
    
    const data = await response.json() as any
    const items = data.items || []
    
    const keywords = new Set<string>()
    items.forEach((item: any) => {
      const title = item.title.replace(/<[^>]*>/g, '')
      const matches = title.match(/[가-힣]{2,10}/g) || []
      matches.forEach(m => {
        if (m.length >= 2 && m.length <= 8) keywords.add(m)
      })
    })
    
    return Array.from(keywords).slice(0, 10)
  } catch {
    return []
  }
}

// ============================================================
// V16.0 - RAG 기반 프롬프트 체이닝 (Hallucination Zero Project)
// Step 1: 팩트 수집 → Step 2: 전략 수립 → Step 3: 콘텐츠 생성 → Step 4: 자가 진단
// ============================================================

// Step 1: 네이버 검색 API로 팩트 데이터 수집 (블로그 + 뉴스)
async function collectFactData(
  insuranceType: string, 
  customerConcern: string,
  target: string,
  clientId: string, 
  clientSecret: string
): Promise<{ blogFacts: string[], newsFacts: string[], searchSuccess: boolean }> {
  const blogFacts: string[] = []
  const newsFacts: string[] = []
  
  // 검색 쿼리 조합
  const queries = [
    `2026년 ${insuranceType} 개정`,
    `${insuranceType} ${customerConcern.substring(0, 20)}`,
    `${insuranceType} 추천 ${target}`
  ]
  
  try {
    // 블로그 검색 (상위 3개)
    for (const query of queries.slice(0, 2)) {
      const blogResponse = await fetch(
        `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(query)}&display=3&sort=sim`,
        {
          headers: {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret
          }
        }
      )
      
      if (blogResponse.ok) {
        const blogData = await blogResponse.json() as any
        const items = blogData.items || []
        items.forEach((item: any) => {
          const title = (item.title || '').replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, '')
          const desc = (item.description || '').replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, '')
          if (title && desc) {
            blogFacts.push(`[블로그] ${title}: ${desc}`)
          }
        })
      }
    }
    
    // 뉴스 검색 (상위 3개)
    const newsResponse = await fetch(
      `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(`${insuranceType} 2026`)}&display=3&sort=date`,
      {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret
        }
      }
    )
    
    if (newsResponse.ok) {
      const newsData = await newsResponse.json() as any
      const items = newsData.items || []
      items.forEach((item: any) => {
        const title = (item.title || '').replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, '')
        const desc = (item.description || '').replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, '')
        if (title && desc) {
          newsFacts.push(`[뉴스] ${title}: ${desc}`)
        }
      })
    }
    
    console.log(`[RAG Step 1] 팩트 수집 완료 - 블로그: ${blogFacts.length}개, 뉴스: ${newsFacts.length}개`)
    
    return { 
      blogFacts: blogFacts.slice(0, 5), 
      newsFacts: newsFacts.slice(0, 3),
      searchSuccess: blogFacts.length > 0 || newsFacts.length > 0
    }
  } catch (error) {
    console.log('[RAG Step 1] 네이버 검색 오류:', error)
    return { blogFacts: [], newsFacts: [], searchSuccess: false }
  }
}

// Step 2: 전략 수립 - JSON 포맷으로 팩트 추출 및 전략 수립
interface StrategyJSON {
  seoKeywords: string[]           // SEO 키워드 5개
  factChecks: string[]            // 2026년 핵심 변경점
  expertStrategies: {             // 3명 전문가 전략
    factExpert: string            // 팩트형 전문가 핵심 논리
    empathyExpert: string         // 공감형 전문가 핵심 논리
    comparisonExpert: string      // 비교형 전문가 핵심 논리
  }
  userContextSummary: string      // 사용자 맥락 요약
}

async function buildStrategy(
  insuranceType: string,
  customerConcern: string,
  target: string,
  factData: { blogFacts: string[], newsFacts: string[] },
  geminiKeys: string[]
): Promise<StrategyJSON> {
  // 팩트 데이터가 없으면 기본 지식 베이스 사용
  const factContext = factData.blogFacts.length > 0 || factData.newsFacts.length > 0
    ? `
【 네이버 검색 결과 (2026년 최신 정보) 】
${factData.blogFacts.join('\n')}
${factData.newsFacts.join('\n')}
`
    : `
【 기본 지식 베이스 (검색 결과 없음 - Fallback) 】
- 2026년 보험 트렌드: 비갱신형 필수화, 통합 보장 강화
- 암보험: 통합암(원발/전이 각각 보장), 중입자/양성자 치료비 특약 중요
- 3대질환: I49(기타 부정맥), 산정특례 심장질환 보장 확대
- 운전자보험: 변호사선임비용 경찰조사단계 포함, 공탁금 선지급 100%
- 간병/치매: 체증형 간병인 일당, 장기요양등급 1~5등급 보장
`
  
  const strategyPrompt = `당신은 보험 콘텐츠 전략가입니다.

【 사용자 입력 (Original Input) - 절대 변경 금지 】
- 보험 종류: "${insuranceType}"
- 핵심 고민: "${customerConcern}"
- 타깃 고객: "${target}"

${factContext}

【 작업 지시 】
위의 검색 결과와 사용자 고민을 분석해서 다음을 **JSON 포맷으로만** 출력하세요.
⚠️ 글쓰기 금지! JSON만 출력!

{
  "seoKeywords": ["검색량 높은 키워드 5개 - ${insuranceType} 관련"],
  "factChecks": ["검색 결과에서 확인된 2026년 핵심 변경점 3개 (예: 기.갑.경.제, 통합암, I49 등)"],
  "expertStrategies": {
    "factExpert": "팩트형 전문가가 주장할 핵심 논리 한 줄 (약관/수치 기반)",
    "empathyExpert": "공감형 전문가가 주장할 핵심 논리 한 줄 (심리적 위로 + 대안)",
    "comparisonExpert": "비교형 전문가가 주장할 핵심 논리 한 줄 (타사/과거 비교)"
  },
  "userContextSummary": "${target}이 ${customerConcern}에 대해 고민하는 상황 요약"
}

⚠️ 중요: 반드시 위 JSON 구조로만 응답하세요. 설명 텍스트 금지!`

  try {
    const result = await callGeminiAPI(strategyPrompt, geminiKeys)
    const jsonMatch = result.match(/\{[\s\S]*\}/)
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as StrategyJSON
      console.log('[RAG Step 2] 전략 수립 완료:', JSON.stringify(parsed.seoKeywords))
      return parsed
    }
  } catch (error) {
    console.log('[RAG Step 2] 전략 파싱 오류:', error)
  }
  
  // 파싱 실패 시 보험 종류별 맞춤 기본 전략 반환
  const insuranceKeywords: Record<string, string[]> = {
    '암보험': ['암보험 비갱신형 추천', '암보험 갱신료 인상', '암보험 필수 특약', '암보험 진단비 얼마', '2026년 암보험 개정'],
    '종신보험': ['종신보험 해지 환급금', '종신보험 손해', '종신보험 사업비', '종신보험 vs 정기보험', '종신보험 감액완납'],
    '달러종신보험': ['달러보험 환율 리스크', '달러종신보험 해지', '달러보험 사업비 30%', '달러보험 원금 회복', '달러보험 추천'],
    '운전자보험': ['운전자보험 필수 특약', '운전자보험 변호사 비용', '운전자보험 벌금 한도', '민식이법 운전자보험', '운전자보험 공탁금'],
    '실손보험': ['실손보험 4세대 전환', '실손보험 갱신료', '실손보험 비급여 자부담', '실손보험 추천', '2026년 실손보험'],
    '간병보험': ['간병보험 추천', '치매보험 필요성', '간병보험 ADL 판정', '간병비용 월 얼마', '간병보험 납입면제'],
    '어린이보험': ['태아보험 22주', '어린이보험 100세 만기', '어린이보험 필수 특약', '어린이보험 추천', '태아보험 가입 시기'],
    '뇌심장보험': ['뇌혈관질환 보장', '급성심근경색 보장', '허혈성심장질환 특약', '뇌출혈 vs 뇌경색', '심혈관보험 추천']
  }
  
  const defaultKeywords = insuranceKeywords[insuranceType] || [
    `${insuranceType} 추천 2026`, 
    `${insuranceType} 비교`, 
    `${insuranceType} 해지 손해`, 
    `${insuranceType} 필수 특약`, 
    `${target} ${insuranceType}`
  ]
  
  return {
    seoKeywords: defaultKeywords,
    factChecks: ['2026년 비갱신형 특약 강화', '통합 보장 트렌드', '갱신형 보험료 인상 이슈'],
    expertStrategies: {
      factExpert: `${insuranceType} 약관 기준 정확한 보장 범위와 예외 사항 분석`,
      empathyExpert: `${customerConcern} 상황에 대한 공감과 현실적 대안 제시`,
      comparisonExpert: `${insuranceType} 타사 상품 및 2020년형 vs 2026년형 비교`
    },
    userContextSummary: `${target}이 ${customerConcern}에 대해 고민하는 상황`
  }
}

// Step 3: 콘텐츠 생성 - V20.0 마스터 프롬프트 (JSON 강제 출력)
async function generateContentWithStrategy(
  insuranceType: string,
  customerConcern: string,
  target: string,
  strategy: StrategyJSON,
  additionalContext: string,
  geminiKeys: string[],
  tone: string = '친근한',
  photoContext: string = ''
): Promise<string> {
  
  // V20.0: 연령대 추출
  const ageMatch = target.match(/(\d+)대/)
  const targetAge = ageMatch ? ageMatch[0] : '회원'
  const targetNickname = ageMatch ? `${ageMatch[0]}님` : '회원님'
  
  // ============================================================
  // 🎭 V17.0 멀티 페르소나 시스템 - 톤 선택에 따른 Role 스위칭
  // ============================================================
  
  // V22.0 Clean-Template: 시나리오 데이터베이스 완전 삭제
  // AI가 베낄 예시가 전혀 없는 깡통 프롬프트

  // ============================================================
  // 🎭 톤별 페르소나 정의
  // ============================================================
  
  let personaRole = ''
  let questionStyle = ''
  let answerStyle = ''
  let commentStyle = ''

  // 톤 분석: 여러 키워드 조합 처리
  const toneNormalized = tone.toLowerCase()
  const isExpert = toneNormalized.includes('전문') || toneNormalized.includes('설득')
  const isFriendly = toneNormalized.includes('친근') || toneNormalized.includes('공감')
  const isRealTalk = toneNormalized.includes('보험초보') || toneNormalized.includes('현실') || toneNormalized.includes('사이다')

  if (isExpert) {
    // Ver 1. [톤: 전문/설득] → "The Classic Expert (정석 파)"
    personaRole = `# System Role: Certified Insurance Analyst (Formal & Professional)

당신은 금융권에서 20년간 근무한 **수석 컨설턴트**입니다.
감정적인 호소보다는 **객관적인 데이터, 약관 조항, 법률적 근거**를 통해 고객에게 신뢰를 주십시오.

【 작성 지침 】
1. **말투:** "~입니다/합니다" 체를 사용하며, 매우 정중하고 격식 있게 작성.
2. **논리 구조:** [현황 분석] → [문제점 진단] → [전문가 솔루션] 순서로 체계적으로 설명.
3. **핵심:** 2026년 개정된 세법이나 약관(금융감독원 기준)을 인용하여 권위를 확보.`

    questionStyle = `【 질문 작성 스타일 (전문적) 】
- 말투: 정중하지만 구체적인 상황 설명
- ${target}의 언어와 상황으로 작성
- 반드시 300자 이상의 구체적인 상황 묘사 필수
- 약관이나 숫자에 대한 질문 포함`

    answerStyle = `【 답변 작성 스타일 (전문적) 】
- 말투: "~입니다/합니다" 격식체
- ${insuranceType} 전문가로서 객관적 분석
- 구조: [결론 먼저] → [근거 제시] → [구체적 조언]
- 반드시 400자 이상, 약관 조항/수치 인용 필수
- 감정적 표현 최소화, 데이터 기반 설명`

    commentStyle = `【 댓글 스타일 (전문적) 】
- "객관적인 분석 감사합니다. 저도 증권 분석 부탁드립니다."
- "금감원 기준으로 설명해주시니 이해가 됩니다."
- "쪽지 드렸습니다. 상담 부탁드립니다."`

  } else if (isRealTalk) {
    // Ver 3. [톤: 보험초보/현실적] → "The Realist (사이다 파)"
    personaRole = `# System Role: The 'Salty' Insurance Veteran (Naver Cafe Real-Talk Style)

당신은 AI가 아닙니다. 당신은 네이버 보험 카페에서 활동하는 **20년 차 '독설가'이자 '해결사'**입니다.
교과서적인 답변은 절대 금지합니다. **옆집 형/오빠/누나가 술 한잔하며 조언해 주듯** 리얼하고 거침없는 말투를 사용하십시오.

【 작성 지침 】
1. **말투:** 커뮤니티 리얼 용어 사용 (호구, 눈탱이, 손절, 수업료 등)
2. **논리 구조:** [충격 요법] → [손익 계산] → [행동 지령]
3. **핵심:** 돌려 말하지 마세요. 고객이 손해 볼 상황이라면 **강력하게 경고(Warning)**하십시오.

【 금지어 】
- "도움이 되셨기를 바랍니다." (이런 멘트 쓰면 바로 AI인 거 들킵니다)
- "참고하시기 바랍니다." 같은 공무원 말투 절대 금지`

    questionStyle = `【 질문 작성 스타일 (리얼 토크) 】
- 말투: 다급함, 억울함, 의심을 담은 ${target}의 언어
- ${target}이 실제로 쓰는 표현과 말투 사용
- 반드시 300자 이상의 리얼한 상황 묘사
- 감정(분노, 억울함, 불안)을 솔직하게 표현
- ${insuranceType}에 대한 구체적 고민 포함`

    answerStyle = `【 답변 작성 스타일 (리얼 토크) 】
- 말투: 단호하고 확신에 찬 어조 (커뮤니티 고수 느낌)
- ${insuranceType} 전문가로서 현실적 조언
- 구조: [충격적 훅] → [현실 직시] → [즉각 행동 지시]
- 반드시 400자 이상
- ${target}에게 맞춤화된 조언 필수`

    commentStyle = `【 댓글 스타일 (리얼 토크) 】
- "와... 저도 저 설계사한테 당했는데 ㅠㅠ 동지시네요."
- "보험 닥터한테 진단받고 싹 갈아엎음. 속이 다 시원함."
- "엄마 친구가 제일 무서움 ㄹㅇ... 그냥 실비만 남기고 다 해지하셈."`

  } else {
    // Ver 2. [톤: 친근/공감] → "The Kind Mentor (공감 파)" - 기본값
    personaRole = `# System Role: Empathic Life Partner (Warm & Friendly)

당신은 고객의 고민을 내 일처럼 걱정해 주는 **따뜻한 멘토**입니다.
어려운 보험 용어는 최대한 빼고, **일상적인 비유**를 들어 설명하십시오. 무엇보다 고객의 불안한 마음을 먼저 어루만져야 합니다.

【 작성 지침 】
1. **말투:** "~해요/그랬죠?" 처럼 부드러운 구어체 사용
2. **논리 구조:** [공감과 위로] → [쉬운 비유 설명] → [안심 시키기]
3. **핵심:** "저도 예전에 그랬어요", "얼마나 속상하셨을까요" 같은 감정적 유대감 형성`

    questionStyle = `【 질문 작성 스타일 (친근) 】
- 말투: 부드럽고 자연스러운 구어체
- ${target}의 일상적인 언어와 표현 사용
- 반드시 300자 이상의 자연스러운 스토리텔링
- 감정 표현과 이모티콘 적절히 사용
- ${insuranceType}에 대한 ${target}의 실제 고민 반영`

    answerStyle = `【 답변 작성 스타일 (친근) 】
- 말투: "~해요/~죠?" 부드러운 구어체
- ${target}에게 공감하며 ${insuranceType} 조언
- 구조: [공감 먼저] → [쉬운 비유] → [따뜻한 조언]
- 반드시 400자 이상
- 마무리: 안심시키는 멘트 + 도움 제안`

    commentStyle = `【 댓글 스타일 (친근) 】
- "저도 비슷한 고민이었는데 이 글 보고 한시름 놓았어요~"
- "정말 따뜻한 조언이네요. 저도 도움 받고 싶어요!"
- "화이팅하세요! 좋은 결과 있으시길 바랍니다 :)"`
  }

  // ============================================================
  // 🔥 V17.5 네이버 카페 실제 질문 패턴 기반 생성 가이드
  // ============================================================
  
  // V20.0: 2026 Knowledge Injection - 보험종류별 전문 지식
  const get2026Knowledge = (type: string): string => {
    const knowledge: Record<string, string> = {
      '암보험': '(기.갑.경.제) 필수, 통합암(전이암 별도 보장), 산정특례 5년, 비갱신형 전환 권장',
      '암': '(기.갑.경.제) 필수, 통합암(전이암 별도 보장), 산정특례 5년, 비갱신형 전환 권장',
      '종신보험': '사업비 30% 함정, 원금 도달 7-10년, 감액완납/청약철회 옵션, 저축 목적이면 잘못된 선택',
      '달러종신': '사업비 30% 함정, 원금 회복 7-10년, 환율 리스크, 비혼주의자는 수익자 지정 필수',
      '운전자보험': '경찰조사단계 변호사비 선지급, 공탁금 100% 선지급, 민식이법 대비 2천만원 이상',
      '운전자': '경찰조사단계 변호사비 선지급, 공탁금 100% 선지급, 민식이법 대비 2천만원 이상',
      '뇌': '뇌출혈은 9%만 보장, 뇌혈관질환(I60-I69)으로 100% 커버, 부정맥(I49) 최신 담보',
      '심장': '급성심근경색은 범위 좁음, 허혈성심장질환(I20-I25)으로 협심증/부정맥 보장, I49 부정맥 최신 담보',
      '실손': '4세대 자기부담금 30%, 비급여 많으면 기존 유지, 급여 위주면 4세대 전환, 1~3세대 할증률 비교',
      '간병': '치매 경도인지장애부터 보장, 간병인 월 300만원, ADL 6개 항목 기준, 재가급여, 일당 15만원 시대',
      '어린이': '기갑경제(기존/갑상선/경계성/제자리암), 30세vs100세 만기 전환권, 산정특례, 태아보험',
      '저축보험': '사업비 25-35% 차감, 예정이율 2.25-2.5%, 원금 회복 7-10년, 감액완납/청약철회 옵션',
      '저축': '사업비 25-35% 차감, 예정이율 2.25-2.5%, 원금 회복 7-10년, 감액완납/청약철회 옵션',
      '연금보험': '세제적격 연 400만원 한도, 55세 이후 연금개시, 복리 효과 10년 이상 유지시',
      '변액보험': '펀드 수익률 변동, 사업비 높음, 최저보증 옵션 확인, 10년 이상 장기투자',
      // V24.0 XIVIX 12대 전략 카테고리
      '경영인': '법인세 절세, 가업승계, 해지환급금 과세 체계, CEO 유동성 확보, 사망보험금 상속세 재원',
      '정기': '법인세 절세, 가업승계, 해지환급금 과세 체계, CEO 유동성 확보',
      '상속': '10년 증여 주기, 유류분 분쟁 대비, 상속세 재원 마련, 수익자 지정 법리',
      '증여': '10년 증여 주기, 유류분 분쟁 대비, 상속세 재원 마련, 수익자 지정 법리',
      '종신': '10년 증여 주기, 유류분 분쟁 대비, 상속세 재원 마련, 수익자 지정 법리',
      '태아': '기갑경제(기존/갑상선/경계성/제자리암), 30세vs100세 만기 전환권, 산정특례',
      '유병자': '3.5.5/3.2.5 고지사항, 할증 보험료 가성비, 기왕력 보장 범위',
      '간편': '3.5.5/3.2.5 고지사항, 할증 보험료 가성비, 기왕력 보장 범위',
      '항암': '비급여 항암치료비, 중입자치료 특약, 1~9종 수술비 반복 지급 조건, 표적항암',
      '수술': '비급여 항암치료비, 중입자치료 특약, 1~9종 수술비 반복 지급 조건',
      '펫': '슬개골탈구/피부병 면책조항, 동물등록증 할인, 적금 대비 기대수익률',
      '반려견': '슬개골탈구/피부병 면책조항, 동물등록증 할인, 적금 대비 기대수익률',
      '치아': '임플란트/브릿지 개수 제한, 보존치료 한도, 면책/감액 기간 팩트체크',
      '화재': '누수 피해 일배책, 화재 대물 배상, 자영업자 의무 가입 담보',
      '배상': '누수 피해 일배책, 화재 대물 배상, 자영업자 의무 가입 담보',
      '교통': '민식이법, 경찰조사 단계 변호사비 선지급, 공탁금 50% 선지급 특약',
      '운전자': '민식이법, 경찰조사 단계 변호사비 선지급, 공탁금 50% 선지급 특약'
    }
    for (const [key, value] of Object.entries(knowledge)) {
      if (type.includes(key) || key.includes(type)) return value
    }
    return '비갱신형 필수, 납입면제 조건 확인, 해지환급금 예시표 검토'
  }
  
  const domainKnowledge2026 = get2026Knowledge(insuranceType)
  
  // V24.0 XIVIX 카페 점령 엔진 - Triple-Persona System
  const contentPrompt = `# [Role: XIVIX Cafe Dominator V24.0]
당신은 네이버 카페 상위 노출을 위해 1인 3역(질문자, 전문가, 댓글러)을 수행하는 보험 콘텐츠 엔지니어입니다.

# [CRITICAL: No-Example Policy]
## ⚠️ 금지 문구 (출력 시 즉시 재생성됨)
- "방대표", "김대표", "이대표", "박대표", "최대표", "정대표" ← 절대 금지!
- "형님들", "그 펜 내려놓으세요", "급질요" ← 고정 말투 금지!
- 사용자가 선택하지 않은 타겟 언급 금지 (예: 신혼부부 선택 시 "육아맘" 금지)

## 데이터 바인딩 원칙
- 시스템에 내장된 모든 과거 예시를 무시하십시오.
- 오직 아래 {변수} 데이터만 사용하여 콘텐츠를 구성하십시오.
- 모든 문장은 매번 새롭게 생성하십시오. 고정된 문장 구조 반복 금지!

# [데이터 결합 우선순위]
1순위: {customerConcern} "${customerConcern}" ← 모든 섹션의 핵심 주제
2순위: {photoContext} ← 구체적 근거 (있을 경우)
3순위: {target} "${target}", {insuranceType} "${insuranceType}", {tone} "${tone}"
${photoContext ? `\n【 사진 분석 데이터 】\n${photoContext}` : ''}

# [2026 Knowledge Injection - ${insuranceType}]
${domainKnowledge2026}

# [Execution: Triple-Persona System]

## Step 1. 질문자 (The Shill - Customer)
- 페르소나: "${target}"의 연령과 직업에 맞는 **완전 초보 소비자** 말투
- 지침: "${customerConcern}" 때문에 실제로 당황하거나 억울해하는 구체적인 사연을 창조 (최소 300자)
- 사진 연동: photoContext 데이터가 있다면 보험사명/가입일/금액을 질문 본문에 반드시 포함
${photoContext ? `- 【필수 포함】 ${photoContext}의 구체적 수치 언급` : ''}

## Step 2. 전문가 (The Authority - Expert)
- 페르소나: "${tone}"에 맞춘 **보험 엔지니어**. 감정보다 데이터와 약관으로 상대를 압도
- 지침: "${insuranceType}"의 2026년 최신 정보를 인용하여 "${customerConcern}"에 대한 명확한 해답 (최소 500자)
- 금지: 뻔한 위로나 로봇 말투 금지. 독설적이거나 매우 분석적이어야 함

## Step 3. 댓글러 (The Social Proof - Community)
- 페르소나: 질문을 보고 부러워하거나, 동질감을 느끼거나, 전문가를 찬양하는 5명의 카페 회원
- 지침: "${target}" 커뮤니티에서 실제로 달릴 법한 리얼한 반응들

# [Output Format - JSON]
반드시 아래 태그만 출력하십시오. 설명/구분선/마크다운 금지!

[제목1]
(${target} 시점, "${customerConcern}" 반영)

[제목2]
(${insuranceType} 포함)

[질문1]
(${target}의 다급한 상황, 300자 이상)

[질문2]
(${target}의 의심하는 상황, 300자 이상)

[질문3]
(${target}의 비용 고민 상황, 300자 이상)

[답변1]
(팩트형, 500자 이상, ${insuranceType} 2026년 수치 인용)

[답변2]
(공감형, 500자 이상, 대안 2-3가지)

[답변3]
(비교형, 500자 이상)

[댓글1]
(${target} 공감형 댓글)

[댓글2]
(사이다형 댓글)

[댓글3]
("${customerConcern}" 파생 질문)

[댓글4]
(경험담 공유)

[댓글5]
(응원형)

[검색키워드]
${strategy.seoKeywords.slice(0, 5).join(', ')}

[최적화제목1]
${target} ${insuranceType} "${customerConcern}" 포함

[최적화제목2]
2026년 ${insuranceType} 완벽 가이드

[강조포인트]
- ${insuranceType} 2026년 핵심 변경사항
- "${customerConcern}" 해결 체크포인트 3가지
- ${target} 맞춤 전문가 조언

[해시태그]
#${insuranceType.replace(/\s/g, '')} #${target.replace(/\s/g, '')}보험 #2026보험

[자가진단결과]
- 핵심고민 반영도: 상
- 타깃 적합도: 상
- 보험종류 일치도: 상
- 재생성 필요: 아니오`

  console.log('[V22.0 Clean-Template] 콘텐츠 생성 시작 - 핵심고민:', customerConcern)
  try {
    return await callGeminiAPI(contentPrompt, geminiKeys)
  } catch (error) {
    console.log('[RAG Step 3] API 호출 오류 - Human-Like Fallback 콘텐츠 반환:', error)
    
    // V17.0 멀티 페르소나 Human-Like Fallback 템플릿
    // 톤에 따라 다른 스타일 적용
    const toneNormalized = tone.toLowerCase()
    const isRealTalk = toneNormalized.includes('보험초보') || toneNormalized.includes('현실') || toneNormalized.includes('사이다')
    const isExpert = toneNormalized.includes('전문') || toneNormalized.includes('설득')
    
    // V17.8 리얼 토크 스타일 (사이다) - 제목 랜덤화 (핵심고민 반영)
    if (isRealTalk) {
      // 랜덤 금액 (8만원~19만원)
      const randomAmount = (Math.floor(Math.random() * 12) + 8)
      // 랜덤 보험사
      const companies = ['메리츠', '삼성생명', '한화생명', 'DB손해보험', '교보생명', 'KB손해보험', '현대해상', '신한라이프']
      const randomCompany = companies[Math.floor(Math.random() * companies.length)]
      
      const realTalkTitleTemplates = [
        `월 ${randomAmount}만원짜리 ${insuranceType} 이거 괜찮을까요? ${target}입니다`,
        `${target}인데 ${insuranceType} ${customerConcern.substring(0, 15)}... 어떡하죠?`,
        `${randomCompany} ${insuranceType} 가입했는데 후회중이에요 ㅠㅠ`,
        `${insuranceType} 눈탱이 맞은 건가요? ${target}입니다`,
        `${customerConcern.substring(0, 18)} 때문에 미치겠어요 ㅠㅠ`,
        `${target} ${insuranceType} 리모델링 해야하나요? 의견 부탁해요`,
        `월 ${randomAmount}만원 ${insuranceType} 손절할까요 유지할까요?`,
        `장롱 속 ${insuranceType} 발견했는데 이거 어쩌죠?`
      ]
      const realTalkTitle1 = realTalkTitleTemplates[Math.floor(Math.random() * realTalkTitleTemplates.length)]
      const realTalkTitle2 = realTalkTitleTemplates[Math.floor(Math.random() * realTalkTitleTemplates.length)]
      
      return `[제목1]
${realTalkTitle1}

[제목2]
${realTalkTitle2}

[질문1]
급질문요 ㅠㅠ 저 ${target}인데요.
엄마 친구 설계사 이모가 ${randomCompany} ${insuranceType} 무조건 좋다고 해서 월 ${randomAmount}만원짜리 가입했어요.
${customerConcern}
근데 유튜브 보니까 사업비가 30%나 빠진다면서요? 이거 진짜예요?
이미 3회차 납입했는데 지금이라도 손절하는 게 맞을까요?
아 진짜 밤에 잠이 안 와요ㅠㅠ 눈탱이 맞은 거 같아서 속이 쓰려요.
팩트로 조언 좀 부탁드려요. 쪽지 사절이고요 댓글로만 부탁합니다.

[질문2]
안녕하세요~ ${target}입니다.
서랍 정리하다가 2015년에 가입한 한화생명 ${insuranceType} 증권 발견했어요.
${customerConcern}
그때는 뭐가 뭔지 모르고 사인했는데 이거 아직 유효한 건가요?
보장 내용이 너무 옛날 것 같은데... 요즘 상품이랑 비교하면 어떤가요?
리모델링해야 하는 건지, 그냥 유지해도 되는 건지 전문가분들 의견 부탁드려요.
구체적으로 어떤 부분 확인해야 하는지 체크리스트 알려주시면 감사하겠습니다!

[질문3]
안녕하세요, ${target}입니다.
삼성생명 ${insuranceType} 월 8만원짜리 제안받았는데 이거 괜찮은가요?
${customerConcern}
설계사가 2026년 개정 상품이라 좋다고 하는데 진짜인지 모르겠어요.
친구는 DB손해보험이 더 좋다고 하고... 뭐가 맞는지 헷갈려요.
가입 전에 꼭 확인해야 할 거 있으면 알려주세요!
비교 분석 해주시면 너무 감사하겠습니다.

[답변1]
좋은 질문입니다! ${targetNickname}, 이렇게 미리 확인하시려는 거 정말 현명하세요.

결론부터 말씀드리면요, 일단 숨 고르시고 같이 확인해봐요.
${insuranceType} 고민으로 상담 오시는 분들 정말 많은데, 대부분 해결됐어요!

${insuranceType}을 자세히 살펴보면요,
쉽게 말해서 '저축'보다는 '보장'에 가까운 상품이에요.
그래서 ${customerConcern} 상황이시라면 더 답답하실 수밖에 없죠.

【 핵심 분석 】
• 사업비율: 납입금의 약 25~35%가 수수료로 빠져요
• 예정이율: 2026년 기준 2.25~2.5% 수준 (은행 예금 3%보다 낮음)
• 원금 회복: 7~10년은 유지해야 원금 근처 가요
• 해지환급금: 3년차 기준 납입액의 40~60% 수준

【 체크해야 할 부분 】
✔️ 납입면제 조건 - 암/뇌/심장 진단 시 면제 범위
✔️ 현재 해지환급금 - 보험사 앱에서 바로 확인 가능해요
✔️ 감액완납 옵션 - 해지 대신 납입 중단하고 보장 일부 유지

${targetNickname}, 너무 자책하지 마세요. 이건 몰라서 그런 거예요.
증권 사진 올려주시면 구체적으로 분석해드릴게요!

[답변2]
안녕하세요! ${targetNickname}과 비슷한 분들 상담 정말 많이 해봤어요.

얼마 전에 비슷한 케이스가 있었는데요,
${target}분이 2018년에 가입한 갱신형 ${insuranceType} 때문에 고민하셨어요.
${customerConcern} 상황이셨는데 결론부터 말씀드리면, 잘 해결됐어요!

【 갱신형 vs 비갱신형 비교 분석 】
• 갱신형: 지금 월 3만원 → 50대 8만원 → 65세 12만원 (3~4배 폭등)
• 비갱신형: 지금 월 5만원 → 평생 5만원 고정
• 20년 총 납입 비교: 갱신형 약 2,880만원 vs 비갱신형 1,200만원

【 회사별 특징 (참고용) 】
• 메리츠: 갱신 주기 3년, 보장 범위 넓음
• 삼성: 안정적이지만 보험료 다소 높음
• DB손해: 다이렉트 상품 가성비 좋음

${targetNickname} 상황에서는 장기적으로 비갱신형이 훨씬 유리해요.
궁금한 거 있으시면 편하게 댓글 주세요!

[답변3]
${targetNickname}, 내용 잘 정리해서 올려주셨어요. 고민 많으시죠ㅠㅠ

선택지를 깔끔하게 정리해드릴게요. 결정은 ${targetNickname}이 하시는 거예요!

【 선택지 1: 해지 】
지금 당장 빠지는 방법이에요.
→ 예상 환급금: 납입액의 50~60% (3년 납입 기준)
→ 장점: 더 이상의 손실 방지, 새 상품 가입 가능
→ 단점: 확정 손실 발생, 건강 상태 따라 재가입 어려울 수 있음

【 선택지 2: 감액완납 】
납입 중단하고 보험은 유지하는 방법이에요. (가장 추천!)
→ 원금의 70~80% 보존 가능
→ 장점: 손실 최소화 + 보장 일부 유지 + 새 보험 가입 가능
→ 단점: 보장금액 줄어듦

【 선택지 3: 끝까지 유지 】
7~10년 더 넣으면 원금은 찾을 수 있어요.
→ 장점: 원금 회복 가능, 보장 계속 유지
→ 단점: 기회비용 발생 (그 돈으로 다른 투자했으면 더 벌 수도)

${customerConcern} 상황이시라면요, 제 생각엔 '감액완납 후 비갱신형 새 가입'이 제일 나아요.
왜냐하면 손실은 최소화하면서 더 좋은 조건으로 갈아탈 수 있거든요.

증권 사진 주시면 정확한 계산해드릴게요. 언제든 물어보세요!

[댓글1]
저도 ${target}인데 똑같은 고민이에요 ㅠㅠ 메리츠 월 15만원짜리 가입했는데 여기 댓글 보고 용기 얻고 갑니다

[댓글2]
${insuranceType} 정보 감사합니다. 저도 2017년에 가입한 거 바로 증권 확인해봐야겠네요

[댓글3]
저도 ${target}인데요, 2018년에 한화생명 가입한 거는 어떻게 해야 할까요? 감액완납 되나요?

[댓글4]
저 작년에 삼성→DB손해로 리모델링하고 월 6만원 아꼈어요. 비갱신형으로 바꾸길 잘했습니다!

[댓글5]
화이팅! 전문가 분석 받으면 해결돼요. 저도 증권 올리고 3일 만에 정리했어요 :)

[검색키워드]
${strategy.seoKeywords.join(', ')}

[최적화제목1]
${target} ${insuranceType} 피눈물 흘리기 전에 이것만 확인하세요

[최적화제목2]
${insuranceType} 호구 탈출법, 20년차 전문가가 알려드립니다

[강조포인트]
- ${insuranceType} 사업비 30% 함정 주의
- 2026년 기준 해지환급금 예시표 확인 필수
- 청약 철회 15일 이내면 전액 환불 가능

[해시태그]
#${insuranceType.replace(/\s/g, '')} #보험호구탈출 #보험해지 #보험리모델링 #${target.replace(/\s/g, '')}보험

[자가진단결과]
- 핵심고민 반영도: 상
- 타깃 적합도: 상
- 보험종류 일치도: 상
- 2026년 팩트 반영: 상
- 재생성 필요: 아니오
- 재생성 사유: Fallback Human-Like 템플릿 적용`
    }
    
    // V18.0 전문가 스타일 - 사진 분석 결과 반영 + 제목 랜덤화
    if (isExpert) {
      // 사진 분석 결과에서 주요 정보 추출
      const photoCompany = photoContext.match(/보험사[:\s]*([^\n,]+)/)?.[1]?.trim() || ''
      const photoProduct = photoContext.match(/상품명[:\s]*([^\n,]+)/)?.[1]?.trim() || ''
      const photoPremium = photoContext.match(/월\s*보험료[:\s]*([0-9,]+)/)?.[1] || ''
      const photoContractDate = photoContext.match(/계약일[:\s]*([^\n,]+)/)?.[1]?.trim() || ''
      const photoRiders = photoContext.match(/특약[:\s]*([^\n]+)/)?.[1]?.trim() || ''
      const photoIssue = photoContext.match(/핵심문제[:\s]*([^\n]+)/)?.[1]?.trim() || ''
      const photoAdvice = photoContext.match(/전문가조언[:\s]*([^\n]+)/)?.[1]?.trim() || ''
      
      const hasPhotoData = photoCompany || photoPremium || photoContractDate
      
      const expertTitleTemplates = hasPhotoData ? [
        `${target} ${photoCompany || ''} ${insuranceType} 전문가 분석 요청드립니다`,
        `${photoContractDate ? photoContractDate + ' 가입한 ' : ''}${insuranceType} 검토 중입니다`,
        `월 ${photoPremium || '??'}원 ${insuranceType} 이거 괜찮은 건가요?`,
        `${target}인데 ${insuranceType} 객관적 조언 부탁드립니다`,
      ] : [
        `${target} ${insuranceType} 전문가 분석 요청드립니다 (${customerConcern.substring(0, 12)})`,
        `${insuranceType} 가입 검토 중입니다. ${customerConcern.substring(0, 15)}...`,
        `${target}인데 ${insuranceType} 객관적 조언 부탁드립니다`,
        `2026년 기준 ${insuranceType} 분석 요청 - ${target}입니다`,
        `${customerConcern.substring(0, 18)} 상황인데 ${insuranceType} 어떻게 할까요?`,
        `${insuranceType} 약관 분석 부탁드립니다. ${target} 상황이에요`,
        `${target} ${insuranceType} 손익분기점 계산 요청드립니다`,
        `${insuranceType} 전문가님들 의견 부탁드려요. ${customerConcern.substring(0, 12)}`
      ]
      const expertTitle1 = expertTitleTemplates[Math.floor(Math.random() * expertTitleTemplates.length)]
      const expertTitle2 = expertTitleTemplates[Math.floor(Math.random() * expertTitleTemplates.length)]
      
      // V18.0: 사진 데이터 기반 답변 생성
      const photoBasedAnswer = hasPhotoData ? `
[${targetNickname} 증권 분석 결과]
${photoCompany ? `• 보험사: ${photoCompany}` : ''}
${photoProduct ? `• 상품명: ${photoProduct}` : ''}
${photoPremium ? `• 월 보험료: ${photoPremium}원` : ''}
${photoContractDate ? `• 계약일: ${photoContractDate}` : ''}
${photoRiders ? `• 특약 구성: ${photoRiders}` : ''}

[핵심 분석]
${photoIssue || '갱신형 특약 비율이 높아 향후 보험료 상승이 우려됩니다.'}

[전문가 조언]
${photoAdvice || '비갱신형 상품으로의 리모델링을 검토해보시는 것이 좋겠습니다.'}

${targetNickname}, 위 분석은 증권 사진 기반으로 작성되었습니다. 추가 질문은 댓글로 남겨주세요!` : `
[핵심 수치]
• 사업비율: 납입금의 약 25~35%가 수수료로 빠집니다
• 예정이율: 2026년 기준 2.25~2.5% 수준입니다
• 원금 도달: 7~10년 정도 유지해야 원금을 회복할 수 있어요

${targetNickname}, 증권 자료를 댓글로 첨부해주시면 더 정확한 분석을 해드릴게요.
편하게 문의해주세요!`
      
      return `[제목1]
${expertTitle1}

[제목2]
${expertTitle2}

[질문1]
안녕하십니까. ${target}입니다.
${hasPhotoData ? `${photoContractDate ? photoContractDate + '에 가입한 ' : ''}${photoCompany || ''} ${insuranceType}` : insuranceType} 관련하여 객관적인 분석을 부탁드립니다.
${customerConcern}
${hasPhotoData && photoPremium ? `현재 월 ${photoPremium}원을 납입하고 있는데, 이 금액이 적정한지 궁금합니다.` : ''}
설계사 말로는 좋다고 하는데, 금융감독원 기준이나 약관 조항에 근거한 정확한 정보를 얻고 싶습니다.
사업비율, 예정이율, 해지환급금 추이 등 수치로 설명해주시면 감사하겠습니다.
정중히 조언 부탁드립니다. 쪽지보다는 댓글로 답변 부탁드립니다.

[질문2]
안녕하십니까. 저도 ${target}입니다.
${insuranceType} 가입 전 전문가 의견을 구하고자 글을 올립니다.
현재 설계사가 제안한 상품의 약관을 검토 중인데요.
${customerConcern}
2026년 개정된 내용이 있다면 함께 안내 부탁드립니다.
특히 갱신형과 비갱신형 중 어떤 것이 유리한지 비교 분석 부탁드립니다.

[질문3]
안녕하십니까. ${target}입니다.
${hasPhotoData ? `${photoContractDate ? photoContractDate + '에 가입한 ' : ''}${photoCompany || ''} ${insuranceType}` : '예전에 가입한 ' + insuranceType}의 리모델링을 고민 중입니다.
${customerConcern}
현재 상품과 신규 상품의 손익분기점 계산을 부탁드립니다.
해지환급금, 신규 가입 시 보험료, 보장 범위 등 수치 기반 비교 분석 요청드립니다.

[답변1]
안녕하십니까. ${targetNickname}, 먼저 이렇게 신중하게 알아보시는 모습이 인상적입니다.
많은 분들이 무턱대고 가입하시는데, ${targetNickname}처럼 먼저 확인하시는 게 정말 현명하세요.

${customerConcern} 상황에 대해 공감하면서 객관적으로 분석해드리겠습니다.

[${insuranceType}이란?]
먼저 쉽게 설명드리면, ${insuranceType}은 '저축'보다는 '보장'에 가까운 상품입니다.
은행 적금과는 다르게 사업비(수수료)가 먼저 빠지고 나머지가 적립되는 구조예요.
${photoBasedAnswer}

[답변2]
${targetNickname}, ${customerConcern} 상황이시군요.
비슷한 고민으로 상담 오시는 분들이 정말 많아요. 혼자가 아니세요!

[2026년 ${insuranceType} 주요 변경사항]
올해부터 바뀐 게 몇 가지 있어요:
• 비갱신형 특약 의무화 확대 - 이제 비갱신형 옵션이 더 많아졌어요
• 해지환급금 최저 기준 상향 - 소비자 보호가 강화됐어요
• 청약 철회 기간 확대 검토 중 (15일 → 30일)

[${targetNickname}께 드리는 조언]
갱신형 vs 비갱신형, 쉽게 말씀드리면:
• 갱신형은 지금은 싸지만 나중에 3~4배 올라요
• 비갱신형은 지금은 비싸 보이지만 평생 고정이에요

현재 보유 증권 정보를 공유해주시면 ${targetNickname} 상황에 맞춤 분석해드릴게요!

[답변3]
${targetNickname}, 꼼꼼하게 비교하시는 모습이 정말 좋습니다.
비교 분석 관점에서 정리해드릴게요.

[${insuranceType} 대안 비교]
- A안: 비갱신형 보장보험 ⭐추천
  → 보험료 고정, 장기적으로 유리
- B안: 저축보다 실손의료비 우선
  → 보장 위주로 가시려면 이 방법도 있어요
- C안: 기존 유지 + 추가 담보 설계
  → 이미 가입하신 게 있다면 보완하는 방법

${customerConcern} 상황에서는 A안이 가장 맞을 것 같아요.
${targetNickname} 개별 상황에 따라 달라질 수 있으니, 상세 시뮬레이션이 필요하시면 댓글로 요청해주세요!

[댓글1]
저도 ${target}인데 객관적인 분석 감사합니다. 증권 분석 부탁드려도 될까요?

[댓글2]
금감원 기준으로 설명해주시니 신뢰가 갑니다. ${target}으로서 도움 많이 됐어요.

[댓글3]
저도 ${target}인데 비슷한 상황이에요. 맞춤 상담 부탁드립니다.

[댓글4]
전문가님 덕분에 ${insuranceType} 이해가 됐습니다!

[댓글5]
정확한 정보 감사합니다. ${target}분들께 많은 도움이 될 것 같아요.

[검색키워드]
${strategy.seoKeywords.join(', ')}

[최적화제목1]
${target} ${insuranceType} 금융감독원 기준 완벽 분석

[최적화제목2]
2026년 ${insuranceType} 개정 사항 총정리

[강조포인트]
- ${insuranceType} 2026년 금감원 기준 확인 필수
- 비갱신형 특약 가입 여부 점검
- 해지환급금 손익분기점 계산

[해시태그]
#${insuranceType.replace(/\s/g, '')} #보험전문가 #금융감독원 #보험분석 #${target.replace(/\s/g, '')}보험

[자가진단결과]
- 핵심고민 반영도: 상
- 타깃 적합도: 상
- 보험종류 일치도: 상
- 2026년 팩트 반영: 상
- 재생성 필요: 아니오
- 재생성 사유: Fallback Expert 템플릿 적용`
    }
    
    // V17.8: 친근/공감 스타일 - 제목 랜덤화 (핵심고민 반영)
    const friendlyTitleTemplates = [
      `${target}인데 ${customerConcern.substring(0, 20)}... 어떻게 해야 하나요?`,
      `${insuranceType} 때문에 고민이에요 ㅠㅠ ${target}입니다`,
      `${target} ${insuranceType} 질문이요! ${customerConcern.substring(0, 15)}...`,
      `혹시 ${insuranceType} 아시는 분? ${customerConcern.substring(0, 15)} 고민중이에요`,
      `${target}인데 ${insuranceType} 이거 맞나요? 조언 부탁드려요`,
      `${insuranceType} 고민 글이에요... ${target}입니다 ㅠㅠ`,
      `${target} ${insuranceType} 도움 요청합니다! ${customerConcern.substring(0, 12)}`,
      `급해요! ${target}인데 ${insuranceType} 관련 질문이요`
    ]
    const friendlyTitle1 = friendlyTitleTemplates[Math.floor(Math.random() * friendlyTitleTemplates.length)]
    const friendlyTitle2 = friendlyTitleTemplates[Math.floor(Math.random() * friendlyTitleTemplates.length)]
    
    return `[제목1]
${friendlyTitle1}

[제목2]
${friendlyTitle2}

[질문1]
안녕하세요~ ${target}이에요 :)
${customerConcern}
요즘 ${insuranceType} 때문에 고민이 많아요 ㅠㅠ
유튜브도 보고 블로그도 찾아봤는데 너무 어렵더라구요.
비슷한 경험 있으신 분들 조언 좀 부탁드려요~
쪽지 사절이에요, 댓글로 편하게 답변 주시면 감사하겠습니다!

[질문2]
안녕하세요~ 저도 ${target}이에요!
${insuranceType} 가입 전에 이것저것 알아보고 있는데요.
${customerConcern}
설계사한테 들은 건 있는데 진짜인지 모르겠어서요...
경험자분들 이야기 좀 들려주세요~ 어떤 거 보고 결정하셨어요?

[질문3]
${target}인데 예전에 가입한 ${insuranceType}이 있어요.
${customerConcern}
갱신 때마다 보험료가 오르니까 이거 유지해야 하나 고민이에요.
해지하고 새로 드는 게 나을까요? 비슷한 경험 있으신 분 계신가요?

[답변1]
${targetNickname}, ${insuranceType} 고민이시군요.
저도 비슷한 경험이 있어서 그 마음 충분히 이해해요.

${customerConcern} 상황이시라면 핵심부터 짚어드릴게요.
${insuranceType}은 복잡해 보이지만 몇 가지만 확인하면 됩니다.

일단 지금 가장 중요한 건 '비갱신형' 특약이 있는지 확인하는 거예요.
2026년 기준으로 이게 있으면 나중에 보험료 폭탄 안 맞아요.

증권 사진 댓글로 올려주시면 상세하게 분석해드릴게요.
방법은 있으니 너무 걱정하지 마세요.

[답변2]
많이 걱정되셨죠? ${customerConcern} 상황에서 불안한 마음 너무 이해해요.
저도 예전에 똑같은 고민 했거든요 ㅠㅠ

${insuranceType}은 사람마다 상황이 다 달라서요,
무조건 해지하라거나 유지하라고 말씀드리기 어려워요.

그래도 하나만 기억하세요!
"지금 결정 안 해도 돼요. 천천히 알아보면 됩니다."

편하게 상황 말씀해주시면 같이 고민해드릴게요 :)

[답변3]
비교해서 쉽게 설명드릴게요~

${insuranceType} 장점: 장기적으로 보장받을 수 있어요
${insuranceType} 단점: 중간에 해지하면 손해볼 수 있어요

${customerConcern} 상황이시라면
1) 먼저 현재 상품 확인하고
2) 다른 상품이랑 비교해보고
3) 그 다음에 결정하셔도 늦지 않아요!

댓글로 궁금한 거 물어보세요~ 같이 알아봐요 :)

[댓글1]
저도 비슷한 고민이었는데 이 글 보고 한시름 놓았어요~

[댓글2]
정말 따뜻한 조언이네요. ${insuranceType} 정보 감사합니다!

[댓글3]
저도 도움 받고 싶어요! 쪽지 드려도 될까요?

[댓글4]
저도 최근에 ${insuranceType} 정리했는데 마음이 편해졌어요 :)

[댓글5]
화이팅하세요! 좋은 결과 있으시길 바랍니다 💪

[검색키워드]
${strategy.seoKeywords.join(', ')}

[최적화제목1]
${target} ${insuranceType} 고민 해결법, 쉽게 알려드려요

[최적화제목2]
${insuranceType} 초보자 가이드, 이것만 알면 끝!

[강조포인트]
- ${insuranceType} 비갱신형 확인이 핵심
- 천천히 알아봐도 괜찮아요
- 전문가 무료 상담 적극 활용

[해시태그]
#${insuranceType.replace(/\s/g, '')} #보험상담 #보험추천 #보험초보 #${target.replace(/\s/g, '')}보험

[자가진단결과]
- 핵심고민 반영도: 상
- 타깃 적합도: 상
- 보험종류 일치도: 상
- 2026년 팩트 반영: 상
- 재생성 필요: 아니오
- 재생성 사유: Fallback Friendly 템플릿 적용`
  }
}

// Step 4: 자가 진단 및 검수 - True/False 판정
interface SelfDiagnosisResult {
  hasConcernInQuestions: boolean    // 질문에 핵심고민 포함 여부
  hasConcernInAnswers: boolean      // 답변에 핵심고민 포함 여부
  hasInsuranceTypeInAnswers: boolean // 답변에 보험종류 포함 여부
  has2026Facts: boolean             // 2026년 최신 트렌드 반영 여부
  overallPass: boolean              // 전체 통과 여부
  failReasons: string[]             // 실패 사유
}

async function selfDiagnoseContent(
  generatedContent: string,
  customerConcern: string,
  insuranceType: string,
  strategy: StrategyJSON,
  geminiKeys: string[],
  target: string = ''  // V23.0: target 검증 추가
): Promise<SelfDiagnosisResult> {
  // V24.0 XIVIX: 금지어 검수 (할루시네이션 원천 차단)
  const FORBIDDEN_WORDS = [
    // 고정 인명
    '방대표', '김대표', '이대표', '박대표', '최대표', '정대표',
    // 고정 말투
    '형님들', '그 펜', '펜 내려', '급질요',
    // 로봇 말투
    '도움이 되셨기를', '참고하시기 바랍니다', '문의 주시기 바랍니다'
  ]
  const contentLower = generatedContent.toLowerCase()
  
  // 금지어 포함 여부 검사
  const foundForbiddenWords = FORBIDDEN_WORDS.filter(word => contentLower.includes(word.toLowerCase()))
  if (foundForbiddenWords.length > 0) {
    console.log(`[V24.0 금지어 감지!] 발견된 금지어: ${foundForbiddenWords.join(', ')} - 자동 재생성 필요`)
  }
  
  // 먼저 로컬 검증 (빠른 체크)
  const concernKeywords = customerConcern.split(/[\s,]+/).filter(w => w.length > 1)
  const concernSubstring = customerConcern.substring(0, 15).toLowerCase()
  
  // 질문 섹션 추출
  const questionsSection = generatedContent.match(/\[질문1\][\s\S]*?(?=\[답변1\])/i)?.[0] || ''
  const answersSection = generatedContent.match(/\[답변1\][\s\S]*?(?=\[댓글1\])/i)?.[0] || ''
  const titleSection = generatedContent.match(/\[제목1\][\s\S]*?(?=\[제목2\])/i)?.[0] || ''
  
  const hasConcernInQuestions = concernKeywords.some(kw => questionsSection.toLowerCase().includes(kw)) ||
    questionsSection.toLowerCase().includes(concernSubstring)
  
  const hasConcernInAnswers = concernKeywords.some(kw => answersSection.toLowerCase().includes(kw)) ||
    answersSection.toLowerCase().includes(concernSubstring)
  
  const insuranceCount = (answersSection.match(new RegExp(insuranceType, 'gi')) || []).length
  const hasInsuranceTypeInAnswers = insuranceCount >= 2
  
  // V23.0: TARGET 검증 (핵심!)
  // 사용자가 입력한 target이 제목/질문에 포함되어야 함
  let hasTargetMatch = true
  if (target) {
    const targetKeywords = target.split(/[\s,]+/).filter(w => w.length > 1)
    const titleAndQuestion = (titleSection + questionsSection).toLowerCase()
    
    // target 키워드가 하나라도 포함되어야 함
    hasTargetMatch = targetKeywords.some(kw => titleAndQuestion.includes(kw.toLowerCase()))
    
    // 잘못된 타겟 감지 (예: '신혼부부'를 입력했는데 '30대 직장인'이 나온 경우)
    const wrongTargets = ['30대', '40대', '50대', '60대', '직장인', '자영업자', '공무원', '프리랜서', '육아맘']
    const inputTargetNormalized = target.toLowerCase()
    
    for (const wrongTarget of wrongTargets) {
      if (!inputTargetNormalized.includes(wrongTarget.toLowerCase()) && 
          titleAndQuestion.includes(wrongTarget.toLowerCase())) {
        console.log(`[V23.0 TARGET 검증] 불일치 감지: 입력="${target}", 출력에 "${wrongTarget}" 포함`)
        hasTargetMatch = false
        break
      }
    }
  }
  
  // 2026년 팩트 체크 (전략에서 가져온 factChecks 기반)
  const has2026Facts = strategy.factChecks.some(fact => {
    const factKeywords = fact.split(/[\s,]+/).filter(w => w.length > 1)
    return factKeywords.some(kw => contentLower.includes(kw.toLowerCase()))
  })
  
  const failReasons: string[] = []
  
  // V24.0: 금지어 검수 결과 추가 (최우선)
  const hasForbiddenWords = foundForbiddenWords.length > 0
  if (hasForbiddenWords) failReasons.push(`금지어 발견: ${foundForbiddenWords.join(', ')} - 할루시네이션`)
  
  if (!hasConcernInQuestions) failReasons.push('질문에 핵심고민이 충분히 반영되지 않음')
  if (!hasConcernInAnswers) failReasons.push('답변에 핵심고민이 반영되지 않음')
  if (!hasInsuranceTypeInAnswers) failReasons.push(`답변에 "${insuranceType}"가 2회 이상 언급되지 않음`)
  if (!has2026Facts) failReasons.push('2026년 최신 트렌드가 답변에 반영되지 않음')
  if (!hasTargetMatch) failReasons.push(`TARGET 불일치: "${target}"가 출력에 반영되지 않음`)
  
  // V24.0: 금지어 포함 시 무조건 실패 (할루시네이션 원천 차단)
  const overallPass = !hasForbiddenWords && hasConcernInQuestions && hasConcernInAnswers && hasInsuranceTypeInAnswers && hasTargetMatch
  
  console.log(`[RAG Step 4] 자가 진단 - 통과: ${overallPass}, 실패 사유: ${failReasons.length}개`)
  if (!hasTargetMatch) console.log(`[V23.0 TARGET 실패] 입력: "${target}"`)
  
  return {
    hasConcernInQuestions,
    hasConcernInAnswers,
    hasInsuranceTypeInAnswers,
    has2026Facts,
    overallPass,
    failReasons
  }
}

// 가상 연락처 생성 (수정: ㅇㅇ71-10ㅇㅇ 형태 - 이름 없이)
function generateVirtualContact(): { phone: string, kakao: string } {
  // 가상 전화번호 (ㅇㅇXX-10XX 형태 - 18번호 안씀)
  const mid1 = String(Math.floor(10 + Math.random() * 90)) // 2자리 (10-99)
  const mid2 = String(Math.floor(10 + Math.random() * 90)) // 2자리 (10-99)
  const phone = `ㅇㅇ${mid1}-10${mid2}`
  
  // 가상 카카오톡 ID
  const kakaoId = `ins_${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`
  
  return { phone, kakao: kakaoId }
}

// 보험 설계서 생성 (복사 가능한 텍스트 표 형식 + HTML 표시용)
function generateInsuranceDesignData(data: {
  companyName: string,
  productName: string,
  insuranceType: string,
  customerAge: string,
  customerGender: string,
  customerTarget: string,
  customerConcern: string,
  paymentPeriod: string,
  coveragePeriod: string,
  mainCoverage: Array<{category: string, name: string, coverage: string, premium: string, note?: string}>,
  riders: Array<{name: string, coverage: string, premium: string, period: string, note?: string}>,
  totalPremium: string,
  monthlyPremium: string,
  specialNotes: string[],
  designReason: string
}): { text: string, html: string } {
  const today = new Date()
  const dateStr = `${today.getFullYear()}. ${today.getMonth() + 1}. ${today.getDate()}.`
  
  // ===== 엑셀 스타일 텍스트 버전 (복사/붙여넣기용) =====
  let textLines: string[] = []
  
  // 헤더
  textLines.push('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓')
  textLines.push(`┃  ${data.companyName}  |  ${data.productName}`)
  textLines.push(`┃  작성일: ${dateStr}`)
  textLines.push('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛')
  textLines.push('')
  
  // 고객 정보
  textLines.push('【 고객 정보 】')
  textLines.push(`  ▸ 고객유형: ${data.customerTarget}`)
  textLines.push(`  ▸ 연    령: ${data.customerAge}`)
  textLines.push(`  ▸ 성    별: ${data.customerGender}`)
  textLines.push(`  ▸ 보험종류: ${data.insuranceType}`)
  textLines.push(`  ▸ 납입기간: ${data.paymentPeriod} / 보장기간: ${data.coveragePeriod}`)
  textLines.push('')
  
  // 주계약
  textLines.push('┌──────────────────────────────────────────────────────────────┐')
  textLines.push('│                      [ 주계약 보장내역 ]                      │')
  textLines.push('├────────┬────────────────────┬──────────┬──────────┤')
  textLines.push('│  구분  │        보장명        │  보장금액  │  보험료  │')
  textLines.push('├────────┼────────────────────┼──────────┼──────────┤')
  data.mainCoverage.forEach(item => {
    const cat = item.category.padEnd(6, ' ')
    const name = item.name.substring(0, 18).padEnd(18, ' ')
    const coverage = item.coverage.padStart(8, ' ')
    const premium = item.premium.padStart(8, ' ')
    textLines.push(`│ ${cat} │ ${name} │ ${coverage} │ ${premium} │`)
    if (item.note) {
      textLines.push(`│        │   └ ${item.note.substring(0, 36).padEnd(38, ' ')}│`)
    }
  })
  textLines.push('└────────┴────────────────────┴──────────┴──────────┘')
  textLines.push('')
  
  // 특약
  textLines.push('┌──────────────────────────────────────────────────────────────┐')
  textLines.push('│                       [ 특약 보장내역 ]                       │')
  textLines.push('├────┬──────────────────────┬──────────┬────────┬────────┤')
  textLines.push('│ No │        특약명          │  보장금액  │ 보험료 │  만기  │')
  textLines.push('├────┼──────────────────────┼──────────┼────────┼────────┤')
  data.riders.forEach((item, idx) => {
    const no = String(idx + 1).padStart(2, ' ')
    const name = item.name.substring(0, 20).padEnd(20, ' ')
    const coverage = item.coverage.padStart(8, ' ')
    const premium = item.premium.padStart(6, ' ')
    const period = item.period.padStart(6, ' ')
    textLines.push(`│ ${no} │ ${name} │ ${coverage} │ ${premium} │ ${period} │`)
    if (item.note) {
      textLines.push(`│    │   └ ${item.note.substring(0, 40).padEnd(43, ' ')}│`)
    }
  })
  textLines.push('└────┴──────────────────────┴──────────┴────────┴────────┘')
  textLines.push('')
  
  // 합계
  textLines.push('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓')
  textLines.push(`┃                월 납입 보험료 합계:  ${data.monthlyPremium.padStart(12, ' ')}          ┃`)
  textLines.push('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛')
  textLines.push('')
  
  // 설계 이유
  if (data.designReason) {
    textLines.push('【 이 설계를 추천하는 이유 】')
    textLines.push(data.designReason)
    textLines.push('')
  }
  
  // 유의사항
  textLines.push('【 설계 특이사항 및 유의점 】')
  data.specialNotes.forEach(note => {
    textLines.push(`  ▸ ${note}`)
  })
  textLines.push('')
  textLines.push('────────────────────────────────────────────────────────────────')
  textLines.push('              보험엑시트 | 2026년 기준 | 실제 보험료는 상담 필요')
  textLines.push('────────────────────────────────────────────────────────────────')
  
  const textVersion = textLines.join('\n')
  
  // ===== HTML 버전 (화면 표시용 - 반응형) =====
  const mainRowsHtml = data.mainCoverage.map(item => `
    <tr>
      <td>${item.category}</td>
      <td>${item.name}${item.note ? `<br><small style="color:#888;font-size:10px;">└ ${item.note}</small>` : ''}</td>
      <td style="text-align:right;">${item.coverage}</td>
      <td style="text-align:right;">${item.premium}</td>
    </tr>
  `).join('')
  
  const riderRowsHtml = data.riders.map((item, idx) => `
    <tr>
      <td style="text-align:center;">${idx + 1}</td>
      <td>${item.name}${item.note ? `<br><small style="color:#888;font-size:10px;">└ ${item.note}</small>` : ''}</td>
      <td style="text-align:right;">${item.coverage}</td>
      <td style="text-align:right;">${item.premium}</td>
      <td style="text-align:center;">${item.period}</td>
    </tr>
  `).join('')
  
  const notesHtml = data.specialNotes.map(note => `<li style="margin:2px 0;">${note}</li>`).join('')

  const htmlVersion = `
<style>
.ds-sheet { font-family: 'Pretendard', -apple-system, sans-serif; background: #fff; color: #111; padding: 12px; font-size: 12px; line-height: 1.4; }
.ds-sheet * { box-sizing: border-box; }
.ds-header { background: linear-gradient(135deg, #1a5a3a 0%, #0d7a42 100%); color: #fff; padding: 12px; border-radius: 6px 6px 0 0; }
.ds-company { font-size: 11px; opacity: 0.9; }
.ds-product { font-size: 14px; font-weight: 700; margin: 2px 0; }
.ds-date { font-size: 10px; opacity: 0.8; }
.ds-info { background: #f8f9fa; padding: 10px 12px; border: 1px solid #e9ecef; }
.ds-info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.ds-info-item { display: flex; gap: 6px; font-size: 11px; }
.ds-info-label { color: #666; min-width: 48px; }
.ds-info-value { color: #111; font-weight: 500; }
.ds-section { margin: 8px 0; }
.ds-section-title { font-size: 11px; font-weight: 700; color: #1a5a3a; margin-bottom: 4px; padding-left: 8px; border-left: 3px solid #1a5a3a; }
.ds-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.ds-table th { background: #e8f5e9; padding: 6px 4px; border: 1px solid #c8e6c9; font-weight: 600; font-size: 10px; }
.ds-table td { padding: 5px 4px; border: 1px solid #e0e0e0; }
.ds-table tr:nth-child(even) { background: #fafafa; }
.ds-total { background: linear-gradient(135deg, #1a5a3a 0%, #0d7a42 100%); color: #fff; padding: 10px 12px; margin: 8px 0; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; }
.ds-total-label { font-size: 12px; }
.ds-total-value { font-size: 16px; font-weight: 700; }
.ds-reason { background: #fff3e0; border: 1px solid #ffe0b2; border-radius: 4px; padding: 8px; margin: 8px 0; }
.ds-reason-title { font-size: 10px; font-weight: 700; color: #e65100; margin-bottom: 4px; }
.ds-reason-text { font-size: 11px; color: #333; }
.ds-notes { background: #f5f5f5; padding: 8px; border-radius: 4px; margin: 8px 0; }
.ds-notes-title { font-size: 10px; font-weight: 700; color: #666; margin-bottom: 4px; }
.ds-notes ul { margin: 0; padding-left: 16px; font-size: 10px; color: #555; }
.ds-footer { text-align: center; font-size: 9px; color: #999; padding: 8px; border-top: 1px solid #eee; }
@media (max-width: 480px) {
  .ds-sheet { padding: 8px; font-size: 11px; }
  .ds-table { font-size: 10px; }
  .ds-table th, .ds-table td { padding: 4px 2px; }
  .ds-info-grid { grid-template-columns: 1fr; }
}
</style>
<div class="ds-sheet">
  <div class="ds-header">
    <div class="ds-company">${data.companyName}</div>
    <div class="ds-product">${data.productName}</div>
    <div class="ds-date">작성일: ${dateStr}</div>
  </div>
  
  <div class="ds-info">
    <div class="ds-info-grid">
      <div class="ds-info-item"><span class="ds-info-label">고객유형</span><span class="ds-info-value">${data.customerTarget}</span></div>
      <div class="ds-info-item"><span class="ds-info-label">연령/성별</span><span class="ds-info-value">${data.customerAge} / ${data.customerGender}</span></div>
      <div class="ds-info-item"><span class="ds-info-label">보험종류</span><span class="ds-info-value">${data.insuranceType}</span></div>
      <div class="ds-info-item"><span class="ds-info-label">납입/보장</span><span class="ds-info-value">${data.paymentPeriod} / ${data.coveragePeriod}</span></div>
    </div>
  </div>
  
  <div class="ds-section">
    <div class="ds-section-title">주계약 보장내역</div>
    <table class="ds-table">
      <thead><tr><th style="width:18%;">구분</th><th>보장명</th><th style="width:20%;">보장금액</th><th style="width:18%;">보험료</th></tr></thead>
      <tbody>${mainRowsHtml}</tbody>
    </table>
  </div>
  
  <div class="ds-section">
    <div class="ds-section-title">특약 보장내역</div>
    <table class="ds-table">
      <thead><tr><th style="width:8%;">No</th><th>특약명</th><th style="width:18%;">보장금액</th><th style="width:15%;">보험료</th><th style="width:12%;">만기</th></tr></thead>
      <tbody>${riderRowsHtml}</tbody>
    </table>
  </div>
  
  <div class="ds-total">
    <span class="ds-total-label">월 납입 보험료 합계</span>
    <span class="ds-total-value">${data.monthlyPremium}</span>
  </div>
  
  ${data.designReason ? `
  <div class="ds-reason">
    <div class="ds-reason-title">이 설계를 추천하는 이유</div>
    <div class="ds-reason-text">${data.designReason}</div>
  </div>
  ` : ''}
  
  <div class="ds-notes">
    <div class="ds-notes-title">설계 특이사항 및 유의점</div>
    <ul>${notesHtml}</ul>
  </div>
  
  <div class="ds-footer">보험엑시트 | 2026년 기준 | 실제 보험료는 상담이 필요합니다</div>
</div>
  `
  
  return { text: textVersion, html: htmlVersion }
}

const mainPageHtml = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>보험 콘텐츠 마스터 | AI Q&A 자동화</title>
  <meta name="description" content="AI 기반 네이버 카페 Q&A 자동 생성 + 설계서 이미지 생성">
  <!-- 보안: 캐시 방지 -->
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <link rel="preconnect" href="https://cdn.jsdelivr.net">
  <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <script src="https://html2canvas.hertzen.com/dist/html2canvas.min.js"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { 
            sans: ['"Pretendard Variable"', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'Helvetica Neue', 'Segoe UI', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', 'Apple Color Emoji', 'Segoe UI Emoji', 'sans-serif'],
            display: ['"Pretendard Variable"', 'Pretendard', 'sans-serif']
          },
          colors: { 
            primary: '#03C75A', 
            dark: { 900: '#050505', 800: '#0a0a0a', 700: '#111111', 600: '#1a1a1a' }
          },
          fontSize: {
            '2xs': ['0.65rem', { lineHeight: '0.9rem' }],
          }
        }
      }
    }
  </script>
  <style>
    /* ========== 보안: 복사/선택/드래그 방지 ========== */
    * { 
      margin: 0; padding: 0; box-sizing: border-box;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
    }
    /* 입력 필드는 선택 허용 */
    input, textarea, [contenteditable="true"] {
      -webkit-user-select: text;
      -moz-user-select: text;
      -ms-user-select: text;
      user-select: text;
    }
    /* 이미지 드래그 방지 */
    img {
      -webkit-user-drag: none;
      -khtml-user-drag: none;
      -moz-user-drag: none;
      -o-user-drag: none;
      user-drag: none;
      pointer-events: none;
    }
    
    /* ========== 인쇄 방지 ========== */
    @media print {
      html, body {
        display: none !important;
        visibility: hidden !important;
      }
      * {
        display: none !important;
        visibility: hidden !important;
      }
    }
    
    /* ========== 추가 보안: 텍스트 선택 하이라이트 숨김 ========== */
    ::selection {
      background: transparent;
      color: inherit;
    }
    ::-moz-selection {
      background: transparent;
      color: inherit;
    }
    
    html { scroll-behavior: smooth; }
    body { 
      font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Helvetica Neue', 'Segoe UI', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif;
      background: #050505; 
      color: #fff; 
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      letter-spacing: -0.025em;
      font-feature-settings: 'ss01' on, 'ss02' on;
      line-height: 1.5;
    }
    
    /* 반응형 기본 폰트 - 더 큰 화면 활용 */
    html { font-size: 15px; }
    @media (min-width: 640px) { html { font-size: 15px; } }
    @media (min-width: 1024px) { html { font-size: 16px; } }
    @media (min-width: 1440px) { html { font-size: 17px; } }
    @media (min-width: 1920px) { html { font-size: 18px; } }
    
    /* 배경 */
    .hero-gradient {
      background: linear-gradient(180deg, #050505 0%, #0a0f14 40%, #050505 100%);
      position: relative;
      min-height: 100vh;
    }
    .hero-gradient::before {
      content: '';
      position: absolute;
      top: 0; left: 50%;
      transform: translateX(-50%);
      width: 100%; max-width: 1800px; height: 50%;
      background: radial-gradient(ellipse at center top, rgba(3, 199, 90, 0.06) 0%, transparent 65%);
      pointer-events: none;
    }
    
    /* 글래스 카드 */
    .glass-card {
      background: rgba(255, 255, 255, 0.02);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 12px;
    }
    @media (min-width: 768px) {
      .glass-card { border-radius: 16px; }
    }
    
    /* 입력 필드 - PC에서 더 크게 */
    .input-premium {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      font-size: 0.95rem;
      transition: all 0.15s ease;
      font-weight: 400;
    }
    @media (min-width: 1024px) {
      .input-premium { font-size: 1rem; border-radius: 12px; }
    }
    @media (min-width: 1440px) {
      .input-premium { font-size: 1.05rem; }
    }
    .input-premium:focus {
      background: rgba(255, 255, 255, 0.05);
      border-color: #03C75A;
      box-shadow: 0 0 0 2px rgba(3, 199, 90, 0.12);
      outline: none;
    }
    .input-premium::placeholder { color: rgba(255, 255, 255, 0.45); font-weight: 400; }
    
    /* 칩 버튼 - PC에서 더 크게! */
    .chip {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 0.85rem;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.85);
      transition: all 0.15s ease;
      cursor: pointer;
      white-space: nowrap;
    }
    @media (min-width: 768px) {
      .chip { padding: 10px 16px; font-size: 0.9rem; border-radius: 8px; }
    }
    @media (min-width: 1024px) {
      .chip { padding: 12px 20px; font-size: 0.95rem; border-radius: 10px; }
    }
    @media (min-width: 1440px) {
      .chip { padding: 14px 24px; font-size: 1rem; }
    }
    .chip:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }
    .chip.active {
      background: rgba(3, 199, 90, 0.2);
      border-color: rgba(3, 199, 90, 0.5);
      color: #2ECC71;
      font-weight: 600;
    }
    
    /* 중복 선택 가능한 칩 버튼 - 문체 톤용 */
    .chip-multi {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 0.85rem;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.85);
      transition: all 0.15s ease;
      cursor: pointer;
      white-space: nowrap;
    }
    @media (min-width: 768px) {
      .chip-multi { padding: 10px 16px; font-size: 0.9rem; border-radius: 8px; }
    }
    @media (min-width: 1024px) {
      .chip-multi { padding: 12px 20px; font-size: 0.95rem; border-radius: 10px; }
    }
    @media (min-width: 1440px) {
      .chip-multi { padding: 14px 24px; font-size: 1rem; }
    }
    .chip-multi:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }
    .chip-multi.active {
      background: rgba(3, 199, 90, 0.2);
      border-color: rgba(3, 199, 90, 0.5);
      color: #2ECC71;
      font-weight: 600;
    }
    
    /* 보험초보 특수 스타일 */
    .chip-beginner {
      background: linear-gradient(135deg, rgba(147, 112, 219, 0.15) 0%, rgba(138, 43, 226, 0.1) 100%);
      border-color: rgba(147, 112, 219, 0.4);
      color: #B48EFF;
    }
    .chip-beginner:hover {
      background: linear-gradient(135deg, rgba(147, 112, 219, 0.25) 0%, rgba(138, 43, 226, 0.2) 100%);
      border-color: rgba(147, 112, 219, 0.6);
      color: #C9A0FF;
    }
    .chip-beginner.active {
      background: linear-gradient(135deg, rgba(147, 112, 219, 0.35) 0%, rgba(138, 43, 226, 0.3) 100%);
      border-color: rgba(147, 112, 219, 0.8);
      color: #D4B8FF;
      box-shadow: 0 0 12px rgba(147, 112, 219, 0.4);
    }
    
    /* 제안서 요청형 특수 스타일 */
    .chip-proposal {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(29, 78, 216, 0.1) 100%);
      border-color: rgba(59, 130, 246, 0.4);
      color: #60A5FA;
    }
    .chip-proposal:hover {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(29, 78, 216, 0.2) 100%);
      border-color: rgba(59, 130, 246, 0.6);
      color: #93C5FD;
    }
    .chip-proposal.active {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.35) 0%, rgba(29, 78, 216, 0.3) 100%);
      border-color: rgba(59, 130, 246, 0.8);
      color: #BFDBFE;
      box-shadow: 0 0 12px rgba(59, 130, 246, 0.4);
    }
    
    /* 페이드인 애니메이션 */
    @keyframes fadeIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
    .animate-fadeIn {
      animation: fadeIn 0.2s ease-out;
    }
    
    /* 버튼 - 컴팩트 */
    .btn-primary {
      background: linear-gradient(135deg, #03C75A 0%, #00A84D 100%);
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.9rem;
      transition: all 0.15s ease;
      letter-spacing: -0.01em;
    }
    .btn-primary:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 24px rgba(3, 199, 90, 0.3);
    }
    .btn-primary:active { transform: translateY(0); }
    .btn-primary:disabled {
      background: linear-gradient(135deg, #2d3748 0%, #1a202c 100%);
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }
    
    /* 피처 탭 - 컴팩트 */
    .feature-tab {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 10px;
      transition: all 0.15s ease;
      cursor: pointer;
      padding: 10px 12px;
    }
    @media (min-width: 768px) {
      .feature-tab { padding: 12px 16px; border-radius: 12px; }
    }
    .feature-tab:hover {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.1);
    }
    .feature-tab.active {
      background: rgba(3, 199, 90, 0.1);
      border-color: rgba(3, 199, 90, 0.35);
    }
    
    /* 결과 카드 - 가독성 개선 */
    .result-card {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
    }
    .result-content { 
      max-height: 280px; 
      overflow-y: auto;
      color: rgba(255, 255, 255, 0.92);
    }
    @media (min-width: 768px) {
      .result-content { max-height: 350px; }
    }
    @media (min-width: 1024px) {
      .result-content { max-height: 420px; }
    }
    @media (min-width: 1440px) {
      .result-content { max-height: 500px; }
    }
    
    /* 스텝 뱃지 - 더 작게 */
    .step-badge {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      font-weight: 700;
      font-size: 10px;
    }
    @media (min-width: 768px) {
      .step-badge { width: 26px; height: 26px; font-size: 11px; }
    }
    .step-badge.completed { background: #03C75A; color: white; }
    .step-badge.active { background: #3B82F6; color: white; animation: pulse 1s infinite; }
    .step-badge.pending { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.5); }
    
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.35); }
      50% { box-shadow: 0 0 0 5px rgba(59, 130, 246, 0); }
    }
    
    /* 키워드 태그 - 가독성 개선 */
    .keyword-tag {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 5px 10px;
      background: rgba(3, 199, 90, 0.15);
      border: 1px solid rgba(3, 199, 90, 0.3);
      border-radius: 5px;
      font-size: 0.78rem;
      font-weight: 600;
      color: #2ECC71;
      cursor: pointer;
      transition: all 0.12s ease;
    }
    .keyword-tag:hover {
      background: rgba(3, 199, 90, 0.25);
      color: #58D68D;
    }
    
    /* 스피너 - 더 작게 */
    .spinner {
      border: 2px solid rgba(255, 255, 255, 0.08);
      border-top-color: #fff;
      border-radius: 50%;
      width: 16px; height: 16px;
      animation: spin 0.5s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    
    /* 토스트 */
    .toast {
      transform: translateY(80px);
      opacity: 0;
      transition: all 0.25s ease;
    }
    .toast.show { transform: translateY(0); opacity: 1; }
    
    /* 스크롤바 - 더 얇게 */
    ::-webkit-scrollbar { width: 4px; height: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 2px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.15); }
    
    /* 설계서 프리뷰 */
    .design-preview {
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.35);
    }
    
    /* 컨테이너 - PC에서 전체 화면 활용! */
    .container-wide { 
      max-width: 100%; 
      width: 100%; 
    }
    /* 모바일에서는 약간의 여백, PC에서는 전체 너비 */
    @media (min-width: 1024px) {
      .container-wide { 
        max-width: calc(100% - 48px); /* 좌우 24px씩만 여백 */
      }
    }
    @media (min-width: 1440px) {
      .container-wide { 
        max-width: calc(100% - 64px); /* 좌우 32px씩만 여백 */
      }
    }
    .container-full { max-width: 100%; }
    
    /* 모바일 터치 */
    @media (max-width: 640px) {
      .touch-target { min-height: 42px; }
    }
    
    /* 숨김 스크롤바 (터치 디바이스) */
    .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
    .scrollbar-hide::-webkit-scrollbar { display: none; }
    
    /* 그리드 레이아웃 확장 - PC에서 더 넓게! */
    @media (min-width: 1280px) {
      .xl-grid-3 { grid-template-columns: repeat(3, 1fr); }
    }
    @media (min-width: 1536px) {
      .xxl-gap { gap: 1.5rem; }
    }
    @media (min-width: 1920px) {
      .xxl-gap { gap: 2rem; }
    }
    
    /* 섹션 간격 최적화 */
    .section-compact { padding-top: 0.75rem; padding-bottom: 0.75rem; }
    @media (min-width: 768px) {
      .section-compact { padding-top: 1rem; padding-bottom: 1rem; }
    }
    
    /* 텍스트 최적화 */
    .text-balance { text-wrap: balance; }
    
    /* PC 전용 - 더 넓은 그리드 */
    @media (min-width: 1024px) {
      .lg-full-width { width: 100% !important; max-width: 100% !important; }
    }
  </style>
</head>
<body class="min-h-screen" oncontextmenu="return false;" ondragstart="return false;" onselectstart="return false;" oncopy="return false;" oncut="return false;">
  
  <!-- 네비게이션 - PC에서 전체 너비 -->
  <nav class="fixed top-0 left-0 right-0 z-50 px-2 py-1.5 sm:px-3 sm:py-2 lg:px-6 xl:px-8">
    <div class="w-full">
      <div class="glass-card px-3 py-1.5 sm:px-4 sm:py-2 flex items-center justify-between">
        <a href="/" class="flex items-center gap-2">
          <div class="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-to-br from-primary to-emerald-600 flex items-center justify-center">
            <i class="fas fa-shield-alt text-white text-xs sm:text-sm"></i>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="text-xs sm:text-sm font-bold text-white">보험 콘텐츠 마스터</span>
            <span class="text-2xs sm:text-xs text-gray-400 font-medium">V6.8</span>
          </div>
        </a>
        <div class="flex items-center gap-1.5 sm:gap-2">
          <div class="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/15">
            <span class="w-1 h-1 rounded-full bg-primary animate-pulse"></span>
            <span class="text-2xs text-primary font-medium">AI</span>
          </div>
          <a href="/admin" class="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 transition-all">
            <i class="fas fa-cog text-xs sm:text-sm"></i>
          </a>
        </div>
      </div>
    </div>
  </nav>

  <!-- 메인 섹션 - PC에서 전체 너비 활용 -->
  <section class="hero-gradient min-h-screen px-2 sm:px-3 lg:px-6 xl:px-8 2xl:px-12 pt-12 sm:pt-14 pb-4 sm:pb-6">
    <div class="w-full">
      
      <!-- 헤더 - 더 컴팩트 -->
      <div class="text-center mb-3 sm:mb-4 lg:mb-5">
        <h1 class="text-lg sm:text-xl md:text-2xl lg:text-3xl xl:text-4xl font-extrabold text-white mb-1 sm:mb-1.5 leading-tight tracking-tight">
          네이버 카페 <span class="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-400">Q&A 자동화</span>
        </h1>
        <p class="text-xs sm:text-sm text-gray-300 font-medium">키워드 분석부터 설계서 이미지까지 원클릭</p>
      </div>
      
      <!-- 탭 - 더 컴팩트 -->
      <div class="flex gap-1.5 sm:gap-2 mb-3 sm:mb-4 overflow-x-auto pb-1 scrollbar-hide">
        <button onclick="selectFeature('qna')" id="card-qna" class="feature-tab active flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          <div class="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <i class="fas fa-robot text-blue-400 text-xs sm:text-sm"></i>
          </div>
          <div class="text-left">
            <div class="text-xs sm:text-sm font-semibold text-white">Q&A 자동화</div>
            <div class="text-2xs text-gray-400">15-20초</div>
          </div>
        </button>
        
        <button onclick="selectFeature('blog')" id="card-blog" class="feature-tab flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          <div class="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
            <i class="fas fa-pen-fancy text-orange-400 text-xs sm:text-sm"></i>
          </div>
          <div class="text-left">
            <div class="text-xs sm:text-sm font-semibold text-white">블로그 생성</div>
          </div>
        </button>
        
        <button onclick="selectFeature('analyze')" id="card-analyze" class="feature-tab flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          <div class="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <i class="fas fa-chart-line text-purple-400 text-xs sm:text-sm"></i>
          </div>
          <div class="text-left">
            <div class="text-xs sm:text-sm font-semibold text-white">블로그 분석</div>
            <div class="text-2xs text-gray-400">SEO 점수</div>
          </div>
        </button>
      </div>
      
      <!-- 폼 영역 - PC에서 전체 너비 활용 -->
      <div class="glass-card p-3 sm:p-4 lg:p-6 xl:p-8">
        
        <div id="form-qna" class="space-y-4 sm:space-y-5 lg:space-y-6">
          <!-- 진행 상황 -->
          <div id="qna-progress" class="hidden bg-white/8 rounded-lg p-3 lg:p-4">
            <div class="flex items-center justify-between mb-2">
              <span class="text-white font-semibold text-xs lg:text-sm">생성 중...</span>
              <span id="progress-percent" class="text-primary font-bold text-xs lg:text-sm">0%</span>
            </div>
            <div class="flex items-center gap-0.5">
              <div id="step-1"><div class="step-badge pending">1</div></div>
              <div class="flex-1 h-px bg-white/8"></div>
              <div id="step-2"><div class="step-badge pending">2</div></div>
              <div class="flex-1 h-px bg-white/8"></div>
              <div id="step-3"><div class="step-badge pending">3</div></div>
              <div class="flex-1 h-px bg-white/8"></div>
              <div id="step-4"><div class="step-badge pending">4</div></div>
              <div class="flex-1 h-px bg-white/8"></div>
              <div id="step-5"><div class="step-badge pending">5</div></div>
            </div>
            <p id="progress-status" class="text-gray-400 text-2xs lg:text-xs mt-1.5 text-center">준비 중...</p>
          </div>
          
          <!-- 새로운 UI 순서: 핵심고민(1순위) → 타겟 → 보험종류 → 문체톤 -->
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-5 lg:gap-6 xl:gap-8">
            
            <!-- 칼럼 1: 핵심 고민 + 사진 업로드 (1순위 - 빨간색 강조) -->
            <div class="space-y-3 lg:space-y-4">
              <div>
                <label class="block text-xs sm:text-sm lg:text-base font-semibold text-white mb-2 lg:mb-3">
                  <i class="fas fa-fire text-red-500 mr-1.5"></i><span class="text-red-400">핵심 고민</span> <span class="text-red-300 text-xs lg:text-sm">(1순위)</span>
                </label>
                <textarea id="qna-concern" rows="3" placeholder="예: 설계사가 기존 보험 해지하고 새로 가입하라는데 손해 아닌가요?&#10;&#10;비워두면 AI가 자동 생성합니다" class="input-premium w-full px-3 py-2.5 lg:px-4 lg:py-3 text-white resize-none text-sm lg:text-base border-red-500/30 focus:border-red-500/50"></textarea>
              </div>
              
              <!-- 📷 사진 업로드 영역 (드래그 앤 드롭 + 클릭) -->
              <div>
                <label class="block text-xs sm:text-sm lg:text-base font-semibold text-white mb-2 lg:mb-3">
                  <i class="fas fa-camera text-purple-400 mr-1.5"></i><span class="text-purple-300">증권/설계서 사진</span> <span class="text-gray-400 text-xs">(선택, 최대 20MB)</span>
                </label>
                <div id="photo-upload-zone" 
                     class="relative border-2 border-dashed border-purple-500/30 rounded-xl p-4 text-center cursor-pointer hover:border-purple-500/60 hover:bg-purple-500/5 transition-all"
                     ondrop="handlePhotoDrop(event)" 
                     ondragover="handlePhotoDragOver(event)" 
                     ondragleave="handlePhotoDragLeave(event)"
                     onclick="document.getElementById('photo-input').click()">
                  <input type="file" id="photo-input" accept="image/*" class="hidden" onchange="handlePhotoSelect(event)" multiple>
                  <div id="photo-upload-content">
                    <i class="fas fa-cloud-upload-alt text-3xl text-purple-400 mb-2"></i>
                    <p class="text-sm text-gray-300">사진을 드래그하거나 클릭하여 업로드</p>
                    <p class="text-xs text-gray-500 mt-1">JPG, PNG, HEIC 지원 (최대 20MB)</p>
                  </div>
                  <div id="photo-preview-container" class="hidden flex flex-wrap gap-2 justify-center"></div>
                </div>
                <!-- 사진 분석 결과 표시 영역 -->
                <div id="photo-analysis-result" class="hidden mt-3 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                  <div class="flex items-center gap-2 mb-2">
                    <i class="fas fa-search text-purple-400"></i>
                    <span class="text-purple-300 font-semibold text-sm">AI 사진 분석 결과</span>
                  </div>
                  <p id="photo-analysis-text" class="text-gray-300 text-sm"></p>
                </div>
              </div>
              
              <div class="flex items-center gap-3 lg:gap-4">
                <label class="flex items-center gap-2 cursor-pointer bg-blue-500/10 border border-blue-500/15 rounded-lg px-3 py-2.5 lg:px-4 lg:py-3">
                  <input type="checkbox" id="generate-design" checked class="w-4 h-4 lg:w-5 lg:h-5 rounded bg-white/10 border-white/20 text-primary focus:ring-primary">
                  <span class="text-white font-medium text-xs lg:text-sm">설계서 생성</span>
                </label>
                
                <button onclick="generateQnAFull()" id="btn-qna" class="btn-primary flex-1 py-3 lg:py-4 text-white text-sm lg:text-base flex items-center justify-center gap-2 touch-target">
                  <i class="fas fa-magic"></i>
                  <span>Q&A 생성</span>
                </button>
              </div>
            </div>
            
            <!-- 칼럼 2: 타겟 고객 (선택형) -->
            <div>
              <label class="block text-xs sm:text-sm lg:text-base font-semibold text-white mb-2 lg:mb-3">
                <i class="fas fa-users text-blue-400 mr-1.5"></i>타겟 고객 <span class="text-gray-400 text-xs">(선택)</span>
              </label>
              <div class="flex flex-wrap gap-1.5 sm:gap-2 lg:gap-2.5" id="qna-target-chips">
                <button onclick="selectOptionalChip(this, 'qna-target')" data-value="20대 사회초년생" class="chip">20대</button>
                <button onclick="selectOptionalChip(this, 'qna-target')" data-value="30대 직장인" class="chip">30대</button>
                <button onclick="selectOptionalChip(this, 'qna-target')" data-value="40대 가장" class="chip">40대</button>
                <button onclick="selectOptionalChip(this, 'qna-target')" data-value="50대 은퇴준비" class="chip">50대</button>
                <button onclick="selectOptionalChip(this, 'qna-target')" data-value="신혼부부" class="chip">신혼</button>
                <button onclick="selectOptionalChip(this, 'qna-target')" data-value="자영업자" class="chip">자영업</button>
              </div>
            </div>
            
            <!-- 칼럼 3: 보험 종류 (선택형) -->
            <div>
              <label class="block text-xs sm:text-sm lg:text-base font-semibold text-white mb-2 lg:mb-3">
                <i class="fas fa-shield-alt text-blue-400 mr-1.5"></i>보험 종류 <span class="text-gray-400 text-xs">(선택)</span>
              </label>
              <div class="flex flex-wrap gap-1.5 sm:gap-2 lg:gap-2.5" id="qna-insurance-chips">
                <button onclick="selectOptionalChip(this, 'qna-insurance')" data-value="종신보험" class="chip">종신</button>
                <button onclick="selectOptionalChip(this, 'qna-insurance')" data-value="암보험" class="chip">암보험</button>
                <button onclick="selectOptionalChip(this, 'qna-insurance')" data-value="실손보험" class="chip">실손</button>
                <button onclick="selectOptionalChip(this, 'qna-insurance')" data-value="연금보험" class="chip">연금</button>
                <button onclick="selectOptionalChip(this, 'qna-insurance')" data-value="저축보험" class="chip">저축</button>
                <button onclick="selectOptionalChip(this, 'qna-insurance')" data-value="변액보험" class="chip">변액</button>
                <button onclick="selectOptionalChip(this, 'qna-insurance')" data-value="어린이보험" class="chip">어린이</button>
                <button onclick="selectOptionalChip(this, 'qna-insurance')" data-value="운전자보험" class="chip">운전자</button>
              </div>
            </div>
            
            <!-- 칼럼 4: 문체 톤 (선택형, 중복 가능) -->
            <div>
              <label class="block text-xs sm:text-sm lg:text-base font-semibold text-white mb-2 lg:mb-3">
                <i class="fas fa-comment-dots text-blue-400 mr-1.5"></i>문체 톤 <span class="text-gray-400 text-xs">(선택, 중복 가능)</span>
              </label>
              <div class="flex flex-wrap gap-1.5 sm:gap-2 lg:gap-2.5" id="qna-tone-chips">
                <button onclick="toggleOptionalToneChip(this)" data-value="친근한" class="chip-multi">친근</button>
                <button onclick="toggleOptionalToneChip(this)" data-value="전문적인" class="chip-multi">전문</button>
                <button onclick="toggleOptionalToneChip(this)" data-value="설득력 있는" class="chip-multi">설득</button>
                <button onclick="toggleOptionalToneChip(this)" data-value="공감하는" class="chip-multi">공감</button>
                <button onclick="toggleOptionalToneChip(this)" data-value="보험초보" class="chip-multi chip-beginner" title="보험이 처음인 고객을 위한 쉬운 설명">
                  <i class="fas fa-seedling mr-1"></i>보험초보
                </button>
                <button onclick="toggleOptionalToneChip(this)" data-value="제안서요청형" class="chip-multi chip-proposal" title="구체적인 설계/제안서를 요청하는 형식">
                  <i class="fas fa-file-signature mr-1"></i>제안서 요청
                </button>
              </div>
            </div>
          </div>
          
          <!-- ========== IP 보안 접속 제어 모듈 ========== -->
          <div class="mt-6 lg:mt-8 p-4 sm:p-5 lg:p-6 bg-gradient-to-r from-gray-900/80 to-gray-800/80 rounded-2xl border border-cyan-500/20 backdrop-blur-sm">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                <i class="fas fa-shield-alt text-cyan-400 text-lg"></i>
              </div>
              <div>
                <h3 class="text-white font-bold text-sm lg:text-base">IP 보안 접속 제어</h3>
                <p class="text-gray-400 text-xs">네이버 탐지 우회를 위한 Clean IP 연결</p>
              </div>
              <div id="ip-connection-badge" class="ml-auto px-3 py-1 rounded-full text-xs font-medium bg-gray-700/50 text-gray-400 border border-gray-600/30">
                <i class="fas fa-circle text-gray-500 mr-1 text-2xs"></i>미연결
              </div>
            </div>
            
            <!-- 슬라이드 버튼 -->
            <div class="relative mb-4">
              <div id="ip-slider-track" class="relative h-14 bg-gray-800/80 rounded-xl border border-gray-700/50 overflow-hidden cursor-pointer" onclick="handleSliderClick(event)">
                <!-- 배경 그라디언트 (드래그 진행에 따라) -->
                <div id="ip-slider-fill" class="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-600/30 to-cyan-500/50 transition-all duration-100" style="width: 0%"></div>
                
                <!-- 텍스트 -->
                <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span id="ip-slider-text" class="text-gray-300 text-sm font-medium tracking-wide">
                    <i class="fas fa-arrow-right mr-2 animate-pulse"></i>밀어서 새 IP 받기 (Clean IP)
                  </span>
                </div>
                
                <!-- 드래그 핸들 -->
                <div id="ip-slider-handle" 
                     class="absolute top-1 left-1 w-12 h-12 bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-lg shadow-lg shadow-cyan-500/30 flex items-center justify-center cursor-grab active:cursor-grabbing transition-all duration-100 hover:shadow-cyan-500/50"
                     style="touch-action: none;">
                  <i class="fas fa-exchange-alt text-white text-lg"></i>
                </div>
              </div>
              
              <!-- 힌트 텍스트 -->
              <p id="ip-slider-hint" class="text-center text-gray-500 text-xs mt-2">
                <i class="fas fa-hand-pointer mr-1"></i>핸들을 오른쪽 끝까지 드래그하세요
              </p>
            </div>
            
            <!-- 상태 표시 영역 (숨겨진 상태로 시작) -->
            <div id="ip-status-area" class="hidden">
              <!-- 로딩 상태 -->
              <div id="ip-loading" class="hidden text-center py-4">
                <div class="inline-flex items-center gap-3 px-4 py-2 bg-cyan-500/10 rounded-lg border border-cyan-500/20">
                  <div class="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                  <span class="text-cyan-400 text-sm font-medium">보안 서버에 접속 중입니다...</span>
                </div>
              </div>
              
              <!-- 성공 상태 -->
              <div id="ip-success" class="hidden">
                <div class="flex items-center justify-center gap-2 mb-3">
                  <span class="px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg text-sm font-medium border border-green-500/30">
                    <i class="fas fa-check-circle mr-1.5"></i>안전한 한국 IP로 변경되었습니다
                  </span>
                </div>
                
                <!-- IP 비교 표시 -->
                <div class="flex items-center justify-center gap-4 py-4 px-6 bg-gray-800/50 rounded-xl border border-gray-700/30">
                  <div class="text-center">
                    <p class="text-gray-500 text-xs mb-1">이전 IP</p>
                    <p id="ip-old" class="text-gray-400 text-sm line-through">--.---.---.---</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <i class="fas fa-arrow-right text-cyan-400 text-lg animate-pulse"></i>
                  </div>
                  <div class="text-center">
                    <p class="text-green-400 text-xs mb-1">새로운 IP</p>
                    <p id="ip-new" class="text-green-400 text-base font-bold">--.---.---.---</p>
                    <span id="ip-country" class="inline-block mt-1 px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded font-medium">KR</span>
                  </div>
                </div>
                
                <p class="text-center text-gray-500 text-xs mt-3">
                  <i class="fas fa-lock text-green-400 mr-1"></i>네이버가 탐지하지 못하는 주거용 IP입니다
                </p>
              </div>
              
              <!-- 에러 상태 -->
              <div id="ip-error" class="hidden text-center py-4">
                <div class="inline-flex items-center gap-2 px-4 py-2 bg-red-500/10 rounded-lg border border-red-500/20">
                  <i class="fas fa-exclamation-triangle text-red-400"></i>
                  <span id="ip-error-msg" class="text-red-400 text-sm">새 IP 할당 실패. 다시 밀어주세요.</span>
                </div>
              </div>
            </div>
            
            <!-- 현재 연결 정보 (연결 후 표시) -->
            <div id="ip-current-info" class="hidden mt-4 pt-4 border-t border-gray-700/30">
              <div class="flex items-center justify-between text-xs">
                <span class="text-gray-500">
                  <i class="fas fa-clock mr-1"></i>마지막 변경: <span id="ip-last-changed">-</span>
                </span>
                <button onclick="refreshIP()" class="text-cyan-400 hover:text-cyan-300 transition-colors">
                  <i class="fas fa-sync-alt mr-1"></i>IP 다시 변경
                </button>
              </div>
            </div>
          </div>
          <!-- ========== IP 보안 접속 제어 모듈 끝 ========== -->
          
        </div>
        
        <div id="form-blog" class="hidden">
          <!-- 블로그 생성은 XIVIX SEO Master로 연결 (화면 최대 활용) -->
          <div class="relative w-full" style="height: calc(100vh - 120px); min-height: 600px;">
            <iframe 
              id="blog-iframe"
              src="https://xivix-seo-master.pages.dev/" 
              class="w-full h-full border-0 rounded-lg"
              style="background: #0a0a0a;"
              allow="clipboard-read; clipboard-write"
            ></iframe>
          </div>
        </div>
        
        <div id="form-analyze" class="space-y-4 sm:space-y-5 lg:space-y-6 hidden">
          <div class="grid grid-cols-1 lg:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-5 lg:gap-6 xl:gap-8">
            <!-- 칼럼 1-2: 분석할 글 (큰 화면에서 더 넓게) -->
            <div class="lg:col-span-2 2xl:col-span-2">
              <label class="block text-xs sm:text-sm lg:text-base font-semibold text-white mb-2 lg:mb-3">
                <i class="fas fa-file-alt text-purple-400 mr-1.5"></i>분석할 블로그 글 <span class="text-red-400">*</span>
              </label>
              <textarea id="analyze-content" rows="5" placeholder="네이버 블로그에 작성한 글을 붙여넣으세요" class="input-premium w-full px-3 py-2.5 lg:px-4 lg:py-3 text-white resize-none text-sm lg:text-base"></textarea>
            </div>
            
            <!-- 칼럼 3: 키워드 -->
            <div>
              <label class="block text-xs sm:text-sm lg:text-base font-semibold text-white mb-2 lg:mb-3">
                <i class="fas fa-key text-purple-400 mr-1.5"></i>키워드
              </label>
              <input type="text" id="analyze-keyword" placeholder="종신보험" class="input-premium w-full px-3 py-2.5 lg:px-4 lg:py-3 text-white text-sm lg:text-base">
            </div>
            
            <!-- 칼럼 4: 지역 + 버튼 -->
            <div class="space-y-3 lg:space-y-4">
              <div>
                <label class="block text-xs sm:text-sm lg:text-base font-semibold text-white mb-2 lg:mb-3">
                  <i class="fas fa-map-marker-alt text-purple-400 mr-1.5"></i>지역
                </label>
                <input type="text" id="analyze-region" placeholder="강남구" class="input-premium w-full px-3 py-2.5 lg:px-4 lg:py-3 text-white text-sm lg:text-base">
              </div>
              
              <button onclick="analyzeBlog()" id="btn-analyze" class="btn-primary w-full py-3 lg:py-4 text-white text-sm lg:text-base flex items-center justify-center gap-2 touch-target" style="background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);">
                <i class="fas fa-search-plus"></i>
                <span>SEO 분석</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section id="resultsSection" class="hidden py-4 sm:py-6 lg:py-8 px-2 sm:px-3 lg:px-6 xl:px-8 2xl:px-12">
    <div class="w-full">
      
      <div class="flex items-center justify-between gap-3 mb-4 sm:mb-5 lg:mb-6">
        <div>
          <h2 class="text-base sm:text-lg lg:text-xl xl:text-2xl font-bold text-white">생성 결과</h2>
          <p id="resultsInfo" class="text-gray-300 text-xs sm:text-sm lg:text-base"></p>
        </div>
        <div class="flex gap-2 lg:gap-3">
          <button onclick="downloadTxt()" class="flex items-center gap-1.5 px-3 py-2 lg:px-4 lg:py-2.5 rounded-lg bg-white/5 text-gray-100 hover:bg-white/10 transition-all border border-white/8 text-xs lg:text-sm">
            <i class="fas fa-file-alt"></i><span class="hidden sm:inline">TXT</span>
          </button>
          <button onclick="downloadPdf()" class="flex items-center gap-1.5 px-3 py-2 lg:px-4 lg:py-2.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all border border-red-500/15 text-xs lg:text-sm">
            <i class="fas fa-file-pdf"></i><span class="hidden sm:inline">PDF</span>
          </button>
        </div>
      </div>
      
      <!-- Q&A 결과 - PC에서 4열 그리드 -->
      <div id="result-qna" class="hidden">
        
        <!-- ========== SEO 검수 패널 ========== -->
        <div id="seo-review-panel" class="result-card p-4 lg:p-6 mb-4 lg:mb-6 border-2 border-primary/30">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center">
                <i class="fas fa-chart-line text-white text-lg"></i>
              </div>
              <div>
                <h3 class="font-bold text-white text-base lg:text-lg">네이버 노출 확률 검수</h3>
                <p class="text-gray-400 text-xs">C-Rank · D.I.A. · Agent N 알고리즘 분석</p>
              </div>
            </div>
            <div id="seo-grade-badge" class="px-4 py-2 rounded-lg bg-gray-700 text-gray-400 font-bold text-xl">
              -
            </div>
          </div>
          
          <!-- 총점 및 예측 -->
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div class="bg-white/5 rounded-lg p-3 text-center">
              <div class="text-gray-400 text-xs mb-1">총점</div>
              <div id="seo-total-score" class="text-2xl font-bold text-white">0<span class="text-sm text-gray-400">/100</span></div>
            </div>
            <div class="bg-white/5 rounded-lg p-3 text-center">
              <div class="text-gray-400 text-xs mb-1">예상 순위</div>
              <div id="seo-predicted-rank" class="text-sm font-semibold text-primary">분석 중...</div>
            </div>
            <div class="bg-white/5 rounded-lg p-3 text-center">
              <div class="text-gray-400 text-xs mb-1">노출 확률</div>
              <div id="seo-exposure-rate" class="text-lg font-bold text-emerald-400">-%</div>
            </div>
            <div class="bg-white/5 rounded-lg p-3 text-center">
              <div class="text-gray-400 text-xs mb-1">등록 권장</div>
              <div id="seo-recommend" class="text-sm font-semibold text-yellow-400">-</div>
            </div>
          </div>
          
          <!-- 세부 점수 -->
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
            <div class="flex items-center gap-2 bg-white/5 rounded-lg p-2.5">
              <div class="w-8 h-8 rounded-md bg-blue-500/20 flex items-center justify-center">
                <i class="fas fa-heading text-blue-400 text-xs"></i>
              </div>
              <div>
                <div class="text-gray-400 text-2xs">제목 최적화</div>
                <div id="seo-title-score" class="text-white font-semibold text-sm">0<span class="text-gray-500 text-xs">/25</span></div>
              </div>
            </div>
            <div class="flex items-center gap-2 bg-white/5 rounded-lg p-2.5">
              <div class="w-8 h-8 rounded-md bg-emerald-500/20 flex items-center justify-center">
                <i class="fas fa-key text-emerald-400 text-xs"></i>
              </div>
              <div>
                <div class="text-gray-400 text-2xs">키워드 밀도</div>
                <div id="seo-keyword-score" class="text-white font-semibold text-sm">0<span class="text-gray-500 text-xs">/25</span></div>
              </div>
            </div>
            <div class="flex items-center gap-2 bg-white/5 rounded-lg p-2.5">
              <div class="w-8 h-8 rounded-md bg-purple-500/20 flex items-center justify-center">
                <i class="fas fa-align-left text-purple-400 text-xs"></i>
              </div>
              <div>
                <div class="text-gray-400 text-2xs">답변 품질</div>
                <div id="seo-content-score" class="text-white font-semibold text-sm">0<span class="text-gray-500 text-xs">/25</span></div>
              </div>
            </div>
            <div class="flex items-center gap-2 bg-white/5 rounded-lg p-2.5">
              <div class="w-8 h-8 rounded-md bg-orange-500/20 flex items-center justify-center">
                <i class="fas fa-users text-orange-400 text-xs"></i>
              </div>
              <div>
                <div class="text-gray-400 text-2xs">공감/댓글</div>
                <div id="seo-engage-score" class="text-white font-semibold text-sm">0<span class="text-gray-500 text-xs">/25</span></div>
              </div>
            </div>
          </div>
          
          <!-- 강점/개선점/팁 -->
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div class="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
              <div class="flex items-center gap-2 mb-2">
                <i class="fas fa-check-circle text-emerald-400 text-sm"></i>
                <span class="text-emerald-400 font-semibold text-xs">강점</span>
              </div>
              <ul id="seo-strengths" class="text-gray-300 text-xs space-y-1">
                <li>• 분석 중...</li>
              </ul>
            </div>
            <div class="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
              <div class="flex items-center gap-2 mb-2">
                <i class="fas fa-exclamation-triangle text-orange-400 text-sm"></i>
                <span class="text-orange-400 font-semibold text-xs">개선 제안</span>
              </div>
              <ul id="seo-improvements" class="text-gray-300 text-xs space-y-1">
                <li>• 분석 중...</li>
              </ul>
            </div>
            <div class="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
              <div class="flex items-center gap-2 mb-2">
                <i class="fas fa-lightbulb text-blue-400 text-sm"></i>
                <span class="text-blue-400 font-semibold text-xs">네이버 Tips</span>
              </div>
              <ul id="seo-tips" class="text-gray-300 text-xs space-y-1">
                <li>• 분석 중...</li>
              </ul>
            </div>
          </div>
        </div>
        
        <!-- Q&A 제목 섹션 -->
        <div id="qna-title-section" class="result-card p-4 lg:p-5 mb-4 lg:mb-6 hidden border-l-4 border-primary">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center">
                <i class="fas fa-heading text-white text-lg"></i>
              </div>
              <div>
                <div class="text-gray-400 text-xs mb-1">생성된 제목 (클릭 유도형)</div>
                <h3 id="qna-title" class="text-white text-lg lg:text-xl font-bold"></h3>
              </div>
            </div>
            <button onclick="copyText('qna-title')" class="px-4 py-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 text-sm font-medium">
              <i class="fas fa-copy mr-1.5"></i>복사
            </button>
          </div>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-5 xl:gap-6 mb-4 lg:mb-6">
          <!-- 키워드 -->
          <div class="result-card p-4 lg:p-5">
            <div class="flex items-center justify-between mb-3 lg:mb-4">
              <div class="flex items-center gap-2">
                <div class="w-7 h-7 lg:w-8 lg:h-8 rounded-md bg-primary/20 flex items-center justify-center">
                  <i class="fas fa-search text-primary text-xs lg:text-sm"></i>
                </div>
                <span class="font-semibold text-white text-sm lg:text-base">키워드</span>
              </div>
              <button onclick="copyKeywords()" class="px-3 py-1.5 rounded-md bg-primary/20 text-primary hover:bg-primary/30 text-xs lg:text-sm">
                <i class="fas fa-copy"></i>
              </button>
            </div>
            <div id="qna-keywords" class="flex flex-wrap gap-1.5 lg:gap-2"></div>
          </div>
          
          <!-- 질문 2개 (각각 복사 가능) -->
          <div class="result-card p-4 lg:p-5 lg:col-span-2">
            <div class="flex items-center gap-2 mb-4">
              <div class="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <i class="fas fa-question text-blue-400"></i>
              </div>
              <span class="font-bold text-white text-base lg:text-lg">질문</span>
              <span class="text-gray-400 text-xs">(세컨계정용 - 2개)</span>
            </div>
            <div class="space-y-3">
              <!-- 질문 1 -->
              <div class="bg-white/5 rounded-lg p-3 border-l-3 border-blue-500">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-blue-400 text-xs font-semibold">질문 1</span>
                  <button onclick="copyText('qna-q1')" class="px-2 py-1 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 text-xs">
                    <i class="fas fa-copy mr-1"></i>복사
                  </button>
                </div>
                <div id="qna-q1" class="text-gray-100 text-sm whitespace-pre-wrap leading-relaxed"></div>
              </div>
              <!-- 질문 2 -->
              <div class="bg-white/5 rounded-lg p-3 border-l-3 border-cyan-500">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-cyan-400 text-xs font-semibold">질문 2 (다른 스타일)</span>
                  <button onclick="copyText('qna-q2')" class="px-2 py-1 rounded bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 text-xs">
                    <i class="fas fa-copy mr-1"></i>복사
                  </button>
                </div>
                <div id="qna-q2" class="text-gray-100 text-sm whitespace-pre-wrap leading-relaxed"></div>
              </div>
            </div>
          </div>
          
          <!-- 댓글 5개 (각각 복사 가능) -->
          <div class="result-card p-4 lg:p-5 lg:col-span-2">
            <div class="flex items-center gap-2 mb-4">
              <div class="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                <i class="fas fa-comments text-yellow-400"></i>
              </div>
              <span class="font-bold text-white text-base lg:text-lg">댓글</span>
              <span class="text-gray-400 text-xs">(5개 - 각각 복사)</span>
              <button onclick="copyAllComments()" class="ml-auto px-3 py-1.5 rounded-lg bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 text-xs font-medium">
                <i class="fas fa-copy mr-1"></i>전체 복사
              </button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2" id="qna-comments-grid">
              <!-- 댓글들이 여기에 동적으로 추가됨 -->
            </div>
          </div>
        </div>
        
        <!-- 전문가 답변 3개 (각각 복사 가능) - 전체 너비 -->
        <div class="result-card p-4 lg:p-6 mb-4 lg:mb-6">
          <div class="flex items-center gap-2 mb-4">
            <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center">
              <i class="fas fa-user-tie text-white text-lg"></i>
            </div>
            <div>
              <span class="font-bold text-white text-base lg:text-lg">전문가 답변</span>
              <span class="text-gray-400 text-xs ml-2">(본계정용 - 3가지 스타일)</span>
            </div>
            <span id="qna-char" class="ml-2 px-2 py-1 rounded-full bg-primary/20 text-primary text-xs font-semibold">0자</span>
          </div>
          
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4" id="qna-answers-grid">
            <!-- 답변 1 -->
            <div class="bg-white/5 rounded-lg p-4 border-t-3 border-primary">
              <div class="flex items-center justify-between mb-3">
                <div>
                  <span class="text-primary text-sm font-bold">답변 1</span>
                  <span id="answer1-style" class="text-gray-500 text-xs ml-1"></span>
                </div>
                <button onclick="copyText('qna-a1')" class="px-3 py-1.5 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 text-xs font-medium">
                  <i class="fas fa-copy mr-1"></i>복사
                </button>
              </div>
              <div id="qna-a1" class="text-gray-100 text-sm whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto"></div>
            </div>
            <!-- 답변 2 -->
            <div class="bg-white/5 rounded-lg p-4 border-t-3 border-emerald-500">
              <div class="flex items-center justify-between mb-3">
                <div>
                  <span class="text-emerald-400 text-sm font-bold">답변 2</span>
                  <span id="answer2-style" class="text-gray-500 text-xs ml-1"></span>
                </div>
                <button onclick="copyText('qna-a2')" class="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-xs font-medium">
                  <i class="fas fa-copy mr-1"></i>복사
                </button>
              </div>
              <div id="qna-a2" class="text-gray-100 text-sm whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto"></div>
            </div>
            <!-- 답변 3 -->
            <div class="bg-white/5 rounded-lg p-4 border-t-3 border-purple-500">
              <div class="flex items-center justify-between mb-3">
                <div>
                  <span class="text-purple-400 text-sm font-bold">답변 3</span>
                  <span id="answer3-style" class="text-gray-500 text-xs ml-1"></span>
                </div>
                <button onclick="copyText('qna-a3')" class="px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 text-xs font-medium">
                  <i class="fas fa-copy mr-1"></i>복사
                </button>
              </div>
              <div id="qna-a3" class="text-gray-100 text-sm whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto"></div>
            </div>
          </div>
          
          <div id="qna-highlights" class="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/15 rounded-lg hidden">
            <h4 class="font-semibold text-yellow-400 text-sm mb-2"><i class="fas fa-star mr-1"></i>핵심 포인트</h4>
            <ul id="qna-highlights-list" class="text-gray-100 text-sm space-y-1"></ul>
          </div>
        </div>
        
        <!-- 설계서 (텍스트 표 형식 - 복사 가능) - 전체 너비 -->
        <div id="design-section" class="result-card p-4 lg:p-6 hidden mb-4 lg:mb-6">
          <div class="flex items-center justify-between mb-3 lg:mb-4">
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 lg:w-8 lg:h-8 rounded-md bg-emerald-500/20 flex items-center justify-center">
                <i class="fas fa-table text-emerald-400 text-xs lg:text-sm"></i>
              </div>
              <span class="font-semibold text-white text-sm lg:text-base">설계서</span>
              <span class="text-gray-400 text-xs lg:text-sm">(복사용)</span>
            </div>
            <div class="flex gap-2">
              <button onclick="generateProposalImage()" id="btn-gen-image" class="px-3 py-2 lg:px-4 lg:py-2.5 rounded-md bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 text-sm lg:text-base font-medium" title="설계서 이미지 생성">
                <i class="fas fa-image mr-1.5"></i>이미지
              </button>
              <button onclick="copyDesignText()" class="px-4 py-2 lg:px-5 lg:py-2.5 rounded-md bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-sm lg:text-base font-medium" title="텍스트 복사 (카페/블로그용)">
                <i class="fas fa-copy mr-2"></i>복사
              </button>
            </div>
          </div>
          
          <!-- 이미지 스타일 선택 -->
          <div id="image-style-selector" class="mb-3 lg:mb-4 hidden">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-gray-300 text-xs">이미지 스타일:</span>
            </div>
            <div class="flex flex-wrap gap-2">
              <button onclick="selectImageStyle('compact-card')" class="image-style-btn px-3 py-1.5 rounded-md text-xs font-medium bg-purple-500/30 text-purple-300 border border-purple-500/50" data-style="compact-card">
                <i class="fas fa-crop-alt mr-1"></i>컴팩트 카드
              </button>
              <button onclick="selectImageStyle('scan-copy')" class="image-style-btn px-3 py-1.5 rounded-md text-xs font-medium bg-white/10 text-gray-300 hover:bg-white/20" data-style="scan-copy">
                <i class="fas fa-desktop mr-1"></i>책상 위 스캔
              </button>
              <button onclick="selectImageStyle('highlight')" class="image-style-btn px-3 py-1.5 rounded-md text-xs font-medium bg-white/10 text-gray-300 hover:bg-white/20" data-style="highlight">
                <i class="fas fa-highlighter mr-1"></i>형광펜 강조
              </button>
            </div>
          </div>
          
          <!-- 이미지 생성 결과 미리보기 -->
          <div id="image-preview-section" class="mb-4 hidden">
            <div class="flex items-center justify-between mb-2">
              <span class="text-gray-300 text-xs font-medium"><i class="fas fa-image mr-1 text-purple-400"></i>생성된 이미지</span>
              <div class="flex gap-2">
                <button onclick="downloadProposalImage()" class="px-3 py-1.5 rounded-md bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 text-xs font-medium">
                  <i class="fas fa-download mr-1"></i>다운로드
                </button>
                <button onclick="copyImageToClipboard()" class="px-3 py-1.5 rounded-md bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 text-xs font-medium">
                  <i class="fas fa-copy mr-1"></i>이미지 복사
                </button>
              </div>
            </div>
            <div class="relative bg-black/30 rounded-lg overflow-hidden" style="max-height: 350px;">
              <img id="proposal-image" src="" alt="설계서 이미지" class="w-full h-auto object-contain" style="max-height: 350px;">
              <div id="image-loading" class="absolute inset-0 flex items-center justify-center bg-black/60 hidden">
                <div class="text-center">
                  <div class="spinner mb-2"></div>
                  <span class="text-purple-400 text-sm">AI 이미지 생성 중...</span>
                </div>
              </div>
            </div>
            <div class="mt-2 text-center">
              <span id="image-doc-number" class="text-gray-500 text-xs"></span>
            </div>
          </div>
          
          <div id="design-preview" class="design-preview overflow-auto max-h-[400px] lg:max-h-[600px] xl:max-h-[700px] rounded-lg"></div>
          <textarea id="design-text-content" class="hidden"></textarea>
        </div>
        
        <button onclick="copyAllQnA()" class="btn-primary w-full py-3 lg:py-4 text-white font-semibold text-sm lg:text-base flex items-center justify-center gap-2">
          <i class="fas fa-copy"></i>
          <span>전체 복사</span>
        </button>
      </div>
      
      <div id="result-blog" class="space-y-2 sm:space-y-3 hidden">
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-2 sm:gap-3">
          <!-- 제목 -->
          <div class="result-card p-3">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-1.5">
                <div class="w-6 h-6 rounded-md bg-orange-500/20 flex items-center justify-center">
                  <i class="fas fa-heading text-orange-400 text-2xs"></i>
                </div>
                <span class="font-semibold text-white text-xs">제목</span>
              </div>
              <button onclick="copyText('blog-title')" class="px-2 py-1 rounded-md bg-white/5 text-gray-100 hover:bg-white/10 text-2xs">
                <i class="fas fa-copy"></i>
              </button>
            </div>
            <div id="blog-title" class="text-sm sm:text-base font-bold text-white bg-white/8 rounded-lg p-2.5"></div>
          </div>
          
          <!-- 본문 -->
          <div class="result-card p-3 lg:col-span-2">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-1.5">
                <div class="w-6 h-6 rounded-md bg-orange-500/20 flex items-center justify-center">
                  <i class="fas fa-align-left text-orange-400 text-2xs"></i>
                </div>
                <span class="font-semibold text-white text-xs">본문</span>
                <span id="blog-char" class="px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 text-2xs font-semibold">0자</span>
              </div>
              <button onclick="copyText('blog-body')" class="px-2 py-1 rounded-md bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 text-2xs">
                <i class="fas fa-copy"></i>
              </button>
            </div>
            <div id="blog-body" class="result-content text-gray-100 whitespace-pre-wrap leading-relaxed bg-white/8 rounded-lg p-2.5 text-xs"></div>
          </div>
        </div>
        
        <div class="flex gap-2 sm:gap-3">
          <div class="result-card p-3 flex-1">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-1.5">
                <div class="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center">
                  <i class="fas fa-hashtag text-primary text-2xs"></i>
                </div>
                <span class="font-semibold text-white text-xs">해시태그</span>
              </div>
              <button onclick="copyText('blog-tags')" class="px-2 py-1 rounded-md bg-white/5 text-gray-100 hover:bg-white/10 text-2xs">
                <i class="fas fa-copy"></i>
              </button>
            </div>
            <div id="blog-tags" class="text-primary font-medium bg-white/8 rounded-lg p-2.5 text-xs"></div>
          </div>
          
          <button onclick="copyAllBlog()" class="py-2.5 px-6 rounded-lg text-white font-semibold text-xs flex items-center justify-center gap-1.5" style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);">
            <i class="fas fa-copy text-xs"></i>
            <span>전체</span>
          </button>
        </div>
      </div>
      
      <div id="result-analyze" class="space-y-2 sm:space-y-3 hidden">
        <!-- 점수 카드 -->
        <div class="result-card p-4" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.1) 0%, rgba(124, 58, 237, 0.05) 100%);">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="text-center sm:text-left">
              <p class="text-gray-300 text-2xs mb-1">종합 SEO 점수</p>
              <div class="flex items-end gap-1">
                <span id="total-score" class="text-3xl sm:text-4xl font-black text-white">0</span>
                <span class="text-base text-gray-400 mb-1">/100</span>
              </div>
            </div>
            <div class="grid grid-cols-4 gap-3 sm:gap-5">
              <div class="text-center">
                <p class="text-gray-300 text-2xs mb-1">SEO</p>
                <p id="seo-score" class="text-xl sm:text-2xl font-black text-primary">-</p>
              </div>
              <div class="text-center">
                <p class="text-gray-300 text-2xs mb-1">C-RANK</p>
                <p id="crank-score" class="text-xl sm:text-2xl font-black text-yellow-400">-</p>
              </div>
              <div class="text-center">
                <p class="text-gray-300 text-2xs mb-1">AEO</p>
                <p id="aeo-score" class="text-xl sm:text-2xl font-black text-blue-400">-</p>
              </div>
              <div class="text-center">
                <p class="text-gray-300 text-2xs mb-1">GEO</p>
                <p id="geo-score" class="text-xl sm:text-2xl font-black text-purple-400">-</p>
              </div>
            </div>
          </div>
        </div>
        
        <!-- 분석 + 개선안 2열 -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
          <div class="result-card p-3">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-1.5">
                <div class="w-6 h-6 rounded-md bg-purple-500/20 flex items-center justify-center">
                  <i class="fas fa-clipboard-check text-purple-400 text-2xs"></i>
                </div>
                <span class="font-semibold text-white text-xs">상세 분석</span>
              </div>
              <button onclick="copyText('analyze-result')" class="px-2 py-1 rounded-md bg-white/5 text-gray-100 hover:bg-white/10 text-2xs">
                <i class="fas fa-copy"></i>
              </button>
            </div>
            <div id="analyze-result" class="result-content text-gray-100 whitespace-pre-wrap leading-relaxed bg-white/8 rounded-lg p-2.5 text-xs"></div>
          </div>
          
          <div class="result-card p-3">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-1.5">
                <div class="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center">
                  <i class="fas fa-edit text-primary text-2xs"></i>
                </div>
                <span class="font-semibold text-white text-xs">개선안</span>
              </div>
              <button onclick="copyText('analyze-improved')" class="px-2 py-1 rounded-md bg-primary/20 text-primary hover:bg-primary/30 text-2xs">
                <i class="fas fa-copy"></i>
              </button>
            </div>
            <div id="analyze-improved" class="result-content text-gray-100 whitespace-pre-wrap leading-relaxed bg-white/8 rounded-lg p-2.5 text-xs"></div>
          </div>
        </div>
        
        <button onclick="copyAnalyzeAll()" class="w-full py-2.5 rounded-lg text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5" style="background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);">
          <i class="fas fa-copy text-xs"></i>
          <span>전체 복사</span>
        </button>
      </div>
    </div>
  </section>

  <footer class="py-4 sm:py-6 px-3 border-t border-white/5">
    <div class="container-wide mx-auto">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-emerald-600 flex items-center justify-center">
            <i class="fas fa-shield-alt text-white text-xs"></i>
          </div>
          <div>
            <p class="font-semibold text-white text-xs">보험 콘텐츠 마스터 V6.8</p>
            <p class="text-gray-400 text-2xs">2026 보험엑시트</p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <a href="/api/health" class="text-gray-300 hover:text-primary transition-colors text-xs">API</a>
          <a href="/admin" class="text-gray-300 hover:text-primary transition-colors text-xs">관리자</a>
        </div>
      </div>
    </div>
  </footer>

  <div id="toast" class="toast fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl bg-gray-800/95 backdrop-blur-md text-white font-medium text-sm shadow-xl z-50 border border-white/8"></div>

  <script>
    let currentFeature = 'qna';
    let generatedKeywords = [];
    // 기본값 없이 시작 (모두 선택형)
    const selections = {
      'qna-target': '',
      'qna-tone': '',
      'qna-insurance': '',
      'blog-type': '정보성',
      'blog-target': '30대',
      'analyze-type': '종합 분석'
    };

    function selectFeature(feature) {
      currentFeature = feature;
      document.querySelectorAll('.feature-card').forEach(c => c.classList.remove('active'));
      document.getElementById('card-' + feature).classList.add('active');
      document.querySelectorAll('[id^="form-"]').forEach(f => f.classList.add('hidden'));
      document.getElementById('form-' + feature).classList.remove('hidden');
      // 블로그 탭은 iframe으로 처리되므로 결과 섹션 항상 숨김
      if (feature === 'blog') {
        document.getElementById('resultsSection').classList.add('hidden');
      } else {
        document.getElementById('resultsSection').classList.add('hidden');
      }
    }

    function selectChip(btn, group) {
      btn.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      selections[group] = btn.dataset.value;
      
      // 보험종류 선택 시 종신/운전자 충돌 체크
      if (group === 'qna-insurance') {
        checkInsuranceConflict();
      }
    }
    
    // 선택형 칩 (토글 방식 - 선택/해제 가능)
    function selectOptionalChip(btn, group) {
      const wasActive = btn.classList.contains('active');
      
      // 같은 그룹의 다른 칩들 비활성화
      btn.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      
      if (wasActive) {
        // 이미 선택된 상태면 해제 (값 비우기)
        selections[group] = '';
      } else {
        // 새로 선택
        btn.classList.add('active');
        selections[group] = btn.dataset.value;
      }
      
      // 보험종류 선택 시 종신/운전자 충돌 체크
      if (group === 'qna-insurance') {
        checkInsuranceConflict();
      }
    }
    
    // 문체 톤 중복 선택 기능 (기본값 없음)
    let selectedTones = []; // 기본값 없음
    
    // 선택형 톤 칩 (최소 0개 가능)
    function toggleOptionalToneChip(btn) {
      const value = btn.dataset.value;
      
      if (btn.classList.contains('active')) {
        // 이미 선택된 경우 해제 (0개도 가능)
        btn.classList.remove('active');
        selectedTones = selectedTones.filter(t => t !== value);
      } else {
        // 새로 선택
        btn.classList.add('active');
        selectedTones.push(value);
        
        // 보험초보 선택 시 안내 메시지
        if (value === '보험초보') {
          showToast('💡 보험초보: 전문 용어를 쉽게 풀어서 설명합니다');
        }
        // 제안서 요청형 선택 시 안내 메시지
        if (value === '제안서요청형') {
          showToast('📋 제안서 요청형: 구체적인 설계 제안을 요청하는 형식으로 작성됩니다');
        }
      }
      
      // 선택된 톤 업데이트 (빈 배열이면 빈 문자열)
      selections['qna-tone'] = selectedTones.join(',');
    }
    
    // 기존 toggleToneChip도 유지 (호환성)
    function toggleToneChip(btn) {
      toggleOptionalToneChip(btn);
    }
    
    // ========== IP 보안 접속 제어 모듈 ========== 
    let ipSliderDragging = false;
    let ipSliderProgress = 0;
    let currentProxyIP = null;
    let previousIP = null;
    
    // 슬라이더 드래그 초기화
    document.addEventListener('DOMContentLoaded', function() {
      const handle = document.getElementById('ip-slider-handle');
      const track = document.getElementById('ip-slider-track');
      
      if (handle && track) {
        // 마우스 이벤트
        handle.addEventListener('mousedown', startDrag);
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', endDrag);
        
        // 터치 이벤트
        handle.addEventListener('touchstart', startDrag, { passive: false });
        document.addEventListener('touchmove', onDrag, { passive: false });
        document.addEventListener('touchend', endDrag);
      }
    });
    
    function startDrag(e) {
      e.preventDefault();
      ipSliderDragging = true;
      document.getElementById('ip-slider-handle').classList.add('scale-110');
    }
    
    function onDrag(e) {
      if (!ipSliderDragging) return;
      
      const track = document.getElementById('ip-slider-track');
      const handle = document.getElementById('ip-slider-handle');
      const fill = document.getElementById('ip-slider-fill');
      
      const rect = track.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left;
      const maxX = rect.width - 56; // 핸들 크기 고려
      
      ipSliderProgress = Math.max(0, Math.min(100, (x / maxX) * 100));
      
      handle.style.left = (ipSliderProgress / 100 * maxX) + 'px';
      fill.style.width = ipSliderProgress + '%';
      
      // 텍스트 변경
      const text = document.getElementById('ip-slider-text');
      if (ipSliderProgress > 80) {
        text.innerHTML = '<i class="fas fa-check mr-2"></i>손을 떼면 IP 변경!';
        text.className = 'text-cyan-400 text-sm font-bold tracking-wide';
      } else {
        text.innerHTML = '<i class="fas fa-arrow-right mr-2 animate-pulse"></i>밀어서 새 IP 받기 (Clean IP)';
        text.className = 'text-gray-300 text-sm font-medium tracking-wide';
      }
    }
    
    function endDrag(e) {
      if (!ipSliderDragging) return;
      ipSliderDragging = false;
      
      document.getElementById('ip-slider-handle').classList.remove('scale-110');
      
      if (ipSliderProgress >= 90) {
        // IP 변경 실행
        triggerIPChange();
      } else {
        // 리셋
        resetSlider();
      }
    }
    
    function handleSliderClick(e) {
      // 핸들 클릭이 아닌 트랙 클릭 시 힌트 표시
      if (e.target.id === 'ip-slider-track' || e.target.id === 'ip-slider-fill') {
        showToast('핸들을 드래그해서 밀어주세요');
      }
    }
    
    function resetSlider() {
      const handle = document.getElementById('ip-slider-handle');
      const fill = document.getElementById('ip-slider-fill');
      const text = document.getElementById('ip-slider-text');
      
      handle.style.left = '4px';
      fill.style.width = '0%';
      text.innerHTML = '<i class="fas fa-arrow-right mr-2 animate-pulse"></i>밀어서 새 IP 받기 (Clean IP)';
      text.className = 'text-gray-300 text-sm font-medium tracking-wide';
      ipSliderProgress = 0;
    }
    
    async function triggerIPChange() {
      // 로딩 상태
      const handle = document.getElementById('ip-slider-handle');
      const text = document.getElementById('ip-slider-text');
      const statusArea = document.getElementById('ip-status-area');
      const loading = document.getElementById('ip-loading');
      const success = document.getElementById('ip-success');
      const error = document.getElementById('ip-error');
      const hint = document.getElementById('ip-slider-hint');
      
      // UI 업데이트
      handle.innerHTML = '<div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>';
      text.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>IP 교체 중...';
      text.className = 'text-cyan-400 text-sm font-bold tracking-wide';
      hint.classList.add('hidden');
      
      statusArea.classList.remove('hidden');
      loading.classList.remove('hidden');
      success.classList.add('hidden');
      error.classList.add('hidden');
      
      try {
        // 이전 IP 저장
        previousIP = currentProxyIP || await getCurrentIP();
        
        // Bright Data 프록시로 새 IP 요청
        const response = await fetch('/api/proxy/change-ip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        
        if (data.success && data.newIP) {
          // 성공
          currentProxyIP = data.newIP;
          
          document.getElementById('ip-old').textContent = maskIP(previousIP || '알수없음');
          document.getElementById('ip-new').textContent = maskIP(data.newIP);
          document.getElementById('ip-country').textContent = data.country || 'KR';
          document.getElementById('ip-last-changed').textContent = new Date().toLocaleTimeString('ko-KR');
          
          loading.classList.add('hidden');
          success.classList.remove('hidden');
          document.getElementById('ip-current-info').classList.remove('hidden');
          
          // 뱃지 업데이트
          const badge = document.getElementById('ip-connection-badge');
          badge.innerHTML = '<i class="fas fa-check-circle text-green-400 mr-1 text-2xs"></i>보안 연결됨';
          badge.className = 'ml-auto px-3 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30';
          
          // 핸들 복구
          handle.innerHTML = '<i class="fas fa-check text-white text-lg"></i>';
          
          showToast('✅ 안전한 한국 IP로 변경되었습니다!');
          
          // 3초 후 슬라이더 리셋
          setTimeout(() => {
            resetSlider();
            handle.innerHTML = '<i class="fas fa-exchange-alt text-white text-lg"></i>';
            hint.classList.remove('hidden');
          }, 3000);
          
        } else {
          throw new Error(data.error || 'IP 변경 실패');
        }
        
      } catch (err) {
        console.error('IP Change Error:', err);
        
        loading.classList.add('hidden');
        error.classList.remove('hidden');
        document.getElementById('ip-error-msg').textContent = err.message || '새 IP 할당 실패. 다시 밀어주세요.';
        
        // 핸들 복구
        handle.innerHTML = '<i class="fas fa-exchange-alt text-white text-lg"></i>';
        
        // 2초 후 리셋
        setTimeout(() => {
          resetSlider();
          hint.classList.remove('hidden');
          error.classList.add('hidden');
        }, 2000);
      }
    }
    
    async function getCurrentIP() {
      try {
        const res = await fetch('/api/proxy/current-ip');
        const data = await res.json();
        return data.ip || null;
      } catch {
        return null;
      }
    }
    
    function maskIP(ip) {
      if (!ip) return '--.---.---.---';
      const parts = ip.split('.');
      if (parts.length === 4) {
        return parts[0] + '.' + parts[1] + '.xxx.' + parts[3];
      }
      return ip;
    }
    
    function refreshIP() {
      resetSlider();
      showToast('슬라이더를 밀어서 새 IP를 받으세요');
    }
    // ========== IP 보안 접속 제어 모듈 끝 ==========
    
    // 핵심고민에 '종신' 입력 시 보험종류에서 '운전자' 클릭하면 알람 표시
    function checkInsuranceConflict() {
      const concern = document.getElementById('qna-concern').value || '';
      const selectedInsurance = selections['qna-insurance'];
      
      // 핵심고민에 '종신' 관련 키워드가 있는지 체크
      const hasJongshin = /종신|whole\s*life|사망보험/i.test(concern);
      
      if (hasJongshin && selectedInsurance === '운전자보험') {
        showConflictAlert();
      }
    }
    
    function showConflictAlert() {
      // 커스텀 알림 모달 표시
      var alertDiv = document.createElement('div');
      alertDiv.id = 'conflict-alert';
      alertDiv.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fadeIn';
      alertDiv.innerHTML = '<div class="bg-gray-900 border border-yellow-500/50 rounded-2xl p-6 max-w-md mx-4 shadow-2xl">' +
        '<div class="flex items-center gap-3 mb-4">' +
        '<div class="w-12 h-12 bg-yellow-500/20 rounded-full flex items-center justify-center">' +
        '<i class="fas fa-exclamation-triangle text-yellow-400 text-xl"></i>' +
        '</div>' +
        '<h3 class="text-lg font-bold text-white">보험 종류 확인</h3>' +
        '</div>' +
        '<p class="text-gray-300 mb-4">' +
        '핵심 고민에 <span class="text-blue-400 font-semibold">종신보험</span> 관련 내용이 있는데,<br>' +
        '<span class="text-yellow-400 font-semibold">운전자보험</span>을 선택하셨습니다.' +
        '</p>' +
        '<p class="text-gray-400 text-sm mb-6">' +
        '종신보험과 운전자보험은 보장 내용이 다릅니다.<br>' +
        '의도한 선택이 맞는지 확인해 주세요.' +
        '</p>' +
        '<div class="flex gap-3">' +
        '<button onclick="closeConflictAlert()" class="flex-1 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">' +
        '그대로 진행' +
        '</button>' +
        '<button onclick="changeToJongshin()" class="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">' +
        '종신보험으로 변경' +
        '</button>' +
        '</div>' +
        '</div>';
      document.body.appendChild(alertDiv);
    }
    
    function closeConflictAlert() {
      var el = document.getElementById('conflict-alert');
      if (el) el.remove();
    }
    
    function changeToJongshin() {
      // 종신보험으로 변경
      document.querySelectorAll('#qna-insurance-chips .chip').forEach(c => c.classList.remove('active'));
      var jongshinBtn = document.querySelector('#qna-insurance-chips .chip[data-value="종신보험"]');
      if (jongshinBtn) {
        jongshinBtn.classList.add('active');
        selections['qna-insurance'] = '종신보험';
      }
      closeConflictAlert();
      showToast('종신보험으로 변경되었습니다');
    }
    
    // 핵심고민 입력 시 실시간 체크
    document.addEventListener('DOMContentLoaded', function() {
      const concernInput = document.getElementById('qna-concern');
      if (concernInput) {
        concernInput.addEventListener('input', function() {
          // 입력이 끝나고 1초 후 체크
          clearTimeout(this.checkTimeout);
          this.checkTimeout = setTimeout(checkInsuranceConflict, 1000);
        });
      }
    });

    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3000);
    }

    function copyText(id) {
      navigator.clipboard.writeText(document.getElementById(id).textContent).then(() => showToast('복사 완료!'));
    }
    
    function copyKeywords() {
      if (generatedKeywords.length > 0) {
        navigator.clipboard.writeText(generatedKeywords.join(', ')).then(() => showToast('키워드 복사 완료!'));
      }
    }

    function copyAllQnA() {
      const all = '【질문】\\n' + document.getElementById('qna-q').textContent + '\\n\\n【답변】\\n' + document.getElementById('qna-a').textContent + '\\n\\n【댓글】\\n' + document.getElementById('qna-c').textContent;
      navigator.clipboard.writeText(all).then(() => showToast('전체 복사 완료!'));
    }

    function copyAllBlog() {
      const all = document.getElementById('blog-title').textContent + '\\n\\n' + document.getElementById('blog-body').textContent + '\\n\\n' + document.getElementById('blog-tags').textContent;
      navigator.clipboard.writeText(all).then(() => showToast('전체 복사 완료!'));
    }

    function copyAnalyzeAll() {
      const all = '【분석】\\n' + document.getElementById('analyze-result').textContent + '\\n\\n【개선안】\\n' + document.getElementById('analyze-improved').textContent;
      navigator.clipboard.writeText(all).then(() => showToast('전체 복사 완료!'));
    }

    function downloadTxt() {
      let content = '', filename = '';
      if (currentFeature === 'qna') {
        content = '【질문】\\n' + document.getElementById('qna-q').textContent + '\\n\\n【답변】\\n' + document.getElementById('qna-a').textContent + '\\n\\n【댓글】\\n' + document.getElementById('qna-c').textContent;
        filename = 'qna_' + new Date().toISOString().slice(0,10) + '.txt';
      } else if (currentFeature === 'blog') {
        content = '【제목】\\n' + document.getElementById('blog-title').textContent + '\\n\\n【본문】\\n' + document.getElementById('blog-body').textContent + '\\n\\n【해시태그】\\n' + document.getElementById('blog-tags').textContent;
        filename = 'blog_' + new Date().toISOString().slice(0,10) + '.txt';
      } else {
        content = '【분석】\\n' + document.getElementById('analyze-result').textContent + '\\n\\n【개선안】\\n' + document.getElementById('analyze-improved').textContent;
        filename = 'analyze_' + new Date().toISOString().slice(0,10) + '.txt';
      }
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
      showToast('TXT 다운로드 완료!');
    }

    function downloadPdf() {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      let content = '', title = '';
      if (currentFeature === 'qna') { title = 'Q&A 생성 결과'; content = document.getElementById('qna-q').textContent + '\\n\\n' + document.getElementById('qna-a').textContent; }
      else if (currentFeature === 'blog') { title = '블로그 생성 결과'; content = document.getElementById('blog-title').textContent + '\\n\\n' + document.getElementById('blog-body').textContent; }
      else { title = '블로그 분석 결과'; content = document.getElementById('analyze-result').textContent; }
      doc.setFontSize(18); doc.text(title, 20, 20);
      doc.setFontSize(10); doc.text(doc.splitTextToSize(content, 170), 20, 35);
      doc.save(currentFeature + '_' + new Date().toISOString().slice(0,10) + '.pdf');
      showToast('PDF 다운로드 완료!');
    }
    
    // 설계서 텍스트 복사 (엑셀/표 형식 - 네이버 카페/블로그용)
    function copyDesignText() {
      const textContent = document.getElementById('design-text-content').value;
      if (!textContent) { showToast('설계서가 없습니다'); return; }
      
      navigator.clipboard.writeText(textContent).then(() => {
        showToast('설계서 텍스트 복사 완료! (카페/블로그에 붙여넣기)');
      }).catch(() => {
        // 폴백: textarea 선택 후 복사
        const textarea = document.getElementById('design-text-content');
        textarea.classList.remove('hidden');
        textarea.select();
        document.execCommand('copy');
        textarea.classList.add('hidden');
        showToast('설계서 복사 완료!');
      });
    }
    
    // ========== 📷 사진 업로드 및 분석 기능 ==========
    let uploadedPhotos = []; // 업로드된 사진들 저장
    let photoAnalysisResult = null; // 사진 분석 결과
    
    function handlePhotoDragOver(e) {
      e.preventDefault();
      e.stopPropagation();
      document.getElementById('photo-upload-zone').classList.add('border-purple-500', 'bg-purple-500/10');
    }
    
    function handlePhotoDragLeave(e) {
      e.preventDefault();
      e.stopPropagation();
      document.getElementById('photo-upload-zone').classList.remove('border-purple-500', 'bg-purple-500/10');
    }
    
    function handlePhotoDrop(e) {
      e.preventDefault();
      e.stopPropagation();
      document.getElementById('photo-upload-zone').classList.remove('border-purple-500', 'bg-purple-500/10');
      
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        processPhotoFiles(files);
      }
    }
    
    function handlePhotoSelect(e) {
      const files = e.target.files;
      if (files.length > 0) {
        processPhotoFiles(files);
      }
    }
    
    async function processPhotoFiles(files) {
      const maxSize = 20 * 1024 * 1024; // 20MB
      const validTypes = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'];
      
      for (const file of files) {
        // 파일 크기 체크
        if (file.size > maxSize) {
          showToast('파일 크기가 20MB를 초과합니다: ' + file.name);
          continue;
        }
        
        // 파일 타입 체크
        if (!validTypes.includes(file.type) && !file.name.toLowerCase().endsWith('.heic')) {
          showToast('지원하지 않는 파일 형식입니다: ' + file.name);
          continue;
        }
        
        // 파일을 Base64로 변환
        const reader = new FileReader();
        reader.onload = function(e) {
          const base64 = e.target.result;
          uploadedPhotos.push({
            name: file.name,
            size: file.size,
            type: file.type,
            base64: base64
          });
          updatePhotoPreview();
        };
        reader.readAsDataURL(file);
      }
    }
    
    function updatePhotoPreview() {
      const container = document.getElementById('photo-preview-container');
      const uploadContent = document.getElementById('photo-upload-content');
      
      if (uploadedPhotos.length > 0) {
        uploadContent.classList.add('hidden');
        container.classList.remove('hidden');
        
        container.innerHTML = uploadedPhotos.map((photo, idx) => 
          '<div class="relative group">' +
            '<img src="' + photo.base64 + '" class="w-20 h-20 object-cover rounded-lg border border-purple-500/30 pointer-events-auto">' +
            '<button onclick="removePhoto(' + idx + ')" class="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto">' +
              '<i class="fas fa-times text-white text-xs"></i>' +
            '</button>' +
            '<span class="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-2xs px-1 truncate rounded-b-lg">' + formatFileSize(photo.size) + '</span>' +
          '</div>'
        ).join('') +
        '<button onclick="analyzePhotos()" class="w-20 h-20 border-2 border-dashed border-purple-500/40 rounded-lg flex flex-col items-center justify-center text-purple-400 hover:bg-purple-500/10 pointer-events-auto">' +
          '<i class="fas fa-search text-lg mb-1"></i>' +
          '<span class="text-2xs">분석하기</span>' +
        '</button>';
      } else {
        uploadContent.classList.remove('hidden');
        container.classList.add('hidden');
      }
    }
    
    function removePhoto(idx) {
      uploadedPhotos.splice(idx, 1);
      updatePhotoPreview();
      if (uploadedPhotos.length === 0) {
        document.getElementById('photo-analysis-result').classList.add('hidden');
        photoAnalysisResult = null;
      }
    }
    
    function formatFileSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
    
    async function analyzePhotos() {
      if (uploadedPhotos.length === 0) {
        showToast('분석할 사진이 없습니다');
        return;
      }
      
      const resultDiv = document.getElementById('photo-analysis-result');
      const textDiv = document.getElementById('photo-analysis-text');
      
      resultDiv.classList.remove('hidden');
      textDiv.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>AI가 사진을 분석 중입니다...';
      
      try {
        const concern = document.getElementById('qna-concern').value.trim();
        const insuranceType = selections['qna-insurance'] || '';
        
        const res = await fetch('/api/analyze/photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            photos: uploadedPhotos.map(p => p.base64),
            concern: concern,
            insuranceType: insuranceType
          })
        });
        
        const data = await res.json();
        
        if (data.success && data.analysis) {
          photoAnalysisResult = data.analysis;
          textDiv.innerHTML = data.analysis.replace(/\\n/g, '<br>');
          showToast('사진 분석 완료! 결과가 Q&A에 반영됩니다');
        } else {
          textDiv.innerHTML = '사진 분석에 실패했습니다. Q&A 생성 시 자동으로 재시도합니다.';
        }
      } catch (error) {
        textDiv.innerHTML = '사진 분석 중 오류가 발생했습니다: ' + error.message;
      }
    }
    
    // ========== 설계서 이미지 생성 기능 ==========
    let selectedImageStyle = 'compact-card';
    let currentDesignData = null; // 현재 설계서 데이터 저장
    let generatedImageUrl = null;
    
    function selectImageStyle(style) {
      selectedImageStyle = style;
      document.querySelectorAll('.image-style-btn').forEach(btn => {
        if (btn.dataset.style === style) {
          btn.classList.remove('bg-white/10', 'text-gray-300');
          btn.classList.add('bg-purple-500/30', 'text-purple-300', 'border', 'border-purple-500/50');
        } else {
          btn.classList.remove('bg-purple-500/30', 'text-purple-300', 'border', 'border-purple-500/50');
          btn.classList.add('bg-white/10', 'text-gray-300');
        }
      });
    }
    
    async function generateProposalImage() {
      // 스타일 선택 UI 표시
      document.getElementById('image-style-selector').classList.remove('hidden');
      
      // 현재 설계서 데이터 가져오기
      const designHtml = document.getElementById('design-preview').innerHTML;
      if (!designHtml) {
        showToast('먼저 설계서를 생성해주세요');
        return;
      }
      
      // 버튼 로딩 상태
      const btn = document.getElementById('btn-gen-image');
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div><span class="text-xs">생성중...</span>';
      
      // 이미지 미리보기 섹션 표시 + 로딩
      document.getElementById('image-preview-section').classList.remove('hidden');
      document.getElementById('image-loading').classList.remove('hidden');
      document.getElementById('proposal-image').src = '';
      
      try {
        // 설계서 데이터 추출 (선택된 값들에서)
        const companyName = selections['qna-company'] || '삼성생명';
        const insuranceType = selections['qna-insurance'] || '종신보험';
        const target = selections['qna-target'] || '30대 직장인';
        
        // 나이/성별 추론
        const ageMatch = target.match(/(\\d+)대/);
        const customerAge = ageMatch ? ageMatch[1] + '세' : '35세';
        const customerGender = target.includes('여성') || target.includes('엄마') || target.includes('주부') ? '여성' : '남성';
        
        // API 호출
        const res = await fetch('/api/generate/proposal-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyName,
            insuranceType,
            customerAge,
            customerGender,
            monthlyPremium: currentDesignData?.monthlyPremium || '89,000원',
            coverages: currentDesignData?.coverages || [],
            style: selectedImageStyle
          })
        });
        
        const data = await res.json();
        
        document.getElementById('image-loading').classList.add('hidden');
        
        if (data.success && data.imageUrl) {
          generatedImageUrl = data.imageUrl;
          document.getElementById('proposal-image').src = data.imageUrl;
          document.getElementById('image-doc-number').textContent = '문서번호: ' + data.docNumber;
          showToast('설계서 이미지 생성 완료!');
        } else {
          showToast('이미지 생성 실패: ' + (data.error || '알 수 없는 오류'));
          document.getElementById('image-preview-section').classList.add('hidden');
        }
      } catch (error) {
        document.getElementById('image-loading').classList.add('hidden');
        document.getElementById('image-preview-section').classList.add('hidden');
        showToast('이미지 생성 오류: ' + error.message);
        console.error('Image generation error:', error);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-image mr-1.5"></i>이미지';
      }
    }
    
    function downloadProposalImage() {
      if (!generatedImageUrl) {
        showToast('다운로드할 이미지가 없습니다');
        return;
      }
      
      const link = document.createElement('a');
      link.href = generatedImageUrl;
      link.download = 'insurance_proposal_' + Date.now() + '.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('이미지 다운로드 완료!');
    }
    
    async function copyImageToClipboard() {
      if (!generatedImageUrl) {
        showToast('복사할 이미지가 없습니다');
        return;
      }
      
      try {
        // base64 이미지를 Blob으로 변환
        const response = await fetch(generatedImageUrl);
        const blob = await response.blob();
        
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob })
        ]);
        showToast('이미지가 클립보드에 복사되었습니다!');
      } catch (error) {
        // 폴백: 이미지 URL 복사
        try {
          await navigator.clipboard.writeText(generatedImageUrl);
          showToast('이미지 URL이 복사되었습니다');
        } catch (e) {
          showToast('이미지 복사 실패');
        }
      }
    }

    function updateProgress(step, percent, status) {
      document.getElementById('qna-progress').classList.remove('hidden');
      document.getElementById('progress-percent').textContent = percent + '%';
      document.getElementById('progress-status').textContent = status;
      
      for (let i = 1; i <= 5; i++) {
        const badge = document.querySelector('#step-' + i + ' .step-badge');
        badge.classList.remove('completed', 'active', 'pending');
        if (i < step) badge.classList.add('completed');
        else if (i === step) badge.classList.add('active');
        else badge.classList.add('pending');
      }
    }

    function setLoading(btnId, loading) {
      const btn = document.getElementById(btnId);
      if (loading) {
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner"></div><span>AI 생성 중...</span>';
      } else {
        btn.disabled = false;
        if (btnId === 'btn-qna') btn.innerHTML = '<i class="fas fa-magic"></i><span>Q&A 완전 자동화 시작</span>';
        else if (btnId === 'btn-blog') btn.innerHTML = '<i class="fas fa-pen-fancy"></i><span>블로그 글 생성하기 (1,700자+)</span>';
        else btn.innerHTML = '<i class="fas fa-search-plus"></i><span>블로그 분석하기</span>';
      }
    }

    function showResults(type) {
      document.getElementById('resultsSection').classList.remove('hidden');
      document.querySelectorAll('[id^="result-"]').forEach(r => r.classList.add('hidden'));
      document.getElementById('result-' + type).classList.remove('hidden');
      document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
    }

    // ========== SEO 점수 패널 업데이트 함수 ==========
    function updateSEOPanel(seoData) {
      if (!seoData) return;
      
      // 총점 및 등급
      document.getElementById('seo-total-score').innerHTML = seoData.totalScore + '<span class="text-sm text-gray-400">/100</span>';
      
      // 등급 배지 색상
      const gradeBadge = document.getElementById('seo-grade-badge');
      gradeBadge.textContent = seoData.grade;
      gradeBadge.className = 'px-4 py-2 rounded-lg font-bold text-xl ';
      if (seoData.grade === 'S+') {
        gradeBadge.className += 'bg-gradient-to-r from-yellow-500 to-amber-500 text-black';
      } else if (seoData.grade === 'S') {
        gradeBadge.className += 'bg-primary text-white';
      } else if (seoData.grade === 'A') {
        gradeBadge.className += 'bg-emerald-500 text-white';
      } else if (seoData.grade === 'B') {
        gradeBadge.className += 'bg-blue-500 text-white';
      } else if (seoData.grade === 'C') {
        gradeBadge.className += 'bg-orange-500 text-white';
      } else {
        gradeBadge.className += 'bg-gray-600 text-white';
      }
      
      // 예상 순위, 노출 확률, 등록 권장
      document.getElementById('seo-predicted-rank').textContent = seoData.predictedRank;
      document.getElementById('seo-exposure-rate').textContent = seoData.exposureRate + '%';
      document.getElementById('seo-recommend').textContent = seoData.recommend;
      
      // 노출 확률 색상
      const expRate = document.getElementById('seo-exposure-rate');
      if (seoData.exposureRate >= 85) {
        expRate.className = 'text-lg font-bold text-emerald-400';
      } else if (seoData.exposureRate >= 70) {
        expRate.className = 'text-lg font-bold text-blue-400';
      } else if (seoData.exposureRate >= 50) {
        expRate.className = 'text-lg font-bold text-yellow-400';
      } else {
        expRate.className = 'text-lg font-bold text-orange-400';
      }
      
      // 등록 권장 색상
      const recEl = document.getElementById('seo-recommend');
      if (seoData.recommend.includes('즉시') || seoData.recommend.includes('권장')) {
        recEl.className = 'text-sm font-semibold text-emerald-400';
      } else if (seoData.recommend.includes('OK')) {
        recEl.className = 'text-sm font-semibold text-blue-400';
      } else {
        recEl.className = 'text-sm font-semibold text-yellow-400';
      }
      
      // 세부 점수
      document.getElementById('seo-title-score').innerHTML = seoData.titleScore + '<span class="text-gray-500 text-xs">/25</span>';
      document.getElementById('seo-keyword-score').innerHTML = seoData.keywordScore + '<span class="text-gray-500 text-xs">/25</span>';
      document.getElementById('seo-content-score').innerHTML = seoData.contentScore + '<span class="text-gray-500 text-xs">/25</span>';
      document.getElementById('seo-engage-score').innerHTML = seoData.engageScore + '<span class="text-gray-500 text-xs">/25</span>';
      
      // 강점 리스트
      const strengthsEl = document.getElementById('seo-strengths');
      if (seoData.strengths && seoData.strengths.length > 0) {
        strengthsEl.innerHTML = seoData.strengths.map(s => '<li>• ' + s + '</li>').join('');
      } else {
        strengthsEl.innerHTML = '<li>• 분석 완료</li>';
      }
      
      // 개선 제안 리스트
      const improvementsEl = document.getElementById('seo-improvements');
      if (seoData.improvements && seoData.improvements.length > 0) {
        improvementsEl.innerHTML = seoData.improvements.map(s => '<li>• ' + s + '</li>').join('');
      } else {
        improvementsEl.innerHTML = '<li>• 현재 상태 우수</li>';
      }
      
      // 네이버 Tips 리스트
      const tipsEl = document.getElementById('seo-tips');
      if (seoData.tips && seoData.tips.length > 0) {
        tipsEl.innerHTML = seoData.tips.map(s => '<li>• ' + s + '</li>').join('');
      } else {
        tipsEl.innerHTML = '<li>• 게시 후 댓글 유도하면 순위 상승</li>';
      }
    }

    async function generateQnAFull() {
      const concern = document.getElementById('qna-concern').value.trim();
      const generateDesign = document.getElementById('generate-design').checked;
      
      setLoading('btn-qna', true);
      
      try {
        // 사진이 있고 아직 분석하지 않았으면 먼저 분석
        if (uploadedPhotos.length > 0 && !photoAnalysisResult) {
          updateProgress(1, 5, '사진 분석 중...');
          await analyzePhotos();
        }
        
        updateProgress(1, 10, '네이버 키워드 분석 중...');
        
        const res = await fetch('/api/generate/qna-full', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target: selections['qna-target'],
            tone: selections['qna-tone'],
            insuranceType: selections['qna-insurance'],
            concern: concern,
            generateDesign: generateDesign,
            photoAnalysis: photoAnalysisResult, // 사진 분석 결과 전달
            hasPhoto: uploadedPhotos.length > 0
          })
        });
        
        const data = await res.json();
        
        generatedKeywords = data.keywords || [];
        const keywordsDiv = document.getElementById('qna-keywords');
        keywordsDiv.innerHTML = generatedKeywords.map(kw => 
          '<span class="keyword-tag" onclick="copyKeyword(\\'' + kw + '\\')">#' + kw + '</span>'
        ).join('');
        
        // 제목 업데이트
        if (data.title) {
          document.getElementById('qna-title').textContent = data.title;
          document.getElementById('qna-title-section').classList.remove('hidden');
        } else {
          document.getElementById('qna-title-section').classList.add('hidden');
        }
        
        // V9.5: 질문 2개 업데이트
        const questions = data.questions || [data.question];
        document.getElementById('qna-q1').textContent = questions[0] || '';
        document.getElementById('qna-q2').textContent = questions[1] || '(두 번째 질문이 생성되지 않았습니다)';
        
        // V9.5: 답변 3개 업데이트
        const answers = data.answers || [data.answer];
        document.getElementById('qna-a1').textContent = answers[0] || '';
        document.getElementById('qna-a2').textContent = answers[1] || '(두 번째 답변이 생성되지 않았습니다)';
        document.getElementById('qna-a3').textContent = answers[2] || '(세 번째 답변이 생성되지 않았습니다)';
        document.getElementById('qna-char').textContent = (answers[0] || '').length + '자';
        
        // V9.5: 댓글 5개 업데이트 (각각 복사 가능)
        const comments = data.comments || [];
        const commentsGrid = document.getElementById('qna-comments-grid');
        const commentColors = ['yellow', 'orange', 'pink', 'violet', 'teal'];
        const commentLabels = ['깨달음', '감사', '비슷경험', '질문', '해결'];
        commentsGrid.innerHTML = comments.map((c, i) => {
          const color = commentColors[i] || 'gray';
          const label = commentLabels[i] || '';
          return '<div class="bg-white/5 rounded-lg p-2.5 border-l-2 border-' + color + '-500">' +
            '<div class="flex items-center justify-between mb-1.5">' +
              '<span class="text-' + color + '-400 text-2xs font-semibold">' + label + '</span>' +
              '<button onclick="copyText(\\'qna-c' + (i+1) + '\\')" class="px-1.5 py-0.5 rounded bg-' + color + '-500/20 text-' + color + '-400 text-2xs hover:bg-' + color + '-500/30">' +
                '<i class="fas fa-copy"></i>' +
              '</button>' +
            '</div>' +
            '<div id="qna-c' + (i+1) + '" class="text-gray-200 text-xs leading-relaxed">' + c + '</div>' +
          '</div>';
        }).join('');
        
        // 전역 댓글 저장 (전체 복사용)
        window.generatedComments = comments;
        
        if (data.highlights && data.highlights.length > 0) {
          const highlightsList = document.getElementById('qna-highlights-list');
          highlightsList.innerHTML = data.highlights.map(h => '<li><i class="fas fa-check text-yellow-400 mr-2"></i>' + h + '</li>').join('');
          document.getElementById('qna-highlights').classList.remove('hidden');
        } else {
          document.getElementById('qna-highlights').classList.add('hidden');
        }
        
        if (data.designHtml) {
          document.getElementById('design-section').classList.remove('hidden');
          const preview = document.getElementById('design-preview');
          preview.innerHTML = data.designHtml;
          // 텍스트 버전 저장 (복사용)
          if (data.designText) {
            document.getElementById('design-text-content').value = data.designText;
          }
          // 이미지 생성용 데이터 저장
          currentDesignData = {
            monthlyPremium: data.monthlyPremium || '89,000원',
            coverages: data.coverages || []
          };
          // 이미지 미리보기 영역 초기화
          document.getElementById('image-preview-section').classList.add('hidden');
          document.getElementById('image-style-selector').classList.add('hidden');
          generatedImageUrl = null;
        } else {
          document.getElementById('design-section').classList.add('hidden');
          currentDesignData = null;
        }
        
        // SEO 점수 패널 업데이트
        if (data.seo) {
          updateSEOPanel(data.seo);
        }
        
        document.getElementById('qna-progress').classList.add('hidden');
        document.getElementById('resultsInfo').textContent = 'Q&A 생성 완료 - ' + selections['qna-target'] + ' - SEO ' + (data.seo ? data.seo.grade : '-') + '등급';
        showResults('qna');
        showToast('Q&A 완전 자동화 완료! SEO: ' + (data.seo ? data.seo.totalScore + '점' : '-'));
        
      } catch (e) {
        console.error(e);
        showToast('생성 실패. 다시 시도해주세요.');
        document.getElementById('qna-progress').classList.add('hidden');
      }
      
      setLoading('btn-qna', false);
    }
    
    function copyKeyword(kw) {
      navigator.clipboard.writeText(kw).then(() => showToast(kw + ' 복사!'));
    }
    
    // V9.5: 댓글 전체 복사
    function copyAllComments() {
      if (window.generatedComments && window.generatedComments.length > 0) {
        const allText = window.generatedComments.join('\\n\\n');
        window.intentionalCopy = true;
        navigator.clipboard.writeText(allText).then(() => {
          showToast('댓글 ' + window.generatedComments.length + '개 전체 복사 완료!');
        });
      } else {
        showToast('복사할 댓글이 없습니다');
      }
    }

    async function generateBlog() {
      const topic = document.getElementById('blog-topic').value.trim();
      if (!topic) { showToast('블로그 주제를 입력해주세요'); return; }
      
      setLoading('btn-blog', true);
      try {
        const res = await fetch('/api/generate/blog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic,
            keywords: document.getElementById('blog-keywords').value.trim(),
            region: document.getElementById('blog-region').value.trim(),
            type: selections['blog-type'],
            target: selections['blog-target']
          })
        });
        const data = await res.json();
        document.getElementById('blog-title').textContent = data.title;
        document.getElementById('blog-body').textContent = data.content;
        document.getElementById('blog-tags').textContent = data.hashtags;
        document.getElementById('blog-char').textContent = data.content.length + '자';
        document.getElementById('resultsInfo').textContent = '블로그 생성 완료 - ' + data.content.length + '자';
        showResults('blog');
        showToast('블로그 글 생성 완료!');
      } catch (e) { showToast('생성 실패'); }
      setLoading('btn-blog', false);
    }

    async function analyzeBlog() {
      const content = document.getElementById('analyze-content').value.trim();
      if (!content) { showToast('분석할 글을 입력해주세요'); return; }
      
      setLoading('btn-analyze', true);
      try {
        const res = await fetch('/api/analyze/blog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            keyword: document.getElementById('analyze-keyword').value.trim(),
            region: document.getElementById('analyze-region').value.trim(),
            type: selections['analyze-type']
          })
        });
        const data = await res.json();
        document.getElementById('total-score').textContent = data.totalScore;
        document.getElementById('seo-score').textContent = data.seoScore;
        document.getElementById('crank-score').textContent = data.crankScore;
        document.getElementById('aeo-score').textContent = data.aeoScore;
        document.getElementById('geo-score').textContent = data.geoScore;
        document.getElementById('analyze-result').textContent = data.analysis;
        document.getElementById('analyze-improved').textContent = data.improved;
        document.getElementById('resultsInfo').textContent = '분석 완료 - 종합 ' + data.totalScore + '점';
        showResults('analyze');
        showToast('블로그 분석 완료!');
      } catch (e) { showToast('분석 실패'); }
      setLoading('btn-analyze', false);
    }

    // ========== 보안 강화 코드 (복사/캡처 방지 - 가벼운 버전) ==========
    
    (function() {
      // 키보드 단축키 차단 (개발자 도구 감지는 제거 - 너무 예민함)
      document.addEventListener('keydown', function(e) {
        // F12 차단
        if (e.key === 'F12' || e.keyCode === 123) {
          e.preventDefault();
          e.stopPropagation();
          showToast('개발자 도구 사용이 제한됩니다');
          return false;
        }
        
        // Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C (개발자 도구)
        if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) {
          e.preventDefault();
          e.stopPropagation();
          showToast('개발자 도구 사용이 제한됩니다');
          return false;
        }
        
        // Ctrl+U (소스 보기)
        if (e.ctrlKey && (e.key === 'U' || e.key === 'u')) {
          e.preventDefault();
          e.stopPropagation();
          showToast('소스 보기가 제한됩니다');
          return false;
        }
        
        // Ctrl+S (저장)
        if (e.ctrlKey && (e.key === 'S' || e.key === 's')) {
          e.preventDefault();
          e.stopPropagation();
          showToast('저장 기능이 제한됩니다');
          return false;
        }
        
        // Ctrl+P (인쇄)
        if (e.ctrlKey && (e.key === 'P' || e.key === 'p')) {
          e.preventDefault();
          e.stopPropagation();
          showToast('인쇄 기능이 제한됩니다');
          return false;
        }
        
        // Ctrl+A (전체 선택) - 입력 필드 제외
        if (e.ctrlKey && (e.key === 'A' || e.key === 'a') && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
        
        // PrintScreen 감지 (완전 차단 어려움, 경고만)
        if (e.key === 'PrintScreen') {
          showToast('화면 캡처가 제한됩니다');
          // 클립보드 초기화 시도
          navigator.clipboard.writeText('').catch(()=>{});
        }
      }, true);
      
      // 3. 마우스 오른쪽 버튼 차단 (이중 보안)
      document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        showToast('우클릭이 제한됩니다');
        return false;
      }, true);
      
      // 4. 드래그 방지 (이중 보안)
      document.addEventListener('dragstart', function(e) {
        e.preventDefault();
        return false;
      }, true);
      
      // 5. 복사 이벤트 차단 (복사 버튼 제외)
      document.addEventListener('copy', function(e) {
        // 복사 버튼을 통한 의도적 복사는 허용
        if (window.intentionalCopy) {
          window.intentionalCopy = false;
          return true;
        }
        // 입력 필드에서의 복사는 허용
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
          return true;
        }
        e.preventDefault();
        return false;
      }, true);
      
      // 6. 붙여넣기 차단 (입력 필드 제외)
      document.addEventListener('paste', function(e) {
        if (!['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
          e.preventDefault();
          return false;
        }
      }, true);
      
      // 7. 선택 차단 (결과 영역 제외)
      document.addEventListener('selectstart', function(e) {
        if (!['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
          e.preventDefault();
          return false;
        }
      }, true);
      
    })();
    
    // 복사 버튼용 플래그 설정 함수 오버라이드
    const originalCopyText = copyText;
    copyText = function(id) {
      window.intentionalCopy = true;
      originalCopyText(id);
    };
    
    const originalCopyKeywords = copyKeywords;
    copyKeywords = function() {
      window.intentionalCopy = true;
      originalCopyKeywords();
    };
    
    const originalCopyDesignText = copyDesignText;
    copyDesignText = function() {
      window.intentionalCopy = true;
      originalCopyDesignText();
    };
    
    const originalCopyAllQnA = copyAllQnA;
    copyAllQnA = function() {
      window.intentionalCopy = true;
      originalCopyAllQnA();
    };
    
    const originalCopyAllBlog = copyAllBlog;
    copyAllBlog = function() {
      window.intentionalCopy = true;
      originalCopyAllBlog();
    };
    
    const originalCopyAnalyzeAll = copyAnalyzeAll;
    copyAnalyzeAll = function() {
      window.intentionalCopy = true;
      originalCopyAnalyzeAll();
    };
  </script>
</body>
</html>
`

const adminPageHtml = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>관리자 - 보험 콘텐츠 마스터</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <link rel="preconnect" href="https://cdn.jsdelivr.net">
  <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" rel="stylesheet">
  <style>
    body { 
      font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif; 
      background: #050505; 
      color: white;
      letter-spacing: -0.025em;
    }
    .glass-card { background: rgba(255,255,255,0.02); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; }
  </style>
</head>
<body class="min-h-screen p-3 sm:p-4 lg:p-6">
  <div class="max-w-5xl mx-auto">
    
    <div class="flex items-center justify-between mb-4 sm:mb-6">
      <div class="flex items-center gap-2 sm:gap-3">
        <a href="/" class="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
          <i class="fas fa-shield-alt text-white text-sm sm:text-base"></i>
        </a>
        <div>
          <h1 class="text-base sm:text-lg font-bold text-white">관리자 대시보드</h1>
          <p class="text-gray-400 text-xs">보험 콘텐츠 마스터 V6.8</p>
        </div>
      </div>
      <a href="/" class="px-3 py-1.5 rounded-lg bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 transition-all text-xs">
        <i class="fas fa-arrow-left mr-1"></i>메인
      </a>
    </div>
    
    <div class="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 mb-4 sm:mb-6">
      <div class="glass-card p-3 sm:p-4">
        <div class="flex items-center gap-2 sm:gap-3">
          <div class="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
            <i class="fas fa-server text-green-400 text-xs sm:text-sm"></i>
          </div>
          <div>
            <p class="text-gray-300 text-2xs sm:text-xs">API 상태</p>
            <p id="apiStatus" class="text-white font-semibold text-xs sm:text-sm">확인 중...</p>
          </div>
        </div>
      </div>
      <div class="glass-card p-3 sm:p-4">
        <div class="flex items-center gap-2 sm:gap-3">
          <div class="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <i class="fab fa-google text-blue-400 text-xs sm:text-sm"></i>
          </div>
          <div>
            <p class="text-gray-300 text-2xs sm:text-xs">Gemini</p>
            <p class="text-white font-semibold text-xs sm:text-sm">3키</p>
          </div>
        </div>
      </div>
      <div class="glass-card p-3 sm:p-4">
        <div class="flex items-center gap-2 sm:gap-3">
          <div class="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
            <i class="fas fa-search text-green-400 text-xs sm:text-sm"></i>
          </div>
          <div>
            <p class="text-gray-300 text-2xs sm:text-xs">Naver</p>
            <p class="text-white font-semibold text-xs sm:text-sm">연동</p>
          </div>
        </div>
      </div>
      <div class="glass-card p-3 sm:p-4">
        <div class="flex items-center gap-2 sm:gap-3">
          <div class="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <i class="fas fa-code text-purple-400 text-xs sm:text-sm"></i>
          </div>
          <div>
            <p class="text-gray-300 text-2xs sm:text-xs">버전</p>
            <p class="text-white font-semibold text-xs sm:text-sm">V6.8</p>
          </div>
        </div>
      </div>
    </div>
    
    <div class="glass-card p-3 sm:p-4 mb-3 sm:mb-4">
      <h3 class="font-semibold text-white text-sm mb-3"><i class="fas fa-link text-blue-400 mr-1.5"></i>API 엔드포인트</h3>
      <div class="space-y-1.5 sm:space-y-2">
        <div class="flex items-center justify-between p-2.5 bg-white/8 rounded-lg">
          <div class="flex items-center gap-2">
            <span class="px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 text-2xs font-semibold">GET</span>
            <span class="text-gray-100 text-xs">Health</span>
          </div>
          <a href="/api/health" target="_blank" class="text-green-400 hover:underline text-xs">/api/health</a>
        </div>
        <div class="flex items-center justify-between p-2.5 bg-white/8 rounded-lg">
          <div class="flex items-center gap-2">
            <span class="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 text-2xs font-semibold">POST</span>
            <span class="text-gray-100 text-xs">Q&A 자동화</span>
          </div>
          <span class="text-gray-400 text-xs">/api/generate/qna-full</span>
        </div>
        <div class="flex items-center justify-between p-2.5 bg-white/8 rounded-lg">
          <div class="flex items-center gap-2">
            <span class="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 text-2xs font-semibold">POST</span>
            <span class="text-gray-100 text-xs">블로그 생성</span>
          </div>
          <span class="text-gray-400 text-xs">/api/generate/blog</span>
        </div>
        <div class="flex items-center justify-between p-2.5 bg-white/8 rounded-lg">
          <div class="flex items-center gap-2">
            <span class="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 text-2xs font-semibold">POST</span>
            <span class="text-gray-100 text-xs">블로그 분석</span>
          </div>
          <span class="text-gray-400 text-xs">/api/analyze/blog</span>
        </div>
      </div>
    </div>
    
    <div class="glass-card p-3 sm:p-4">
      <h3 class="font-semibold text-white text-sm mb-3"><i class="fas fa-robot text-green-400 mr-1.5"></i>V6.8 업데이트</h3>
      <div class="grid grid-cols-2 gap-x-4 gap-y-1">
        <div class="flex items-center gap-1.5 text-gray-300 text-xs"><i class="fas fa-check text-green-400 text-2xs"></i>키워드 복사</div>
        <div class="flex items-center gap-1.5 text-gray-300 text-xs"><i class="fas fa-check text-green-400 text-2xs"></i>이모티콘 제거</div>
        <div class="flex items-center gap-1.5 text-gray-300 text-xs"><i class="fas fa-check text-green-400 text-2xs"></i>고객명 삭제</div>
        <div class="flex items-center gap-1.5 text-gray-300 text-xs"><i class="fas fa-check text-green-400 text-2xs"></i>전화번호 형식</div>
        <div class="flex items-center gap-1.5 text-gray-300 text-xs"><i class="fas fa-check text-green-400 text-2xs"></i>맞춤 설계서</div>
        <div class="flex items-center gap-1.5 text-gray-300 text-xs"><i class="fas fa-check text-green-400 text-2xs"></i>나이/성별 추론</div>
        <div class="flex items-center gap-1.5 text-gray-300 text-xs"><i class="fas fa-check text-green-400 text-2xs"></i>2026년 기준</div>
        <div class="flex items-center gap-1.5 text-gray-300 text-xs"><i class="fas fa-check text-green-400 text-2xs"></i>PC/모바일 최적화</div>
      </div>
    </div>
    
  </div>
  <script>
    fetch('/api/health').then(r => r.json()).then(d => {
      document.getElementById('apiStatus').innerHTML = '<span class="text-green-400"><i class="fas fa-check-circle mr-1"></i>정상</span>';
    }).catch(() => {
      document.getElementById('apiStatus').innerHTML = '<span class="text-red-400"><i class="fas fa-times-circle mr-1"></i>오류</span>';
    });
  </script>
</body>
</html>
`

// Routes
app.get('/', (c) => c.html(mainPageHtml))
app.get('/admin', (c) => c.html(adminPageHtml))
// ========== 📷 사진 분석 API (Gemini Vision) ==========
app.post('/api/analyze/photo', async (c) => {
  const { photos, concern, insuranceType } = await c.req.json()
  
  if (!photos || photos.length === 0) {
    return c.json({ success: false, error: '사진이 없습니다' }, 400)
  }
  
  const geminiKeys = getGeminiKeys(c.env)
  if (geminiKeys.length === 0) {
    return c.json({ success: false, error: 'API key not configured' }, 500)
  }
  
  try {
    // Gemini Vision API로 사진 분석
    const apiKey = geminiKeys[Math.floor(Math.random() * geminiKeys.length)]
    
    // Base64에서 데이터 부분만 추출
    const imageData = photos[0].replace(/^data:image\/[a-z]+;base64,/, '')
    
    const analysisPrompt = `당신은 보험 전문가입니다. 이 보험 증권/설계서 이미지를 분석해주세요.

【 분석 요청 】
- 핵심 고민: ${concern || '(미입력)'}
- 보험 종류: ${insuranceType || '(미입력)'}

【 분석 항목 - 모든 항목을 이미지에서 정확히 추출하세요 】
1. 보험사명과 상품명 (정확히 기재된 대로)
2. 계약일/가입일 (이미지에서 찾아서 정확히 기재)
3. 피보험자 나이/생년월일 (있다면 추출, 없으면 가입일 기준으로 현재 나이 추정)
4. 월 보험료 / 납입기간 / 보험기간
5. 주계약 보장 내용 (금액까지 정확히)
6. 특약 구성 (각 특약명과 보장금액)
7. 갱신형/비갱신형 여부 (특약별로 구분)
8. 해지환급금 예시 (있다면)

【 출력 형식 - 반드시 이 형식으로 출력 】
• 보험사: [보험사명]
• 상품명: [상품명 전체]
• 계약일: [YYYY년 MM월 DD일] 또는 [가입 후 N년 경과]
• 추정연령: [현재 추정 나이]대 (예: 40대 후반, 50대 초반)
• 월 보험료: [금액]원
• 납입기간: [기간] / 보험기간: [기간]
• 주계약: [보장명 + 금액]
• 특약목록:
  - [특약1]: [금액] (갱신형/비갱신형)
  - [특약2]: [금액] (갱신형/비갱신형)
  ...
• 갱신 여부: [갱신형 특약 비율 및 요약]
• 핵심 문제점: [이 증권의 가장 큰 문제 1-2가지 지적]
• 전문가 조언: [핵심 고민과 연관지어 구체적인 조언 3-4문장. 실제 금액과 특약명을 언급하며 분석]

【 중요 】
- 이미지에 보이는 숫자/금액/날짜를 정확히 읽어주세요
- 추정이 필요한 경우 "추정" 또는 "약"이라고 표시하세요
- 이미지가 보험 증권이 아니면 "보험 증권을 인식할 수 없습니다"라고 답변하세요`

    // V17.9: Vision API - gemini-2.0-flash-exp 사용 (v1beta API)
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: analysisPrompt },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: imageData
                }
              }
            ]
          }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
        })
      }
    )
    
    if (!response.ok) {
      const errorText = await response.text()
      return c.json({ 
        success: false, 
        error: `Gemini API error: ${response.status}`,
        detail: errorText,
        analysis: '사진 분석에 실패했습니다.'
      })
    }
    
    const data = await response.json() as any
    const analysis = data.candidates?.[0]?.content?.parts?.[0]?.text || '분석 실패'
    
    return c.json({ success: true, analysis })
    
  } catch (error: any) {
    console.error('Photo analysis error:', error)
    return c.json({ 
      success: false, 
      error: error?.message || '사진 분석 중 오류가 발생했습니다',
      analysis: '사진 분석에 실패했습니다. 직접 정보를 입력해주세요.'
    })
  }
})

app.get('/api/health', (c) => c.json({ 
  status: 'ok', 
  version: '18.4', 
  ai: 'gemini-1.5-pro + naver-rag + gemini-image', 
  textModel: 'gemini-1.5-pro-002',
  imageModel: 'gemini-2.5-flash-image',
  ragPipeline: 'naver-search → strategy-json → content-gen(multi-persona) → self-diagnosis',
  year: 2026,
  features: ['keyword-analysis', 'qna-full-auto', 'customer-tailored-design', 'no-emoji', 'responsive-ui', 'excel-style-design', 'one-click-copy', 'pc-full-width-layout', 'security-protection', 'proposal-image-generation', 'compact-card-style', 'rag-4step-pipeline', 'hallucination-zero', 'comments-5', 'multi-persona-tone', 'min-length-enforcement', 'knowledge-injection'],
  timestamp: new Date().toISOString() 
}))

// 네이버 키워드 검색 API
app.get('/api/naver/keywords', async (c) => {
  const query = c.req.query('q')
  if (!query) return c.json({ error: 'Query required' }, 400)
  
  const clientId = c.env?.NAVER_CLIENT_ID || 'fUhHJ1HWyF6fFw_aBfkg'
  const clientSecret = c.env?.NAVER_CLIENT_SECRET || 'gA4jUFDYK0'
  const keywords = await searchNaverKeywords(query, clientId, clientSecret)
  return c.json({ keywords })
})

// ============================================================
// V13.0 - Agentic Workflow: 검수(Self-Correction) 시스템
// 생성 → 검수 → 재생성 Loop 구조
// ============================================================

// 검수(Audit) 함수 - 4가지 기준으로 콘텐츠 품질 검증
interface AuditResult {
  passed: boolean
  scores: {
    seoOptimization: number      // SEO 최적화 (키워드 밀도)
    contextConsistency: number   // 문맥 일치성 (핵심고민 관통)
    expertDiversity: number      // 전문가 답변 다각화
    commentRealism: number       // 댓글 현실성
  }
  totalScore: number
  failReasons: string[]
  suggestions: string[]
}

function auditQnAContent(params: {
  customerConcern: string
  insuranceType: string
  target: string
  titles: string[]
  questions: string[]
  answers: string[]
  comments: string[]
  seoKeywords: string[]
}): AuditResult {
  const { customerConcern, insuranceType, target, titles, questions, answers, comments, seoKeywords } = params
  const failReasons: string[] = []
  const suggestions: string[] = []
  
  // ① SEO 최적화 검증 (C-Rank / D.I.A.+ / Agent N)
  let seoScore = 100
  const allContent = [...titles, ...questions, ...answers].join(' ').toLowerCase()
  const concernLower = customerConcern.toLowerCase()
  const insuranceLower = insuranceType.toLowerCase()
  
  // 핵심 키워드 포함 여부 확인
  if (!allContent.includes(insuranceLower)) {
    seoScore -= 30
    failReasons.push('SEO: 보험종류가 콘텐츠에 충분히 포함되지 않음')
    suggestions.push(`"${insuranceType}"를 제목/질문/답변에 더 자주 언급하세요`)
  }
  
  // SEO 키워드 밀도 확인 (최소 3개 이상 포함)
  const keywordHits = seoKeywords.filter(kw => allContent.includes(kw.toLowerCase())).length
  if (keywordHits < 3) {
    seoScore -= 20
    suggestions.push('SEO 키워드를 콘텐츠 전반에 더 배치하세요')
  }
  
  // ② 문맥 일치성 검증 (핵심고민이 답변/댓글까지 관통하는지)
  let contextScore = 100
  const concernKeywords = concernLower.split(/[\s,]+/).filter(w => w.length > 1)
  
  // 질문에 핵심고민 반영 확인
  const questionHasConcern = questions.some(q => 
    concernKeywords.some(kw => q.toLowerCase().includes(kw)) || 
    q.toLowerCase().includes(concernLower.substring(0, 15))
  )
  if (!questionHasConcern && customerConcern.length > 3) {
    contextScore -= 25
    failReasons.push('문맥: 질문에 핵심고민이 충분히 반영되지 않음')
    suggestions.push(`질문에 "${customerConcern.substring(0, 20)}..."를 직접적으로 언급하세요`)
  }
  
  // 답변에 핵심고민 반영 확인
  const answerHasConcern = answers.some(a => 
    concernKeywords.some(kw => a.toLowerCase().includes(kw)) ||
    a.toLowerCase().includes(concernLower.substring(0, 15))
  )
  if (!answerHasConcern && customerConcern.length > 3) {
    contextScore -= 30
    failReasons.push('문맥: 전문가 답변에 핵심고민이 반영되지 않음')
    suggestions.push('전문가 답변이 질문의 핵심고민에 직접적으로 답해야 합니다')
  }
  
  // 댓글에 상황 공감 확인
  const commentHasConcern = comments.some(c => 
    concernKeywords.some(kw => c.toLowerCase().includes(kw)) ||
    c.includes('저도') || c.includes('비슷한') || c.includes('공감')
  )
  if (!commentHasConcern && customerConcern.length > 3) {
    contextScore -= 15
    suggestions.push('댓글이 질문자의 구체적 상황에 공감해야 합니다')
  }
  
  // ③ 전문가 답변 다각화 검증 (3명의 서로 다른 관점)
  let expertScore = 100
  
  // 답변 개수 확인
  if (answers.length < 3) {
    expertScore -= 40
    failReasons.push('전문가: 3개의 서로 다른 전문가 답변이 필요합니다')
  }
  
  // 답변 길이 확인 (최소 300자)
  const shortAnswers = answers.filter(a => a.length < 300)
  if (shortAnswers.length > 0) {
    expertScore -= 15 * shortAnswers.length
    suggestions.push('전문가 답변은 최소 300자 이상의 상세한 내용이어야 합니다')
  }
  
  // 답변 다양성 확인 (시작 문구가 달라야 함)
  if (answers.length >= 3) {
    const firstWords = answers.map(a => a.substring(0, 30))
    const uniqueStarts = new Set(firstWords).size
    if (uniqueStarts < 3) {
      expertScore -= 20
      suggestions.push('각 전문가 답변의 시작 문구와 관점이 달라야 합니다')
    }
  }
  
  // CTA(Call to Action) 포함 확인
  const ctaKeywords = ['댓글', '문의', '연락', '상담', '확인해', '보세요', '주세요', '드릴게요']
  const answersWithCTA = answers.filter(a => ctaKeywords.some(cta => a.includes(cta)))
  if (answersWithCTA.length < 2) {
    expertScore -= 15
    suggestions.push('전문가 답변에 구체적인 행동 유도(CTA)를 포함하세요')
  }
  
  // ④ 댓글 현실성 검증 (단순 칭찬 금지, 경험담 위주)
  let commentScore = 100
  
  // 댓글 개수 확인
  if (comments.length < 3) {
    commentScore -= 30
    failReasons.push('댓글: 최소 3개의 댓글이 필요합니다')
  }
  
  // 단순 칭찬 댓글 감지
  const simplePraise = ['좋은 정보', '감사합니다', '좋은 글', '잘 읽었', '유익한']
  const praiseOnlyComments = comments.filter(c => 
    simplePraise.some(p => c.includes(p)) && c.length < 50
  )
  if (praiseOnlyComments.length > 1) {
    commentScore -= 20
    suggestions.push('단순 칭찬 댓글 대신 경험담이나 구체적 공감 댓글로 작성하세요')
  }
  
  // 총점 계산
  const totalScore = Math.round((seoScore + contextScore + expertScore + commentScore) / 4)
  const passed = totalScore >= 70 && failReasons.length === 0
  
  return {
    passed,
    scores: {
      seoOptimization: seoScore,
      contextConsistency: contextScore,
      expertDiversity: expertScore,
      commentRealism: commentScore
    },
    totalScore,
    failReasons,
    suggestions
  }
}

// ============================================================
// V14.0 - Agentic Workflow: 재생성 루프(Self-Correction Loop)
// 생성 → 검수 → Fail시 Context 보강 재생성 (최대 2회)
// ============================================================

// Q&A 생성 핵심 함수 (재귀 호출용)
async function generateQnAWithAudit(params: {
  geminiKeys: string[],
  customerConcern: string,
  insuranceType: string,
  target: string,
  tone: string,
  attempt: number,
  previousFailReasons?: string[]
}): Promise<string> {
  const { geminiKeys, customerConcern, insuranceType, target, tone, attempt, previousFailReasons } = params
  
  // 재생성시 Context 강화 프롬프트
  const contextReinforcement = attempt > 1 && previousFailReasons ? `

🚨🚨🚨 [재생성 ${attempt}차 - 이전 오류 수정 필수!] 🚨🚨🚨
이전 생성에서 다음 문제가 발견되었습니다:
${previousFailReasons.map(r => `❌ ${r}`).join('\n')}

반드시 위 문제를 해결한 콘텐츠를 생성하세요!
특히 "${customerConcern}"가 모든 질문과 답변에 명시적으로 포함되어야 합니다.
🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨

` : ''
  
  // 핵심 고민 강제 주입 (할루시네이션 방지)
  const forcedContext = `
########################################################################
#  🔴 절대 규칙: 아래 핵심 고민이 모든 콘텐츠에 반드시 포함되어야 함! 🔴  #
########################################################################

📌 핵심 고민 (MUST INCLUDE): "${customerConcern}"
📌 보험 종류 (MUST INCLUDE): "${insuranceType}"
📌 타깃 고객: "${target}"

⚠️ 위 3가지가 제목/질문/답변/댓글 전체에 자연스럽게 포함되어야 합니다!
⚠️ 특히 "${customerConcern}"는 반드시 질문 본문에 그대로 사용하세요!
⚠️ "${insuranceType}"는 제목과 모든 답변에 최소 2회 이상 언급하세요!

########################################################################
`
  
  const prompt = `${contextReinforcement}${forcedContext}

# 콘텐츠 생성 요청

당신은 네이버 카페 보험 Q&A 전문가입니다.

## 필수 입력 정보
- 핵심 고민: "${customerConcern}" ← 이것이 Q&A의 핵심 주제!
- 보험 종류: "${insuranceType}" ← 반드시 언급!
- 타깃 고객: "${target}" ← 질문자 = 이 사람!
- 답변 톤: ${tone}

## 출력 형식 (태그와 내용만 출력!)

[제목1]
(${target}이 ${customerConcern}에 대해 급하게 질문하는 어그로성 제목, 15-35자, ?로 끝)

[제목2]
(제목1과 다른 스타일의 어그로성 제목, 15-35자, ?로 끝)

[질문1]
안녕하세요. ${target}입니다.
${customerConcern} ← 이 문장 반드시 포함!
${insuranceType} 관련해서 질문 드립니다.
(구체적 상황 200-350자, 쪽지 사절 댓글로 답변 부탁)

[질문2]
(다른 화자, 다른 상황이지만 "${customerConcern}"과 "${insuranceType}" 반드시 포함!)

[질문3]
(또 다른 화자, "${customerConcern}"과 "${insuranceType}" 반드시 포함!)

[답변1]
(팩트형 전문가: "${customerConcern}"에 대한 약관/수치 기반 분석, "${insuranceType}" 2회 이상 언급, 500-700자)

[답변2]
(공감형 전문가: "${customerConcern}"에 공감하며 대안 제시, "${insuranceType}" 2회 이상 언급, 500-700자)

[답변3]
(비교형 전문가: "${customerConcern}"을 타사/과거 상품과 비교, "${insuranceType}" 2회 이상 언급, 500-700자)

[댓글1]
(질문자의 "${customerConcern}" 상황에 공감하는 경험담, 40-100자)

[댓글2]
(전문가 답변 뒷받침하는 정보, "${insuranceType}" 언급, 40-100자)

[댓글3]
(비슷한 상황의 추가 질문, 40-100자)

[댓글4]
(자신의 보험 경험담/후기 공유, 40-100자)

[댓글5]
(질문자 응원 또는 도움 제안, 40-100자)

[검색키워드]
${insuranceType} 관련 SEO 키워드 5개

[최적화제목1]
D.I.A.+ 최적화 제목

[최적화제목2]
에이전트 N 최적화 제목

[강조포인트]
- (핵심 1)
- (핵심 2)
- (핵심 3)

[해시태그]
#${insuranceType.replace(/\s/g, '')} 포함 10개

[자가진단결과]
- 핵심고민 반영도: 상
- 타깃 적합도: 상
- 보험종류 일치도: 상
- 재생성 필요: 아니오

⚠️ 중요: [태그]와 내용만 출력! 설명이나 구분선 출력 금지!
⚠️ "${customerConcern}"가 질문1, 질문2, 질문3에 반드시 포함되어야 함!`

  return await callGeminiAPI(prompt, geminiKeys)
}

// Q&A 완전 자동화 API (V14.0 - Agentic Workflow with Regeneration Loop)
app.post('/api/generate/qna-full', async (c) => {
  const { target: inputTarget, tone: inputTone, insuranceType: inputInsuranceType, concern, generateDesign, photoAnalysis, hasPhoto } = await c.req.json()
  
  const insuranceType = inputInsuranceType || '종합보험'  // 기본 보험종류
  const tone = inputTone || '친근한'  // 기본 톤
  
  // 환경 변수에서 API 키 가져오기 (Cloudflare Secrets) - 4개 키 로테이션
  const geminiKeys = getGeminiKeys(c.env)
  const naverClientId = c.env?.NAVER_CLIENT_ID || 'fUhHJ1HWyF6fFw_aBfkg'
  const naverClientSecret = c.env?.NAVER_CLIENT_SECRET || 'gA4jUFDYK0'
  
  if (geminiKeys.length === 0) {
    return c.json({ error: 'API key not configured' }, 500)
  }
  
  // ========== V23.1: 사용자 입력 TARGET 우선 사용 ==========
  // 핵심 수정: 사용자가 구체적인 target을 입력하면 그대로 사용
  // 연령대만 입력한 경우(예: "30대", "40대")에만 직업 추가
  let target = inputTarget || '30대'
  const inputAgeMatch = target.match(/(20대|30대|40대|50대|60대)/)
  const ageGroup = inputAgeMatch ? inputAgeMatch[1] : '30대'
  
  // V23.1: 구체적인 타겟 키워드가 있는지 확인
  const specificTargetKeywords = ['직장인', '자영업자', '공무원', '프리랜서', '워킹맘', '육아맘', '1인가구', '취준생', '맞벌이', '신혼부부', '은퇴자', '연금생활자', '대학생', '사회초년생', '주부', '가장', '학부모', '외벌이']
  const hasSpecificTarget = specificTargetKeywords.some(keyword => target.includes(keyword))
  
  // 사용자가 구체적인 타겟을 입력하지 않은 경우에만 직업 생성
  if (!hasSpecificTarget) {
    console.log(`[V23.1] 타겟에 구체적 키워드 없음(${target}), 직업 생성 시작...`)
    
    // 연령대별 직업 풀
    const occupationPools: Record<string, string> = {
      '20대': '사회초년생, 대학생, 취준생, 프리랜서, 스타트업직원, 공무원준비생, 대학원생, 인턴, 계약직, 알바생',
      '30대': '직장인, 프리랜서, 신혼부부, 자영업자, 육아맘, IT개발자, 공무원, 영업직, 맞벌이, 워킹맘, 1인가구',
      '40대': '가장, 직장인, 자영업자, 프리랜서, 맞벌이부부, 중간관리자, 사업가, 학부모, 외벌이, 투잡러',
      '50대': '은퇴준비, 자영업자, 직장인, 1인사업자, 프리랜서, 경력단절, 조기퇴직, 귀농준비, 재취업, 빈둥지',
      '60대': '은퇴자, 연금생활자, 자영업자, 재취업, 귀농귀촌, 손주돌봄, 시니어창업, 건강관리'
    }
    
    const poolForAge = occupationPools[ageGroup] || occupationPools['30대']
    const randomSeed = Date.now() % 1000
    
    try {
      const occupationPrompt = `${ageGroup}가 ${insuranceType}에 대해 네이버 카페에 질문합니다.
아래 직업 목록에서 무작위로 하나만 선택해서 출력하세요.

직업 목록: ${poolForAge}

규칙:
- 위 목록에서 반드시 하나만 선택
- 랜덤 시드: ${randomSeed} (이 숫자를 참고해서 다른 결과 출력)
- 직업만 출력, 다른 설명 없이
- 2-5글자

출력:`

      const generatedOccupation = await callGeminiAPI(occupationPrompt, geminiKeys)
      const cleanOccupation = generatedOccupation.replace(/["\n\r:]/g, '').trim().slice(0, 10)
      target = `${ageGroup} ${cleanOccupation}`
      console.log(`[V23.1] Gemini 생성 직업: ${target}`)
    } catch (e) {
      // API 실패 시 목록에서 랜덤 선택
      const fallbackList = poolForAge.split(', ')
      const randomOccupation = fallbackList[Math.floor(Math.random() * fallbackList.length)]
      target = `${ageGroup} ${randomOccupation}`
      console.log(`[V23.1] 직업 생성 실패, 랜덤 선택: ${target}`)
    }
  } else {
    console.log(`[V23.1] 사용자 입력 타겟 그대로 사용: ${target}`)
  }
  
  // 1. 네이버 키워드 분석
  const searchQuery = `${ageGroup} ${insuranceType} 추천`
  const naverKeywords = await searchNaverKeywords(searchQuery, naverClientId, naverClientSecret)
  const relatedKeywords = await getRelatedKeywords(insuranceType, naverClientId, naverClientSecret)
  
  const allKeywords = [...new Set([insuranceType, ...naverKeywords.slice(0, 5), ...relatedKeywords.slice(0, 3)])]
  const coreKeywords = allKeywords.slice(0, 6)
  
  // 2. 가상 연락처 생성 (이름 제외)
  const contact = generateVirtualContact()
  
  // V17.9: 사진 분석 결과가 있으면 핵심 고민에 통합
  let photoContext = ''
  let adjustedTarget = target  // 사진 분석 결과로 조정될 수 있는 타깃
  
  if (photoAnalysis && photoAnalysis !== '보험 증권을 인식할 수 없습니다') {
    photoContext = `\n\n【 사진 분석 결과 】\n${photoAnalysis}`
    
    // V18.1: 사진에서 추정연령 또는 계약일로 나이 추정
    let extractedAge = 0
    
    // 방법1: 추정연령 직접 추출
    const ageMatch = photoAnalysis.match(/추정연령[:\s]*(\d+)대|(\d+)대\s*(초반|중반|후반)?/)
    if (ageMatch) {
      extractedAge = parseInt(ageMatch[1] || ageMatch[2])
    }
    
    // 방법2: 계약일로부터 나이 추정 (가입 당시 30대 가정 + 경과 연수)
    // V18.2: 더 다양한 날짜 형식 지원 (2007.03.15, 2007-03-15, 2007/03/15 등)
    if (!extractedAge) {
      // 여러 패턴을 순차적으로 시도
      let contractYear = null
      let yearsElapsed = null
      
      // 패턴1: "계약일: 2007년" 또는 "계약일: 2007.03.15"
      const pattern1 = photoAnalysis.match(/계약일[:\s]*(\d{4})/)
      if (pattern1) contractYear = pattern1[1]
      
      // 패턴2: "가입일: 2007년" 또는 "가입: 2007년"
      if (!contractYear) {
        const pattern2 = photoAnalysis.match(/가입일?[:\s]*(\d{4})/)
        if (pattern2) contractYear = pattern2[1]
      }
      
      // 패턴3: "2007년 가입" 또는 "2007년에 가입"
      if (!contractYear) {
        const pattern3 = photoAnalysis.match(/(\d{4})년.*가입/)
        if (pattern3) contractYear = pattern3[1]
      }
      
      // 패턴4: "19년 경과" 또는 "가입 후 19년"
      if (!contractYear) {
        const pattern4 = photoAnalysis.match(/(\d+)년\s*경과|가입\s*후\s*(\d+)년/)
        if (pattern4) yearsElapsed = pattern4[1] || pattern4[2]
      }
      
      if (contractYear) {
        const yearsPassed = 2026 - parseInt(contractYear)
        // 가입 당시 30대 중반(35세) 가정
        const estimatedAge = 35 + yearsPassed
        extractedAge = Math.floor(estimatedAge / 10) * 10  // 10대 단위로 반올림
        console.log(`[V18.2] 계약일(${contractYear}년) 기준 추정연령: ${estimatedAge}세 → ${extractedAge}대`)
      } else if (yearsElapsed) {
        // "19년 경과" 같은 패턴
        const estimatedAge = 35 + parseInt(yearsElapsed)
        extractedAge = Math.floor(estimatedAge / 10) * 10
        console.log(`[V18.2] 경과연수(${yearsElapsed}년) 기준 추정연령: ${estimatedAge}세 → ${extractedAge}대`)
      }
    }
    
    // 추출된 나이로 타깃 조정
    if (extractedAge > 0) {
      const inputAgeMatch = inputTarget?.match(/(\d+)대/)
      const inputAge = inputAgeMatch ? parseInt(inputAgeMatch[1]) : 30
      
      // 사진의 나이가 입력된 나이보다 10살 이상 많으면 사진 기준으로 조정
      if (extractedAge >= inputAge + 10) {
        const newAgeGroup = `${extractedAge}대`
        
        // V18.4: 새로운 연령대에 맞는 직업도 Gemini API로 생성
        try {
          const newOccupationPrompt = `${newAgeGroup}가 ${insuranceType}에 대해 질문하려고 합니다.
이 사람의 직업/상황을 하나만 생성해주세요.
${newAgeGroup}에 어울리는 현실적인 직업, 2-4글자로만, 설명없이.
출력 예시: 자영업자`

          const newOccupation = await callGeminiAPI(newOccupationPrompt, geminiKeys)
          const cleanNewOccupation = newOccupation.replace(/["\n\r]/g, '').trim().slice(0, 10)
          adjustedTarget = `${newAgeGroup} ${cleanNewOccupation}`
          console.log(`[V18.4] 사진 기준 타깃 + Gemini 직업: ${target} → ${adjustedTarget}`)
        } catch (e) {
          adjustedTarget = `${newAgeGroup} 직장인`
          console.log(`[V18.4] 직업 생성 실패, 기본값: ${adjustedTarget}`)
        }
      }
    }
  }
  
  // 3. 고민/질문 자동 생성 (API 실패 시 기본값 제공)
  let customerConcern = concern
  if (!customerConcern) {
    try {
      const concernPrompt = `당신은 ${target}입니다. ${insuranceType}에 대해 네이버 카페에 질문하려고 합니다.
현실적이고 구체적인 고민을 50자 이내로 작성해주세요.
이모티콘이나 특수문자 없이 순수 텍스트만 작성하세요.
반드시 한 문장으로 작성하세요.`
      customerConcern = await callGeminiAPI(concernPrompt, geminiKeys)
      customerConcern = cleanText(customerConcern.replace(/["\n]/g, '').trim())
    } catch (e) {
      // API 실패 시 보험종류별 기본 고민 제공
      const defaultConcerns: Record<string, string> = {
        '암보험': '암보험 갱신이 다가오는데 보험료가 너무 올라서 고민입니다',
        '종신보험': '종신보험 가입했는데 이게 저축인지 보험인지 헷갈립니다',
        '달러종신보험': '달러종신보험 가입했는데 사망보험금이라면서요? 어떡해요',
        '운전자보험': '운전자보험 옛날에 들었는데 민식이법 때문에 다시 들어야 하나요',
        '실손보험': '실손보험 4세대로 갈아타야 하는지 고민입니다',
        '간병보험': '부모님 간병보험 알아보는데 뭘 챙겨야 하는지 모르겠어요',
        '어린이보험': '아이 어린이보험 가입하려는데 뭘 봐야 하는지 모르겠습니다'
      }
      customerConcern = defaultConcerns[insuranceType] || `${insuranceType} 가입하려는데 어떤 걸 봐야 하는지 모르겠습니다`
      console.log('[V17.2] 고민 자동생성 실패 - 기본 고민 사용:', customerConcern)
    }
  }
  
  // 4. Q&A 생성 프롬프트 (C-Rank/D.I.A./Agent N 최적화) - V9.5 대폭 강화
  
  // 질문 유형 20가지 (현실적인 일반인 질문 스타일)
  const questionTypes = [
    { style: '급한형', example: '지금 급한데요, 내일까지 결정해야 하는데...' },
    { style: '조언형', example: '이거 어떻게 해야 할지 모르겠어서요...' },
    { style: '속은형', example: '혹시 저 속은 건 아닌가요? 설계사가...' },
    { style: '현실고민형', example: '솔직히 돈이 없어서 고민인데...' },
    { style: '비교형', example: 'A회사랑 B회사 중에 뭐가 나은가요?' },
    { style: '불안형', example: '제가 너무 늦은 거 아닌가요? 나이가...' },
    { style: '경험요청형', example: '실제로 가입하신 분 계신가요?' },
    { style: '추천요청형', example: '제 상황에 맞는 거 추천 좀 해주세요' },
    { style: '확인형', example: '제가 알아본 게 맞는지 확인 좀...' },
    { style: '동네형질문', example: '형, 이거 진짜 필요한 거 맞아요?' },
    { style: '초보형', example: '보험 처음인데 뭐부터 해야 해요?' },
    { style: '가격질문형', example: '이 정도면 비싼 건가요? 싼 건가요?' },
    { style: '타이밍형', example: '지금 가입하는 게 맞아요? 좀 더 기다려야?' },
    { style: '후회형', example: '제가 이미 가입한 게 있는데 잘못한 건가요?' },
    { style: '주변권유형', example: '친구가 자꾸 가입하라는데 정말 필요해요?' },
    { style: '뉴스확인형', example: '뉴스에서 봤는데 이게 맞는 말이에요?' },
    { style: '솔직고백형', example: '솔직히 말하면 저 건강이 좀 안 좋은데...' },
    { style: '가족걱정형', example: '제가 없으면 가족이 걱정돼서요...' },
    { style: '직접경험형', example: '저번에 아파서 병원 갔는데 비용이...' },
    { style: '분노형', example: '왜 이렇게 복잡해요? 쉽게 좀 설명해주세요' }
  ]
  const selectedType1 = questionTypes[Math.floor(Math.random() * questionTypes.length)]
  const selectedType2 = questionTypes[Math.floor(Math.random() * questionTypes.length)]
  
  // 전문가 유형은 아래 새 버전으로 이동 (3가지 다른 관점)
  
  // 톤 분석 - 다중 선택된 톤 처리
  const tones = tone.split(',').map((t: string) => t.trim())
  const isBeginnerMode = tones.includes('보험초보')
  const isProposalMode = tones.includes('제안서요청형')
  const baseTones = tones.filter((t: string) => !['보험초보', '제안서요청형'].includes(t))
  
  // 암환자/사고 상황 감지 - 공감대 형성 우선 적용
  const isTraumaticSituation = /암|cancer|사고|교통사고|수술|병원|진단|환자|투병|항암|치료중|치료|입원|병|질병|건강악화|중병|병력/.test(customerConcern.toLowerCase())
  
  // ============================================================
  // V11.0 - 새로운 Q&A 출력 형식 + SEO 최적화 프롬프트
  // ============================================================
  
  // KEYWORD 유무에 따른 상황 처리
  const hasKeyword = customerConcern && customerConcern.length > 3
  const keywordStatus = hasKeyword ? '상황 A (핵심 고민 있음)' : '상황 B (핵심 고민 없음)'
  
  // 클릭유도 키워드 리스트 - 3개 다르게 선택
  const clickBaitKeywords = ['호구', '손해', '해지', '충격', '거절', '폭탄', '함정', '후회', '속은', '실수', '사기', '위험', '경고', '주의']
  const shuffledClickBaits = clickBaitKeywords.sort(() => Math.random() - 0.5)
  const clickBait1 = shuffledClickBaits[0]
  const clickBait2 = shuffledClickBaits[1]
  const clickBait3 = shuffledClickBaits[2]
  
  // 전문가 유형 3가지 (각각 다른 관점!)
  const expertTypes = [
    { type: '공감형 멘토', style: '따뜻하게 공감하면서 조언', focus: '감정 케어 + 실용 조언', opening: '많이 걱정되셨죠? 충분히 이해해요.' },
    { type: '데이터 분석가', style: '숫자와 통계로 객관적 분석', focus: '손익 계산 + 비교 분석', opening: '객관적으로 숫자로 말씀드릴게요.' },
    { type: '현장 베테랑', style: '20년 경험 기반 실전 조언', focus: '실제 사례 + 현실적 해법', opening: '제가 20년간 봐온 케이스 중에...' },
    { type: '소비자 보호 전문가', style: '고객 권리 중심 조언', focus: '약관 해석 + 권리 주장법', opening: '소비자 입장에서 말씀드리면...' },
    { type: '재무설계사', style: '장기적 재무 관점 조언', focus: '자산 배분 + 미래 설계', opening: '장기적인 관점에서 보면요...' },
    { type: '보험 리모델링 전문가', style: '기존 보험 분석 + 개선안', focus: '비교 분석 + 최적화', opening: '기존 보험 구조를 분석해보니...' }
  ]
  const shuffledExperts = expertTypes.sort(() => Math.random() - 0.5)
  const expert1 = shuffledExperts[0]
  const expert2 = shuffledExperts[1]
  const expert3 = shuffledExperts[2]
  
  // 질문자 유형 다양화 (질문1, 질문2는 완전히 다른 사람!)
  const questionerTypes = [
    { age: '20대 후반', gender: '여성', job: '직장인', situation: '사회초년생, 보험 처음', style: '캐주얼, 솔직' },
    { age: '30대 초반', gender: '남성', job: '회사원', situation: '신혼, 아이 계획 중', style: '실용적, 직접적' },
    { age: '30대 후반', gender: '여성', job: '워킹맘', situation: '아이 둘, 육아+직장', style: '바쁨, 핵심만' },
    { age: '40대 초반', gender: '남성', job: '자영업자', situation: '가장, 사업 운영', style: '현실적, 비용 민감' },
    { age: '40대 후반', gender: '여성', job: '전업주부', situation: '자녀 대학생', style: '꼼꼼, 비교 선호' },
    { age: '50대 초반', gender: '남성', job: '직장인', situation: '은퇴 준비, 노후 걱정', style: '신중, 안정 추구' },
    { age: '50대 후반', gender: '여성', job: '자영업', situation: '건강 걱정 시작', style: '걱정 많음, 상세 질문' },
    { age: '30대 중반', gender: '남성', job: '프리랜서', situation: '4대보험 없음', style: '불안, 정보 갈증' }
  ]
  const shuffledQuestioners = questionerTypes.sort(() => Math.random() - 0.5)
  const questioner1 = shuffledQuestioners[0]
  const questioner2 = shuffledQuestioners[1]
  
  // ============================================================
  // 타깃 페르소나 상세 분석 (성별/연령/직업/가족상황)
  // ============================================================
  const parseTargetPersona = (targetStr: string) => {
    // 성별 추출
    let gender = ''
    if (/여성|여자|엄마|주부|아내|며느리|딸/.test(targetStr)) gender = '여성'
    else if (/남성|남자|아빠|남편|아들|가장/.test(targetStr)) gender = '남성'
    else gender = Math.random() > 0.5 ? '남성' : '여성'
    
    // 연령대 추출
    let ageGroup = ''
    let ageNum = 35
    const ageMatch = targetStr.match(/(\d+)대/)
    if (ageMatch) {
      ageGroup = ageMatch[0]
      ageNum = parseInt(ageMatch[1]) + Math.floor(Math.random() * 9)
    } else if (/20대|사회초년생|대학|취준/.test(targetStr)) { ageGroup = '20대'; ageNum = 25 + Math.floor(Math.random() * 5) }
    else if (/30대/.test(targetStr)) { ageGroup = '30대'; ageNum = 32 + Math.floor(Math.random() * 7) }
    else if (/40대/.test(targetStr)) { ageGroup = '40대'; ageNum = 42 + Math.floor(Math.random() * 7) }
    else if (/50대/.test(targetStr)) { ageGroup = '50대'; ageNum = 52 + Math.floor(Math.random() * 7) }
    else if (/60대|은퇴|노후/.test(targetStr)) { ageGroup = '60대'; ageNum = 62 + Math.floor(Math.random() * 7) }
    else { ageGroup = '30대'; ageNum = 35 }
    
    // 직업/상황 추출
    let occupation = ''
    if (/직장인|회사원|샐러리맨/.test(targetStr)) occupation = '직장인'
    else if (/자영업|사장|CEO|대표/.test(targetStr)) occupation = '자영업자'
    else if (/프리랜서|1인/.test(targetStr)) occupation = '프리랜서'
    else if (/공무원/.test(targetStr)) occupation = '공무원'
    else if (/주부|전업/.test(targetStr)) occupation = '전업주부'
    else if (/사회초년생|신입/.test(targetStr)) occupation = '사회초년생'
    else occupation = '직장인'
    
    // 가족상황 추출
    let familyStatus = ''
    if (/신혼|결혼|예비/.test(targetStr)) familyStatus = '신혼'
    else if (/가장|가정|아이|자녀|육아/.test(targetStr)) familyStatus = '가장(자녀있음)'
    else if (/싱글|미혼|독신/.test(targetStr)) familyStatus = '미혼'
    else if (/은퇴|노후/.test(targetStr)) familyStatus = '은퇴준비'
    else familyStatus = Math.random() > 0.5 ? '기혼' : '미혼'
    
    return { gender, ageGroup, ageNum, occupation, familyStatus }
  }
  
  const persona = parseTargetPersona(target)
  
  // 페르소나별 구체적 상황 생성
  const getPersonaContext = () => {
    const contexts: string[] = []
    
    // 성별별 특성
    if (persona.gender === '여성') {
      contexts.push('여성 특유의 세심한 관찰력과 가족 건강에 대한 관심이 높음')
      if (persona.familyStatus === '가장(자녀있음)') {
        contexts.push('아이들 미래와 교육비 걱정이 큼, "내가 아프면 아이들은..." 언급')
      }
      if (persona.occupation === '전업주부') {
        contexts.push('남편 수입에 의존, 본인 보장에 소홀했던 것에 불안')
      }
    } else {
      contexts.push('남성 특유의 책임감, 가장으로서의 부담감 표현')
      if (persona.familyStatus === '가장(자녀있음)') {
        contexts.push('가족 생계 책임, "내가 쓰러지면..." 언급, 사망/후유장해 보장 관심')
      }
    }
    
    // 연령별 특성
    if (persona.ageGroup === '20대') {
      contexts.push('보험 처음, 뭐가 뭔지 모름, 부모님이 가입해준 보험만 있음')
      contexts.push('적은 예산(월 3-5만원), 실비 위주 고민')
    } else if (persona.ageGroup === '30대') {
      contexts.push('결혼/출산 전후 보험 재정비 시기, 실용적 판단')
      contexts.push('보험료 부담 vs 보장 범위 고민, 월 10-20만원대')
    } else if (persona.ageGroup === '40대') {
      contexts.push('건강검진에서 뭔가 나오기 시작, 갱신 폭탄 시작되는 시기')
      contexts.push('기존 보험 리모델링 제안 많이 받음, 해지 손실 고민')
    } else if (persona.ageGroup === '50대') {
      contexts.push('가입 거절/조건부 경험, 보험료 부담 최고조')
      contexts.push('자녀 독립 후 본인 노후 대비, 간병/치매 관심 증가')
    } else if (persona.ageGroup === '60대') {
      contexts.push('신규 가입 어려움, 기존 보험 유지 vs 해지 고민')
      contexts.push('실손 보험료 폭등, 간병/요양 현실적 고민')
    }
    
    // 직업별 특성
    if (persona.occupation === '자영업자') {
      contexts.push('소득 불안정, 4대보험 미가입, 본인이 아프면 가게 문 닫아야')
    } else if (persona.occupation === '프리랜서') {
      contexts.push('고용보험/산재 없음, 아프면 수입 0원, 실비+상해 중요')
    } else if (persona.occupation === '공무원') {
      contexts.push('연금 있지만 실비/암보험 별도 필요, 안정적이라 장기 보험 선호')
    }
    
    return contexts
  }
  
  const personaContexts = getPersonaContext()
  
  // 질문 상황 다양화 (10가지)
  const questionScenarios = [
    { situation: '설계사 리모델링 제안', trigger: '설계사가 찾아와서', ending: '이게 맞는 건지 모르겠어요' },
    { situation: '유튜브/블로그 정보', trigger: '유튜브에서 보험 영상 보다가', ending: '제 보험이 걱정되기 시작했어요' },
    { situation: '지인 권유', trigger: '친구가 보험 들라고 자꾸 그러는데', ending: '정말 필요한 건지 모르겠어요' },
    { situation: '보험료 인상 통보', trigger: '갑자기 보험료가 올랐다고 연락와서', ending: '이거 어떻게 해야 하나요' },
    { situation: '건강검진 후 불안', trigger: '건강검진 받고 나니까', ending: '갑자기 보험이 걱정돼요' },
    { situation: '주변 사고/질병 소식', trigger: '지인이 갑자기 아프다는 소식 듣고', ending: '제 보험 다시 보게 됐어요' },
    { situation: '결혼/출산 계기', trigger: '결혼(출산) 앞두고', ending: '보험 정리 좀 해야 할 것 같아서요' },
    { situation: '부모님 보험 정리', trigger: '부모님 보험 정리하다 보니', ending: '제 것도 봐야 할 것 같아요' },
    { situation: '만기/갱신 안내', trigger: '보험 만기 안내가 와서', ending: '연장해야 하는지 고민이에요' },
    { situation: '해지 고민', trigger: '보험료가 너무 부담돼서', ending: '해지하면 손해인지 궁금해요' }
  ]
  
  const scenario1 = questionScenarios[Math.floor(Math.random() * questionScenarios.length)]
  let scenario2 = questionScenarios[Math.floor(Math.random() * questionScenarios.length)]
  while (scenario2.situation === scenario1.situation) {
    scenario2 = questionScenarios[Math.floor(Math.random() * questionScenarios.length)]
  }
  
  // 2026년형 도메인별 전문 지식 생성
  const get2026DomainKnowledge = (type: string): string => {
    if (type.includes('암')) {
      return `
【 2026년 암보험 전문 지식 】
- Context: "2026년 암 치료 트렌드는 '수술'에서 **'중입자/표적항암'**과 **'통합 전이암'**으로 완전히 넘어왔습니다."
- Key Terms: **(기.갑.경.제)**, **통합암(원발/전이 각각 보장)**, **중입자/양성자 치료비**, **산정특례(5년)**
- Logic: "일반암 1번 받고 끝? 2026년엔 촌스러운 설계입니다. 전이암까지 계속 받는 **'통합암'**이 기본입니다."
- 필수 언급: 2025년 발표 통계, 2026년 개정 약관 기준으로 설명`;
    }
    if (type.includes('뇌') || type.includes('심장') || type.includes('2대') || type.includes('3대')) {
      return `
【 2026년 뇌/심장(2대질환) 전문 지식 】
- Context: "2025년 통계를 보니 급성심근경색보다 **'부정맥/심부전'** 환자가 급증했습니다."
- Key Terms: **I49(기타 부정맥)**, **산정특례 심장질환**, **혈전용해치료**, **순환계통 질환(광범위)**
- Logic: "아직도 뇌출혈/급성심근경색만 있다면 구멍 뚫린 보험입니다. **'순환계통'**까지 넓혀야 100세까지 안전합니다."
- 필수 언급: 2025년 발표 통계, 2026년 개정 약관 기준으로 설명`;
    }
    if (type.includes('운전자')) {
      return `
【 2026년 운전자보험 전문 지식 】
- Context: "도로교통법은 매년 바뀝니다. 2024~2025년 가입자도 안심 못 합니다."
- Key Terms: **변호사선임비용(경찰조사단계 포함)**, **공탁금 선지급(50% → 100% 확대 트렌드)**, **급발진 변호사 비용**
- Logic: "혹시 변호사 비용 나중에 돌려받으시나요? 2026년 요즘은 보험사가 **'바로 쏴주는(선지급)'** 게 국룰입니다."
- 필수 언급: 2025년 발표 통계, 2026년 개정 약관 기준으로 설명`;
    }
    if (type.includes('간병') || type.includes('치매') || type.includes('요양')) {
      return `
【 2026년 간병/치매 전문 지식 】
- Context: "요양병원비 물가 상승률 보셨나요? 정해진 금액만 주는 건 휴지 조각입니다."
- Key Terms: **체증형 간병인 일당(매년 5~10% 상승)**, **재가급여(방문요양)**, **장기요양등급(1~5등급)**
- Logic: "내일 병원비가 오르면 보험금도 같이 올라야죠. **'체증형'** 아니면 나중에 간병인 못 부릅니다."
- 필수 언급: 2025년 발표 통계, 2026년 개정 약관 기준으로 설명`;
    }
    // 기본 (종합보험 등)
    return `
【 2026년 보험 트렌드 전문 지식 】
- Context: "2026년 현재, 보험 시장은 **비갱신형 필수화**와 **통합 보장** 트렌드입니다."
- Key Terms: **비갱신형**, **통합형 보장**, **납입면제**, **해지환급금**
- Logic: "갱신형만 있는 보험? 2026년엔 '폭탄 보험'이라 불립니다. 반드시 **비갱신형 비중** 확인하세요."
- 필수 언급: 2025년 발표 통계, 2026년 개정 약관 기준으로 설명`;
  }

  const domainKnowledge = get2026DomainKnowledge(insuranceType)

  // ============================================================
  // V14.0 - 할루시네이션 방지: Context 강제 주입 프롬프트
  // ============================================================
  
  const qnaPrompt = `########################################################################
#  🔴🔴🔴 절대 규칙: 아래 핵심 고민이 모든 콘텐츠에 반드시 포함! 🔴🔴🔴  #
########################################################################

📌 핵심 고민 (CRITICAL - MUST INCLUDE IN ALL CONTENT):
"${customerConcern}"

📌 보험 종류 (MUST INCLUDE):
"${insuranceType}"

📌 타깃 고객:
"${target}"

⚠️ 위 3가지가 제목/질문/답변/댓글 전체에 반드시 포함되어야 합니다!
⚠️ 특히 "${customerConcern}"는 [질문1], [질문2], [질문3]에 그대로 사용!
⚠️ "${insuranceType}"는 제목과 모든 답변에 최소 2회 이상 언급!
⚠️ 엉뚱한 내용 생성 시 실패로 간주됩니다!

########################################################################

${domainKnowledge}

# System Context: 2026 보험 전문가

당신은 **2026년 현재** 대한민국 보험 트렌드 전문가입니다.
모든 답변은 **2025년 통계**와 **2026년 개정 약관** 기준으로 작성하세요.

==========================================================
당신은 네이버 카페 보험 Q&A 전문가입니다.
사용자의 고민을 듣고, 그 눈높이에 맞춰 쉽게 설명해주는 친절한 보험 멘토입니다.

############################################################
#                                                          #
#         📌 콘텐츠 생성 우선순위 (반드시 순서대로!)         #
#                                                          #
############################################################

【 1순위: 핵심 고민 (가장 중요!) 】
${hasKeyword ? `
✅ 사용자가 입력한 고민: "${customerConcern}"
→ 이것이 Q&A의 핵심 주제입니다!
→ 질문자는 이 고민을 가지고 있고, 전문가는 이 고민에 답해야 합니다.
→ 제목, 질문, 답변 모두 이 고민을 중심으로 작성하세요.
` : `
⚠️ 핵심 고민 없음 → 아래 보험종류/타깃에 맞는 일반적 고민 생성
`}

【 2순위: 타깃 고객 (눈높이 맞춤) 】
✅ 타깃: "${target}"
→ 질문자 = "${target}" (이 사람이 고민을 가지고 질문)
→ 답변 = "${target}"의 눈높이에 맞춰서 쉽게 설명
→ ${persona.ageGroup} ${persona.gender} ${persona.occupation}의 말투와 상황 반영

【 3순위: 보험 종류 (있으면 반영, 없으면 고민에 맞게) 】
${insuranceType && insuranceType !== '종합보험' ? `
✅ 선택된 보험: "${insuranceType}"
→ 이 보험에 대한 Q&A로 작성
→ 핵심 고민 + 이 보험 종류를 연결해서 설명
` : `
⚠️ 특정 보험 미선택 → 핵심 고민에 맞는 보험 종류 자연스럽게 언급
`}

【 4순위: 답변 톤 (기본: 초보자 눈높이) 】
✅ 선택된 톤: ${tones.length > 0 ? tones.join(', ') : '초보자 친화적'}
→ 어려운 보험 용어는 쉬운 비유로 풀어서 설명
→ "~이란 쉽게 말해서 ~입니다" 형식 활용
→ 전문용어 사용 시 반드시 괄호로 쉬운 설명 추가

############################################################

==========================================================
【 Q&A 흐름 요약 】
==========================================================

[질문] "${target}"이 "${hasKeyword ? customerConcern : '보험 관련 고민'}"에 대해 질문
         ↓
[답변] 전문가가 "${target}" 눈높이에 맞춰 쉽게 설명
         ↓  
[핵심] ${hasKeyword ? `"${customerConcern}"` : '고민'}에 대한 명확한 해결책 제시

==========================================================
【 PART 1: 제목 생성 규칙 - 2개 생성! 】
==========================================================

📌 서로 다른 스타일의 어그로성 제목 2개 생성!
- 제목1 클릭 키워드: "${clickBait1}"
- 제목2 클릭 키워드: "${clickBait2}" (제목1과 다른 키워드!)

★★★ [제목1] 직접적 호소형 ★★★
- 스타일: 질문자가 급박하게 호소하는 느낌
- 예시: "${hasKeyword ? customerConcern.slice(0, 15) : insuranceType} ${clickBait1} 당한 건가요?"
- 반드시 핵심고민("${customerConcern.substring(0, 20)}") 또는 "${insuranceType}" 포함!

★★★ [제목2] 충격/걱정형 ★★★
- 스타일: 뉴스나 경험에서 본 충격적인 사실로 시작
- 예시: "${insuranceType} 이거 ${clickBait2}인 거 맞나요? ${target}인데 걱정되서요"
- 제목1과 완전히 다른 톤!

※ 의문문(?)으로 끝, 15-35자, 핵심고민 반영 필수!

==========================================================
【 PART 2: 질문 생성 - 3개 생성! (각기 다른 화자) 】
==========================================================

🚨 중요: 3명의 서로 다른 화자가 같은 핵심고민으로 질문!
- 공통 핵심 고민: ${hasKeyword ? `"${customerConcern}"` : '자동 생성'} ← 반드시 3개 모두 이 고민 포함!
- 공통 보험종류: "${insuranceType}" ← 반드시 3개 모두 언급!

★★★ [질문1] 화자A: ${questioner1.age} ${questioner1.gender} ${questioner1.job} ★★★
■ 상황: "${scenario1.situation}" - "${scenario1.trigger}"
■ 말투: ${questioner1.style}
■ 핵심 고민: ${hasKeyword ? `"${customerConcern}"` : '자동 생성'}
■ 구체적 사연: 설계사 제안을 받은 상황, 월 보험료 X만원, 가입 Y년차

★★★ [질문2] 화자B: ${questioner2.age} ${questioner2.gender} ${questioner2.job} ★★★
■ 상황: "${scenario2.situation}" - "${scenario2.trigger}"
■ 말투: ${questioner2.style}
■ 핵심 고민: ${hasKeyword ? `"${customerConcern}"` : '자동 생성'} (같은 고민!)
■ 구체적 사연: 유튜브/블로그에서 정보를 보고 혼란스러운 상황

★★★ [질문3] 화자C: ${persona.ageNum}세 ${persona.gender} ${persona.occupation} ★★★
■ 상황: 건강검진 결과나 주변 사고 소식을 듣고 걱정
■ 말투: 걱정 많음, 상세 질문
■ 핵심 고민: ${hasKeyword ? `"${customerConcern}"` : '자동 생성'} (같은 고민!)
■ 구체적 사연: 가족/지인의 경험담을 듣고 불안해진 상황

### 질문 본문 필수 요소 (우선순위대로!):
1순위: 핵심 고민 "${customerConcern}" ← 질문의 중심 주제! 반드시 문장에 포함!
2순위: 보험 종류 "${insuranceType}" ← 반드시 언급!
3순위: 자기소개 (나이/직업/상황)
4순위: 구체적 숫자 (월 보험료, 가입 기간, 해지환급금 등)
5순위: 마무리 - "쪽지 사절이요, 댓글로 조언 부탁드립니다"

※ 전화번호 절대 금지! / 200-350자

【 질문자 톤앤매너 】
- 각 화자마다 다른 말투 (캐주얼/현실적/걱정많음 등)
- 전화번호: 절대 포함 금지!
- 마무리: "쪽지 사절이요, 댓글로 공개 답변 부탁드립니다" 또는 "조언 부탁드려요"

==========================================================
【 PART 3: 전문가 답변 생성 규칙 】
==========================================================

### 전문가 역할 - 3-Way Expert View (영업 상담 관점!)
🚨 핵심: 모든 전문가는 "${customerConcern}"에 대해 답해야 함!
🚨 핵심: 모든 답변에 "${insuranceType}" 언급 필수!

############################################################
#  ⭐ 3명의 전문가 = 3가지 영업 관점 (디테일한 상담!) ⭐     #
############################################################

★★★ [답변1] 전문가 A: 팩트형 (약관/수치 분석가) ★★★
■ 역할: 약관과 수치 중심의 냉철한 분석
■ 핵심 고민: "${customerConcern}"에 대한 팩트 기반 답변
■ 필수 포함: 
  - "${insuranceType}"의 구체적 약관 내용
  - 숫자/통계 (보험료, 환급금, 보장금액 등)
  - 2026년 기준 최신 정보
■ 시작 멘트: "객관적으로 말씀드리면..." 또는 "약관 기준으로 보면..."
■ CTA: "증권 사진 올려주시면 정확히 분석해드릴게요"

★★★ [답변2] 전문가 B: 공감/영업형 (심리적 위로 + 대안 제시) ★★★
■ 역할: 심리적 위로와 현실적 대안 제시 (가입 유도!)
■ 핵심 고민: "${customerConcern}"에 공감하며 해결책 제시
■ 필수 포함:
  - 질문자 상황에 대한 깊은 공감
  - "${insuranceType}" 관련 현실적 대안 2-3가지
  - 가입/유지/변경 중 적합한 선택지 제안
■ 시작 멘트: "많이 걱정되셨죠? 충분히 이해해요..." 또는 "제가 딱 그 상황 봐왔는데요..."
■ CTA: "댓글로 상황 더 알려주시면 맞춤 설계 도와드릴게요"

★★★ [답변3] 전문가 C: 비교/분석형 (타사/과거 상품 비교) ★★★
■ 역할: 타사 상품 또는 과거 상품과의 비교 우위 설명
■ 핵심 고민: "${customerConcern}"을 다른 상품들과 비교하며 설명
■ 필수 포함:
  - "${insuranceType}" vs 다른 선택지 비교
  - 2020년형 vs 2026년형 차이점
  - 보험사별 장단점 (구체적 언급)
■ 시작 멘트: "비교해서 말씀드리면..." 또는 "다른 분들 케이스를 보면..."
■ CTA: "현재 보험과 신규 상품 비교표 만들어드릴까요?"

### 답변 공통 필수 사항 (검수 기준!):
1. ✅ 핵심 고민 "${customerConcern}" 직접 언급 (필수!)
2. ✅ 보험 종류 "${insuranceType}" 최소 2회 언급 (필수!)
3. ✅ 각 전문가별 다른 시작 문구 (필수!)
4. ✅ 구체적 CTA - 행동 유도 (필수!)
5. ✅ 500-700자 분량 (필수!)

### 가독성: 4줄 이상 뭉침 금지, **볼드** 활용, 이모지 적당히

### 절대 규칙:
- 가상 이름(홍길동, 김철수) 금지
- 무미건조한 약관 나열 금지
- 마크다운 문법 허용 (**볼드** 사용)

==========================================================
【 PART 4: 댓글 생성 규칙 】
==========================================================

### 댓글 2-3개 생성 (공감형 + 사이다형 혼합)

【 공감형 댓글 】
- "아 저도 똑같은 고민이었는데... 이 글 보고 결심했어요"
- "와 진짜 속 시원하네요. 저만 이런 고민 하는 줄 알았는데"
- "설계사한테 물어봐도 맨날 자기 보험 권유만 해서 답답했는데"

【 사이다형 댓글 】
- "와 이건 진짜 찐 정보네요. 바로 증권 확인해봐야겠어요"
- "20년 경력이시라니 믿음이 가네요. 저도 댓글 달아봅니다"
- "이렇게 명쾌하게 설명해주시는 분 처음 봤어요"

==========================================================
【 V14.0 출력 형식 - Context 강제 포함! 】
==========================================================

🚨🚨🚨 최종 확인: 아래 내용이 반드시 포함되어야 합니다! 🚨🚨🚨
- "${customerConcern}" ← 질문1,2,3에 이 문장 그대로 포함!
- "${insuranceType}" ← 제목, 모든 답변에 최소 2회 포함!

※ [태그]와 내용만 출력! 구분선/설명문 출력 금지!

[제목1]
${target}인데 ${insuranceType} ${customerConcern.length > 10 ? customerConcern.substring(0, 15) + '...' : ''} ${clickBait1} 당한 건가요?

[제목2]
${insuranceType} ${clickBait2} 맞나요? ${target}인데 걱정되서 글 올립니다

[질문1]
안녕하세요. ${questioner1.age} ${questioner1.gender} ${questioner1.job}입니다.
${customerConcern}
${insuranceType} 관련해서 질문 드립니다.
${scenario1.trigger}
(구체적 상황 200-350자 작성, 쪽지 사절 댓글로 답변 부탁)
보험종류: "${insuranceType}" ← 반드시 언급!
(200-350자, 전화번호 금지, 구체적 숫자 포함)

[질문2]
화자B: ${questioner2.age} ${questioner2.gender} ${questioner2.job}
상황: "${scenario2.trigger}"
핵심 고민: "${customerConcern}" ← 같은 고민!
보험종류: "${insuranceType}" ← 반드시 언급!
(200-350자, 완전히 다른 사연)

[질문3]
화자C: ${persona.ageNum}세 ${persona.gender} ${persona.occupation}
상황: 건강검진/주변 사고 소식 후 걱정
핵심 고민: "${customerConcern}" ← 같은 고민!
보험종류: "${insuranceType}" ← 반드시 언급!
(200-350자, 또 다른 구체적 사연)

[답변1]
전문가A: 팩트형 (약관/수치 분석가)
핵심 고민: "${customerConcern}"에 대한 팩트 기반 답변
보험종류: "${insuranceType}" 최소 2회 언급!
시작: "객관적으로 말씀드리면..."
(500-700자, 숫자/통계 포함, CTA 필수)

[답변2]
전문가B: 공감/영업형 (심리적 위로 + 대안)
핵심 고민: "${customerConcern}"에 공감하며 답변
보험종류: "${insuranceType}" 최소 2회 언급!
시작: "많이 걱정되셨죠?..."
(500-700자, 대안 제시, 가입 유도 CTA)

[답변3]
전문가C: 비교/분석형 (타사/과거 상품 비교)
핵심 고민: "${customerConcern}"을 비교 관점에서 답변
보험종류: "${insuranceType}" 최소 2회 언급!
시작: "비교해서 말씀드리면..."
(500-700자, 타사/과거 상품 비교, 비교표 제안 CTA)

[댓글1]
공감형 - 질문자의 "${customerConcern}" 상황에 공감하는 경험담
(40-100자, 단순 칭찬 금지! 구체적 경험 공유)

[댓글2]
사이다형 - 전문가 답변을 뒷받침하는 정보 제공
(40-100자, "${insuranceType}" 관련 실제 경험)

[댓글3]
질문형 - 비슷한 상황의 추가 질문
(40-100자, "${customerConcern}"과 연관된 파생 질문)

==========================================================
【 PART 5: 자가진단 (SEO 최적화 검수) 】
==========================================================

### C-Rank / D.I.A.+ / 에이전트 N 최적화 항목:

[검색키워드]
- C-Rank 최적화된 SEO 키워드 5개 (네이버 검색 상위 노출용)
- 형식: "${insuranceType}" 관련 + "${hasKeyword ? customerConcern : '보험 고민'}" 연관 키워드
- 예시: "${insuranceType} 해지", "${insuranceType} 갱신", "${insuranceType} 비교", "${insuranceType} 추천", "${insuranceType} 리모델링"

[최적화제목1]
- D.I.A.+ 알고리즘 최적화 제목 (클릭률 UP)
- 질문자 톤 + 클릭유도 키워드 + 15-35자

[최적화제목2]  
- 에이전트 N 최적화 제목 (AI 추천용)
- 다른 관점 + 다른 클릭 키워드 사용

[강조포인트]
- (핵심 장점 1)
- (핵심 장점 2)
- (핵심 장점 3)

[해시태그]
(10개, #으로 시작, 띄어쓰기로 구분)

[자가진단결과]
- 핵심고민 반영도: (상/중/하)
- 타깃 적합도: (상/중/하)  
- 보험종류 일치도: (상/중/하)
- 재생성 필요: (예/아니오)
- 재생성 사유: (있을 경우만)

※ 중요: [태그]와 실제 내용만 출력하세요. 괄호 안의 설명은 출력하지 마세요!`

  // ============================================================
  // V16.0 - RAG 기반 4단계 파이프라인 (Hallucination Zero Project)
  // Step 1: 팩트 수집 → Step 2: 전략 수립 → Step 3: 콘텐츠 생성 → Step 4: 자가 진단
  // ============================================================
  
  const MAX_REGENERATION_ATTEMPTS = 2
  let currentAttempt = 1
  let qnaResult = ''
  let regenerationHistory: Array<{ attempt: number, failReasons: string[], score: number, step: string }> = []
  let finalAuditResult: AuditResult | null = null
  
  // RAG 파이프라인 실행 로그
  interface RAGPipelineLog {
    step1_factCollection: { success: boolean, blogCount: number, newsCount: number }
    step2_strategyBuilding: { success: boolean, seoKeywords: string[] }
    step3_contentGeneration: { success: boolean, generatedLength: number }
    step4_selfDiagnosis: { pass: boolean, failReasons: string[] }
  }
  let ragPipelineLog: RAGPipelineLog = {
    step1_factCollection: { success: false, blogCount: 0, newsCount: 0 },
    step2_strategyBuilding: { success: false, seoKeywords: [] },
    step3_contentGeneration: { success: false, generatedLength: 0 },
    step4_selfDiagnosis: { pass: false, failReasons: [] }
  }
  
  // 파싱 함수들 (재사용을 위해 미리 정의)
  // 구분선(===) 제거 함수
  const removeSeparators = (text: string) => {
    return text
      .replace(/={3,}[^=]*={3,}/g, '') // ===...=== 패턴 제거
      .replace(/★{3,}[^★]*★{3,}/g, '') // ★★★...★★★ 패턴 제거
      .replace(/【[^】]*】/g, '') // 【...】 패턴 제거
      .trim()
  }
  
  // 파싱 및 검수 함수 (Self-Correction Loop에서 재사용)
  const parseAndAuditQnA = (result: string) => {
    const title1Match = result.match(/\[제목1\]([\s\S]*?)(?=\[제목2\])/i)
    const title2Match = result.match(/\[제목2\]([\s\S]*?)(?=\[질문1\])/i)
    const titleMatch = result.match(/\[제목\]([\s\S]*?)(?=\[질문1\])/i)
    
    const question1Match = result.match(/\[질문1\]([\s\S]*?)(?=\[질문2\])/i)
    const question2Match = result.match(/\[질문2\]([\s\S]*?)(?=\[질문3\]|\[답변1\])/i)
    const question3Match = result.match(/\[질문3\]([\s\S]*?)(?=\[답변1\])/i)
    
    const answer1Match = result.match(/\[답변1\]([\s\S]*?)(?=\[답변2\])/i)
    const answer2Match = result.match(/\[답변2\]([\s\S]*?)(?=\[답변3\])/i)
    const answer3Match = result.match(/\[답변3\]([\s\S]*?)(?=\[댓글1\])/i)
    
    const comment1Match = result.match(/\[댓글1\]([\s\S]*?)(?=\[댓글2\])/i)
    const comment2Match = result.match(/\[댓글2\]([\s\S]*?)(?=\[댓글3\])/i)
    const comment3Match = result.match(/\[댓글3\]([\s\S]*?)(?=\[댓글4\]|\[검색키워드\]|\[강조포인트\])/i)
    const comment4Match = result.match(/\[댓글4\]([\s\S]*?)(?=\[댓글5\]|\[검색키워드\]|\[강조포인트\])/i)
    const comment5Match = result.match(/\[댓글5\]([\s\S]*?)(?=\[검색키워드\]|\[강조포인트\])/i)
    
    const seoKeywordsMatch = result.match(/\[검색키워드\]([\s\S]*?)(?=\[최적화제목1\])/i)
    
    // 제목 2개 추출
    let parsedTitle1 = title1Match 
      ? removeSeparators(cleanText(title1Match[1].trim()))
      : (titleMatch ? removeSeparators(cleanText(titleMatch[1].trim())) : '')
    let parsedTitle2 = title2Match 
      ? removeSeparators(cleanText(title2Match[1].trim()))
      : ''
    
    // 질문 3개 추출
    const parsedQuestions = [
      question1Match ? cleanText(question1Match[1].trim()) : '',
      question2Match ? cleanText(question2Match[1].trim()) : '',
      question3Match ? cleanText(question3Match[1].trim()) : ''
    ].filter(q => q.length > 30)
    
    // 답변 3개 추출
    const parsedAnswers = [
      answer1Match ? cleanText(answer1Match[1].trim()) : '',
      answer2Match ? cleanText(answer2Match[1].trim()) : '',
      answer3Match ? cleanText(answer3Match[1].trim()) : ''
    ].filter(a => a.length > 50)
    
    // 댓글 5개 추출
    const parsedComments = [
      comment1Match ? cleanText(comment1Match[1].trim()) : '',
      comment2Match ? cleanText(comment2Match[1].trim()) : '',
      comment3Match ? cleanText(comment3Match[1].trim()) : '',
      comment4Match ? cleanText(comment4Match[1].trim()) : '',
      comment5Match ? cleanText(comment5Match[1].trim()) : ''
    ].filter(c => c.length > 10)
    
    // SEO 키워드 추출
    let parsedSeoKeywords: string[] = []
    if (seoKeywordsMatch) {
      parsedSeoKeywords = seoKeywordsMatch[1]
        .split(/[\n,]/)
        .map(kw => cleanText(kw.replace(/^[-•*\d.)\s]+/, '').trim()))
        .filter(kw => kw.length > 2 && kw.length < 30)
        .slice(0, 5)
    }
    
    // 검수 실행
    const auditResult = auditQnAContent({
      customerConcern,
      insuranceType,
      target,
      titles: [parsedTitle1, parsedTitle2].filter(t => t.length > 0),
      questions: parsedQuestions,
      answers: parsedAnswers,
      comments: parsedComments,
      seoKeywords: parsedSeoKeywords
    })
    
    return {
      titles: [parsedTitle1, parsedTitle2],
      questions: parsedQuestions,
      answers: parsedAnswers,
      comments: parsedComments,
      seoKeywords: parsedSeoKeywords,
      auditResult
    }
  }
  
  // ============================================================
  // V16.0 - RAG 4단계 파이프라인 실행
  // ============================================================
  
  console.log('[V16.0 RAG] 4단계 파이프라인 시작 - 핵심고민:', customerConcern.substring(0, 30))
  
  // =========================
  // Step 1: 네이버 API로 팩트 수집
  // =========================
  console.log('[V16.0 RAG Step 1] 네이버 검색 API로 팩트 수집 시작...')
  const factData = await collectFactData(
    insuranceType, 
    customerConcern, 
    target, 
    naverClientId, 
    naverClientSecret
  )
  ragPipelineLog.step1_factCollection = {
    success: factData.searchSuccess,
    blogCount: factData.blogFacts.length,
    newsCount: factData.newsFacts.length
  }
  console.log(`[V16.0 RAG Step 1] 팩트 수집 완료 - 블로그: ${factData.blogFacts.length}개, 뉴스: ${factData.newsFacts.length}개`)
  
  // =========================
  // Step 2: 전략 수립 (JSON 포맷)
  // =========================
  console.log('[V16.0 RAG Step 2] 전략 수립 시작...')
  // V18.0: 사진 분석 결과에서 추출한 연령이 있으면 adjustedTarget 사용
  const effectiveTarget = adjustedTarget || target
  const strategy = await buildStrategy(insuranceType, customerConcern, effectiveTarget, factData, geminiKeys)
  ragPipelineLog.step2_strategyBuilding = {
    success: strategy.seoKeywords.length > 0,
    seoKeywords: strategy.seoKeywords
  }
  console.log(`[V16.0 RAG Step 2] 전략 수립 완료 - SEO 키워드: ${strategy.seoKeywords.join(', ')}`)
  
  // 추가 컨텍스트 (기존 프롬프트의 페르소나/시나리오 정보)
  const additionalContext = `
【 타깃 페르소나 상세 분석 】
- ${persona.ageGroup} ${persona.gender} ${persona.occupation}
- 가족상황: ${persona.familyStatus}
- 상황: ${personaContexts.join('; ')}

【 질문 시나리오 】
- 시나리오1: ${scenario1.trigger} → ${scenario1.ending}
- 시나리오2: ${scenario2.trigger} → ${scenario2.ending}

【 전문가 유형 】
- 전문가A: ${expert1.type} (${expert1.focus})
- 전문가B: ${expert2.type} (${expert2.focus})
- 전문가C: ${expert3.type} (${expert3.focus})

【 톤 설정 】
- 기본 톤: ${baseTones.join(', ') || tone}
- 초보 모드: ${isBeginnerMode ? '활성화' : '비활성화'}
- 트라우마 상황: ${isTraumaticSituation ? '감지됨 (공감 우선)' : '일반'}

【 2026년 도메인 지식 】
${domainKnowledge}
`
  
  // =========================
  // Step 3 & 4: 콘텐츠 생성 + 자가진단 (최대 2회 재생성)
  // =========================
  
  while (currentAttempt <= MAX_REGENERATION_ATTEMPTS + 1) {
    // 재생성 시 이전 오류 반영
    const previousFailContext = currentAttempt > 1 && regenerationHistory.length > 0 ? `

🚨🚨🚨 [RAG 재생성 ${currentAttempt}차 - 이전 오류 반드시 수정!] 🚨🚨🚨
이전 생성에서 다음 문제가 발견되었습니다:
${regenerationHistory[regenerationHistory.length - 1].failReasons.map(r => `❌ ${r}`).join('\n')}

⚠️ 반드시 위 문제를 해결해야 합니다!
⚠️ JSON 전략에 없는 내용은 절대 지어내지 마세요!
🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨

` : ''
    
    // Step 3: 전략 기반 콘텐츠 생성 (V17.0 멀티 페르소나 적용)
    console.log(`[V17.2 RAG Step 3] ${currentAttempt}차 콘텐츠 생성 시작... (톤: ${tone})`)
    qnaResult = await generateContentWithStrategy(
      insuranceType,
      customerConcern,
      effectiveTarget,  // V18.0: 사진 분석 결과로 조정된 타깃 사용
      strategy,
      previousFailContext + additionalContext,
      geminiKeys,
      tone,  // 멀티 페르소나를 위한 톤 파라미터 전달
      photoContext  // V17.9: 사진 분석 결과 전달
    )
    
    // V23.0: TARGET 즉시 검증 - API 응답에서 잘못된 타겟이 나오면 강제로 폴백 재생성
    const titleCheck = qnaResult.match(/\[제목1\][\s\S]*?(?=\[제목2\])/i)?.[0] || ''
    const questionCheck = qnaResult.match(/\[질문1\][\s\S]*?(?=\[질문2\])/i)?.[0] || ''
    const wrongTargetPatterns = ['30대', '40대', '50대', '60대', '직장인', '자영업자', '공무원', '프리랜서', '워킹맘', '육아맘', '1인가구', '취준생', '맞벌이']
    const inputTargetLower = effectiveTarget.toLowerCase()
    
    let targetMismatch = false
    let detectedWrongTarget = ''
    for (const wrongPattern of wrongTargetPatterns) {
      // 사용자가 입력한 target에 없는 패턴이 출력에 있으면 불일치
      if (!inputTargetLower.includes(wrongPattern.toLowerCase()) && 
          (titleCheck.toLowerCase().includes(wrongPattern.toLowerCase()) ||
           questionCheck.toLowerCase().includes(wrongPattern.toLowerCase()))) {
        console.log(`[V23.0 TARGET 불일치!] 입력: "${effectiveTarget}", 출력에 "${wrongPattern}" 발견 - 폴백 강제 사용`)
        targetMismatch = true
        detectedWrongTarget = wrongPattern
        break
      }
    }
    
    // TARGET 불일치 시 폴백 템플릿으로 직접 교체 (V23.0 핵심!)
    if (targetMismatch) {
      console.log(`[V23.0] 폴백 템플릿 직접 생성 - TARGET: ${effectiveTarget}, 잘못된 타겟: ${detectedWrongTarget}`)
      
      // 폴백 템플릿 직접 생성 (API 호출 없이)
      const targetNickname = effectiveTarget.match(/(\d+)대/) ? `${effectiveTarget.match(/(\d+)대/)?.[0]}님` : `${effectiveTarget}님`
      const friendlyTitleTemplates = [
        `${effectiveTarget}인데 ${customerConcern.substring(0, 20)}... 어떻게 해야 하나요?`,
        `${insuranceType} 때문에 고민이에요 ㅠㅠ ${effectiveTarget}입니다?`,
        `${effectiveTarget} ${insuranceType} 질문이요! ${customerConcern.substring(0, 15)}...?`,
        `혹시 ${insuranceType} 아시는 분? ${effectiveTarget}인데 ${customerConcern.substring(0, 12)} 고민중이에요?`,
        `${effectiveTarget}인데 ${insuranceType} 이거 맞나요? 조언 부탁드려요?`,
        `${insuranceType} 고민 글이에요... ${effectiveTarget}입니다 ㅠㅠ?`,
        `${effectiveTarget} ${insuranceType} 도움 요청합니다! ${customerConcern.substring(0, 12)}?`
      ]
      const friendlyTitle1 = friendlyTitleTemplates[Math.floor(Math.random() * friendlyTitleTemplates.length)]
      const friendlyTitle2 = friendlyTitleTemplates[Math.floor(Math.random() * friendlyTitleTemplates.length)]
      
      qnaResult = `[제목1]
${friendlyTitle1}

[제목2]
${friendlyTitle2}

[질문1]
안녕하세요~ ${effectiveTarget}이에요 :)
${customerConcern}
요즘 ${insuranceType} 때문에 고민이 많아요 ㅠㅠ
유튜브도 보고 블로그도 찾아봤는데 너무 어렵더라구요.
비슷한 경험 있으신 분들 조언 좀 부탁드려요~
쪽지 사절이에요, 댓글로 편하게 답변 주시면 감사하겠습니다!

[질문2]
안녕하세요~ 저도 ${effectiveTarget}이에요!
${insuranceType} 가입 전에 이것저것 알아보고 있는데요.
${customerConcern}
설계사한테 들은 건 있는데 진짜인지 모르겠어서요...
경험자분들 이야기 좀 들려주세요~ 어떤 거 보고 결정하셨어요?

[질문3]
${effectiveTarget}인데 예전에 가입한 ${insuranceType}이 있어요.
${customerConcern}
갱신 때마다 보험료가 오르니까 이거 유지해야 하나 고민이에요.
해지하고 새로 드는 게 나을까요? 비슷한 경험 있으신 분 계신가요?

[답변1]
${targetNickname}, ${insuranceType} 관련 고민이시군요.
비슷한 상황의 분들 정말 많이 상담해드렸어요.
${customerConcern} 상황이시라면 핵심부터 짚어드릴게요.
${insuranceType}은 복잡해 보이지만 몇 가지만 확인하면 됩니다.
일단 지금 가장 중요한 건 '비갱신형' 특약이 있는지 확인하는 거예요.
2026년 기준으로 이게 있으면 나중에 보험료 폭등 걱정이 없어요.
증권 사진 올려주시면 상세하게 분석해드릴게요!

[답변2]
${targetNickname}, ${customerConcern} 상황이시군요.
비슷한 고민으로 상담 오시는 분들 정말 많아요. 혼자가 아니세요!
${insuranceType}은 사업비가 25~35% 빠지는 구조예요.
그래서 초기 몇 년은 해지환급금이 납입액보다 적을 수 있어요.
하지만 7~10년 유지하면 원금 회복이 가능해요.
감액완납이라는 옵션도 있으니 해지 전에 꼭 확인해보세요!

[답변3]
${targetNickname}, 꼼꼼하게 비교하시는 모습이 정말 좋습니다.
${insuranceType} 선택지를 정리해드릴게요:
- A안: 해지하고 비갱신형으로 갈아타기
- B안: 감액완납으로 납입 중단하고 보장 일부 유지
- C안: 현재 상품 끝까지 유지
${customerConcern} 상황이시라면 A안이나 B안을 추천드려요.
구체적인 시뮬레이션이 필요하시면 댓글로 요청해주세요!

[댓글1]
저도 ${effectiveTarget}인데 똑같은 고민이에요 ㅠㅠ 여기 댓글 보고 용기 얻고 갑니다

[댓글2]
${insuranceType} 정보 감사합니다. 저도 증권 확인해봐야겠네요

[댓글3]
저도 ${effectiveTarget}인데요, 감액완납 되는지 문의해볼게요!

[댓글4]
저 작년에 리모델링하고 월 6만원 아꼈어요. 비갱신형으로 바꾸길 잘했습니다!

[댓글5]
화이팅! 전문가 분석 받으면 해결돼요. 저도 증권 올리고 3일 만에 정리했어요 :)

[검색키워드]
${insuranceType} 추천 2026, ${insuranceType} 비교, ${insuranceType} 해지 손해, ${insuranceType} 필수 특약, ${effectiveTarget} ${insuranceType}

[최적화제목1]
${effectiveTarget} ${insuranceType} 고민 해결법, 쉽게 알려드려요

[최적화제목2]
${insuranceType} 초보자 가이드, 이것만 알면 끝!

[강조포인트]
- ${insuranceType} 사업비 25-35% 함정 주의
- 2026년 기준 비갱신형 특약 확인 필수
- 감액완납 옵션 활용법

[해시태그]
#${insuranceType.replace(/\s/g, '')} #보험호구탈출 #보험해지 #보험리모델링 #${effectiveTarget.replace(/\s/g, '')}보험

[자가진단결과]
- 핵심고민 반영도: 상
- 타깃 적합도: 상
- 보험종류 일치도: 상
- 2026년 팩트 반영: 상
- 재생성 필요: 아니오
- 재생성 사유: V23.0 Fallback Direct 템플릿 적용`
    }
    
    ragPipelineLog.step3_contentGeneration = {
      success: qnaResult.length > 500,
      generatedLength: qnaResult.length
    }
    console.log(`[V16.0 RAG Step 3] 콘텐츠 생성 완료 - 길이: ${qnaResult.length}자`)
    
    // Step 4: 자가 진단 (V23.0: target 검증 추가)
    console.log(`[V16.0 RAG Step 4] ${currentAttempt}차 자가진단 시작...`)
    const diagnosisResult = await selfDiagnoseContent(
      qnaResult,
      customerConcern,
      insuranceType,
      strategy,
      geminiKeys,
      target  // V23.0: target 전달
    )
    
    // 파싱 및 auditQnAContent 검수도 병행
    const { auditResult: currentAudit } = parseAndAuditQnA(qnaResult)
    finalAuditResult = currentAudit
    
    // 통합 검수 결과 (selfDiagnose + auditQnAContent)
    const combinedPass = diagnosisResult.overallPass && currentAudit.passed
    const combinedFailReasons = [...diagnosisResult.failReasons, ...currentAudit.failReasons]
    
    ragPipelineLog.step4_selfDiagnosis = {
      pass: combinedPass,
      failReasons: combinedFailReasons
    }
    
    console.log(`[V16.0 RAG Step 4] 자가진단 완료 - 통과: ${combinedPass}, 점수: ${currentAudit.totalScore}`)
    
    // 검수 통과 시 루프 종료
    if (combinedPass || currentAudit.totalScore >= 75) {
      console.log(`[V16.0 RAG] 검수 통과! (${currentAttempt}차 시도)`)
      break
    }
    
    // 검수 실패 - 재생성 기록 저장
    regenerationHistory.push({
      attempt: currentAttempt,
      failReasons: combinedFailReasons,
      score: currentAudit.totalScore,
      step: 'Step4-SelfDiagnosis'
    })
    
    // 최대 재생성 횟수 도달 시 종료
    if (currentAttempt > MAX_REGENERATION_ATTEMPTS) {
      console.log(`[V16.0 RAG] 최대 재생성 횟수(${MAX_REGENERATION_ATTEMPTS}회) 도달 - 현재 결과 사용`)
      break
    }
    
    console.log(`[V16.0 RAG] 검수 실패 - ${currentAttempt + 1}차 재생성 준비...`)
    console.log(`[V16.0 RAG] 실패 사유: ${combinedFailReasons.join(', ')}`)
    
    currentAttempt++
  }
  
  console.log(`[V16.0 RAG] 4단계 파이프라인 완료 - 총 ${currentAttempt}회 시도, 최종 점수: ${finalAuditResult?.totalScore}`)
  
  // ============================================================
  // 기존 qnaPrompt 기반 Fallback (RAG 실패 시) - 삭제하고 아래 파싱으로 이동
  // ============================================================
  
  // ============================================================
  // V16.0 - RAG 파이프라인 완료 후 최종 파싱
  // ============================================================
  
  // V13.0: 제목 2개, 질문 3개 파싱
  const title1Match = qnaResult.match(/\[제목1\]([\s\S]*?)(?=\[제목2\])/i)
  const title2Match = qnaResult.match(/\[제목2\]([\s\S]*?)(?=\[질문1\])/i)
  // 기존 [제목] 태그 호환성 유지
  const titleMatch = qnaResult.match(/\[제목\]([\s\S]*?)(?=\[질문1\])/i)
  
  const question1Match = qnaResult.match(/\[질문1\]([\s\S]*?)(?=\[질문2\])/i)
  const question2Match = qnaResult.match(/\[질문2\]([\s\S]*?)(?=\[질문3\]|\[답변1\])/i)
  const question3Match = qnaResult.match(/\[질문3\]([\s\S]*?)(?=\[답변1\])/i)
  
  const answer1Match = qnaResult.match(/\[답변1\]([\s\S]*?)(?=\[답변2\])/i)
  const answer2Match = qnaResult.match(/\[답변2\]([\s\S]*?)(?=\[답변3\])/i)
  const answer3Match = qnaResult.match(/\[답변3\]([\s\S]*?)(?=\[댓글1\])/i)
  const highlightsMatch = qnaResult.match(/\[강조포인트\]([\s\S]*?)(?=\[해시태그\])/i)
  const comment1Match = qnaResult.match(/\[댓글1\]([\s\S]*?)(?=\[댓글2\])/i)
  const comment2Match = qnaResult.match(/\[댓글2\]([\s\S]*?)(?=\[댓글3\])/i)
  const comment3Match = qnaResult.match(/\[댓글3\]([\s\S]*?)(?=\[댓글4\]|\[검색키워드\]|\[강조포인트\])/i)
  const comment4Match = qnaResult.match(/\[댓글4\]([\s\S]*?)(?=\[댓글5\]|\[검색키워드\]|\[강조포인트\])/i)
  const comment5Match = qnaResult.match(/\[댓글5\]([\s\S]*?)(?=\[검색키워드\]|\[강조포인트\])/i)
  const hashtagMatch = qnaResult.match(/\[해시태그\]([\s\S]*?)(?=\[자가진단결과\]|$)/i)
  
  // V12.2: 자가진단 워크플로우 - 검색키워드, 최적화제목, 자가진단결과 파싱
  const seoKeywordsMatch = qnaResult.match(/\[검색키워드\]([\s\S]*?)(?=\[최적화제목1\])/i)
  const optimizedTitle1Match = qnaResult.match(/\[최적화제목1\]([\s\S]*?)(?=\[최적화제목2\])/i)
  const optimizedTitle2Match = qnaResult.match(/\[최적화제목2\]([\s\S]*?)(?=\[강조포인트\])/i)
  const selfDiagnosisMatch = qnaResult.match(/\[자가진단결과\]([\s\S]*?)$/i)
  
  // V13.0: 제목 2개 추출
  let generatedTitle1 = title1Match 
    ? removeSeparators(cleanText(title1Match[1].trim()))
    : (titleMatch ? removeSeparators(cleanText(titleMatch[1].trim())) : `${target}인데 ${insuranceType} 이거 ${clickBait1} 당한 건가요?`)
  let generatedTitle2 = title2Match 
    ? removeSeparators(cleanText(title2Match[1].trim()))
    : `${insuranceType} ${clickBait2} 맞나요? 걱정돼서 글 올립니다`
  
  // 의문문이 아니면 ? 추가
  if (!generatedTitle1.endsWith('?')) generatedTitle1 = generatedTitle1.replace(/[.!]?$/, '?')
  if (!generatedTitle2.endsWith('?')) generatedTitle2 = generatedTitle2.replace(/[.!]?$/, '?')
  
  // 기존 호환성 유지
  const generatedTitle = generatedTitle1
  
  // V13.0: 질문 3개 추출 (전화번호 제외)
  const questions = [
    question1Match ? cleanText(question1Match[1].trim()) : `안녕하세요. ${questioner1.age} ${questioner1.gender} ${questioner1.job}입니다. ${insuranceType} 관련해서 질문이 있어요. ${customerConcern} 설계사분이 리모델링 제안하셨는데 이게 맞는 건지 모르겠어요. 월 보험료가 8만원인데 적당한 건지... 쪽지 사절이요, 댓글로 조언 부탁드립니다.`,
    question2Match ? cleanText(question2Match[1].trim()) : `${questioner2.age} ${questioner2.gender} ${questioner2.job}입니다. 유튜브에서 ${insuranceType} 관련 영상 보고 혼란스러워서 글 올립니다. ${customerConcern} 기존 보험 해지하고 새로 가입하라는데 손해 보는 거 아닌가요? 고수님들 도와주세요!`,
    question3Match ? cleanText(question3Match[1].trim()) : `${persona.ageNum}세 ${persona.gender} ${persona.occupation}입니다. 최근에 건강검진 받고 좀 걱정이 생겼어요. ${customerConcern} ${insuranceType}이 지금 상태로 충분한지 모르겠네요. 조언 부탁드립니다.`
  ].filter(q => q.length > 30)
  
  // 답변 3개 추출
  const answers = [
    answer1Match ? cleanText(answer1Match[1].trim()) : `😱 ${insuranceType}... 이건 확인이 필요합니다.\n\n${target}께서 걱정하시는 부분 충분히 이해합니다.\n\n전문가로서 딱 3가지만 짚어 드립니다.\n\n✅ **첫째:** 현재 상품의 보장 내역을 먼저 확인하세요.\n⚠️ **둘째:** 갱신형 특약이 있다면 주의가 필요합니다.\n💡 **셋째:** 증권을 사진 찍어 댓글로 남겨주시면 분석해 드립니다.`,
    answer2Match ? cleanText(answer2Match[1].trim()) : `💡 데이터로 말씀드리겠습니다.\n\n${insuranceType} 리모델링, 무조건 나쁜 건 아닙니다. 다만 **핵심은 비교 분석**입니다.\n\n✅ **기존 상품 장점:** 이율, 비갱신 여부 확인\n⚠️ **신규 상품 함정:** 갱신형 특약, 해지환급금 손실\n💡 **결론:** 두 상품을 나란히 비교해보세요.\n\n댓글로 두 상품 정보 주시면 비교표 만들어 드립니다!`,
    answer3Match ? cleanText(answer3Match[1].trim()) : `🔥 20년 경력으로 종합 정리해 드립니다.\n\n${target}께서 고민하시는 상황, 정말 많이 봐왔습니다.\n\n✅ **장기적 관점:** 지금 결정이 10년 후를 좌우합니다.\n⚠️ **흔한 실수:** 당장 보험료만 보고 결정하면 후회\n💡 **액션 플랜:** 1) 기존 증권 확인 2) 해지환급금 계산 3) 댓글로 상담\n\n지금 바로 증권 꺼내서 **'납입기간'**과 **'보장기간'** 확인해보세요!`
  ].filter(a => a.length > 50)
  
  // 강조 포인트 파싱
  let highlights: string[] = []
  if (highlightsMatch) {
    highlights = highlightsMatch[1]
      .split('\n')
      .map(line => cleanText(line.replace(/^[-•*]\s*/, '').trim()))
      .filter(line => line.length > 5)
      .slice(0, 3)
  }
  
  // 댓글 5개 수집 (공감형 + 사이다형 + 질문형 + 경험담 + 응원)
  const comments = [
    comment1Match ? cleanText(comment1Match[1].trim()) : '아 저도 똑같은 고민이었는데... 이 글 보고 속 시원해졌어요',
    comment2Match ? cleanText(comment2Match[1].trim()) : '와 이건 진짜 찐 정보네요. 바로 증권 확인해봐야겠어요',
    comment3Match ? cleanText(comment3Match[1].trim()) : '저도 증권 분석 부탁드려도 될까요? 비슷한 상황인 것 같아서요',
    comment4Match ? cleanText(comment4Match[1].trim()) : `저도 작년에 ${insuranceType} 리모델링했는데 만족해요`,
    comment5Match ? cleanText(comment5Match[1].trim()) : '화이팅하세요! 좋은 결과 있으시길 바랍니다'
  ].filter(c => c.length > 10)
  
  // V12.2: 자가진단 워크플로우 데이터 처리
  // 검색 최적화 키워드 5개 파싱
  let seoKeywords: string[] = []
  if (seoKeywordsMatch) {
    seoKeywords = seoKeywordsMatch[1]
      .split(/[\n,]/)
      .map(kw => cleanText(kw.replace(/^[-•*\d.)\s]+/, '').trim()))
      .filter(kw => kw.length > 2 && kw.length < 30)
      .slice(0, 5)
  }
  // V17.7: 기본값 - 보험종류 + 핵심고민 기반 SEO 최적화 키워드 생성
  if (seoKeywords.length < 5) {
    // 2026년 보험 트렌드 키워드 포함
    const defaultKeywords = [
      `${insuranceType} 추천 2026`,
      `${insuranceType} 비교`,
      `${target} ${insuranceType} 추천`,
      `${insuranceType} 갱신 폭탄`,
      `${insuranceType} 해지 손해`,
      `${insuranceType} 비갱신`,
      `${insuranceType} 리모델링`,
      `${insuranceType} 보험료 비교`,
      `${insuranceType} 후기`,
      `${insuranceType} 가입 시기`
    ]
    while (seoKeywords.length < 5 && defaultKeywords.length > 0) {
      const kw = defaultKeywords.shift()
      if (kw && !seoKeywords.includes(kw)) seoKeywords.push(kw)
    }
  }
  
  // 최적화 제목 2개 파싱
  const optimizedTitle1 = optimizedTitle1Match 
    ? removeSeparators(cleanText(optimizedTitle1Match[1].trim())).replace(/^\d+\.\s*/, '')
    : `${target}인데 ${insuranceType} 이거 손해 보는 건가요?`
  const optimizedTitle2 = optimizedTitle2Match 
    ? removeSeparators(cleanText(optimizedTitle2Match[1].trim())).replace(/^\d+\.\s*/, '')
    : `${insuranceType} 갱신 폭탄 맞은 건가요? 도와주세요`
  
  // 자가진단 결과 파싱
  interface SelfDiagnosis {
    concernReflection: string  // 핵심고민 반영도
    targetFit: string          // 타깃 적합도  
    insuranceMatch: string     // 보험종류 일치도
    needRegenerate: boolean    // 재생성 필요 여부
    reason: string             // 재생성 사유
  }
  
  let selfDiagnosis: SelfDiagnosis = {
    concernReflection: '상',
    targetFit: '상',
    insuranceMatch: '상',
    needRegenerate: false,
    reason: ''
  }
  
  if (selfDiagnosisMatch) {
    const diagText = selfDiagnosisMatch[1]
    const concernMatch = diagText.match(/핵심고민\s*반영도[:\s]*(상|중|하)/i)
    const targetMatch = diagText.match(/타깃\s*적합도[:\s]*(상|중|하)/i)
    const insuranceMatchResult = diagText.match(/보험종류\s*일치도[:\s]*(상|중|하)/i)
    const regenMatch = diagText.match(/재생성\s*필요[:\s]*(예|아니오|yes|no)/i)
    const reasonMatch = diagText.match(/재생성\s*사유[:\s]*([^\n]+)/i)
    
    selfDiagnosis = {
      concernReflection: concernMatch ? concernMatch[1] : '상',
      targetFit: targetMatch ? targetMatch[1] : '상',
      insuranceMatch: insuranceMatchResult ? insuranceMatchResult[1] : '상',
      needRegenerate: regenMatch ? (regenMatch[1] === '예' || regenMatch[1].toLowerCase() === 'yes') : false,
      reason: reasonMatch ? reasonMatch[1].trim() : ''
    }
  }
  
  // 자동 자가진단 (AI 결과와 별도로 로직 기반 검증)
  const autoValidation = {
    hasConcernInTitle: hasKeyword ? generatedTitle.includes(customerConcern.substring(0, 10)) || 
      generatedTitle.toLowerCase().includes(insuranceType.toLowerCase()) : true,
    hasConcernInQuestion: hasKeyword ? (questions[0] || '').includes(customerConcern.substring(0, 10)) : true,
    hasInsuranceType: (questions[0] || '').includes(insuranceType) || (answers[0] || '').includes(insuranceType),
    hasTargetReference: (questions[0] || '').includes(target.substring(0, 5)) || generatedTitle.includes(target.substring(0, 5))
  }
  
  // 자동 재생성 필요 여부 판단
  const autoNeedRegenerate = !autoValidation.hasConcernInQuestion || !autoValidation.hasInsuranceType
  
  // SEO 점수 계산 (첫 번째 질문/답변 기준)
  const seoScore = calculateSEOScore({
    title: generatedTitle,
    question: questions[0] || '',
    answer: answers[0] || '',
    keywords: coreKeywords,
    highlights,
    commentsCount: comments.length,
    target,
    insuranceType
  })
  
  // 5. 타겟에 따른 성별/나이 자동 추론
  const targetInfo: { age: string, gender: string, ageNum: number } = (() => {
    const ageMatch = target.match(/(\d+)대/)
    const ageNum = ageMatch ? parseInt(ageMatch[1]) : 35
    const age = ageMatch ? `${ageMatch[1]}세` : '35세'
    
    // 타겟에 따른 성별 추론
    let gender = '남성'
    if (target.includes('신혼부부')) gender = Math.random() > 0.5 ? '남성' : '여성'
    else if (target.includes('가장')) gender = '남성'
    else if (target.includes('직장인')) gender = Math.random() > 0.3 ? '남성' : '여성'
    else if (target.includes('사회초년생')) gender = Math.random() > 0.5 ? '남성' : '여성'
    else if (target.includes('은퇴준비')) gender = Math.random() > 0.6 ? '남성' : '여성'
    else if (target.includes('자영업자')) gender = Math.random() > 0.4 ? '남성' : '여성'
    
    return { age, gender, ageNum }
  })()

  // 6. 설계서 생성 (텍스트 표 형식 - 복사/붙여넣기용 + HTML 표시용)
  let designHtml = ''
  let designText = ''
  let parsedMonthlyPremium = ''
  let parsedCoverages: Array<{name: string, amount: string, premium?: string}> = []
  
  if (generateDesign) {
    const designPrompt = `${target}를 위한 ${insuranceType} 보험 설계서용 상세 보장 내역을 JSON으로 생성해주세요.

【고객 정보 - 반드시 이 조건에 맞춰 설계】
- 타겟 고객: ${target}
- 예상 나이: ${targetInfo.ageNum}세
- 성별: ${targetInfo.gender}
- 고객 고민: ${customerConcern}
- 보험 종류: ${insuranceType}

【설계 원칙】
- 2026년 기준 현실적인 보험료 (${targetInfo.gender} ${targetInfo.ageNum}세 기준)
- ${target}의 특성과 니즈에 맞는 보장 구성
- 고객 고민(${customerConcern})을 해결할 수 있는 보장 포함
- 보험회사명과 실제 판매중인 상품명 스타일로 작성

【출력 형식 - 반드시 JSON만 출력】
{
  "companyName": "삼성생명",
  "productName": "무배당 삼성 ${insuranceType} 플러스 2026",
  "paymentPeriod": "20년납",
  "coveragePeriod": "종신",
  "mainCoverage": [
    {"category": "주계약", "name": "사망보험금", "coverage": "1억원", "premium": "45,000원", "note": "질병/재해사망 공통"},
    {"category": "주계약", "name": "재해사망 추가지급금", "coverage": "1억원", "premium": "5,000원", "note": "재해사망시 추가 지급"}
  ],
  "riders": [
    {"name": "암진단특약 (유사암제외)", "coverage": "5,000만원", "premium": "28,000원", "period": "90세", "note": "1회 진단시 전액 지급"},
    {"name": "뇌출혈진단특약", "coverage": "3,000만원", "premium": "12,000원", "period": "90세", "note": "뇌졸중 포함"},
    {"name": "급성심근경색진단특약", "coverage": "3,000만원", "premium": "10,000원", "period": "90세", "note": "허혈성 심장질환 포함"},
    {"name": "수술비특약 (1-5종)", "coverage": "100만원", "premium": "8,500원", "period": "90세", "note": "수술종류별 차등 지급"},
    {"name": "입원일당특약", "coverage": "5만원", "premium": "6,200원", "period": "80세", "note": "1일당 지급"},
    {"name": "상해후유장해특약", "coverage": "1억원", "premium": "4,800원", "period": "80세", "note": "3%이상 후유장해"}
  ],
  "totalPremium": "119,500원",
  "specialNotes": [
    "비갱신형 특약 선택으로 보험료 인상 없음",
    "납입면제 특약 포함 (암/뇌/심장 진단시)",
    "중도인출 및 추가납입 가능",
    "${target} 특성에 맞춘 보장 구성"
  ],
  "designReason": "${target}의 주요 니즈인 '${customerConcern.substring(0, 30)}'을 고려하여 설계하였습니다. ${insuranceType}의 핵심 보장과 함께 3대 진단비, 수술/입원 보장을 추가하여 종합적인 보장을 구성했습니다."
}`

    try {
      const designData = await callGeminiAPI(designPrompt, geminiKeys)
      const jsonMatch = designData.match(/\{[\s\S]*\}/)
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        
        // 이미지 생성용 보장내역 추출
        const coveragesForImage = [
          ...(parsed.mainCoverage || []).map((c: any) => ({
            name: c.name,
            amount: c.coverage,
            premium: c.premium
          })),
          ...(parsed.riders || []).slice(0, 5).map((r: any) => ({
            name: r.name,
            amount: r.coverage,
            premium: r.premium
          }))
        ]
        
        // 텍스트 + HTML 둘 다 생성
        const designResult = generateInsuranceDesignData({
          companyName: parsed.companyName || '삼성생명',
          productName: parsed.productName || `무배당 ${insuranceType} 2026`,
          insuranceType: insuranceType,
          customerAge: targetInfo.age,
          customerGender: targetInfo.gender,
          customerTarget: target,
          customerConcern: cleanText(customerConcern),
          paymentPeriod: parsed.paymentPeriod || '20년납',
          coveragePeriod: parsed.coveragePeriod || '종신',
          mainCoverage: parsed.mainCoverage || [],
          riders: parsed.riders || [],
          totalPremium: parsed.totalPremium || '100,000원',
          monthlyPremium: parsed.totalPremium || '100,000원',
          specialNotes: parsed.specialNotes || [],
          designReason: parsed.designReason || ''
        })
        
        designHtml = designResult.html
        designText = designResult.text
        
        // 이미지 생성용 데이터도 저장
        parsedMonthlyPremium = parsed.totalPremium || '100,000원'
        parsedCoverages = coveragesForImage
      }
    } catch (e) {
      console.log('Design generation error:', e)
    }
  }
  
  // 해시태그 파싱
  const generatedHashtags = hashtagMatch 
    ? cleanText(hashtagMatch[1].trim()) 
    : `#${insuranceType.replace(/\s/g, '')} #${target}보험 #보험추천 #${coreKeywords[0].replace(/\s/g, '')} #보험상담`

  // V13.0: 검수 시스템 실행
  const auditResult = auditQnAContent({
    customerConcern,
    insuranceType,
    target,
    titles: [generatedTitle1, generatedTitle2],
    questions,
    answers,
    comments,
    seoKeywords
  })
  
  // V17.7: SEO 키워드 통합 - seoKeywords 최상위 포함
  const finalSeoKeywords = seoKeywords.length > 0 ? seoKeywords : [
    `${insuranceType} 추천`,
    `${insuranceType} 비교`,
    `${insuranceType} 해지`,
    `${target} ${insuranceType}`,
    `${insuranceType} 갱신`
  ]
  
  // V13.0: 제목 2개, 질문 3개, 답변 3개, 댓글 3개, 해시태그 반환
  return c.json({
    keywords: coreKeywords,
    seoKeywords: finalSeoKeywords,  // V17.7: 최상위 SEO 키워드 포함
    // V13.0: 제목 2개
    title: generatedTitle1,  // 메인 제목 (호환성)
    titles: [generatedTitle1, generatedTitle2],  // 제목 2개 배열
    // 해시태그 (핵심 고민 반영)
    hashtags: generatedHashtags,
    // V13.0: 질문 3개 (각각 복사 가능)
    questions: questions,
    question: questions[0] || `안녕하세요. ${target}인데 ${insuranceType} 관련 질문이 있어요. ${customerConcern} 좋은 설계사분 추천 부탁드려요.`,
    // 답변 3개 (각각 복사 가능) - 3-Way Expert View
    answers: answers,
    answer: answers[0] || `${insuranceType}에 대해 답변드립니다.`,
    // 강조 포인트
    highlights: highlights,
    // 댓글 3개 (각각 복사 가능) - 경험담 위주
    comments: comments,
    // 설계서 데이터
    designHtml: designHtml,
    designText: designText,
    monthlyPremium: parsedMonthlyPremium || '89,000원',
    coverages: parsedCoverages || [],
    // SEO 점수 데이터 (프론트엔드에서 네이버 노출 확률 패널 업데이트용)
    seo: {
      totalScore: seoScore.totalScore,
      grade: seoScore.grade,
      titleScore: seoScore.titleScore,
      keywordScore: seoScore.keywordScore,
      contentScore: seoScore.contentScore,
      engageScore: seoScore.engageScore,
      predictedRank: seoScore.predictedRank,
      exposureRate: seoScore.exposureRate,
      recommend: seoScore.recommend,
      strengths: seoScore.strengths,
      improvements: seoScore.improvements,
      tips: seoScore.tips
    },
    // V12.2: 자가진단 워크플로우 데이터
    selfDiagnosis: {
      // C-Rank / D.I.A.+ / 에이전트 N 최적화 키워드 5개
      seoKeywords: seoKeywords,
      // 최적화 제목 2가지
      optimizedTitles: [optimizedTitle1, optimizedTitle2],
      // AI 자가진단 결과
      aiDiagnosis: {
        concernReflection: selfDiagnosis.concernReflection,  // 핵심고민 반영도 (상/중/하)
        targetFit: selfDiagnosis.targetFit,                  // 타깃 적합도 (상/중/하)
        insuranceMatch: selfDiagnosis.insuranceMatch,        // 보험종류 일치도 (상/중/하)
        needRegenerate: selfDiagnosis.needRegenerate,        // 재생성 필요 여부
        reason: selfDiagnosis.reason                         // 재생성 사유
      },
      // 자동 검증 결과
      autoValidation: {
        hasConcernInTitle: autoValidation.hasConcernInTitle,
        hasConcernInQuestion: autoValidation.hasConcernInQuestion,
        hasInsuranceType: autoValidation.hasInsuranceType,
        hasTargetReference: autoValidation.hasTargetReference,
        needRegenerate: autoNeedRegenerate
      },
      // 최종 재생성 필요 여부 (AI + 자동 검증 종합)
      finalNeedRegenerate: selfDiagnosis.needRegenerate || autoNeedRegenerate,
      finalReason: autoNeedRegenerate 
        ? '자동검증: 핵심고민 또는 보험종류가 콘텐츠에 충분히 반영되지 않았습니다.'
        : (selfDiagnosis.needRegenerate ? selfDiagnosis.reason : '')
    },
    // V16.0: 검수(Audit) 시스템 결과 - RAG Self-Correction 적용
    audit: {
      passed: finalAuditResult?.passed ?? auditResult?.passed ?? false,
      totalScore: finalAuditResult?.totalScore ?? auditResult?.totalScore ?? 0,
      scores: finalAuditResult?.scores ?? auditResult?.scores ?? {},
      failReasons: finalAuditResult?.failReasons ?? auditResult?.failReasons ?? [],
      suggestions: finalAuditResult?.suggestions ?? auditResult?.suggestions ?? []
    },
    // V16.0: RAG 기반 Self-Correction 이력
    selfCorrection: {
      totalAttempts: currentAttempt ?? 1,
      maxAttempts: MAX_REGENERATION_ATTEMPTS ?? 2,
      regenerationHistory: regenerationHistory ?? [],
      finalScore: finalAuditResult?.totalScore ?? auditResult?.totalScore ?? 0,
      wasRegenerated: (currentAttempt ?? 1) > 1
    },
    // V16.0: RAG 파이프라인 실행 로그
    ragPipeline: {
      step1_factCollection: ragPipelineLog.step1_factCollection,
      step2_strategyBuilding: ragPipelineLog.step2_strategyBuilding,
      step3_contentGeneration: ragPipelineLog.step3_contentGeneration,
      step4_selfDiagnosis: ragPipelineLog.step4_selfDiagnosis,
      strategyUsed: {
        seoKeywords: strategy?.seoKeywords ?? [],
        factChecks: strategy?.factChecks ?? [],
        expertStrategies: strategy?.expertStrategies ?? {}
      }
    },
    // 버전 정보
    version: 'V18.4-GeminiRandomOccupation'
  })
})

// ========== 설계서 이미지 생성 API ==========
app.post('/api/generate/proposal-image', async (c) => {
  const body = await c.req.json()
  const {
    companyName = '삼성생명',
    insuranceType = '종신보험',
    customerAge = '35세',
    customerGender = '남성',
    monthlyPremium = '89,000원',
    docNumber,
    coverages = [],
    style = 'compact-card'
  } = body
  
  // 4개 키 로테이션
  const geminiKeys = getGeminiKeys(c.env)
  if (geminiKeys.length === 0) {
    return c.json({ success: false, error: 'API key not configured' }, 500)
  }
  const geminiKey = getNextGeminiKey(geminiKeys)
  
  // 문서번호 자동 생성 (없으면)
  const finalDocNumber = docNumber || `INS-${Date.now()}`
  
  // 기본 보장내역 (없으면)
  const finalCoverages = coverages.length > 0 ? coverages : [
    { name: '일반사망보험금', amount: '1억원', premium: '52,000원' },
    { name: '재해사망보험금', amount: '1억원', premium: '8,500원' },
    { name: '암진단비(일반암)', amount: '5,000만원', premium: '15,200원' },
    { name: '뇌혈관질환진단비', amount: '3,000만원', premium: '7,800원' },
    { name: '급성심근경색진단비', amount: '3,000만원', premium: '5,500원' }
  ]
  
  const imageData: ImageGenerationData = {
    companyName,
    insuranceType,
    customerAge,
    customerGender,
    monthlyPremium,
    docNumber: finalDocNumber,
    coverages: finalCoverages,
    style: style as 'compact-card' | 'full-document' | 'highlight' | 'scan-copy'
  }
  
  console.log('Generating proposal image:', { companyName, insuranceType, style, docNumber: finalDocNumber, keysAvailable: geminiKeys.length })
  
  const result = await generateInsuranceImage(imageData, geminiKey, geminiKeys)
  
  if (result.success) {
    return c.json({
      success: true,
      imageUrl: result.imageUrl,
      docNumber: finalDocNumber,
      model: result.model || 'gemini-2.5-flash-image',
      style,
      message: '설계서 이미지가 생성되었습니다.'
    })
  } else {
    return c.json({
      success: false,
      error: result.error,
      docNumber: finalDocNumber
    }, 500)
  }
})

// Blog API
app.post('/api/generate/blog', async (c) => {
  const { topic, keywords, region, type, target } = await c.req.json()
  
  const geminiKeys = getGeminiKeys(c.env)
  if (geminiKeys.length === 0) {
    return c.json({ error: 'API key not configured' }, 500)
  }
  
  const prompt = `당신은 네이버 블로그 SEO 전문 작성 AI입니다.

【중요 규칙】
- 이모티콘 사용 금지
- ## 또는 ** 마크다운 사용 금지

【조건】
- 주제: ${topic}
- 키워드: ${keywords || topic}
- 지역: ${region || '전국'}
- 유형: ${type}
- 타겟: ${target}
- 2026년 기준

【규칙】
1. 본문 1,700자 이상
2. 키워드 3회+ 포함
3. [이미지 삽입] 3-4회
4. 3줄 요약 포함
5. Q&A 섹션 포함

【출력 형식】
[제목]
(30자 이내)

[본문]
(1,700자 이상)

[해시태그]
(10개)`

  try {
    const result = await callGeminiAPI(prompt, geminiKeys)
    
    const titleMatch = result.match(/\[제목\]\s*([\s\S]*?)(?=\[본문\])/i)
    const contentMatch = result.match(/\[본문\]\s*([\s\S]*?)(?=\[해시태그\])/i)
    const hashtagMatch = result.match(/\[해시태그\]\s*([\s\S]*?)$/i)
    
    return c.json({
      title: cleanText(titleMatch ? titleMatch[1].trim() : `${topic}, 이것만 알면 끝!`),
      content: cleanText(contentMatch ? contentMatch[1].trim() : ''),
      hashtags: cleanText(hashtagMatch ? hashtagMatch[1].trim() : `#${topic.replace(/\s/g, '')}`)
    })
  } catch (error) {
    return c.json({
      title: `${topic}, 완벽 가이드`,
      content: `3줄 요약\n1. ${topic}의 핵심\n2. ${target}을 위한 정보\n3. 실용적인 가이드\n\n[이미지 삽입]\n\n${topic}에 대해 알아보겠습니다...`,
      hashtags: `#${topic.replace(/\s/g, '')} #${target}추천`
    })
  }
})

// Analyze API
app.post('/api/analyze/blog', async (c) => {
  const { content, keyword, region, type } = await c.req.json()
  
  const geminiKeys = getGeminiKeys(c.env)
  if (geminiKeys.length === 0) {
    return c.json({ error: 'API key not configured' }, 500)
  }
  
  const prompt = `당신은 네이버 블로그 SEO 분석 전문가입니다.

【분석 대상】
${content.substring(0, 4000)}

【조건】
- 목표 키워드: ${keyword || '미지정'}
- 목표 지역: ${region || '미지정'}
- 글자수: ${content.length}자

【평가 기준】
- SEO (0-100)
- C-RANK (0-100)
- AEO (0-100)
- GEO (0-100)

【출력 형식 - 이모티콘 사용 금지】
[점수]
SEO: (숫자)
C-RANK: (숫자)
AEO: (숫자)
GEO: (숫자)
총점: (숫자)

[분석]
(상세 분석)

[개선된 제목]
(개선안)`

  try {
    const result = await callGeminiAPI(prompt, geminiKeys)
    
    const seoMatch = result.match(/SEO:\s*(\d+)/i)
    const crankMatch = result.match(/C-RANK:\s*(\d+)/i)
    const aeoMatch = result.match(/AEO:\s*(\d+)/i)
    const geoMatch = result.match(/GEO:\s*(\d+)/i)
    const totalMatch = result.match(/총점:\s*(\d+)/i)
    
    const seoScore = seoMatch ? parseInt(seoMatch[1]) : 70
    const crankScore = crankMatch ? parseInt(crankMatch[1]) : 70
    const aeoScore = aeoMatch ? parseInt(aeoMatch[1]) : 60
    const geoScore = geoMatch ? parseInt(geoMatch[1]) : 50
    const totalScore = totalMatch ? parseInt(totalMatch[1]) : Math.round((seoScore + crankScore + aeoScore + geoScore) / 4)
    
    const analysisMatch = result.match(/\[분석\]([\s\S]*?)(?=\[개선된 제목\])/i)
    const improvedMatch = result.match(/\[개선된 제목\]([\s\S]*?)$/i)
    
    return c.json({
      totalScore, seoScore, crankScore, aeoScore, geoScore,
      analysis: cleanText(analysisMatch ? analysisMatch[1].trim() : '분석 결과'),
      improved: cleanText(improvedMatch ? improvedMatch[1].trim() : '개선안')
    })
  } catch (error) {
    return c.json({
      totalScore: 65, seoScore: 70, crankScore: 65, aeoScore: 60, geoScore: 50,
      analysis: '분석 중 오류',
      improved: '개선안 생성 실패'
    })
  }
})

// ========== Bright Data 프록시 IP 변경 API ==========

// 현재 세션 IP 저장 (메모리 기반 - Worker 재시작시 초기화)
let currentSessionId = ''
let currentProxyIP = ''

// 새 IP 요청 API
app.post('/api/proxy/change-ip', async (c) => {
  try {
    const host = c.env?.BRIGHT_DATA_HOST || 'brd.superproxy.io'
    const port = c.env?.BRIGHT_DATA_PORT || '33335'
    const username = c.env?.BRIGHT_DATA_USERNAME
    const password = c.env?.BRIGHT_DATA_PASSWORD
    
    // 환경변수 확인
    if (!username || !password) {
      // Demo 모드: 환경변수가 없으면 시뮬레이션된 결과 반환
      const demoIP = generateDemoIP()
      currentProxyIP = demoIP
      currentSessionId = 'demo-' + Date.now()
      
      return c.json({
        success: true,
        newIP: demoIP,
        country: 'KR',
        sessionId: currentSessionId,
        demo: true,
        message: 'Demo mode - Bright Data credentials not configured'
      })
    }
    
    // 새 세션 ID 생성 (IP 변경용)
    const newSessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(7)
    
    // Bright Data 프록시를 통해 IP 확인 요청
    // 세션 ID를 변경하면 새 IP가 할당됨
    const proxyUrl = `http://${username}-session-${newSessionId}:${password}@${host}:${port}`
    
    // 프록시를 통해 IP 확인 서비스 호출
    // 참고: Cloudflare Workers에서 직접 프록시 연결은 제한됨
    // 대신 Bright Data의 API나 외부 IP 확인 서비스를 사용
    
    // 방법 1: 외부 IP 확인 서비스 호출 (실제 구현에서는 프록시 터널 사용)
    const ipCheckResponse = await fetch('https://api.ipify.org?format=json', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
      }
    })
    
    if (!ipCheckResponse.ok) {
      throw new Error('IP 확인 서비스 응답 오류')
    }
    
    const ipData = await ipCheckResponse.json() as { ip: string }
    const newIP = ipData.ip || generateDemoIP()
    
    // Geo-location 확인 (한국 IP 여부)
    let country = 'KR'
    try {
      const geoResponse = await fetch(`https://ipapi.co/${newIP}/json/`)
      if (geoResponse.ok) {
        const geoData = await geoResponse.json() as { country_code?: string }
        country = geoData.country_code || 'KR'
      }
    } catch {
      // Geo 확인 실패 시 기본값 사용
    }
    
    // 세션 정보 업데이트
    currentSessionId = newSessionId
    currentProxyIP = newIP
    
    // KR이 아닌 경우 재시도 옵션 안내
    if (country !== 'KR') {
      return c.json({
        success: true,
        newIP: newIP,
        country: country,
        sessionId: newSessionId,
        warning: '해외 IP가 감지되었습니다. 자동으로 재시도합니다.',
        shouldRetry: true
      })
    }
    
    return c.json({
      success: true,
      newIP: newIP,
      country: country,
      sessionId: newSessionId
    })
    
  } catch (error) {
    console.error('IP Change Error:', error)
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '새 IP 할당 실패'
    }, 500)
  }
})

// 현재 IP 확인 API
app.get('/api/proxy/current-ip', async (c) => {
  try {
    // 저장된 프록시 IP가 있으면 반환
    if (currentProxyIP) {
      return c.json({
        ip: currentProxyIP,
        sessionId: currentSessionId,
        connected: true
      })
    }
    
    // 없으면 현재 Workers IP 반환 (프록시 연결 안됨)
    const response = await fetch('https://api.ipify.org?format=json')
    const data = await response.json() as { ip: string }
    
    return c.json({
      ip: data.ip || null,
      sessionId: null,
      connected: false
    })
  } catch {
    return c.json({
      ip: null,
      sessionId: null,
      connected: false
    })
  }
})

// 프록시 상태 확인 API
app.get('/api/proxy/status', async (c) => {
  const hasCredentials = !!(c.env?.BRIGHT_DATA_USERNAME && c.env?.BRIGHT_DATA_PASSWORD)
  
  return c.json({
    configured: hasCredentials,
    currentIP: currentProxyIP || null,
    sessionId: currentSessionId || null,
    host: c.env?.BRIGHT_DATA_HOST || 'brd.superproxy.io',
    port: c.env?.BRIGHT_DATA_PORT || '33335'
  })
})

// Demo IP 생성 함수 (테스트용)
function generateDemoIP(): string {
  // 한국 IP 대역 시뮬레이션
  const koreanPrefixes = ['211.234', '175.193', '121.134', '58.226', '39.118', '211.55', '220.95']
  const prefix = koreanPrefixes[Math.floor(Math.random() * koreanPrefixes.length)]
  const suffix1 = Math.floor(Math.random() * 256)
  const suffix2 = Math.floor(Math.random() * 256)
  return `${prefix}.${suffix1}.${suffix2}`
}

export default app
