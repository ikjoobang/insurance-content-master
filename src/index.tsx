import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  GEMINI_API_KEYS?: string
  NAVER_CLIENT_ID?: string
  NAVER_CLIENT_SECRET?: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/*', cors())

// Gemini API 키 로테이션
const GEMINI_KEYS = [
  'AIzaSyD_XMMAwxEKl23JgQZsUPF9H6cKBiIqZQA',
  'AIzaSyBjbZvUc-YKSFnMhco9sLVKEli2RXbbQuw',
  'AIzaSyCRVYPJ23CWgTL0u4boCbwbcsts0wD8D7M'
]

// 네이버 API 자격증명
const NAVER_CLIENT_ID = 'fUhHJ1HWyF6fFw_aBfkg'
const NAVER_CLIENT_SECRET = 'gA4jUFDYK0'

let currentKeyIndex = 0
let failedKeys = new Set<number>()

function getNextApiKey(): string | null {
  if (failedKeys.size >= GEMINI_KEYS.length) failedKeys.clear()
  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    const idx = (currentKeyIndex + i) % GEMINI_KEYS.length
    if (!failedKeys.has(idx)) {
      currentKeyIndex = (idx + 1) % GEMINI_KEYS.length
      return GEMINI_KEYS[idx]
    }
  }
  return GEMINI_KEYS[0]
}

function markKeyFailed(key: string) {
  const idx = GEMINI_KEYS.indexOf(key)
  if (idx !== -1) failedKeys.add(idx)
}

async function callGeminiAPI(prompt: string, retries = 3): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const apiKey = getNextApiKey()
    if (!apiKey) throw new Error('No API keys available')
    
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
      
      if (!response.ok) { markKeyFailed(apiKey); continue }
      const data = await response.json() as any
      return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    } catch (error) {
      markKeyFailed(apiKey)
    }
  }
  throw new Error('All API keys failed')
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
async function searchNaverKeywords(query: string): Promise<string[]> {
  try {
    const response = await fetch(
      `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(query)}&display=30&sort=sim`,
      {
        headers: {
          'X-Naver-Client-Id': NAVER_CLIENT_ID,
          'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
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
async function getRelatedKeywords(query: string): Promise<string[]> {
  try {
    const response = await fetch(
      `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(query)}&display=10`,
      {
        headers: {
          'X-Naver-Client-Id': NAVER_CLIENT_ID,
          'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
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

// 보험 설계서 HTML 생성 (엑셀 스타일 - 고객 맞춤 상세 보장 내역)
function generateInsuranceDesignHtml(data: {
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
}): string {
  const today = new Date()
  const dateStr = `${today.getFullYear()}. ${today.getMonth() + 1}. ${today.getDate()}.`
  
  // 주계약 행 생성
  const mainRows = data.mainCoverage.map((item, idx) => `
    <tr style="background: ${idx % 2 === 0 ? '#f8fafc' : '#ffffff'};">
      <td style="border: 1px solid #d1d5db; padding: 10px 14px; text-align: center; font-weight: 600; color: #1e40af;">${item.category}</td>
      <td style="border: 1px solid #d1d5db; padding: 10px 14px;">
        <div style="font-weight: 500;">${item.name}</div>
        ${item.note ? `<div style="font-size: 11px; color: #6b7280; margin-top: 2px;">${item.note}</div>` : ''}
      </td>
      <td style="border: 1px solid #d1d5db; padding: 10px 14px; text-align: right; font-weight: 700; color: #059669; font-size: 15px;">${item.coverage}</td>
      <td style="border: 1px solid #d1d5db; padding: 10px 14px; text-align: right; font-weight: 500;">${item.premium}</td>
    </tr>
  `).join('')
  
  // 특약 행 생성
  const riderRows = data.riders.map((item, idx) => `
    <tr style="background: ${idx % 2 === 0 ? '#fffbeb' : '#ffffff'};">
      <td style="border: 1px solid #d1d5db; padding: 10px 14px; text-align: center; font-size: 13px; font-weight: 600; color: #374151;">${idx + 1}</td>
      <td style="border: 1px solid #d1d5db; padding: 10px 14px;">
        <div style="font-weight: 500;">${item.name}</div>
        ${item.note ? `<div style="font-size: 11px; color: #6b7280; margin-top: 2px;">${item.note}</div>` : ''}
      </td>
      <td style="border: 1px solid #d1d5db; padding: 10px 14px; text-align: right; font-weight: 700; color: #059669; font-size: 15px;">${item.coverage}</td>
      <td style="border: 1px solid #d1d5db; padding: 10px 14px; text-align: right; font-weight: 500;">${item.premium}</td>
      <td style="border: 1px solid #d1d5db; padding: 10px 14px; text-align: center; color: #6b7280; font-size: 13px;">${item.period}</td>
    </tr>
  `).join('')
  
  // 특이사항 행 생성
  const notesHtml = data.specialNotes.map(note => `<li style="margin-bottom: 6px; padding-left: 4px;">${note}</li>`).join('')

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Noto Sans KR', sans-serif; background: #f3f4f6; padding: 20px; }
    .container { max-width: 850px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,0.15); }
    .header { background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 50%, #3b82f6 100%); color: white; padding: 24px 28px; }
    .header-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .company-name { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; }
    .doc-type { font-size: 13px; background: rgba(255,255,255,0.25); padding: 8px 20px; border-radius: 25px; font-weight: 600; }
    .product-name { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
    .date { font-size: 12px; opacity: 0.85; }
    .customer-info-section { background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); padding: 20px 28px; border-bottom: 3px solid #3b82f6; }
    .customer-title { font-size: 14px; font-weight: 700; color: #1e40af; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .customer-title::before { content: ''; width: 4px; height: 18px; background: #3b82f6; border-radius: 2px; }
    .customer-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .customer-item { background: white; padding: 14px 16px; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .customer-label { font-size: 11px; color: #6b7280; margin-bottom: 4px; font-weight: 500; }
    .customer-value { font-size: 15px; font-weight: 700; color: #1f2937; }
    .concern-box { margin-top: 16px; background: white; padding: 14px 18px; border-radius: 10px; border-left: 4px solid #f59e0b; }
    .concern-label { font-size: 11px; color: #92400e; margin-bottom: 6px; font-weight: 600; }
    .concern-text { font-size: 13px; color: #374151; line-height: 1.6; }
    .info-section { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: #e5e7eb; border-bottom: 2px solid #1e40af; }
    .info-item { background: white; padding: 14px 18px; text-align: center; }
    .info-label { font-size: 11px; color: #6b7280; margin-bottom: 6px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
    .info-value { font-size: 15px; font-weight: 700; color: #1f2937; }
    .section-title { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 12px 20px; font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .section-title::before { content: ''; width: 6px; height: 6px; background: white; border-radius: 50%; }
    .premium-summary { display: flex; justify-content: space-between; align-items: center; padding: 20px 28px; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-bottom: 3px solid #f59e0b; }
    .premium-label { font-size: 18px; font-weight: 700; color: #92400e; }
    .premium-value { font-size: 32px; font-weight: 800; color: #b45309; letter-spacing: -1px; }
    .reason-section { padding: 20px 28px; background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-bottom: 2px solid #22c55e; }
    .reason-title { font-size: 14px; font-weight: 700; color: #166534; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
    .reason-title::before { content: ''; width: 4px; height: 18px; background: #22c55e; border-radius: 2px; }
    .reason-text { font-size: 13px; color: #166534; line-height: 1.7; background: white; padding: 14px 18px; border-radius: 10px; }
    .notes { padding: 20px 28px; background: #f9fafb; border-top: 1px solid #e5e7eb; }
    .notes-title { font-size: 13px; font-weight: 700; color: #374151; margin-bottom: 10px; }
    .notes-list { font-size: 12px; color: #4b5563; padding-left: 18px; line-height: 1.8; }
    .footer { padding: 14px 28px; background: #1f2937; border-top: 1px solid #374151; font-size: 11px; color: #9ca3af; display: flex; justify-content: space-between; align-items: center; }
    .footer-brand { font-weight: 600; color: #d1d5db; }
  </style>
</head>
<body>
  <div class="container">
    <!-- 헤더 -->
    <div class="header">
      <div class="header-top">
        <span class="company-name">${data.companyName}</span>
        <span class="doc-type">맞춤 설계서</span>
      </div>
      <div class="product-name">${data.productName}</div>
      <div class="date">작성일: ${dateStr}</div>
    </div>
    
    <!-- 고객 맞춤 정보 -->
    <div class="customer-info-section">
      <div class="customer-title">고객 맞춤 설계 정보</div>
      <div class="customer-grid">
        <div class="customer-item">
          <div class="customer-label">고객 유형</div>
          <div class="customer-value">${data.customerTarget}</div>
        </div>
        <div class="customer-item">
          <div class="customer-label">예상 연령</div>
          <div class="customer-value">${data.customerAge}</div>
        </div>
        <div class="customer-item">
          <div class="customer-label">성별</div>
          <div class="customer-value">${data.customerGender}</div>
        </div>
      </div>
      ${data.customerConcern ? `
      <div class="concern-box">
        <div class="concern-label">고객 고민/니즈</div>
        <div class="concern-text">${data.customerConcern}</div>
      </div>
      ` : ''}
    </div>
    
    <!-- 기본 정보 -->
    <div class="info-section">
      <div class="info-item">
        <div class="info-label">보험종류</div>
        <div class="info-value">${data.insuranceType}</div>
      </div>
      <div class="info-item">
        <div class="info-label">피보험자</div>
        <div class="info-value">${data.customerAge} / ${data.customerGender}</div>
      </div>
      <div class="info-item">
        <div class="info-label">납입기간</div>
        <div class="info-value">${data.paymentPeriod}</div>
      </div>
      <div class="info-item">
        <div class="info-label">보장기간</div>
        <div class="info-value">${data.coveragePeriod}</div>
      </div>
    </div>
    
    <!-- 주계약 -->
    <div class="section-title">주계약 보장내역</div>
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="background: #e0e7ff;">
          <th style="border: 1px solid #d1d5db; padding: 10px; width: 15%; font-size: 13px;">구분</th>
          <th style="border: 1px solid #d1d5db; padding: 10px; font-size: 13px;">보장명</th>
          <th style="border: 1px solid #d1d5db; padding: 10px; width: 20%; font-size: 13px;">보장금액</th>
          <th style="border: 1px solid #d1d5db; padding: 10px; width: 15%; font-size: 13px;">보험료</th>
        </tr>
      </thead>
      <tbody>
        ${mainRows}
      </tbody>
    </table>
    
    <!-- 특약 -->
    <div class="section-title">특약 보장내역</div>
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="background: #fef9c3;">
          <th style="border: 1px solid #d1d5db; padding: 10px; width: 8%; font-size: 13px;">No</th>
          <th style="border: 1px solid #d1d5db; padding: 10px; font-size: 13px;">특약명</th>
          <th style="border: 1px solid #d1d5db; padding: 10px; width: 18%; font-size: 13px;">보장금액</th>
          <th style="border: 1px solid #d1d5db; padding: 10px; width: 15%; font-size: 13px;">보험료</th>
          <th style="border: 1px solid #d1d5db; padding: 10px; width: 12%; font-size: 13px;">보장만기</th>
        </tr>
      </thead>
      <tbody>
        ${riderRows}
      </tbody>
    </table>
    
    <!-- 보험료 합계 -->
    <div class="premium-summary">
      <span class="premium-label">월 납입 보험료 합계</span>
      <span class="premium-value">${data.monthlyPremium}</span>
    </div>
    
    <!-- 설계 이유 -->
    ${data.designReason ? `
    <div class="reason-section">
      <div class="reason-title">이 설계를 추천하는 이유</div>
      <div class="reason-text">${data.designReason}</div>
    </div>
    ` : ''}
    
    <!-- 특이사항 -->
    <div class="notes">
      <div class="notes-title">설계 특이사항 및 유의점</div>
      <ul class="notes-list">
        ${notesHtml}
      </ul>
    </div>
    
    <!-- 푸터 -->
    <div class="footer">
      <span class="footer-brand">보험엑시트</span>
      <span>본 설계서는 참고용이며, 실제 보험료는 가입 시점에 따라 변경될 수 있습니다. | 2026년 기준</span>
    </div>
  </div>
</body>
</html>
  `
}

const mainPageHtml = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>보험 콘텐츠 마스터 | AI 기반 Q&A 자동화</title>
  <meta name="description" content="AI 기반 네이버 카페 Q&A 자동 생성 + 설계서 이미지 생성">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <script src="https://html2canvas.hertzen.com/dist/html2canvas.min.js"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'sans-serif'] },
          colors: { 
            primary: '#03C75A', 
            dark: { 900: '#0a0a0a', 800: '#111111', 700: '#1a1a1a' }
          }
        }
      }
    }
  </script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { font-family: 'Inter', sans-serif; background: #0a0a0a; color: #fff; overflow-x: hidden; }
    
    .hero-gradient {
      background: linear-gradient(180deg, #0a0a0a 0%, #0f1419 40%, #0a0a0a 100%);
      position: relative;
    }
    .hero-gradient::before {
      content: '';
      position: absolute;
      top: -20%; left: 50%;
      transform: translateX(-50%);
      width: 150%; max-width: 1800px; height: 80%;
      background: radial-gradient(ellipse at center top, rgba(3, 199, 90, 0.12) 0%, transparent 65%);
      pointer-events: none;
    }
    
    .glass-card {
      background: rgba(255, 255, 255, 0.02);
      backdrop-filter: blur(24px);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 28px;
    }
    
    .input-premium {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .input-premium:focus {
      background: rgba(255, 255, 255, 0.06);
      border-color: #03C75A;
      box-shadow: 0 0 0 4px rgba(3, 199, 90, 0.12);
      outline: none;
    }
    .input-premium::placeholder { color: rgba(255, 255, 255, 0.3); }
    
    .chip {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 100px;
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.6);
      transition: all 0.3s ease;
      cursor: pointer;
    }
    .chip:hover {
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.9);
    }
    .chip.active {
      background: linear-gradient(135deg, rgba(3, 199, 90, 0.2) 0%, rgba(3, 199, 90, 0.1) 100%);
      border-color: rgba(3, 199, 90, 0.5);
      color: #03C75A;
    }
    
    .btn-primary {
      background: linear-gradient(135deg, #03C75A 0%, #00B050 100%);
      border-radius: 16px;
      font-weight: 700;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .btn-primary:hover {
      transform: translateY(-3px);
      box-shadow: 0 12px 40px rgba(3, 199, 90, 0.4);
    }
    .btn-primary:disabled {
      background: linear-gradient(135deg, #374151 0%, #1f2937 100%);
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }
    
    .feature-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 24px;
      transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      cursor: pointer;
    }
    .feature-card:hover {
      transform: translateY(-8px);
      border-color: rgba(255, 255, 255, 0.15);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    }
    .feature-card.active {
      background: linear-gradient(135deg, rgba(3, 199, 90, 0.1) 0%, rgba(3, 199, 90, 0.03) 100%);
      border-color: rgba(3, 199, 90, 0.4);
    }
    
    .result-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 20px;
    }
    .result-content { max-height: 500px; overflow-y: auto; }
    
    .step-badge {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      font-weight: 700;
      font-size: 14px;
    }
    .step-badge.completed { background: #03C75A; color: white; }
    .step-badge.active { background: #3B82F6; color: white; animation: pulse 1s infinite; }
    .step-badge.pending { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.4); }
    
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
      50% { box-shadow: 0 0 0 8px rgba(59, 130, 246, 0); }
    }
    
    .keyword-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      background: rgba(3, 199, 90, 0.15);
      border: 1px solid rgba(3, 199, 90, 0.3);
      border-radius: 100px;
      font-size: 13px;
      color: #03C75A;
      cursor: pointer;
      transition: all 0.2s;
    }
    .keyword-tag:hover {
      background: rgba(3, 199, 90, 0.25);
    }
    
    .spinner {
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-top-color: #fff;
      border-radius: 50%;
      width: 24px; height: 24px;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    
    .toast {
      transform: translateY(120px);
      opacity: 0;
      transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .toast.show { transform: translateY(0); opacity: 1; }
    
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.02); }
    ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 3px; }
    
    .design-preview {
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
  </style>
</head>
<body class="min-h-screen">
  
  <nav class="fixed top-0 left-0 right-0 z-50 px-4 py-4">
    <div class="max-w-7xl mx-auto">
      <div class="glass-card px-6 py-3 flex items-center justify-between">
        <a href="/" class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-emerald-600 flex items-center justify-center shadow-lg shadow-primary/20">
            <i class="fas fa-shield-alt text-white text-lg"></i>
          </div>
          <div class="hidden sm:block">
            <span class="text-lg font-bold text-white">보험 콘텐츠 마스터</span>
            <span class="text-xs text-gray-500 ml-2">V6.2</span>
          </div>
        </a>
        <div class="flex items-center gap-2 sm:gap-4">
          <div class="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
            <span class="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
            <span class="text-xs text-primary font-medium">Naver + Gemini AI</span>
          </div>
          <a href="/admin" class="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-all text-sm">
            <i class="fas fa-cog"></i>
          </a>
        </div>
      </div>
    </div>
  </nav>

  <section class="hero-gradient min-h-screen px-4 pt-28 pb-12">
    <div class="max-w-7xl mx-auto">
      
      <div class="text-center mb-12">
        <div class="inline-flex items-center gap-3 mb-6">
          <span class="px-4 py-2 rounded-full text-sm font-medium bg-white/5 border border-white/10 text-gray-400">
            <i class="fas fa-magic text-primary mr-2"></i>6단계 자동화 파이프라인
          </span>
        </div>
        <h1 class="text-4xl sm:text-5xl md:text-6xl font-black text-white mb-6 leading-tight">
          네이버 카페<br class="sm:hidden">
          <span class="text-transparent bg-clip-text bg-gradient-to-r from-primary via-emerald-400 to-primary">Q&A 완전 자동화</span>
        </h1>
        <p class="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto">
          키워드 분석 - Q&A 생성 - 설계서 이미지까지<br class="sm:hidden"> 원클릭으로 완성
        </p>
      </div>
      
      <div class="grid md:grid-cols-3 gap-4 md:gap-6 mb-10">
        <button onclick="selectFeature('qna')" id="card-qna" class="feature-card active p-6 md:p-8 text-left">
          <div class="flex items-start justify-between mb-6">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 flex items-center justify-center">
              <i class="fas fa-robot text-blue-400 text-2xl"></i>
            </div>
            <span class="px-3 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
              V6.1 NEW
            </span>
          </div>
          <h3 class="text-xl font-bold text-white mb-2">Q&A 완전 자동화</h3>
          <p class="text-gray-400 text-sm leading-relaxed mb-4">네이버 키워드 분석 + Q&A + 설계서 이미지 생성</p>
          <div class="flex items-center gap-2 text-xs text-gray-500">
            <i class="fas fa-clock"></i>
            <span>약 15-20초 소요</span>
          </div>
        </button>
        
        <button onclick="selectFeature('blog')" id="card-blog" class="feature-card p-6 md:p-8 text-left">
          <div class="flex items-start justify-between mb-6">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500/20 to-orange-600/10 flex items-center justify-center">
              <i class="fas fa-pen-fancy text-orange-400 text-2xl"></i>
            </div>
            <span class="px-3 py-1 rounded-full text-xs font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">
              블로그
            </span>
          </div>
          <h3 class="text-xl font-bold text-white mb-2">블로그 생성</h3>
          <p class="text-gray-400 text-sm leading-relaxed mb-4">SEO 최적화 1,700자+ 블로그 글</p>
          <div class="flex items-center gap-2 text-xs text-gray-500">
            <i class="fas fa-clock"></i>
            <span>약 15초 소요</span>
          </div>
        </button>
        
        <button onclick="selectFeature('analyze')" id="card-analyze" class="feature-card p-6 md:p-8 text-left">
          <div class="flex items-start justify-between mb-6">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 flex items-center justify-center">
              <i class="fas fa-chart-line text-purple-400 text-2xl"></i>
            </div>
            <span class="px-3 py-1 rounded-full text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
              분석
            </span>
          </div>
          <h3 class="text-xl font-bold text-white mb-2">블로그 분석</h3>
          <p class="text-gray-400 text-sm leading-relaxed mb-4">SEO/C-RANK/AEO/GEO 점수</p>
          <div class="flex items-center gap-2 text-xs text-gray-500">
            <i class="fas fa-clock"></i>
            <span>약 20초 소요</span>
          </div>
        </button>
      </div>
      
      <div class="glass-card p-6 md:p-10 max-w-4xl mx-auto">
        
        <div id="form-qna" class="space-y-8">
          <div class="flex items-center gap-4 pb-6 border-b border-white/5">
            <div class="w-12 h-12 rounded-2xl bg-blue-500/20 flex items-center justify-center">
              <i class="fas fa-robot text-blue-400 text-xl"></i>
            </div>
            <div>
              <h2 class="text-2xl font-bold text-white">Q&A 완전 자동화</h2>
              <p class="text-gray-400 text-sm">네이버 키워드 분석 - Q&A - 설계서 이미지</p>
            </div>
          </div>
          
          <div id="qna-progress" class="hidden bg-white/5 rounded-2xl p-6">
            <div class="flex items-center justify-between mb-4">
              <span class="text-white font-semibold">생성 진행 상황</span>
              <span id="progress-percent" class="text-primary font-bold">0%</span>
            </div>
            <div class="flex items-center gap-2">
              <div id="step-1" class="flex items-center gap-2">
                <div class="step-badge pending">1</div>
                <span class="text-sm text-gray-400 hidden md:inline">키워드</span>
              </div>
              <div class="flex-1 h-1 bg-white/10 rounded mx-2"></div>
              <div id="step-2" class="flex items-center gap-2">
                <div class="step-badge pending">2</div>
                <span class="text-sm text-gray-400 hidden md:inline">질문</span>
              </div>
              <div class="flex-1 h-1 bg-white/10 rounded mx-2"></div>
              <div id="step-3" class="flex items-center gap-2">
                <div class="step-badge pending">3</div>
                <span class="text-sm text-gray-400 hidden md:inline">답변</span>
              </div>
              <div class="flex-1 h-1 bg-white/10 rounded mx-2"></div>
              <div id="step-4" class="flex items-center gap-2">
                <div class="step-badge pending">4</div>
                <span class="text-sm text-gray-400 hidden md:inline">댓글</span>
              </div>
              <div class="flex-1 h-1 bg-white/10 rounded mx-2"></div>
              <div id="step-5" class="flex items-center gap-2">
                <div class="step-badge pending">5</div>
                <span class="text-sm text-gray-400 hidden md:inline">설계서</span>
              </div>
            </div>
            <p id="progress-status" class="text-gray-500 text-sm mt-4 text-center">준비 중...</p>
          </div>
          
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-users text-blue-400 mr-2"></i>타겟 고객
            </label>
            <div class="flex flex-wrap gap-2" id="qna-target-chips">
              <button onclick="selectChip(this, 'qna-target')" data-value="20대 사회초년생" class="chip">20대 사회초년생</button>
              <button onclick="selectChip(this, 'qna-target')" data-value="30대 직장인" class="chip active">30대 직장인</button>
              <button onclick="selectChip(this, 'qna-target')" data-value="40대 가장" class="chip">40대 가장</button>
              <button onclick="selectChip(this, 'qna-target')" data-value="50대 은퇴준비" class="chip">50대 은퇴준비</button>
              <button onclick="selectChip(this, 'qna-target')" data-value="신혼부부" class="chip">신혼부부</button>
              <button onclick="selectChip(this, 'qna-target')" data-value="자영업자" class="chip">자영업자</button>
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-font text-blue-400 mr-2"></i>문체 톤
            </label>
            <div class="flex flex-wrap gap-2" id="qna-tone-chips">
              <button onclick="selectChip(this, 'qna-tone')" data-value="친근한" class="chip active">친근한</button>
              <button onclick="selectChip(this, 'qna-tone')" data-value="전문적인" class="chip">전문적인</button>
              <button onclick="selectChip(this, 'qna-tone')" data-value="설득력 있는" class="chip">설득력 있는</button>
              <button onclick="selectChip(this, 'qna-tone')" data-value="공감하는" class="chip">공감하는</button>
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-shield-alt text-blue-400 mr-2"></i>보험 종류
            </label>
            <div class="flex flex-wrap gap-2" id="qna-insurance-chips">
              <button onclick="selectChip(this, 'qna-insurance')" data-value="종신보험" class="chip active">종신보험</button>
              <button onclick="selectChip(this, 'qna-insurance')" data-value="암보험" class="chip">암보험</button>
              <button onclick="selectChip(this, 'qna-insurance')" data-value="실손보험" class="chip">실손보험</button>
              <button onclick="selectChip(this, 'qna-insurance')" data-value="연금보험" class="chip">연금보험</button>
              <button onclick="selectChip(this, 'qna-insurance')" data-value="저축보험" class="chip">저축보험</button>
              <button onclick="selectChip(this, 'qna-insurance')" data-value="변액보험" class="chip">변액보험</button>
              <button onclick="selectChip(this, 'qna-insurance')" data-value="어린이보험" class="chip">어린이보험</button>
              <button onclick="selectChip(this, 'qna-insurance')" data-value="운전자보험" class="chip">운전자보험</button>
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-question-circle text-blue-400 mr-2"></i>핵심 고민 <span class="text-gray-500 text-xs">(선택 - 비워두면 자동 생성)</span>
            </label>
            <textarea id="qna-concern" rows="3" placeholder="예: 보험료가 부담되는데 괜찮은 상품이 있을까요?" class="input-premium w-full px-5 py-4 text-white resize-none"></textarea>
          </div>
          
          <div class="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-5">
            <label class="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" id="generate-design" checked class="w-5 h-5 rounded bg-white/10 border-white/20 text-primary focus:ring-primary">
              <div>
                <span class="text-white font-semibold">보험 설계서 이미지 생성</span>
                <p class="text-gray-400 text-sm">엑셀 형태 상세 보장분석 설계서</p>
              </div>
            </label>
          </div>
          
          <button onclick="generateQnAFull()" id="btn-qna" class="btn-primary w-full py-5 text-white text-lg flex items-center justify-center gap-3">
            <i class="fas fa-magic"></i>
            <span>Q&A 완전 자동화 시작</span>
          </button>
        </div>
        
        <div id="form-blog" class="space-y-8 hidden">
          <div class="flex items-center gap-4 pb-6 border-b border-white/5">
            <div class="w-12 h-12 rounded-2xl bg-orange-500/20 flex items-center justify-center">
              <i class="fas fa-pen-fancy text-orange-400 text-xl"></i>
            </div>
            <div>
              <h2 class="text-2xl font-bold text-white">블로그 생성</h2>
              <p class="text-gray-400 text-sm">SEO 최적화 1,700자+ 블로그</p>
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-file-alt text-orange-400 mr-2"></i>콘텐츠 유형
            </label>
            <div class="flex flex-wrap gap-2" id="blog-type-chips">
              <button onclick="selectChip(this, 'blog-type')" data-value="정보성" class="chip active">정보성</button>
              <button onclick="selectChip(this, 'blog-type')" data-value="후기성" class="chip">후기성</button>
              <button onclick="selectChip(this, 'blog-type')" data-value="비교분석" class="chip">비교분석</button>
              <button onclick="selectChip(this, 'blog-type')" data-value="뉴스형" class="chip">뉴스형</button>
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-users text-orange-400 mr-2"></i>타겟 독자
            </label>
            <div class="flex flex-wrap gap-2" id="blog-target-chips">
              <button onclick="selectChip(this, 'blog-target')" data-value="20대" class="chip">20대</button>
              <button onclick="selectChip(this, 'blog-target')" data-value="30대" class="chip active">30대</button>
              <button onclick="selectChip(this, 'blog-target')" data-value="40대" class="chip">40대</button>
              <button onclick="selectChip(this, 'blog-target')" data-value="50대 이상" class="chip">50대+</button>
              <button onclick="selectChip(this, 'blog-target')" data-value="전 연령" class="chip">전 연령</button>
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-heading text-orange-400 mr-2"></i>블로그 주제 <span class="text-red-400">*</span>
            </label>
            <input type="text" id="blog-topic" placeholder="예: 30대 종신보험 추천" class="input-premium w-full px-5 py-4 text-white">
          </div>
          
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-semibold text-white mb-3">
                <i class="fas fa-key text-orange-400 mr-2"></i>핵심 키워드 (쉼표 구분)
              </label>
              <input type="text" id="blog-keywords" placeholder="종신보험, 30대 보험" class="input-premium w-full px-5 py-4 text-white">
            </div>
            <div>
              <label class="block text-sm font-semibold text-white mb-3">
                <i class="fas fa-map-marker-alt text-orange-400 mr-2"></i>지역 (GEO)
              </label>
              <input type="text" id="blog-region" placeholder="서울 강남" class="input-premium w-full px-5 py-4 text-white">
            </div>
          </div>
          
          <button onclick="generateBlog()" id="btn-blog" class="btn-primary w-full py-5 text-white text-lg flex items-center justify-center gap-3" style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);">
            <i class="fas fa-pen-fancy"></i>
            <span>블로그 글 생성하기 (1,700자+)</span>
          </button>
        </div>
        
        <div id="form-analyze" class="space-y-8 hidden">
          <div class="flex items-center gap-4 pb-6 border-b border-white/5">
            <div class="w-12 h-12 rounded-2xl bg-purple-500/20 flex items-center justify-center">
              <i class="fas fa-chart-line text-purple-400 text-xl"></i>
            </div>
            <div>
              <h2 class="text-2xl font-bold text-white">블로그 분석</h2>
              <p class="text-gray-400 text-sm">SEO/C-RANK/AEO/GEO 점수 분석</p>
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-file-alt text-purple-400 mr-2"></i>분석할 블로그 글 <span class="text-red-400">*</span>
            </label>
            <textarea id="analyze-content" rows="8" placeholder="네이버 블로그에 작성한 글 전체를 붙여넣으세요." class="input-premium w-full px-5 py-4 text-white resize-none"></textarea>
          </div>
          
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-semibold text-white mb-3">
                <i class="fas fa-key text-purple-400 mr-2"></i>목표 키워드
              </label>
              <input type="text" id="analyze-keyword" placeholder="강남 종신보험" class="input-premium w-full px-5 py-4 text-white">
            </div>
            <div>
              <label class="block text-sm font-semibold text-white mb-3">
                <i class="fas fa-map-marker-alt text-purple-400 mr-2"></i>목표 지역
              </label>
              <input type="text" id="analyze-region" placeholder="서울 강남구" class="input-premium w-full px-5 py-4 text-white">
            </div>
          </div>
          
          <button onclick="analyzeBlog()" id="btn-analyze" class="btn-primary w-full py-5 text-white text-lg flex items-center justify-center gap-3" style="background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);">
            <i class="fas fa-search-plus"></i>
            <span>블로그 분석하기</span>
          </button>
        </div>
      </div>
    </div>
  </section>

  <section id="resultsSection" class="hidden py-16 px-4 bg-gradient-to-b from-transparent to-gray-900/30">
    <div class="max-w-4xl mx-auto">
      
      <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
        <div>
          <h2 class="text-3xl font-bold text-white mb-2">생성 결과</h2>
          <p id="resultsInfo" class="text-gray-400"></p>
        </div>
        <div class="flex gap-3">
          <button onclick="downloadTxt()" class="flex items-center gap-2 px-5 py-3 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10 transition-all border border-white/10">
            <i class="fas fa-file-alt"></i><span>TXT</span>
          </button>
          <button onclick="downloadPdf()" class="flex items-center gap-2 px-5 py-3 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all border border-red-500/20">
            <i class="fas fa-file-pdf"></i><span>PDF</span>
          </button>
        </div>
      </div>
      
      <div id="result-qna" class="space-y-4 hidden">
        
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <i class="fas fa-search text-primary"></i>
              </div>
              <span class="font-bold text-white">네이버 키워드 분석</span>
            </div>
            <button onclick="copyKeywords()" class="px-4 py-2 rounded-xl bg-primary/20 text-primary hover:bg-primary/30 text-sm">
              <i class="fas fa-copy mr-1"></i> 키워드 복사
            </button>
          </div>
          <div id="qna-keywords" class="flex flex-wrap gap-2"></div>
        </div>
        
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                <i class="fas fa-question-circle text-blue-400"></i>
              </div>
              <div>
                <span class="font-bold text-white">질문</span>
                <span class="text-gray-500 text-sm ml-2">(세컨 아이디용)</span>
              </div>
            </div>
            <button onclick="copyText('qna-q')" class="px-4 py-2 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10 text-sm">
              <i class="fas fa-copy mr-1"></i> 복사
            </button>
          </div>
          <div id="qna-q" class="result-content text-gray-300 whitespace-pre-wrap leading-relaxed bg-white/5 rounded-xl p-4"></div>
        </div>
        
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <i class="fas fa-user-tie text-primary"></i>
              </div>
              <div>
                <span class="font-bold text-white">전문가 답변</span>
                <span class="text-gray-500 text-sm ml-2">(본 아이디용)</span>
              </div>
              <span id="qna-char" class="px-3 py-1 rounded-full bg-primary/20 text-primary text-xs font-bold">0자</span>
            </div>
            <button onclick="copyText('qna-a')" class="px-4 py-2 rounded-xl bg-primary/20 text-primary hover:bg-primary/30 text-sm">
              <i class="fas fa-copy mr-1"></i> 복사
            </button>
          </div>
          <div id="qna-a" class="result-content text-gray-300 whitespace-pre-wrap leading-relaxed bg-white/5 rounded-xl p-4"></div>
          
          <div id="qna-highlights" class="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl hidden">
            <h4 class="font-bold text-yellow-400 text-sm mb-2">핵심 강조 포인트</h4>
            <ul id="qna-highlights-list" class="text-gray-300 text-sm space-y-1"></ul>
          </div>
        </div>
        
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-yellow-500/20 flex items-center justify-center">
                <i class="fas fa-reply-all text-yellow-400"></i>
              </div>
              <span class="font-bold text-white">후기형 댓글 3개</span>
            </div>
            <button onclick="copyText('qna-c')" class="px-4 py-2 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10 text-sm">
              <i class="fas fa-copy mr-1"></i> 복사
            </button>
          </div>
          <div id="qna-c" class="result-content text-gray-300 whitespace-pre-wrap leading-relaxed bg-white/5 rounded-xl p-4"></div>
        </div>
        
        <div id="design-section" class="result-card p-6 hidden">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <i class="fas fa-file-image text-emerald-400"></i>
              </div>
              <span class="font-bold text-white">보험 설계서 (엑셀 스타일)</span>
            </div>
            <button onclick="downloadDesignImage()" class="px-4 py-2 rounded-xl bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-sm">
              <i class="fas fa-download mr-1"></i> 이미지 저장
            </button>
          </div>
          <div id="design-preview" class="design-preview"></div>
        </div>
        
        <button onclick="copyAllQnA()" class="btn-primary w-full py-5 text-white font-bold text-lg flex items-center justify-center gap-3">
          <i class="fas fa-copy"></i>
          <span>전체 복사</span>
        </button>
      </div>
      
      <div id="result-blog" class="space-y-4 hidden">
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
                <i class="fas fa-heading text-orange-400"></i>
              </div>
              <span class="font-bold text-white">제목</span>
            </div>
            <button onclick="copyText('blog-title')" class="px-4 py-2 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10 text-sm">
              <i class="fas fa-copy mr-1"></i> 복사
            </button>
          </div>
          <div id="blog-title" class="text-2xl font-bold text-white bg-white/5 rounded-xl p-4"></div>
        </div>
        
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
                <i class="fas fa-align-left text-orange-400"></i>
              </div>
              <span class="font-bold text-white">본문</span>
              <span id="blog-char" class="px-3 py-1 rounded-full bg-orange-500/20 text-orange-400 text-xs font-bold">0자</span>
            </div>
            <button onclick="copyText('blog-body')" class="px-4 py-2 rounded-xl bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 text-sm">
              <i class="fas fa-copy mr-1"></i> 복사
            </button>
          </div>
          <div id="blog-body" class="result-content text-gray-300 whitespace-pre-wrap leading-relaxed bg-white/5 rounded-xl p-4"></div>
        </div>
        
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <i class="fas fa-hashtag text-primary"></i>
              </div>
              <span class="font-bold text-white">해시태그</span>
            </div>
            <button onclick="copyText('blog-tags')" class="px-4 py-2 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10 text-sm">
              <i class="fas fa-copy mr-1"></i> 복사
            </button>
          </div>
          <div id="blog-tags" class="text-primary font-medium bg-white/5 rounded-xl p-4"></div>
        </div>
        
        <button onclick="copyAllBlog()" class="w-full py-5 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-3" style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);">
          <i class="fas fa-copy"></i>
          <span>전체 복사</span>
        </button>
      </div>
      
      <div id="result-analyze" class="space-y-4 hidden">
        <div class="result-card p-8" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.12) 0%, rgba(124, 58, 237, 0.06) 100%);">
          <div class="flex flex-col md:flex-row items-center justify-between gap-8">
            <div class="text-center md:text-left">
              <p class="text-gray-400 text-sm mb-2">종합 SEO 점수</p>
              <div class="flex items-end gap-2">
                <span id="total-score" class="text-6xl font-black text-white">0</span>
                <span class="text-2xl text-gray-500 mb-2">/100</span>
              </div>
            </div>
            <div class="grid grid-cols-4 gap-6">
              <div class="text-center">
                <p class="text-gray-400 text-xs mb-2">SEO</p>
                <p id="seo-score" class="text-3xl font-black text-primary">-</p>
              </div>
              <div class="text-center">
                <p class="text-gray-400 text-xs mb-2">C-RANK</p>
                <p id="crank-score" class="text-3xl font-black text-yellow-400">-</p>
              </div>
              <div class="text-center">
                <p class="text-gray-400 text-xs mb-2">AEO</p>
                <p id="aeo-score" class="text-3xl font-black text-blue-400">-</p>
              </div>
              <div class="text-center">
                <p class="text-gray-400 text-xs mb-2">GEO</p>
                <p id="geo-score" class="text-3xl font-black text-purple-400">-</p>
              </div>
            </div>
          </div>
        </div>
        
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
                <i class="fas fa-clipboard-check text-purple-400"></i>
              </div>
              <span class="font-bold text-white">상세 분석</span>
            </div>
            <button onclick="copyText('analyze-result')" class="px-4 py-2 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10 text-sm">
              <i class="fas fa-copy mr-1"></i> 복사
            </button>
          </div>
          <div id="analyze-result" class="result-content text-gray-300 whitespace-pre-wrap leading-relaxed bg-white/5 rounded-xl p-4"></div>
        </div>
        
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <i class="fas fa-edit text-primary"></i>
              </div>
              <span class="font-bold text-white">개선안</span>
            </div>
            <button onclick="copyText('analyze-improved')" class="px-4 py-2 rounded-xl bg-primary/20 text-primary hover:bg-primary/30 text-sm">
              <i class="fas fa-copy mr-1"></i> 복사
            </button>
          </div>
          <div id="analyze-improved" class="result-content text-gray-300 whitespace-pre-wrap leading-relaxed bg-white/5 rounded-xl p-4"></div>
        </div>
        
        <button onclick="copyAnalyzeAll()" class="w-full py-5 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-3" style="background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);">
          <i class="fas fa-copy"></i>
          <span>전체 복사</span>
        </button>
      </div>
    </div>
  </section>

  <footer class="py-16 px-4 border-t border-white/5">
    <div class="max-w-6xl mx-auto">
      <div class="flex flex-col md:flex-row items-center justify-between gap-6">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-emerald-600 flex items-center justify-center">
            <i class="fas fa-shield-alt text-white"></i>
          </div>
          <div>
            <p class="font-bold text-white">보험 콘텐츠 마스터 V6.2</p>
            <p class="text-gray-500 text-sm">2026 보험엑시트</p>
          </div>
        </div>
        <div class="flex items-center gap-6">
          <a href="/api/health" class="text-gray-400 hover:text-primary transition-colors text-sm">API Status</a>
          <a href="/admin" class="text-gray-400 hover:text-primary transition-colors text-sm">관리자</a>
        </div>
      </div>
    </div>
  </footer>

  <div id="toast" class="toast fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-4 rounded-2xl bg-gray-800/90 backdrop-blur-lg text-white font-medium shadow-2xl z-50 border border-white/10"></div>

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
      document.getElementById('resultsSection').classList.add('hidden');
    }

    function selectChip(btn, group) {
      btn.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      selections[group] = btn.dataset.value;
    }

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
    
    async function downloadDesignImage() {
      const preview = document.getElementById('design-preview');
      if (!preview.innerHTML) { showToast('설계서가 없습니다'); return; }
      
      try {
        const canvas = await html2canvas(preview, { scale: 2, useCORS: true });
        const link = document.createElement('a');
        link.download = 'insurance_design_' + new Date().toISOString().slice(0,10) + '.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        showToast('이미지 다운로드 완료!');
      } catch (e) {
        showToast('이미지 저장 실패');
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
        
        document.getElementById('qna-q').textContent = data.question;
        document.getElementById('qna-a').textContent = data.answer;
        document.getElementById('qna-c').textContent = data.comments;
        document.getElementById('qna-char').textContent = data.answer.length + '자';
        
        if (data.highlights && data.highlights.length > 0) {
          const highlightsList = document.getElementById('qna-highlights-list');
          highlightsList.innerHTML = data.highlights.map(h => '<li>' + h + '</li>').join('');
          document.getElementById('qna-highlights').classList.remove('hidden');
        } else {
          document.getElementById('qna-highlights').classList.add('hidden');
        }
        
        if (data.designHtml) {
          document.getElementById('design-section').classList.remove('hidden');
          const preview = document.getElementById('design-preview');
          preview.innerHTML = data.designHtml;
        } else {
          document.getElementById('design-section').classList.add('hidden');
        }
        
        document.getElementById('qna-progress').classList.add('hidden');
        document.getElementById('resultsInfo').textContent = 'Q&A 생성 완료 - ' + selections['qna-target'] + ' - ' + generatedKeywords.length + '개 키워드';
        showResults('qna');
        showToast('Q&A 완전 자동화 완료!');
        
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
  <style>
    body { font-family: 'Inter', sans-serif; background: #0a0a0a; color: white; }
    .glass-card { background: rgba(255,255,255,0.03); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; }
  </style>
</head>
<body class="min-h-screen p-4 md:p-8">
  <div class="max-w-6xl mx-auto">
    
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-4">
        <a href="/" class="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
          <i class="fas fa-shield-alt text-white text-xl"></i>
        </a>
        <div>
          <h1 class="text-2xl font-bold text-white">관리자 대시보드</h1>
          <p class="text-gray-500 text-sm">보험 콘텐츠 마스터 V6.2</p>
        </div>
      </div>
      <a href="/" class="px-4 py-2 rounded-xl bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-all text-sm">
        <i class="fas fa-arrow-left mr-2"></i>메인으로
      </a>
    </div>
    
    <div class="grid md:grid-cols-4 gap-6 mb-8">
      <div class="glass-card p-6">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
            <i class="fas fa-server text-green-400 text-xl"></i>
          </div>
          <div>
            <p class="text-gray-400 text-sm">API 상태</p>
            <p id="apiStatus" class="text-white font-bold">확인 중...</p>
          </div>
        </div>
      </div>
      <div class="glass-card p-6">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
            <i class="fab fa-google text-blue-400 text-xl"></i>
          </div>
          <div>
            <p class="text-gray-400 text-sm">Gemini API</p>
            <p class="text-white font-bold">3키 로테이션</p>
          </div>
        </div>
      </div>
      <div class="glass-card p-6">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
            <i class="fas fa-search text-primary text-xl"></i>
          </div>
          <div>
            <p class="text-gray-400 text-sm">Naver API</p>
            <p class="text-white font-bold">연동 완료</p>
          </div>
        </div>
      </div>
      <div class="glass-card p-6">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center">
            <i class="fas fa-code text-purple-400 text-xl"></i>
          </div>
          <div>
            <p class="text-gray-400 text-sm">버전</p>
            <p class="text-white font-bold">V6.2</p>
          </div>
        </div>
      </div>
    </div>
    
    <div class="glass-card p-6 mb-8">
      <h3 class="font-bold text-white text-lg mb-6"><i class="fas fa-link text-blue-400 mr-2"></i>API 엔드포인트</h3>
      <div class="space-y-3">
        <div class="flex items-center justify-between p-4 bg-white/5 rounded-xl">
          <div class="flex items-center gap-3">
            <span class="px-2 py-1 rounded bg-green-500/20 text-green-400 text-xs font-bold">GET</span>
            <span class="text-gray-300">Health Check</span>
          </div>
          <a href="/api/health" target="_blank" class="text-green-400 hover:underline text-sm">/api/health</a>
        </div>
        <div class="flex items-center justify-between p-4 bg-white/5 rounded-xl">
          <div class="flex items-center gap-3">
            <span class="px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-xs font-bold">POST</span>
            <span class="text-gray-300">Q&A 완전 자동화</span>
            <span class="px-2 py-1 rounded bg-primary/20 text-primary text-xs">NEW</span>
          </div>
          <span class="text-gray-500 text-sm">/api/generate/qna-full</span>
        </div>
        <div class="flex items-center justify-between p-4 bg-white/5 rounded-xl">
          <div class="flex items-center gap-3">
            <span class="px-2 py-1 rounded bg-orange-500/20 text-orange-400 text-xs font-bold">POST</span>
            <span class="text-gray-300">블로그 생성</span>
          </div>
          <span class="text-gray-500 text-sm">/api/generate/blog</span>
        </div>
        <div class="flex items-center justify-between p-4 bg-white/5 rounded-xl">
          <div class="flex items-center gap-3">
            <span class="px-2 py-1 rounded bg-purple-500/20 text-purple-400 text-xs font-bold">POST</span>
            <span class="text-gray-300">블로그 분석</span>
          </div>
          <span class="text-gray-500 text-sm">/api/analyze/blog</span>
        </div>
      </div>
    </div>
    
    <div class="glass-card p-6">
      <h3 class="font-bold text-white text-lg mb-4"><i class="fas fa-robot text-primary mr-2"></i>V6.2 업데이트 내용</h3>
      <ul class="space-y-2 text-gray-400 text-sm">
        <li class="flex items-center gap-2"><i class="fas fa-check text-primary"></i> 키워드 복사 기능</li>
        <li class="flex items-center gap-2"><i class="fas fa-check text-primary"></i> 이모티콘/마크다운 완전 제거</li>
        <li class="flex items-center gap-2"><i class="fas fa-check text-primary"></i> 가상 고객명 삭제</li>
        <li class="flex items-center gap-2"><i class="fas fa-check text-primary"></i> 전화번호 형식 (ㅇㅇXX-10XX)</li>
        <li class="flex items-center gap-2"><i class="fas fa-check text-primary"></i> 설계서 고객 맞춤형 재설계</li>
        <li class="flex items-center gap-2"><i class="fas fa-check text-primary"></i> 타겟별 나이/성별 자동 추론</li>
        <li class="flex items-center gap-2"><i class="fas fa-check text-primary"></i> 2026년 기준 업데이트</li>
      </ul>
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
  version: '6.2', 
  ai: 'gemini + naver', 
  year: 2026,
  features: ['keyword-analysis', 'qna-full-auto', 'customer-tailored-design', 'no-emoji'],
  timestamp: new Date().toISOString() 
}))

// 네이버 키워드 검색 API
app.get('/api/naver/keywords', async (c) => {
  const query = c.req.query('q')
  if (!query) return c.json({ error: 'Query required' }, 400)
  
  const keywords = await searchNaverKeywords(query)
  return c.json({ keywords })
})

// Q&A 완전 자동화 API (V6.1)
app.post('/api/generate/qna-full', async (c) => {
  const { target, tone, insuranceType, concern, generateDesign } = await c.req.json()
  
  // 1. 네이버 키워드 분석
  const searchQuery = `${target} ${insuranceType} 추천`
  const naverKeywords = await searchNaverKeywords(searchQuery)
  const relatedKeywords = await getRelatedKeywords(insuranceType)
  
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
    customerConcern = await callGeminiAPI(concernPrompt)
    customerConcern = cleanText(customerConcern.replace(/["\n]/g, '').trim())
  }
  
  // 4. Q&A 생성 프롬프트 (이모티콘/마크다운 금지, 가상 고객명 삭제)
  const qnaPrompt = `당신은 보험 전문 콘텐츠 작성 AI입니다. 네이버 카페용 Q&A를 생성해주세요.

【절대 규칙 - 반드시 지켜야 함】
- 이모티콘 절대 사용 금지 (모든 종류)
- ## 또는 ** 마크다운 사용 금지
- 가상 이름/가명 사용 금지 (예: 홍길동, 김철수 등)
- 순수 텍스트만 작성
- 현재 연도는 2026년

【조건】
- 타겟: ${target}
- 보험 종류: ${insuranceType}
- 문체 톤: ${tone}
- 고민: ${customerConcern}
- 핵심 키워드: ${coreKeywords.join(', ')}
- 연락처: ${contact.phone}

【SEO 최적화 규칙】
1. 핵심 키워드(${coreKeywords.slice(0, 3).join(', ')}) 최소 3회 자연스럽게 포함
2. 전문적인 정보 포함 (2026년 기준)
3. 질문-답변 구조 명확히

【출력 형식 - 반드시 이 형식을 따르세요】
[질문]
(${target}이 ${insuranceType}에 대해 궁금해하는 자연스러운 질문. 200-300자. ${tone} 톤)
- 이름 없이 "안녕하세요" 또는 "제가" 등으로 시작
- 연락처: ${contact.phone}
- 고민 상황 구체적으로 설명

[답변]
(보험 전문가 답변 800자 이상)
- 핵심 요약 3줄
- ${insuranceType}의 장점 3가지 (2026년 기준 구체적 숫자/통계 포함)
- 가입 전 체크포인트 3가지
- 추천 이유와 결론
- ${tone} 톤으로 작성

[강조포인트]
- (핵심 장점 1)
- (핵심 장점 2)
- (핵심 장점 3)

[댓글1]
(공감하는 후기형 댓글 50-80자. 이모티콘 없이)

[댓글2]
(정보 추가/질문하는 댓글 50-80자. 이모티콘 없이)

[댓글3]
(추천/감사 댓글 50-80자. 이모티콘 없이)`

  const qnaResult = await callGeminiAPI(qnaPrompt)
  
  // 파싱
  const questionMatch = qnaResult.match(/\[질문\]([\s\S]*?)(?=\[답변\])/i)
  const answerMatch = qnaResult.match(/\[답변\]([\s\S]*?)(?=\[강조포인트\])/i)
  const highlightsMatch = qnaResult.match(/\[강조포인트\]([\s\S]*?)(?=\[댓글1\])/i)
  const comment1Match = qnaResult.match(/\[댓글1\]([\s\S]*?)(?=\[댓글2\])/i)
  const comment2Match = qnaResult.match(/\[댓글2\]([\s\S]*?)(?=\[댓글3\])/i)
  const comment3Match = qnaResult.match(/\[댓글3\]([\s\S]*?)$/i)
  
  // 강조 포인트 파싱
  let highlights: string[] = []
  if (highlightsMatch) {
    highlights = highlightsMatch[1]
      .split('\n')
      .map(line => cleanText(line.replace(/^[-•*]\s*/, '').trim()))
      .filter(line => line.length > 5)
      .slice(0, 3)
  }
  
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

  // 6. 설계서 이미지 생성 (엑셀 스타일 - 고객 맞춤형)
  let designHtml = ''
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
      const designData = await callGeminiAPI(designPrompt)
      const jsonMatch = designData.match(/\{[\s\S]*\}/)
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        
        designHtml = generateInsuranceDesignHtml({
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
      }
    } catch (e) {
      console.log('Design generation error:', e)
    }
  }
  
  // 텍스트 정리 후 반환
  return c.json({
    keywords: coreKeywords,
    question: cleanText(questionMatch ? questionMatch[1].trim() : `[${target}] ${insuranceType} 가입 고민\n\n${customerConcern}\n\n연락처: ${contact.phone}`),
    answer: cleanText(answerMatch ? answerMatch[1].trim() : `${insuranceType}에 대해 답변 드립니다.`),
    highlights: highlights,
    comments: cleanText([
      comment1Match ? comment1Match[1].trim() : '저도 같은 고민이었어요!',
      comment2Match ? comment2Match[1].trim() : '전문가 답변 감사합니다.',
      comment3Match ? comment3Match[1].trim() : '저도 상담 받아봐야겠네요.'
    ].join('\n\n')),
    designHtml: designHtml
  })
})

// Blog API
app.post('/api/generate/blog', async (c) => {
  const { topic, keywords, region, type, target } = await c.req.json()
  
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
    const result = await callGeminiAPI(prompt)
    
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
    const result = await callGeminiAPI(prompt)
    
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
