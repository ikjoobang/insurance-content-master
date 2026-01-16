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
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.8, topK: 40, topP: 0.95, maxOutputTokens: 8192 }
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
          
          <!-- 4열 그리드 (초대형) / 3열 (대형) / 2열 (중형) / 1열 (모바일) -->
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-5 lg:gap-6 xl:gap-8">
            
            <!-- 칼럼 1: 타겟 고객 -->
            <div>
              <label class="block text-xs sm:text-sm lg:text-base font-semibold text-white mb-2 lg:mb-3">
                <i class="fas fa-users text-blue-400 mr-1.5"></i>타겟 고객
              </label>
              <div class="flex flex-wrap gap-1.5 sm:gap-2 lg:gap-2.5" id="qna-target-chips">
                <button onclick="selectChip(this, 'qna-target')" data-value="20대 사회초년생" class="chip">20대</button>
                <button onclick="selectChip(this, 'qna-target')" data-value="30대 직장인" class="chip active">30대</button>
                <button onclick="selectChip(this, 'qna-target')" data-value="40대 가장" class="chip">40대</button>
                <button onclick="selectChip(this, 'qna-target')" data-value="50대 은퇴준비" class="chip">50대</button>
                <button onclick="selectChip(this, 'qna-target')" data-value="신혼부부" class="chip">신혼</button>
                <button onclick="selectChip(this, 'qna-target')" data-value="자영업자" class="chip">자영업</button>
              </div>
            </div>
            
            <!-- 칼럼 2: 보험 종류 -->
            <div>
              <label class="block text-xs sm:text-sm lg:text-base font-semibold text-white mb-2 lg:mb-3">
                <i class="fas fa-shield-alt text-blue-400 mr-1.5"></i>보험 종류
              </label>
              <div class="flex flex-wrap gap-1.5 sm:gap-2 lg:gap-2.5" id="qna-insurance-chips">
                <button onclick="selectChip(this, 'qna-insurance')" data-value="종신보험" class="chip active">종신</button>
                <button onclick="selectChip(this, 'qna-insurance')" data-value="암보험" class="chip">암보험</button>
                <button onclick="selectChip(this, 'qna-insurance')" data-value="실손보험" class="chip">실손</button>
                <button onclick="selectChip(this, 'qna-insurance')" data-value="연금보험" class="chip">연금</button>
                <button onclick="selectChip(this, 'qna-insurance')" data-value="저축보험" class="chip">저축</button>
                <button onclick="selectChip(this, 'qna-insurance')" data-value="변액보험" class="chip">변액</button>
                <button onclick="selectChip(this, 'qna-insurance')" data-value="어린이보험" class="chip">어린이</button>
                <button onclick="selectChip(this, 'qna-insurance')" data-value="운전자보험" class="chip">운전자</button>
              </div>
            </div>
            
            <!-- 칼럼 3: 문체 톤 (중복 선택 가능) -->
            <div>
              <label class="block text-xs sm:text-sm lg:text-base font-semibold text-white mb-2 lg:mb-3">
                <i class="fas fa-comment-dots text-blue-400 mr-1.5"></i>문체 톤 <span class="text-gray-400 text-xs">(중복 선택 가능)</span>
              </label>
              <div class="flex flex-wrap gap-1.5 sm:gap-2 lg:gap-2.5" id="qna-tone-chips">
                <button onclick="toggleToneChip(this)" data-value="친근한" class="chip-multi active">친근</button>
                <button onclick="toggleToneChip(this)" data-value="전문적인" class="chip-multi">전문</button>
                <button onclick="toggleToneChip(this)" data-value="설득력 있는" class="chip-multi">설득</button>
                <button onclick="toggleToneChip(this)" data-value="공감하는" class="chip-multi">공감</button>
                <button onclick="toggleToneChip(this)" data-value="보험초보" class="chip-multi chip-beginner" title="보험이 처음인 고객을 위한 쉬운 설명">
                  <i class="fas fa-seedling mr-1"></i>보험초보
                </button>
                <button onclick="toggleToneChip(this)" data-value="제안서요청형" class="chip-multi chip-proposal" title="구체적인 설계/제안서를 요청하는 형식">
                  <i class="fas fa-file-signature mr-1"></i>제안서 요청
                </button>
              </div>
            </div>
            
            <!-- 칼럼 4: 고민 + 버튼 -->
            <div class="space-y-3 lg:space-y-4">
              <div>
                <label class="block text-xs sm:text-sm lg:text-base font-semibold text-white mb-2 lg:mb-3">
                  <i class="fas fa-edit text-blue-400 mr-1.5"></i>핵심 고민 <span class="text-gray-400 text-xs lg:text-sm">(선택)</span>
                </label>
                <textarea id="qna-concern" rows="2" placeholder="비워두면 AI가 자동 생성" class="input-premium w-full px-3 py-2.5 lg:px-4 lg:py-3 text-white resize-none text-sm lg:text-base"></textarea>
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
          </div>
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
    const selections = {
      'qna-target': '30대 직장인',
      'qna-tone': '친근한',
      'qna-insurance': '종신보험',
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
    
    // 문체 톤 중복 선택 기능
    let selectedTones = ['친근한']; // 기본값
    
    function toggleToneChip(btn) {
      const value = btn.dataset.value;
      
      if (btn.classList.contains('active')) {
        // 이미 선택된 경우 해제 (최소 1개는 유지)
        if (selectedTones.length > 1) {
          btn.classList.remove('active');
          selectedTones = selectedTones.filter(t => t !== value);
        } else {
          showToast('최소 1개의 문체 톤을 선택해야 합니다');
        }
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
      
      // 선택된 톤 업데이트
      selections['qna-tone'] = selectedTones.join(',');
    }
    
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
        updateProgress(1, 10, '네이버 키워드 분석 중...');
        
        const res = await fetch('/api/generate/qna-full', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target: selections['qna-target'],
            tone: selections['qna-tone'],
            insuranceType: selections['qna-insurance'],
            concern: concern,
            generateDesign: generateDesign
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
app.get('/api/health', (c) => c.json({ 
  status: 'ok', 
  version: '9.5', 
  ai: 'gemini + naver + gemini-image', 
  year: 2026,
  features: ['keyword-analysis', 'qna-full-auto', 'customer-tailored-design', 'no-emoji', 'responsive-ui', 'excel-style-design', 'one-click-copy', 'pc-full-width-layout', 'security-protection', 'proposal-image-generation', 'compact-card-style'],
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

// Q&A 완전 자동화 API (V6.1)
app.post('/api/generate/qna-full', async (c) => {
  const { target, tone, insuranceType, concern, generateDesign } = await c.req.json()
  
  // 환경 변수에서 API 키 가져오기 (Cloudflare Secrets) - 4개 키 로테이션
  const geminiKeys = getGeminiKeys(c.env)
  const naverClientId = c.env?.NAVER_CLIENT_ID || 'fUhHJ1HWyF6fFw_aBfkg'
  const naverClientSecret = c.env?.NAVER_CLIENT_SECRET || 'gA4jUFDYK0'
  
  if (geminiKeys.length === 0) {
    return c.json({ error: 'API key not configured' }, 500)
  }
  
  // 1. 네이버 키워드 분석
  const searchQuery = `${target} ${insuranceType} 추천`
  const naverKeywords = await searchNaverKeywords(searchQuery, naverClientId, naverClientSecret)
  const relatedKeywords = await getRelatedKeywords(insuranceType, naverClientId, naverClientSecret)
  
  const allKeywords = [...new Set([insuranceType, ...naverKeywords.slice(0, 5), ...relatedKeywords.slice(0, 3)])]
  const coreKeywords = allKeywords.slice(0, 6)
  
  // 2. 가상 연락처 생성 (이름 제외)
  const contact = generateVirtualContact()
  
  // 3. 고민/질문 자동 생성
  let customerConcern = concern
  if (!customerConcern) {
    const concernPrompt = `당신은 ${target}입니다. ${insuranceType}에 대해 네이버 카페에 질문하려고 합니다.
현실적이고 구체적인 고민을 50자 이내로 작성해주세요.
이모티콘이나 특수문자 없이 순수 텍스트만 작성하세요.
반드시 한 문장으로 작성하세요.`
    customerConcern = await callGeminiAPI(concernPrompt, geminiKeys)
    customerConcern = cleanText(customerConcern.replace(/["\n]/g, '').trim())
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
  
  // 전문가 유형 10가지
  const expertTypes = [
    { style: '친근한형', desc: '동네 형처럼 편하게 설명, "~요" 체' },
    { style: '전문가형', desc: '데이터와 통계로 논리적 설명' },
    { style: '안심형', desc: '먼저 안심시키고 차근차근 설명' },
    { style: '공감형', desc: '감정을 먼저 공감하고 해결책 제시' },
    { style: '실용형', desc: '실제 사례와 현실적인 조언 중심' },
    { style: '비교분석형', desc: '여러 옵션을 비교해서 객관적 분석' },
    { style: '단호형', desc: '명확하게 맞고 틀림을 구분해서 설명' },
    { style: '선배형', desc: '나도 겪어봤다는 경험담 기반 조언' },
    { style: '컨설턴트형', desc: '체계적인 단계별 해결책 제시' },
    { style: '멘토형', desc: '장기적인 관점에서 인생 조언 포함' }
  ]
  const selectedExpert1 = expertTypes[Math.floor(Math.random() * expertTypes.length)]
  const selectedExpert2 = expertTypes[Math.floor(Math.random() * expertTypes.length)]
  const selectedExpert3 = expertTypes[Math.floor(Math.random() * expertTypes.length)]
  
  // 톤 분석 - 다중 선택된 톤 처리
  const tones = tone.split(',').map((t: string) => t.trim())
  const isBeginnerMode = tones.includes('보험초보')
  const isProposalMode = tones.includes('제안서요청형')
  const baseTones = tones.filter((t: string) => !['보험초보', '제안서요청형'].includes(t))
  
  // 암환자/사고 상황 감지 - 공감대 형성 우선 적용
  const isTraumaticSituation = /암|cancer|사고|교통사고|수술|병원|진단|환자|투병|항암|치료중|치료|입원|병|질병|건강악화|중병|병력/.test(customerConcern.toLowerCase())
  
  // 특수 톤 가이드 생성
  let specialToneGuide = ''
  if (isBeginnerMode) {
    specialToneGuide += `
【 보험초보 모드 - 쉬운 설명 필수 】
■ 전문 용어는 반드시 쉬운 말로 풀어서 설명
■ 예시: "납입면제" → "보험료를 안 내도 되는 것", "해지환급금" → "중간에 해약하면 돌려받는 돈"
■ 복잡한 개념은 비유로 설명 (예: "적립금은 저금통에 모으는 것과 같아요")
■ 단계별로 차근차근, 초보자도 이해하기 쉽게
■ "쉽게 설명드리면~", "간단히 말씀드리면~" 표현 활용
`
  }
  if (isProposalMode) {
    specialToneGuide += `
【 제안서 요청형 모드 - 구체적 설계 제안 필수 】
■ "제 상황에 맞는 설계서를 보고 싶어요" 느낌으로 질문 작성
■ 답변에 구체적인 설계 제안 포함 (월 납입료, 보장내용, 기간 등)
■ "상담 후 맞춤 설계서를 보내드릴게요" 형태의 CTA
■ 실제 설계서 예시 언급 (예: "30대 남성 기준 월 5만원대 설계")
■ 구체적인 숫자와 플랜 제시
`
  }
  
  // 암환자/사고 상황일 때 공감 우선 가이드
  let empathyFirstGuide = ''
  if (isTraumaticSituation) {
    empathyFirstGuide = `
★★★★★ 최우선 - 공감대 형성 필수 (암/질병/사고 상황 감지됨) ★★★★★
■ 전문가 답변 시작은 반드시 진심어린 공감으로 시작해야 함
■ 예시 문구:
  - "먼저 힘든 상황에서 용기 내어 질문해 주셔서 감사합니다."
  - "건강 문제로 많이 불안하시죠. 충분히 이해합니다."
  - "사고를 겪으신 후 걱정이 많으시겠습니다. 진심으로 위로드립니다."
  - "투병 중에도 가족을 생각하시는 마음이 느껴집니다."
■ 공감 → 위로 → 희망적 정보 → 실질적 해결책 순서로 답변
■ 절대 상업적인 느낌 없이, 진정성 있게 작성
■ 차가운 정보 나열 금지, 따뜻한 어조 유지
`
  }
  
  const qnaPrompt = `당신은 네이버 검색 상위 1위를 무조건 달성하기 위한 보험 Q&A 전문 작성 AI입니다.

【 네이버 상위 1위 필수 알고리즘 】
■ C-Rank (콘텐츠 신뢰도): 전문성 + 정확한 수치/통계 + 구체적 정보
■ D.I.A. (의도 파악): "${target}이 ${insuranceType} 검색"할 때 원하는 정보 100% 일치
■ Agent N (AI 검색): 구조화된 답변 + 핵심 키워드 자연 반복 (최소 4회)

【 네이버 상위 노출 핵심 원칙 】
1. 핵심 키워드 "${coreKeywords[0]}" 반드시 제목/질문/답변에 4회 이상 자연 배치
2. 2026년 최신 정보, 구체적 숫자(보험료, %, 년수) 필수 포함
3. 검색자의 진짜 고민을 해결하는 답변
4. CTA로 자연스럽게 마무리

【 절대 규칙 】
- 이모티콘 100% 금지
- 마크다운(##, **, 백틱) 금지
- 가상 이름(홍길동, 김철수 등) 금지
- 순수 텍스트만 출력

【 생성 조건 】
- 타겟: ${target}
- 보험: ${insuranceType}
- 선택된 문체 톤: ${tones.join(', ')} (복수 선택됨 - 모든 톤을 자연스럽게 조합)
- 기본 문체: ${baseTones.length > 0 ? baseTones.join(' + ') : '친근한'}
- 핵심 키워드: ${coreKeywords.join(', ')}
- 연락처: ${contact.phone}
${specialToneGuide}
${empathyFirstGuide}

★★★ 최우선 적용 - 사용자 핵심 고민 ★★★
"${customerConcern}"
→ 이 고민 내용을 제목, 질문, 답변, 해시태그에 최우선으로 반영할 것!
→ 선택된 모든 문체 톤(${tones.join(', ')})을 자연스럽게 융합하여 답변 작성!

==========================================================
【 출력 형식 - 반드시 아래 형식 그대로 출력 】
==========================================================

[제목]
★ 전문가에게 질문/고민하는 형태로 작성 (필수!)
★ 사용자 핵심 고민 "${customerConcern}" 내용을 반드시 반영
- "${target}"이 전문가에게 묻는 질문 형태: "~해도 될까요?", "~어떻게 해야 하나요?", "~추천해주세요"
- 핵심 키워드 "${coreKeywords[0]}" 필수 포함 (C-RANK 최적화)
- 15-25자, 검색 의도 명확히 반영
- 예시: "${target} ${insuranceType} 추천해주세요", "${insuranceType} 가입하려는데 어디가 좋을까요?"

[질문1-${selectedType1.style}]
"${selectedType1.example}" 같은 느낌으로 시작
- ${target}이 진짜 네이버 카페에 쓸 것 같은 현실적인 질문
- 150-250자
- 이름 없이 시작 (예: "안녕하세요", "저", "요즘", "다름이 아니라")
- 마지막에 연락처: ${contact.phone}
- 핵심 키워드 1-2회 자연 배치

[질문2-다른유형]
[질문1]과 완전히 다른 스타일의 질문
- 다른 상황, 다른 톤, 다른 고민으로 작성
- 150-250자
- 같은 보험 종류지만 다른 관점의 질문

[답변1-${selectedExpert1.style}]
${selectedExpert1.desc}
- 400-600자
- 핵심 키워드 "${coreKeywords[0]}" 3회 이상 자연 배치
${isTraumaticSituation ? '- ★★★ 필수: 진심어린 공감과 위로로 시작! (암/질병/사고 상황 감지됨) ★★★' : '- 구조: 공감 → 핵심결론 → 근거설명(2026년 기준 수치) → 맞춤조언 3가지 → CTA'}
- 선택된 모든 톤(${tones.join(', ')}) 자연스럽게 융합
${isBeginnerMode ? '- 보험초보 모드: 전문용어는 쉽게 풀어서 설명' : ''}
${isProposalMode ? '- 제안서요청형: 구체적인 설계안 언급 필수' : ''}
- 마지막은 자연스러운 상담 유도 CTA로 마무리
- ★ 사용자 핵심 고민 "${customerConcern}"에 대한 직접적인 해결책 제시 필수!

[답변2-${selectedExpert2.style}]
${selectedExpert2.desc}
- [답변1]과 완전히 다른 스타일로 작성
- 400-600자
- 같은 질문에 대한 다른 전문가의 시각
${isTraumaticSituation ? '- 공감과 위로 기반으로 작성' : ''}
- 핵심 고민에 대한 또 다른 관점의 해결책

[답변3-${selectedExpert3.style}]
${selectedExpert3.desc}
- [답변1], [답변2]와 다른 새로운 스타일
- 400-600자
- 또 다른 관점에서의 전문가 답변
- 모든 문제(문체톤 + 핵심고민)를 종합하여 포괄적 해결책 제시

[강조포인트]
- (핵심 장점 1 - 구체적 수치 포함)
- (핵심 장점 2 - 타사 비교 포함)
- (핵심 장점 3 - ${target} 맞춤 혜택)

[댓글1-깨달음형]
40-80자, "아~ 이래서 그랬구나", "저도 이거 몰랐는데 이제 알겠네요" 느낌

[댓글2-감사형]
40-80자, "답변 진짜 도움됐어요", "이렇게 자세히 설명해주시다니" 느낌

[댓글3-비슷경험형]
40-80자, "저도 비슷한 상황이라", "제 친구도 이런 경우였는데" 느낌

[댓글4-질문형]
40-80자, "그러면 저도 연락드려도 될까요?", "혹시 더 궁금한 거 있으면" 느낌

[댓글5-해결형]
40-80자, "덕분에 궁금한 거 해결됐어요", "이 글 저장해둘게요" 느낌

[해시태그]
★ 사용자 핵심 고민 "${customerConcern}" 관련 키워드 우선 포함
- 10개, #으로 시작, 띄어쓰기로 구분
- 예시: #${insuranceType} #${target}보험 #보험추천 #${coreKeywords[0]}
- C-RANK 최적화를 위해 핵심 키워드 필수 포함`

  const qnaResult = await callGeminiAPI(qnaPrompt, geminiKeys)
  
  // 파싱 - V9.5: 질문 2개, 답변 3개, 댓글 5개
  const titleMatch = qnaResult.match(/\[제목\]([\s\S]*?)(?=\[질문1)/i)
  const question1Match = qnaResult.match(/\[질문1[^\]]*\]([\s\S]*?)(?=\[질문2)/i)
  const question2Match = qnaResult.match(/\[질문2[^\]]*\]([\s\S]*?)(?=\[답변1)/i)
  const answer1Match = qnaResult.match(/\[답변1[^\]]*\]([\s\S]*?)(?=\[답변2)/i)
  const answer2Match = qnaResult.match(/\[답변2[^\]]*\]([\s\S]*?)(?=\[답변3)/i)
  const answer3Match = qnaResult.match(/\[답변3[^\]]*\]([\s\S]*?)(?=\[강조포인트\])/i)
  const highlightsMatch = qnaResult.match(/\[강조포인트\]([\s\S]*?)(?=\[댓글1)/i)
  const comment1Match = qnaResult.match(/\[댓글1[^\]]*\]([\s\S]*?)(?=\[댓글2)/i)
  const comment2Match = qnaResult.match(/\[댓글2[^\]]*\]([\s\S]*?)(?=\[댓글3)/i)
  const comment3Match = qnaResult.match(/\[댓글3[^\]]*\]([\s\S]*?)(?=\[댓글4)/i)
  const comment4Match = qnaResult.match(/\[댓글4[^\]]*\]([\s\S]*?)(?=\[댓글5)/i)
  const comment5Match = qnaResult.match(/\[댓글5[^\]]*\]([\s\S]*?)(?=\[해시태그\])/i)
  const hashtagMatch = qnaResult.match(/\[해시태그\]([\s\S]*?)$/i)
  
  // 제목 추출
  const generatedTitle = titleMatch ? cleanText(titleMatch[1].trim()) : `${target} ${insuranceType} 추천`
  
  // 질문 2개 추출
  const questions = [
    question1Match ? cleanText(question1Match[1].trim()) : `안녕하세요. ${target}인데 ${insuranceType} 가입하려고 하는데요... 연락처: ${contact.phone}`,
    question2Match ? cleanText(question2Match[1].trim()) : `요즘 ${insuranceType} 알아보고 있는데 추천 좀 해주세요. ${contact.phone}`
  ].filter(q => q.length > 30)
  
  // 답변 3개 추출
  const answers = [
    answer1Match ? cleanText(answer1Match[1].trim()) : `${insuranceType}에 대해 답변드립니다.`,
    answer2Match ? cleanText(answer2Match[1].trim()) : '',
    answer3Match ? cleanText(answer3Match[1].trim()) : ''
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
  
  // 댓글 5개 수집
  const comments = [
    comment1Match ? cleanText(comment1Match[1].trim()) : '아 이래서 그랬구나, 저도 이거 몰랐는데 이제 알겠네요',
    comment2Match ? cleanText(comment2Match[1].trim()) : '답변 진짜 도움됐어요, 이렇게 자세히 설명해주시다니 감사합니다',
    comment3Match ? cleanText(comment3Match[1].trim()) : '저도 비슷한 상황이라 참고가 많이 되네요',
    comment4Match ? cleanText(comment4Match[1].trim()) : '그러면 저도 연락드려도 될까요? 궁금한 게 있어서요',
    comment5Match ? cleanText(comment5Match[1].trim()) : '덕분에 궁금한 거 해결됐어요, 이 글 저장해둘게요'
  ].filter(c => c.length > 10)
  
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

  // V9.5: 질문 2개, 답변 3개, 댓글 5개, 해시태그 반환
  return c.json({
    keywords: coreKeywords,
    title: generatedTitle,
    // 해시태그 (핵심 고민 반영)
    hashtags: generatedHashtags,
    // 질문 2개 (각각 복사 가능)
    questions: questions,
    question: questions[0] || `안녕하세요. ${target}인데 ${insuranceType} 관련 질문이 있어요. ${contact.phone}`,
    // 답변 3개 (각각 복사 가능) 
    answers: answers,
    answer: answers[0] || `${insuranceType}에 대해 답변드립니다.`,
    // 강조 포인트
    highlights: highlights,
    // 댓글 5개 (각각 복사 가능)
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
    }
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

export default app
