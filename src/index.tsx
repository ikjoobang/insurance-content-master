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
    
    // 제목과 설명에서 자주 등장하는 키워드 추출
    const allText = items.map((item: any) => 
      (item.title + ' ' + item.description)
        .replace(/<[^>]*>/g, '') // HTML 태그 제거
        .replace(/&[^;]+;/g, '') // HTML 엔티티 제거
    ).join(' ')
    
    // 한글 키워드 추출 (2-6글자)
    const koreanWords = allText.match(/[가-힣]{2,8}/g) || []
    
    // 빈도수 계산
    const wordCount: Record<string, number> = {}
    koreanWords.forEach(word => {
      // 불용어 제외
      const stopWords = ['있습니다', '합니다', '입니다', '됩니다', '합니다', '그리고', '하지만', '그러나', '때문에', '대해서', '관련해', '라고', '이라고']
      if (!stopWords.some(sw => word.includes(sw))) {
        wordCount[word] = (wordCount[word] || 0) + 1
      }
    })
    
    // 상위 키워드 반환 (쿼리 관련 키워드 우선)
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
    
    // 제목에서 키워드 추출
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

// 가상 연락처 생성
function generateVirtualContact(): { name: string, phone: string, kakao: string } {
  const surnames = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임']
  const givenNames = ['민준', '서연', '예준', '서윤', '도윤', '지우', '시우', '하은', '주원', '하윤', '지호', '수아', '준서', '지아', '현우', '소율']
  
  const surname = surnames[Math.floor(Math.random() * surnames.length)]
  const givenName = givenNames[Math.floor(Math.random() * givenNames.length)]
  const name = surname + givenName
  
  // 가상 전화번호
  const prefix = ['010', '010', '010'][Math.floor(Math.random() * 3)]
  const mid = String(Math.floor(1000 + Math.random() * 9000))
  const last = String(Math.floor(1000 + Math.random() * 9000))
  const phone = `${prefix}-${mid}-${last}`
  
  // 가상 카카오톡 ID
  const kakaoId = `ins_${surname.charCodeAt(0) % 100}_${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`
  
  return { name, phone, kakao: `카카오톡: ${kakaoId}` }
}

// 설계서 이미지 HTML 생성 (표 형식)
function generateInsuranceTableHtml(data: {
  title: string,
  customerName: string,
  customerAge: string,
  customerGender: string,
  insuranceType: string,
  items: Array<{name: string, coverage: string, premium: string, period: string}>
  totalPremium: string,
  highlights: string[]
}): string {
  const itemRows = data.items.map((item, idx) => `
    <tr class="${idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}">
      <td class="px-4 py-3 text-center font-medium">${idx + 1}</td>
      <td class="px-4 py-3">${item.name}</td>
      <td class="px-4 py-3 text-right font-semibold text-blue-600">${item.coverage}</td>
      <td class="px-4 py-3 text-right">${item.premium}</td>
      <td class="px-4 py-3 text-center text-gray-600">${item.period}</td>
    </tr>
  `).join('')

  const highlightItems = data.highlights.map(h => `
    <li class="flex items-start gap-2">
      <span class="text-primary font-bold">✓</span>
      <span>${h}</span>
    </li>
  `).join('')

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap');
    body { font-family: 'Noto Sans KR', sans-serif; }
    .primary { color: #03C75A; }
    .bg-primary { background-color: #03C75A; }
  </style>
</head>
<body class="bg-gray-100 p-6">
  <div class="max-w-2xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden">
    
    <!-- Header -->
    <div class="bg-gradient-to-r from-emerald-600 to-green-500 px-6 py-5">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-white text-2xl font-bold">${data.title}</h1>
          <p class="text-emerald-100 text-sm mt-1">보험 설계 제안서</p>
        </div>
        <div class="bg-white/20 rounded-xl px-4 py-2">
          <span class="text-white font-bold">${data.insuranceType}</span>
        </div>
      </div>
    </div>
    
    <!-- Customer Info -->
    <div class="px-6 py-4 bg-gray-50 border-b border-gray-200">
      <div class="flex items-center gap-8">
        <div class="flex items-center gap-2">
          <span class="text-gray-500 text-sm">피보험자:</span>
          <span class="font-semibold">${data.customerName}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-gray-500 text-sm">연령:</span>
          <span class="font-semibold">${data.customerAge}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-gray-500 text-sm">성별:</span>
          <span class="font-semibold">${data.customerGender}</span>
        </div>
      </div>
    </div>
    
    <!-- Coverage Table -->
    <div class="p-6">
      <h3 class="font-bold text-gray-800 mb-4">📋 보장 내역</h3>
      <div class="overflow-hidden rounded-xl border border-gray-200">
        <table class="w-full text-sm">
          <thead class="bg-gray-800 text-white">
            <tr>
              <th class="px-4 py-3 text-center w-12">순번</th>
              <th class="px-4 py-3 text-left">가입담보</th>
              <th class="px-4 py-3 text-right">가입금액</th>
              <th class="px-4 py-3 text-right">보험료</th>
              <th class="px-4 py-3 text-center">만기</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
          <tfoot class="bg-emerald-50 border-t-2 border-emerald-500">
            <tr>
              <td colspan="3" class="px-4 py-4 font-bold text-gray-800">월 납입 보험료 합계</td>
              <td class="px-4 py-4 text-right font-bold text-2xl text-emerald-600">${data.totalPremium}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
    
    <!-- Highlights -->
    <div class="px-6 pb-6">
      <h3 class="font-bold text-gray-800 mb-3">⭐ 핵심 포인트</h3>
      <div class="bg-emerald-50 rounded-xl p-4 border border-emerald-200">
        <ul class="space-y-2 text-sm text-gray-700">
          ${highlightItems}
        </ul>
      </div>
    </div>
    
    <!-- Footer -->
    <div class="px-6 py-4 bg-gray-100 border-t border-gray-200">
      <div class="flex items-center justify-between">
        <p class="text-xs text-gray-500">※ 이 자료는 참고용이며, 실제 보험료는 가입 시점에 따라 다를 수 있습니다.</p>
        <p class="text-xs text-gray-400">${new Date().toLocaleDateString('ko-KR')}</p>
      </div>
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
    
    /* Hero Gradient */
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
    
    /* Glass Morphism */
    .glass-card {
      background: rgba(255, 255, 255, 0.02);
      backdrop-filter: blur(24px);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 28px;
    }
    
    /* Input Styles */
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
    
    /* Chip / Tag Buttons */
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
    
    /* Primary Button */
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
    
    /* Feature Cards */
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
    
    /* Result Cards */
    .result-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 20px;
    }
    .result-content { max-height: 500px; overflow-y: auto; }
    
    /* Progress Steps */
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
    
    /* Keyword Tags */
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
    }
    
    /* Spinner */
    .spinner {
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-top-color: #fff;
      border-radius: 50%;
      width: 24px; height: 24px;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    
    /* Toast */
    .toast {
      transform: translateY(120px);
      opacity: 0;
      transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .toast.show { transform: translateY(0); opacity: 1; }
    
    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.02); }
    ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 3px; }
    
    /* Image Preview */
    .design-preview {
      background: white;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
  </style>
</head>
<body class="min-h-screen">
  
  <!-- Navigation -->
  <nav class="fixed top-0 left-0 right-0 z-50 px-4 py-4">
    <div class="max-w-7xl mx-auto">
      <div class="glass-card px-6 py-3 flex items-center justify-between">
        <a href="/" class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-emerald-600 flex items-center justify-center shadow-lg shadow-primary/20">
            <i class="fas fa-shield-alt text-white text-lg"></i>
          </div>
          <div class="hidden sm:block">
            <span class="text-lg font-bold text-white">보험 콘텐츠 마스터</span>
            <span class="text-xs text-gray-500 ml-2">V6.0</span>
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

  <!-- Hero Section -->
  <section class="hero-gradient min-h-screen px-4 pt-28 pb-12">
    <div class="max-w-7xl mx-auto">
      
      <!-- Header -->
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
          키워드 분석 → Q&A 생성 → 설계서 이미지까지<br class="sm:hidden"> 원클릭으로 완성
        </p>
      </div>
      
      <!-- Feature Cards -->
      <div class="grid md:grid-cols-3 gap-4 md:gap-6 mb-10">
        <button onclick="selectFeature('qna')" id="card-qna" class="feature-card active p-6 md:p-8 text-left">
          <div class="flex items-start justify-between mb-6">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 flex items-center justify-center">
              <i class="fas fa-robot text-blue-400 text-2xl"></i>
            </div>
            <span class="px-3 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
              V6.0 NEW
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
      
      <!-- Main Form -->
      <div class="glass-card p-6 md:p-10 max-w-4xl mx-auto">
        
        <!-- ========== Q&A 완전 자동화 폼 ========== -->
        <div id="form-qna" class="space-y-8">
          <div class="flex items-center gap-4 pb-6 border-b border-white/5">
            <div class="w-12 h-12 rounded-2xl bg-blue-500/20 flex items-center justify-center">
              <i class="fas fa-robot text-blue-400 text-xl"></i>
            </div>
            <div>
              <h2 class="text-2xl font-bold text-white">Q&A 완전 자동화</h2>
              <p class="text-gray-400 text-sm">네이버 키워드 분석 → Q&A → 설계서 이미지</p>
            </div>
          </div>
          
          <!-- Progress Indicator -->
          <div id="qna-progress" class="hidden bg-white/5 rounded-2xl p-6">
            <div class="flex items-center justify-between mb-4">
              <span class="text-white font-semibold">생성 진행 상황</span>
              <span id="progress-percent" class="text-primary font-bold">0%</span>
            </div>
            <div class="flex items-center gap-2">
              <div id="step-1" class="flex items-center gap-2">
                <div class="step-badge pending">1</div>
                <span class="text-sm text-gray-400 hidden md:inline">키워드 분석</span>
              </div>
              <div class="flex-1 h-1 bg-white/10 rounded mx-2"></div>
              <div id="step-2" class="flex items-center gap-2">
                <div class="step-badge pending">2</div>
                <span class="text-sm text-gray-400 hidden md:inline">질문 생성</span>
              </div>
              <div class="flex-1 h-1 bg-white/10 rounded mx-2"></div>
              <div id="step-3" class="flex items-center gap-2">
                <div class="step-badge pending">3</div>
                <span class="text-sm text-gray-400 hidden md:inline">답변 생성</span>
              </div>
              <div class="flex-1 h-1 bg-white/10 rounded mx-2"></div>
              <div id="step-4" class="flex items-center gap-2">
                <div class="step-badge pending">4</div>
                <span class="text-sm text-gray-400 hidden md:inline">댓글 생성</span>
              </div>
              <div class="flex-1 h-1 bg-white/10 rounded mx-2"></div>
              <div id="step-5" class="flex items-center gap-2">
                <div class="step-badge pending">5</div>
                <span class="text-sm text-gray-400 hidden md:inline">설계서</span>
              </div>
            </div>
            <p id="progress-status" class="text-gray-500 text-sm mt-4 text-center">준비 중...</p>
          </div>
          
          <!-- 타겟 고객 -->
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-users text-blue-400 mr-2"></i>타겟 고객
            </label>
            <div class="flex flex-wrap gap-2" id="qna-target-chips">
              <button onclick="selectChip(this, 'qna-target')" data-value="20대 사회초년생" class="chip">👶 20대 사회초년생</button>
              <button onclick="selectChip(this, 'qna-target')" data-value="30대 직장인" class="chip active">👔 30대 직장인</button>
              <button onclick="selectChip(this, 'qna-target')" data-value="40대 가장" class="chip">👨‍👩‍👧 40대 가장</button>
              <button onclick="selectChip(this, 'qna-target')" data-value="50대 은퇴준비" class="chip">🏖️ 50대 은퇴준비</button>
              <button onclick="selectChip(this, 'qna-target')" data-value="신혼부부" class="chip">💑 신혼부부</button>
              <button onclick="selectChip(this, 'qna-target')" data-value="자영업자" class="chip">🏪 자영업자</button>
            </div>
          </div>
          
          <!-- 문체 톤 -->
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-font text-blue-400 mr-2"></i>문체 톤
            </label>
            <div class="flex flex-wrap gap-2" id="qna-tone-chips">
              <button onclick="selectChip(this, 'qna-tone')" data-value="친근한" class="chip active">😊 친근한</button>
              <button onclick="selectChip(this, 'qna-tone')" data-value="전문적인" class="chip">🎓 전문적인</button>
              <button onclick="selectChip(this, 'qna-tone')" data-value="설득력 있는" class="chip">💪 설득력 있는</button>
              <button onclick="selectChip(this, 'qna-tone')" data-value="공감하는" class="chip">🤝 공감하는</button>
            </div>
          </div>
          
          <!-- 보험 종류 -->
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-shield-alt text-blue-400 mr-2"></i>보험 종류
            </label>
            <div class="flex flex-wrap gap-2" id="qna-insurance-chips">
              <button onclick="selectChip(this, 'qna-insurance')" data-value="종신보험" class="chip active">🛡️ 종신보험</button>
              <button onclick="selectChip(this, 'qna-insurance')" data-value="암보험" class="chip">🏥 암보험</button>
              <button onclick="selectChip(this, 'qna-insurance')" data-value="실손보험" class="chip">💊 실손보험</button>
              <button onclick="selectChip(this, 'qna-insurance')" data-value="연금보험" class="chip">🏦 연금보험</button>
              <button onclick="selectChip(this, 'qna-insurance')" data-value="저축보험" class="chip">💰 저축보험</button>
              <button onclick="selectChip(this, 'qna-insurance')" data-value="변액보험" class="chip">📈 변액보험</button>
              <button onclick="selectChip(this, 'qna-insurance')" data-value="어린이보험" class="chip">👶 어린이보험</button>
              <button onclick="selectChip(this, 'qna-insurance')" data-value="운전자보험" class="chip">🚗 운전자보험</button>
            </div>
          </div>
          
          <!-- 고민 입력 (선택) -->
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-question-circle text-blue-400 mr-2"></i>핵심 고민 <span class="text-gray-500 text-xs">(선택 - 비워두면 자동 생성)</span>
            </label>
            <textarea id="qna-concern" rows="3" placeholder="예: 보험료가 부담되는데 괜찮은 상품이 있을까요?" class="input-premium w-full px-5 py-4 text-white resize-none"></textarea>
          </div>
          
          <!-- 설계서 생성 옵션 -->
          <div class="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-5">
            <label class="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" id="generate-design" checked class="w-5 h-5 rounded bg-white/10 border-white/20 text-primary focus:ring-primary">
              <div>
                <span class="text-white font-semibold">설계서 이미지 생성</span>
                <p class="text-gray-400 text-sm">보장분석 표 형식 설계 제안서 이미지</p>
              </div>
            </label>
          </div>
          
          <button onclick="generateQnAFull()" id="btn-qna" class="btn-primary w-full py-5 text-white text-lg flex items-center justify-center gap-3">
            <i class="fas fa-magic"></i>
            <span>Q&A 완전 자동화 시작</span>
          </button>
        </div>
        
        <!-- ========== 블로그 생성 폼 ========== -->
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
          
          <!-- 콘텐츠 유형 -->
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-file-alt text-orange-400 mr-2"></i>콘텐츠 유형
            </label>
            <div class="flex flex-wrap gap-2" id="blog-type-chips">
              <button onclick="selectChip(this, 'blog-type')" data-value="정보성" class="chip active">📚 정보성</button>
              <button onclick="selectChip(this, 'blog-type')" data-value="후기성" class="chip">⭐ 후기성</button>
              <button onclick="selectChip(this, 'blog-type')" data-value="비교분석" class="chip">⚖️ 비교분석</button>
              <button onclick="selectChip(this, 'blog-type')" data-value="뉴스형" class="chip">📰 뉴스형</button>
            </div>
          </div>
          
          <!-- 타겟 독자 -->
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-users text-orange-400 mr-2"></i>타겟 독자
            </label>
            <div class="flex flex-wrap gap-2" id="blog-target-chips">
              <button onclick="selectChip(this, 'blog-target')" data-value="20대" class="chip">👶 20대</button>
              <button onclick="selectChip(this, 'blog-target')" data-value="30대" class="chip active">👔 30대</button>
              <button onclick="selectChip(this, 'blog-target')" data-value="40대" class="chip">👨‍👩‍👧 40대</button>
              <button onclick="selectChip(this, 'blog-target')" data-value="50대 이상" class="chip">🏖️ 50대+</button>
              <button onclick="selectChip(this, 'blog-target')" data-value="전 연령" class="chip">👥 전 연령</button>
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
        
        <!-- ========== 분석 폼 ========== -->
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

  <!-- Results Section -->
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
      
      <!-- Q&A 결과 (확장) -->
      <div id="result-qna" class="space-y-4 hidden">
        
        <!-- 키워드 분석 결과 -->
        <div class="result-card p-6">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <i class="fas fa-search text-primary"></i>
            </div>
            <span class="font-bold text-white">네이버 키워드 분석</span>
          </div>
          <div id="qna-keywords" class="flex flex-wrap gap-2"></div>
        </div>
        
        <!-- 질문 -->
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
          <div class="flex items-center gap-2 mt-3">
            <span class="text-gray-500 text-xs">가상 고객:</span>
            <span id="qna-customer" class="text-primary text-sm font-medium"></span>
          </div>
        </div>
        
        <!-- 답변 -->
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
          
          <!-- 강조 포인트 -->
          <div id="qna-highlights" class="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl hidden">
            <h4 class="font-bold text-yellow-400 text-sm mb-2">⭐ 핵심 강조 포인트</h4>
            <ul id="qna-highlights-list" class="text-gray-300 text-sm space-y-1"></ul>
          </div>
        </div>
        
        <!-- 댓글 -->
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
        
        <!-- 설계서 이미지 -->
        <div id="design-section" class="result-card p-6 hidden">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <i class="fas fa-file-image text-emerald-400"></i>
              </div>
              <span class="font-bold text-white">보험 설계서</span>
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
      
      <!-- 블로그 결과 -->
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
      
      <!-- 분석 결과 -->
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

  <!-- Footer -->
  <footer class="py-16 px-4 border-t border-white/5">
    <div class="max-w-6xl mx-auto">
      <div class="flex flex-col md:flex-row items-center justify-between gap-6">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-emerald-600 flex items-center justify-center">
            <i class="fas fa-shield-alt text-white"></i>
          </div>
          <div>
            <p class="font-bold text-white">보험 콘텐츠 마스터 V6.0</p>
            <p class="text-gray-500 text-sm">© 2025 개발자: 방익주</p>
          </div>
        </div>
        <div class="flex items-center gap-6">
          <a href="/api/health" class="text-gray-400 hover:text-primary transition-colors text-sm">API Status</a>
          <a href="/admin" class="text-gray-400 hover:text-primary transition-colors text-sm">관리자</a>
        </div>
      </div>
    </div>
  </footer>

  <!-- Toast -->
  <div id="toast" class="toast fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-4 rounded-2xl bg-gray-800/90 backdrop-blur-lg text-white font-medium shadow-2xl z-50 border border-white/10"></div>

  <script>
    // State
    let currentFeature = 'qna';
    let generatedDesignHtml = '';
    const selections = {
      'qna-target': '30대 직장인',
      'qna-tone': '친근한',
      'qna-insurance': '종신보험',
      'blog-type': '정보성',
      'blog-target': '30대',
      'analyze-type': '종합 분석'
    };

    // Feature Selection
    function selectFeature(feature) {
      currentFeature = feature;
      document.querySelectorAll('.feature-card').forEach(c => c.classList.remove('active'));
      document.getElementById('card-' + feature).classList.add('active');
      document.querySelectorAll('[id^="form-"]').forEach(f => f.classList.add('hidden'));
      document.getElementById('form-' + feature).classList.remove('hidden');
      document.getElementById('resultsSection').classList.add('hidden');
    }

    // Chip Selection
    function selectChip(btn, group) {
      btn.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      selections[group] = btn.dataset.value;
    }

    // Toast
    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // Copy Functions
    function copyText(id) {
      navigator.clipboard.writeText(document.getElementById(id).textContent).then(() => showToast('📋 복사 완료!'));
    }

    function copyAllQnA() {
      const all = '【질문】\\n' + document.getElementById('qna-q').textContent + '\\n\\n【답변】\\n' + document.getElementById('qna-a').textContent + '\\n\\n【댓글】\\n' + document.getElementById('qna-c').textContent;
      navigator.clipboard.writeText(all).then(() => showToast('📋 전체 복사 완료!'));
    }

    function copyAllBlog() {
      const all = document.getElementById('blog-title').textContent + '\\n\\n' + document.getElementById('blog-body').textContent + '\\n\\n' + document.getElementById('blog-tags').textContent;
      navigator.clipboard.writeText(all).then(() => showToast('📋 전체 복사 완료!'));
    }

    function copyAnalyzeAll() {
      const all = '【분석】\\n' + document.getElementById('analyze-result').textContent + '\\n\\n【개선안】\\n' + document.getElementById('analyze-improved').textContent;
      navigator.clipboard.writeText(all).then(() => showToast('📋 전체 복사 완료!'));
    }

    // Download Functions
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
      showToast('📥 TXT 다운로드 완료!');
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
      showToast('📥 PDF 다운로드 완료!');
    }
    
    // 설계서 이미지 다운로드
    async function downloadDesignImage() {
      const preview = document.getElementById('design-preview');
      if (!preview.innerHTML) { showToast('⚠️ 설계서가 없습니다'); return; }
      
      try {
        const canvas = await html2canvas(preview, { scale: 2, useCORS: true });
        const link = document.createElement('a');
        link.download = 'insurance_design_' + new Date().toISOString().slice(0,10) + '.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        showToast('📥 이미지 다운로드 완료!');
      } catch (e) {
        showToast('❌ 이미지 저장 실패');
      }
    }

    // Progress UI
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

    // Loading State
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

    // Show Results
    function showResults(type) {
      document.getElementById('resultsSection').classList.remove('hidden');
      document.querySelectorAll('[id^="result-"]').forEach(r => r.classList.add('hidden'));
      document.getElementById('result-' + type).classList.remove('hidden');
      document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
    }

    // ========== Q&A 완전 자동화 API ==========
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
        
        // 키워드 표시
        const keywordsDiv = document.getElementById('qna-keywords');
        keywordsDiv.innerHTML = data.keywords.map(kw => 
          '<span class="keyword-tag"><i class="fas fa-hashtag text-xs"></i>' + kw + '</span>'
        ).join('');
        
        // Q&A 표시
        document.getElementById('qna-q').textContent = data.question;
        document.getElementById('qna-a').textContent = data.answer;
        document.getElementById('qna-c').textContent = data.comments;
        document.getElementById('qna-char').textContent = data.answer.length + '자';
        document.getElementById('qna-customer').textContent = data.customerInfo || '';
        
        // 강조 포인트
        if (data.highlights && data.highlights.length > 0) {
          const highlightsList = document.getElementById('qna-highlights-list');
          highlightsList.innerHTML = data.highlights.map(h => '<li>• ' + h + '</li>').join('');
          document.getElementById('qna-highlights').classList.remove('hidden');
        }
        
        // 설계서 이미지
        if (data.designHtml) {
          document.getElementById('design-section').classList.remove('hidden');
          const preview = document.getElementById('design-preview');
          preview.innerHTML = data.designHtml;
          generatedDesignHtml = data.designHtml;
        } else {
          document.getElementById('design-section').classList.add('hidden');
        }
        
        document.getElementById('qna-progress').classList.add('hidden');
        document.getElementById('resultsInfo').textContent = 'Q&A 생성 완료 · ' + selections['qna-target'] + ' · ' + data.keywords.length + '개 키워드';
        showResults('qna');
        showToast('✨ Q&A 완전 자동화 완료!');
        
      } catch (e) {
        console.error(e);
        showToast('❌ 생성 실패. 다시 시도해주세요.');
        document.getElementById('qna-progress').classList.add('hidden');
      }
      
      setLoading('btn-qna', false);
    }

    // ========== 블로그 생성 API ==========
    async function generateBlog() {
      const topic = document.getElementById('blog-topic').value.trim();
      if (!topic) { showToast('⚠️ 블로그 주제를 입력해주세요'); return; }
      
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
        document.getElementById('resultsInfo').textContent = '블로그 생성 완료 · ' + data.content.length + '자';
        showResults('blog');
        showToast('✨ 블로그 글 생성 완료!');
      } catch (e) { showToast('❌ 생성 실패'); }
      setLoading('btn-blog', false);
    }

    // ========== 분석 API ==========
    async function analyzeBlog() {
      const content = document.getElementById('analyze-content').value.trim();
      if (!content) { showToast('⚠️ 분석할 글을 입력해주세요'); return; }
      
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
        document.getElementById('resultsInfo').textContent = '분석 완료 · 종합 ' + data.totalScore + '점';
        showResults('analyze');
        showToast('📊 블로그 분석 완료!');
      } catch (e) { showToast('❌ 분석 실패'); }
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
          <p class="text-gray-500 text-sm">보험 콘텐츠 마스터 V6.0</p>
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
            <p class="text-white font-bold">V6.0</p>
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
        <div class="flex items-center justify-between p-4 bg-white/5 rounded-xl">
          <div class="flex items-center gap-3">
            <span class="px-2 py-1 rounded bg-primary/20 text-primary text-xs font-bold">GET</span>
            <span class="text-gray-300">네이버 키워드 검색</span>
          </div>
          <span class="text-gray-500 text-sm">/api/naver/keywords</span>
        </div>
      </div>
    </div>
    
    <div class="glass-card p-6">
      <h3 class="font-bold text-white text-lg mb-4"><i class="fas fa-robot text-primary mr-2"></i>V6.0 새로운 기능</h3>
      <ul class="space-y-2 text-gray-400 text-sm">
        <li class="flex items-center gap-2"><i class="fas fa-check text-primary"></i> 네이버 API 키워드 자동 분석</li>
        <li class="flex items-center gap-2"><i class="fas fa-check text-primary"></i> 6단계 Q&A 완전 자동화 파이프라인</li>
        <li class="flex items-center gap-2"><i class="fas fa-check text-primary"></i> 보험 설계서 이미지 자동 생성</li>
        <li class="flex items-center gap-2"><i class="fas fa-check text-primary"></i> 가상 고객 정보 자동 생성</li>
        <li class="flex items-center gap-2"><i class="fas fa-check text-primary"></i> SEO/C-RANK/AEO/GEO 최적화</li>
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
  version: '6.0', 
  ai: 'gemini + naver', 
  features: ['keyword-analysis', 'qna-full-auto', 'design-image'],
  timestamp: new Date().toISOString() 
}))

// 네이버 키워드 검색 API
app.get('/api/naver/keywords', async (c) => {
  const query = c.req.query('q')
  if (!query) return c.json({ error: 'Query required' }, 400)
  
  const keywords = await searchNaverKeywords(query)
  return c.json({ keywords })
})

// Q&A 완전 자동화 API (V6.0 핵심 기능)
app.post('/api/generate/qna-full', async (c) => {
  const { target, tone, insuranceType, concern, generateDesign } = await c.req.json()
  
  // 1. 네이버 키워드 분석
  const searchQuery = `${target} ${insuranceType} 추천`
  const naverKeywords = await searchNaverKeywords(searchQuery)
  const relatedKeywords = await getRelatedKeywords(insuranceType)
  
  // 핵심 키워드 선정 (3개 이상)
  const allKeywords = [...new Set([insuranceType, ...naverKeywords.slice(0, 5), ...relatedKeywords.slice(0, 3)])]
  const coreKeywords = allKeywords.slice(0, 6)
  
  // 2. 가상 고객 생성
  const customer = generateVirtualContact()
  
  // 3. 고민/질문 자동 생성 (비어있으면)
  let customerConcern = concern
  if (!customerConcern) {
    const concernPrompt = `당신은 ${target}입니다. ${insuranceType}에 대해 네이버 카페에 질문하려고 합니다.
현실적이고 구체적인 고민을 50자 이내로 작성해주세요.
예: "종신보험 가입 고민인데, 보험료가 부담되고 해지하면 손해라던데 어떤 상품이 좋을까요?"
반드시 한 문장으로 작성하세요.`
    customerConcern = await callGeminiAPI(concernPrompt)
    customerConcern = customerConcern.replace(/["\n]/g, '').trim()
  }
  
  // 4. Q&A 생성 프롬프트
  const qnaPrompt = `당신은 보험 전문 콘텐츠 작성 AI입니다. 네이버 카페용 Q&A를 생성해주세요.

【조건】
- 타겟: ${target}
- 보험 종류: ${insuranceType}
- 문체 톤: ${tone}
- 고민: ${customerConcern}
- 가상 고객: ${customer.name}
- 핵심 키워드: ${coreKeywords.join(', ')}

【SEO 최적화 규칙】
1. 핵심 키워드(${coreKeywords.slice(0, 3).join(', ')}) 최소 3회 자연스럽게 포함
2. C-RANK: 전문적인 정보와 출처 명시
3. AEO: 질문-답변 구조 명확히
4. GEO: 필요시 지역 정보 언급

【출력 형식 - 반드시 이 형식을 따르세요】
[질문]
(${target}이 ${insuranceType}에 대해 궁금해하는 자연스러운 질문. 200-300자. ${tone} 톤)
- 가상 고객명: ${customer.name}
- 연락처: ${customer.phone}
- 고민 상황 구체적으로 설명

[답변]
(보험 전문가 답변 800자 이상)
✅ 핵심 요약 3줄
✅ ${insuranceType}의 장점 3가지 (구체적 숫자/통계 포함)
✅ 가입 전 체크포인트 3가지
✅ 추천 이유와 결론
- ${tone} 톤으로 작성
- 키워드 자연스럽게 포함

[강조포인트]
- (핵심 장점 1)
- (핵심 장점 2)
- (핵심 장점 3)

[댓글1]
(공감하는 후기형 댓글 50-80자)

[댓글2]
(정보 추가/질문하는 댓글 50-80자)

[댓글3]
(추천/감사 댓글 50-80자, ${customer.kakao} 자연스럽게 언급 가능)`

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
      .map(line => line.replace(/^[-•]\s*/, '').trim())
      .filter(line => line.length > 5)
      .slice(0, 3)
  }
  
  // 5. 설계서 이미지 생성
  let designHtml = ''
  if (generateDesign) {
    // 설계서 데이터 생성
    const designPrompt = `${insuranceType} 보험 설계서용 보장 내역을 JSON으로 생성해주세요.

【조건】
- 타겟: ${target}
- 보험 종류: ${insuranceType}
- 현실적인 보험료와 보장금액 설정

【출력 형식 - 반드시 JSON만 출력】
{
  "items": [
    {"name": "사망보장", "coverage": "1억원", "premium": "45,000원", "period": "90세"},
    {"name": "암진단", "coverage": "5,000만원", "premium": "32,000원", "period": "90세"}
  ],
  "totalPremium": "125,000원",
  "highlights": ["비갱신형으로 보험료 인상 없음", "해지환급금 100% 보장", "추가납입으로 적립금 증대 가능"]
}`

    try {
      const designData = await callGeminiAPI(designPrompt)
      const jsonMatch = designData.match(/\{[\s\S]*\}/)
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        
        // 나이 추출
        const ageMatch = target.match(/(\d+)대/)
        const age = ageMatch ? ageMatch[1] + '세' : '35세'
        
        designHtml = generateInsuranceTableHtml({
          title: `${insuranceType} 보장분석`,
          customerName: customer.name,
          customerAge: age,
          customerGender: '남성',
          insuranceType: insuranceType,
          items: parsed.items || [],
          totalPremium: parsed.totalPremium || '월 100,000원',
          highlights: parsed.highlights || highlights
        })
      }
    } catch (e) {
      console.log('Design generation error:', e)
    }
  }
  
  return c.json({
    keywords: coreKeywords,
    customerInfo: `${customer.name} (${customer.phone})`,
    question: questionMatch ? questionMatch[1].trim() : `[${target}] ${insuranceType} 가입 고민\n\n${customerConcern}\n\n연락처: ${customer.phone}`,
    answer: answerMatch ? answerMatch[1].trim() : `${insuranceType}에 대해 답변 드립니다.`,
    highlights: highlights,
    comments: [
      comment1Match ? comment1Match[1].trim() : '저도 같은 고민이었어요!',
      comment2Match ? comment2Match[1].trim() : '전문가 답변 감사합니다.',
      comment3Match ? comment3Match[1].trim() : '저도 상담 받아봐야겠네요.'
    ].join('\n\n'),
    designHtml: designHtml
  })
})

// 기존 Q&A API (호환성 유지)
app.post('/api/generate/qna', async (c) => {
  const { product, concern, target, tone, insuranceType, contact } = await c.req.json()
  
  const prompt = `당신은 보험 전문 콘텐츠 작성 AI입니다. 네이버 카페용 Q&A를 생성해주세요.

【조건】
- 보험 종류: ${insuranceType || '종신보험'}
- 구체적 상품명: ${product}
- 타겟: ${target}
- 문체 톤: ${tone || '친근한'}
- 고민: ${concern}

【출력 형식】
[질문]
(${target}이 ${product}에 대해 궁금해하는 자연스러운 질문)

[답변]
(전문가 답변 800자 이상)

[댓글1]
(공감하는 댓글)

[댓글2]
(정보 추가 댓글)

[댓글3]
(상담 권유 댓글)`

  try {
    const result = await callGeminiAPI(prompt)
    
    const questionMatch = result.match(/\[질문\]([\s\S]*?)(?=\[답변\])/i)
    const answerMatch = result.match(/\[답변\]([\s\S]*?)(?=\[댓글1\])/i)
    const comment1Match = result.match(/\[댓글1\]([\s\S]*?)(?=\[댓글2\])/i)
    const comment2Match = result.match(/\[댓글2\]([\s\S]*?)(?=\[댓글3\])/i)
    const comment3Match = result.match(/\[댓글3\]([\s\S]*?)$/i)
    
    return c.json({
      question: questionMatch ? questionMatch[1].trim() : `[${target}] ${product} 가입 고민`,
      answer: answerMatch ? answerMatch[1].trim() : `${product}에 대한 답변입니다.`,
      comments: [
        comment1Match ? comment1Match[1].trim() : '저도 같은 고민!',
        comment2Match ? comment2Match[1].trim() : '좋은 정보 감사합니다.',
        comment3Match ? comment3Match[1].trim() : '저도 가입 고려해봐야겠네요.'
      ].join('\n\n')
    })
  } catch (error) {
    return c.json({
      question: `[${target}] ${product} 가입 고민이에요`,
      answer: `${product} 관련 답변입니다.`,
      comments: '저도 같은 고민이었어요!\n\n전문가 답변 감사합니다.\n\n저도 가입 고려해봐야겠네요.'
    })
  }
})

// Blog API
app.post('/api/generate/blog', async (c) => {
  const { topic, keywords, region, type, target } = await c.req.json()
  
  const prompt = `당신은 네이버 블로그 SEO 전문 작성 AI입니다.

【조건】
- 주제: ${topic}
- 키워드: ${keywords || topic}
- 지역: ${region || '전국'}
- 유형: ${type}
- 타겟: ${target}

【규칙】
1. 본문 1,700자 이상
2. 키워드 3회+ 포함
3. [📷 이미지 삽입] 3-4회
4. > 3줄 요약 포함
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
      title: titleMatch ? titleMatch[1].trim() : `${topic}, 이것만 알면 끝!`,
      content: contentMatch ? contentMatch[1].trim() : '',
      hashtags: hashtagMatch ? hashtagMatch[1].trim() : `#${topic.replace(/\s/g, '')}`
    })
  } catch (error) {
    return c.json({
      title: `${topic}, 완벽 가이드`,
      content: `> 📌 3줄 요약\n> 1. ${topic}의 핵심\n> 2. ${target}을 위한 정보\n> 3. 실용적인 가이드\n\n[📷 이미지 삽입]\n\n${topic}에 대해 알아보겠습니다...`,
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

【출력 형식】
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
      analysis: analysisMatch ? analysisMatch[1].trim() : '분석 결과',
      improved: improvedMatch ? improvedMatch[1].trim() : '개선안'
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
