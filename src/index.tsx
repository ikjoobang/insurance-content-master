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
    * { margin: 0; padding: 0; box-sizing: border-box; }
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
    
    /* 입력 필드 */
    .input-premium {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      font-size: 0.9rem;
      transition: all 0.15s ease;
      font-weight: 400;
    }
    .input-premium:focus {
      background: rgba(255, 255, 255, 0.05);
      border-color: #03C75A;
      box-shadow: 0 0 0 2px rgba(3, 199, 90, 0.12);
      outline: none;
    }
    .input-premium::placeholder { color: rgba(255, 255, 255, 0.45); font-weight: 400; }
    
    /* 칩 버튼 - 컴팩트 + 가독성 개선 */
    .chip {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 0.8rem;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.85);
      transition: all 0.15s ease;
      cursor: pointer;
      white-space: nowrap;
    }
    @media (min-width: 768px) {
      .chip { padding: 7px 12px; font-size: 0.82rem; border-radius: 8px; }
    }
    @media (min-width: 1024px) {
      .chip { padding: 8px 14px; font-size: 0.85rem; }
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
    
    /* 컨테이너 - 화면 최대 활용 */
    .container-wide { max-width: 1600px; width: 100%; }
    .container-full { max-width: 100%; }
    
    /* 모바일 터치 */
    @media (max-width: 640px) {
      .touch-target { min-height: 42px; }
    }
    
    /* 숨김 스크롤바 (터치 디바이스) */
    .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
    .scrollbar-hide::-webkit-scrollbar { display: none; }
    
    /* 그리드 레이아웃 확장 */
    @media (min-width: 1280px) {
      .xl-grid-3 { grid-template-columns: repeat(3, 1fr); }
    }
    @media (min-width: 1536px) {
      .xxl-gap { gap: 1.5rem; }
    }
    
    /* 섹션 간격 최적화 */
    .section-compact { padding-top: 0.75rem; padding-bottom: 0.75rem; }
    @media (min-width: 768px) {
      .section-compact { padding-top: 1rem; padding-bottom: 1rem; }
    }
    
    /* 텍스트 최적화 */
    .text-balance { text-wrap: balance; }
  </style>
</head>
<body class="min-h-screen">
  
  <!-- 네비게이션 - 최소화 -->
  <nav class="fixed top-0 left-0 right-0 z-50 px-2 py-1.5 sm:px-3 sm:py-2">
    <div class="container-wide mx-auto">
      <div class="glass-card px-3 py-1.5 sm:px-4 sm:py-2 flex items-center justify-between">
        <a href="/" class="flex items-center gap-2">
          <div class="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-to-br from-primary to-emerald-600 flex items-center justify-center">
            <i class="fas fa-shield-alt text-white text-xs sm:text-sm"></i>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="text-xs sm:text-sm font-bold text-white">보험 콘텐츠 마스터</span>
            <span class="text-2xs sm:text-xs text-gray-400 font-medium">V6.4</span>
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

  <!-- 메인 섹션 -->
  <section class="hero-gradient min-h-screen px-2 sm:px-3 lg:px-4 pt-12 sm:pt-14 pb-4 sm:pb-6">
    <div class="container-wide mx-auto">
      
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
            <div class="text-2xs text-gray-400">1,700자+</div>
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
      
      <!-- 폼 영역 -->
      <div class="glass-card p-3 sm:p-4 lg:p-5">
        
        <div id="form-qna" class="space-y-3 sm:space-y-4">
          <!-- 진행 상황 -->
          <div id="qna-progress" class="hidden bg-white/8 rounded-lg p-3">
            <div class="flex items-center justify-between mb-2">
              <span class="text-white font-semibold text-xs">생성 중...</span>
              <span id="progress-percent" class="text-primary font-bold text-xs">0%</span>
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
            <p id="progress-status" class="text-gray-400 text-2xs mt-1.5 text-center">준비 중...</p>
          </div>
          
          <!-- 3열 그리드 (대형 화면) / 2열 (중형) / 1열 (모바일) -->
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            
            <!-- 칼럼 1: 타겟 + 톤 -->
            <div class="space-y-3">
              <div>
                <label class="block text-2xs sm:text-xs font-semibold text-white mb-1.5">
                  <i class="fas fa-users text-blue-400 mr-1"></i>타겟 고객
                </label>
                <div class="flex flex-wrap gap-1 sm:gap-1.5" id="qna-target-chips">
                  <button onclick="selectChip(this, 'qna-target')" data-value="20대 사회초년생" class="chip">20대</button>
                  <button onclick="selectChip(this, 'qna-target')" data-value="30대 직장인" class="chip active">30대</button>
                  <button onclick="selectChip(this, 'qna-target')" data-value="40대 가장" class="chip">40대</button>
                  <button onclick="selectChip(this, 'qna-target')" data-value="50대 은퇴준비" class="chip">50대</button>
                  <button onclick="selectChip(this, 'qna-target')" data-value="신혼부부" class="chip">신혼</button>
                  <button onclick="selectChip(this, 'qna-target')" data-value="자영업자" class="chip">자영업</button>
                </div>
              </div>
              
              <div>
                <label class="block text-2xs sm:text-xs font-semibold text-white mb-1.5">
                  <i class="fas fa-comment-dots text-blue-400 mr-1"></i>문체 톤
                </label>
                <div class="flex flex-wrap gap-1 sm:gap-1.5" id="qna-tone-chips">
                  <button onclick="selectChip(this, 'qna-tone')" data-value="친근한" class="chip active">친근</button>
                  <button onclick="selectChip(this, 'qna-tone')" data-value="전문적인" class="chip">전문</button>
                  <button onclick="selectChip(this, 'qna-tone')" data-value="설득력 있는" class="chip">설득</button>
                  <button onclick="selectChip(this, 'qna-tone')" data-value="공감하는" class="chip">공감</button>
                </div>
              </div>
            </div>
            
            <!-- 칼럼 2: 보험 종류 -->
            <div>
              <label class="block text-2xs sm:text-xs font-semibold text-white mb-1.5">
                <i class="fas fa-shield-alt text-blue-400 mr-1"></i>보험 종류
              </label>
              <div class="flex flex-wrap gap-1 sm:gap-1.5" id="qna-insurance-chips">
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
            
            <!-- 칼럼 3: 고민 + 옵션 + 버튼 -->
            <div class="space-y-3 md:col-span-2 xl:col-span-1">
              <div>
                <label class="block text-2xs sm:text-xs font-semibold text-white mb-1.5">
                  <i class="fas fa-edit text-blue-400 mr-1"></i>핵심 고민 <span class="text-gray-400 text-2xs">(선택)</span>
                </label>
                <textarea id="qna-concern" rows="2" placeholder="비워두면 AI가 자동 생성" class="input-premium w-full px-3 py-2 text-white resize-none text-xs sm:text-sm"></textarea>
              </div>
              
              <div class="flex items-center justify-between gap-3">
                <label class="flex items-center gap-2 cursor-pointer bg-blue-500/10 border border-blue-500/15 rounded-lg px-3 py-2">
                  <input type="checkbox" id="generate-design" checked class="w-3.5 h-3.5 rounded bg-white/10 border-white/20 text-primary focus:ring-primary">
                  <div>
                    <span class="text-white font-medium text-xs">설계서 생성</span>
                  </div>
                </label>
                
                <button onclick="generateQnAFull()" id="btn-qna" class="btn-primary flex-1 py-2.5 sm:py-3 text-white text-xs sm:text-sm flex items-center justify-center gap-1.5 touch-target">
                  <i class="fas fa-magic text-xs"></i>
                  <span>Q&A 생성</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <div id="form-blog" class="space-y-3 sm:space-y-4 hidden">
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            <!-- 칼럼 1: 유형 + 타겟 -->
            <div class="space-y-3">
              <div>
                <label class="block text-2xs sm:text-xs font-semibold text-white mb-1.5">
                  <i class="fas fa-file-alt text-orange-400 mr-1"></i>콘텐츠 유형
                </label>
                <div class="flex flex-wrap gap-1 sm:gap-1.5" id="blog-type-chips">
                  <button onclick="selectChip(this, 'blog-type')" data-value="정보성" class="chip active">정보성</button>
                  <button onclick="selectChip(this, 'blog-type')" data-value="후기성" class="chip">후기성</button>
                  <button onclick="selectChip(this, 'blog-type')" data-value="비교분석" class="chip">비교</button>
                  <button onclick="selectChip(this, 'blog-type')" data-value="뉴스형" class="chip">뉴스</button>
                </div>
              </div>
              
              <div>
                <label class="block text-2xs sm:text-xs font-semibold text-white mb-1.5">
                  <i class="fas fa-users text-orange-400 mr-1"></i>타겟 독자
                </label>
                <div class="flex flex-wrap gap-1 sm:gap-1.5" id="blog-target-chips">
                  <button onclick="selectChip(this, 'blog-target')" data-value="20대" class="chip">20대</button>
                  <button onclick="selectChip(this, 'blog-target')" data-value="30대" class="chip active">30대</button>
                  <button onclick="selectChip(this, 'blog-target')" data-value="40대" class="chip">40대</button>
                  <button onclick="selectChip(this, 'blog-target')" data-value="50대 이상" class="chip">50대+</button>
                  <button onclick="selectChip(this, 'blog-target')" data-value="전 연령" class="chip">전체</button>
                </div>
              </div>
            </div>
            
            <!-- 칼럼 2: 주제 + 키워드/지역 -->
            <div class="space-y-3">
              <div>
                <label class="block text-2xs sm:text-xs font-semibold text-white mb-1.5">
                  <i class="fas fa-heading text-orange-400 mr-1"></i>블로그 주제 <span class="text-red-400">*</span>
                </label>
                <input type="text" id="blog-topic" placeholder="예: 30대 종신보험 추천" class="input-premium w-full px-3 py-2 text-white text-xs sm:text-sm">
              </div>
              
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-2xs sm:text-xs font-semibold text-white mb-1.5">
                    <i class="fas fa-key text-orange-400 mr-1"></i>키워드
                  </label>
                  <input type="text" id="blog-keywords" placeholder="쉼표 구분" class="input-premium w-full px-3 py-2 text-white text-xs sm:text-sm">
                </div>
                <div>
                  <label class="block text-2xs sm:text-xs font-semibold text-white mb-1.5">
                    <i class="fas fa-map-marker-alt text-orange-400 mr-1"></i>지역
                  </label>
                  <input type="text" id="blog-region" placeholder="서울 강남" class="input-premium w-full px-3 py-2 text-white text-xs sm:text-sm">
                </div>
              </div>
            </div>
            
            <!-- 칼럼 3: 버튼 -->
            <div class="flex items-end md:col-span-2 xl:col-span-1">
              <button onclick="generateBlog()" id="btn-blog" class="btn-primary w-full py-2.5 sm:py-3 text-white text-xs sm:text-sm flex items-center justify-center gap-1.5 touch-target" style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);">
                <i class="fas fa-pen-fancy text-xs"></i>
                <span>블로그 생성</span>
              </button>
            </div>
          </div>
        </div>
        
        <div id="form-analyze" class="space-y-3 sm:space-y-4 hidden">
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            <!-- 칼럼 1-2: 분석할 글 -->
            <div class="md:col-span-2 xl:col-span-2">
              <label class="block text-2xs sm:text-xs font-semibold text-white mb-1.5">
                <i class="fas fa-file-alt text-purple-400 mr-1"></i>분석할 블로그 글 <span class="text-red-400">*</span>
              </label>
              <textarea id="analyze-content" rows="4" placeholder="네이버 블로그에 작성한 글을 붙여넣으세요" class="input-premium w-full px-3 py-2 text-white resize-none text-xs sm:text-sm"></textarea>
            </div>
            
            <!-- 칼럼 3: 키워드/지역 + 버튼 -->
            <div class="space-y-3">
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-2xs sm:text-xs font-semibold text-white mb-1.5">
                    <i class="fas fa-key text-purple-400 mr-1"></i>키워드
                  </label>
                  <input type="text" id="analyze-keyword" placeholder="종신보험" class="input-premium w-full px-3 py-2 text-white text-xs sm:text-sm">
                </div>
                <div>
                  <label class="block text-2xs sm:text-xs font-semibold text-white mb-1.5">
                    <i class="fas fa-map-marker-alt text-purple-400 mr-1"></i>지역
                  </label>
                  <input type="text" id="analyze-region" placeholder="강남구" class="input-premium w-full px-3 py-2 text-white text-xs sm:text-sm">
                </div>
              </div>
              
              <button onclick="analyzeBlog()" id="btn-analyze" class="btn-primary w-full py-2.5 sm:py-3 text-white text-xs sm:text-sm flex items-center justify-center gap-1.5 touch-target" style="background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);">
                <i class="fas fa-search-plus text-xs"></i>
                <span>SEO 분석</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section id="resultsSection" class="hidden py-4 sm:py-6 px-2 sm:px-3 lg:px-4">
    <div class="container-wide mx-auto">
      
      <div class="flex items-center justify-between gap-2 mb-3 sm:mb-4">
        <div>
          <h2 class="text-sm sm:text-base lg:text-lg font-bold text-white">생성 결과</h2>
          <p id="resultsInfo" class="text-gray-300 text-2xs sm:text-xs"></p>
        </div>
        <div class="flex gap-1.5">
          <button onclick="downloadTxt()" class="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/5 text-gray-100 hover:bg-white/10 transition-all border border-white/8 text-xs">
            <i class="fas fa-file-alt text-2xs"></i><span class="hidden sm:inline">TXT</span>
          </button>
          <button onclick="downloadPdf()" class="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all border border-red-500/15 text-xs">
            <i class="fas fa-file-pdf text-2xs"></i><span class="hidden sm:inline">PDF</span>
          </button>
        </div>
      </div>
      
      <!-- Q&A 결과 - 3열 그리드 -->
      <div id="result-qna" class="hidden">
        <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3 mb-3">
          <!-- 키워드 -->
          <div class="result-card p-3">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-1.5">
                <div class="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center">
                  <i class="fas fa-search text-primary text-2xs"></i>
                </div>
                <span class="font-semibold text-white text-xs">키워드</span>
              </div>
              <button onclick="copyKeywords()" class="px-2 py-1 rounded-md bg-primary/20 text-primary hover:bg-primary/30 text-2xs">
                <i class="fas fa-copy"></i>
              </button>
            </div>
            <div id="qna-keywords" class="flex flex-wrap gap-1"></div>
          </div>
          
          <!-- 질문 -->
          <div class="result-card p-3">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-1.5">
                <div class="w-6 h-6 rounded-md bg-blue-500/20 flex items-center justify-center">
                  <i class="fas fa-question text-blue-400 text-2xs"></i>
                </div>
                <span class="font-semibold text-white text-xs">질문</span>
                <span class="text-gray-400 text-2xs">(세컨)</span>
              </div>
              <button onclick="copyText('qna-q')" class="px-2 py-1 rounded-md bg-white/5 text-gray-100 hover:bg-white/10 text-2xs">
                <i class="fas fa-copy"></i>
              </button>
            </div>
            <div id="qna-q" class="result-content text-gray-100 whitespace-pre-wrap leading-relaxed bg-white/8 rounded-lg p-2.5 text-xs"></div>
          </div>
          
          <!-- 댓글 -->
          <div class="result-card p-3">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-1.5">
                <div class="w-6 h-6 rounded-md bg-yellow-500/20 flex items-center justify-center">
                  <i class="fas fa-comments text-yellow-400 text-2xs"></i>
                </div>
                <span class="font-semibold text-white text-xs">댓글</span>
              </div>
              <button onclick="copyText('qna-c')" class="px-2 py-1 rounded-md bg-white/5 text-gray-100 hover:bg-white/10 text-2xs">
                <i class="fas fa-copy"></i>
              </button>
            </div>
            <div id="qna-c" class="result-content text-gray-100 whitespace-pre-wrap leading-relaxed bg-white/8 rounded-lg p-2.5 text-xs"></div>
          </div>
        </div>
        
        <!-- 답변 + 설계서 - 2열 -->
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-2 sm:gap-3 mb-3">
          <div class="result-card p-3">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-1.5">
                <div class="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center">
                  <i class="fas fa-user-tie text-primary text-2xs"></i>
                </div>
                <span class="font-semibold text-white text-xs">전문가 답변</span>
                <span class="text-gray-400 text-2xs">(본계정)</span>
                <span id="qna-char" class="px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-2xs font-semibold">0자</span>
              </div>
              <button onclick="copyText('qna-a')" class="px-2 py-1 rounded-md bg-primary/20 text-primary hover:bg-primary/30 text-2xs">
                <i class="fas fa-copy"></i>
              </button>
            </div>
            <div id="qna-a" class="result-content text-gray-100 whitespace-pre-wrap leading-relaxed bg-white/8 rounded-lg p-2.5 text-xs"></div>
            
            <div id="qna-highlights" class="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/15 rounded-lg hidden">
              <h4 class="font-semibold text-yellow-400 text-2xs mb-1">핵심 포인트</h4>
              <ul id="qna-highlights-list" class="text-gray-100 text-2xs space-y-0.5"></ul>
            </div>
          </div>
          
          <!-- 설계서 (텍스트 표 형식 - 복사 가능) -->
          <div id="design-section" class="result-card p-3 hidden">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-1.5">
                <div class="w-6 h-6 rounded-md bg-emerald-500/20 flex items-center justify-center">
                  <i class="fas fa-table text-emerald-400 text-2xs"></i>
                </div>
                <span class="font-semibold text-white text-xs">설계서</span>
                <span class="text-gray-400 text-2xs">(복사용)</span>
              </div>
              <div class="flex gap-1">
                <button onclick="copyDesignText()" class="px-2 py-1 rounded-md bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-2xs" title="텍스트 복사 (카페/블로그용)">
                  <i class="fas fa-copy mr-1"></i>복사
                </button>
              </div>
            </div>
            <div id="design-preview" class="design-preview overflow-auto max-h-80 sm:max-h-96 lg:max-h-[500px] rounded-lg"></div>
            <!-- 복사용 텍스트 (숨김) -->
            <textarea id="design-text-content" class="hidden"></textarea>
          </div>
        </div>
        
        <button onclick="copyAllQnA()" class="btn-primary w-full py-2.5 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5">
          <i class="fas fa-copy text-xs"></i>
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
            <p class="font-semibold text-white text-xs">보험 콘텐츠 마스터 V6.4</p>
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
          // 텍스트 버전 저장 (복사용)
          if (data.designText) {
            document.getElementById('design-text-content').value = data.designText;
          }
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
          <p class="text-gray-400 text-xs">보험 콘텐츠 마스터 V6.4</p>
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
            <p class="text-white font-semibold text-xs sm:text-sm">V6.4</p>
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
      <h3 class="font-semibold text-white text-sm mb-3"><i class="fas fa-robot text-green-400 mr-1.5"></i>V6.4 업데이트</h3>
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
  version: '6.4', 
  ai: 'gemini + naver', 
  year: 2026,
  features: ['keyword-analysis', 'qna-full-auto', 'customer-tailored-design', 'no-emoji', 'responsive-ui', 'excel-style-design', 'one-click-copy'],
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

  // 6. 설계서 생성 (텍스트 표 형식 - 복사/붙여넣기용 + HTML 표시용)
  let designHtml = ''
  let designText = ''
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
    designHtml: designHtml,
    designText: designText
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
