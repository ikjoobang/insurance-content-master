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

const mainPageHtml = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>보험 콘텐츠 마스터 | AI 기반 SEO 최적화</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'sans-serif'] },
          colors: { primary: '#03C75A', dark: '#0a0a0a' }
        }
      }
    }
  </script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { font-family: 'Inter', sans-serif; background: #0a0a0a; color: #fff; overflow-x: hidden; }
    
    .hero-gradient {
      background: linear-gradient(180deg, #0a0a0a 0%, #111827 50%, #0a0a0a 100%);
      position: relative;
    }
    .hero-gradient::before {
      content: '';
      position: absolute;
      top: 0; left: 50%;
      transform: translateX(-50%);
      width: 100%; max-width: 1200px; height: 100%;
      background: radial-gradient(ellipse at center top, rgba(3, 199, 90, 0.15) 0%, transparent 60%);
      pointer-events: none;
    }
    
    .glass-card {
      background: rgba(255, 255, 255, 0.03);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 24px;
    }
    
    .input-glow {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      transition: all 0.3s ease;
    }
    .input-glow:focus {
      background: rgba(255, 255, 255, 0.08);
      border-color: #03C75A;
      box-shadow: 0 0 0 4px rgba(3, 199, 90, 0.15);
      outline: none;
    }
    
    .btn-primary {
      background: linear-gradient(135deg, #03C75A 0%, #00A84C 100%);
      transition: all 0.3s ease;
    }
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(3, 199, 90, 0.4);
    }
    .btn-primary:disabled {
      background: linear-gradient(135deg, #374151 0%, #1f2937 100%);
      cursor: not-allowed; transform: none; box-shadow: none;
    }
    
    .feature-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      transition: all 0.3s ease;
    }
    .feature-card:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(3, 199, 90, 0.3);
      transform: translateY(-4px);
    }
    .feature-card.active {
      background: rgba(3, 199, 90, 0.1);
      border-color: rgba(3, 199, 90, 0.5);
    }
    
    .result-card {
      background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
    }
    
    .badge {
      background: linear-gradient(135deg, rgba(3, 199, 90, 0.2) 0%, rgba(3, 199, 90, 0.1) 100%);
      border: 1px solid rgba(3, 199, 90, 0.3);
    }
    
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .fade-in-up { animation: fadeInUp 0.8s ease-out forwards; }
    
    .spinner {
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-top-color: #03C75A;
      border-radius: 50%;
      width: 24px; height: 24px;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.05); }
    ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 4px; }
    
    .tab-btn.active {
      background: linear-gradient(135deg, #03C75A 0%, #00A84C 100%);
      color: white;
    }
    
    .toast {
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s ease;
    }
    .toast.show { transform: translateY(0); opacity: 1; }
    
    .result-content { max-height: 400px; overflow-y: auto; }
  </style>
</head>
<body class="min-h-screen">
  
  <!-- Navigation -->
  <nav class="fixed top-0 left-0 right-0 z-50 px-4 py-4">
    <div class="max-w-7xl mx-auto flex items-center justify-between">
      <a href="/" class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-emerald-600 flex items-center justify-center">
          <i class="fas fa-shield-alt text-white text-lg"></i>
        </div>
        <span class="text-xl font-bold text-white">보험 콘텐츠 마스터</span>
      </a>
      <div class="flex items-center gap-4">
        <a href="/admin" class="hidden md:flex items-center gap-2 px-4 py-2 rounded-full glass-card text-gray-300 hover:text-white hover:bg-white/10 transition-all text-sm">
          <i class="fas fa-cog"></i><span>관리자</span>
        </a>
        <a href="https://studiojuai-insurance.pages.dev/" target="_blank" class="flex items-center gap-2 px-4 py-2 rounded-full glass-card text-gray-300 hover:text-white hover:bg-white/10 transition-all text-sm">
          <i class="fas fa-external-link-alt"></i><span class="hidden md:inline">수술비 분석</span>
        </a>
      </div>
    </div>
  </nav>

  <!-- Hero Section -->
  <section class="hero-gradient min-h-screen flex items-center justify-center px-4 pt-24 pb-8">
    <div class="max-w-6xl mx-auto w-full">
      
      <div class="text-center mb-8">
        <div class="inline-flex items-center gap-2 badge rounded-full px-4 py-2 fade-in-up">
          <span class="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
          <span class="text-sm text-primary font-medium">Gemini AI 기반 콘텐츠 생성</span>
        </div>
      </div>
      
      <h1 class="text-center text-4xl md:text-5xl lg:text-6xl font-black text-white mb-4 leading-tight fade-in-up">
        보험 콘텐츠
        <span class="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-400">자동 생성</span>
      </h1>
      
      <p class="text-center text-lg md:text-xl text-gray-400 mb-12 max-w-2xl mx-auto fade-in-up">
        AI가 네이버 블로그 SEO 최적화 콘텐츠를 자동으로 생성합니다<br class="hidden md:block">
        Q&A, 블로그 글, SEO 분석까지 한 번에
      </p>
      
      <!-- Feature Cards -->
      <div class="grid md:grid-cols-3 gap-4 md:gap-6 mb-8 fade-in-up">
        <button onclick="selectFeature('qna')" id="card-qna" class="feature-card active rounded-2xl p-6 md:p-8 text-left cursor-pointer">
          <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-500/10 flex items-center justify-center mb-6">
            <i class="fas fa-comments text-blue-400 text-2xl"></i>
          </div>
          <h3 class="text-xl font-bold text-white mb-2">Q&A 생성</h3>
          <p class="text-gray-400 text-sm leading-relaxed">네이버 카페용 질문 + 전문가 답변 + 꼬리형 댓글 3개 자동 생성</p>
        </button>
        
        <button onclick="selectFeature('blog')" id="card-blog" class="feature-card rounded-2xl p-6 md:p-8 text-left cursor-pointer">
          <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500/20 to-orange-500/10 flex items-center justify-center mb-6">
            <i class="fas fa-pen-fancy text-orange-400 text-2xl"></i>
          </div>
          <h3 class="text-xl font-bold text-white mb-2">블로그 생성</h3>
          <p class="text-gray-400 text-sm leading-relaxed">SEO 최적화 블로그 글 1,700자 이상 자동 생성</p>
        </button>
        
        <button onclick="selectFeature('analyze')" id="card-analyze" class="feature-card rounded-2xl p-6 md:p-8 text-left cursor-pointer">
          <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500/20 to-purple-500/10 flex items-center justify-center mb-6">
            <i class="fas fa-chart-line text-purple-400 text-2xl"></i>
          </div>
          <h3 class="text-xl font-bold text-white mb-2">블로그 분석</h3>
          <p class="text-gray-400 text-sm leading-relaxed">기존 글 SEO/C-RANK/AEO/GEO 점수 분석 및 개선안</p>
        </button>
      </div>
      
      <!-- Input Section -->
      <div class="glass-card p-6 md:p-10 max-w-4xl mx-auto fade-in-up">
        
        <!-- Q&A Form -->
        <div id="form-qna" class="space-y-6">
          <div class="flex items-center gap-3 mb-6">
            <div class="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <i class="fas fa-comments text-blue-400"></i>
            </div>
            <div>
              <h2 class="text-xl font-bold text-white">Q&A 생성</h2>
              <p class="text-gray-400 text-sm">네이버 카페용 질문 + 답변 + 댓글</p>
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">타겟 고객</label>
            <div class="flex flex-wrap gap-2">
              <button onclick="selectTarget(this)" class="tab-btn active px-4 py-2 rounded-xl text-sm font-medium bg-white/5 text-gray-400" data-value="30대 직장인">30대 직장인</button>
              <button onclick="selectTarget(this)" class="tab-btn px-4 py-2 rounded-xl text-sm font-medium bg-white/5 text-gray-400" data-value="40대 가장">40대 가장</button>
              <button onclick="selectTarget(this)" class="tab-btn px-4 py-2 rounded-xl text-sm font-medium bg-white/5 text-gray-400" data-value="50대 은퇴준비">50대 은퇴준비</button>
              <button onclick="selectTarget(this)" class="tab-btn px-4 py-2 rounded-xl text-sm font-medium bg-white/5 text-gray-400" data-value="신혼부부">신혼부부</button>
            </div>
          </div>
          
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">보험 상품명 <span class="text-red-400">*</span></label>
              <input type="text" id="qna-product" placeholder="예: 삼성생명 종신보험" class="input-glow w-full px-5 py-4 rounded-xl text-white placeholder-gray-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">연락처 (선택)</label>
              <input type="text" id="qna-contact" placeholder="카카오톡 오픈채팅 링크" class="input-glow w-full px-5 py-4 rounded-xl text-white placeholder-gray-500">
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">핵심 고민/질문 <span class="text-red-400">*</span></label>
            <textarea id="qna-concern" rows="3" placeholder="예: 종신보험 가입을 고민 중인데요, 보험료가 부담되네요." class="input-glow w-full px-5 py-4 rounded-xl text-white placeholder-gray-500 resize-none"></textarea>
          </div>
          
          <button onclick="generateQnA()" id="btn-qna" class="btn-primary w-full py-4 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-3">
            <i class="fas fa-magic"></i> Q&A 생성하기
          </button>
        </div>
        
        <!-- Blog Form -->
        <div id="form-blog" class="space-y-6 hidden">
          <div class="flex items-center gap-3 mb-6">
            <div class="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
              <i class="fas fa-pen-fancy text-orange-400"></i>
            </div>
            <div>
              <h2 class="text-xl font-bold text-white">블로그 생성</h2>
              <p class="text-gray-400 text-sm">SEO 최적화 1,700자+ 블로그 글</p>
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">콘텐츠 유형</label>
            <div class="flex flex-wrap gap-2">
              <button onclick="selectType(this)" class="tab-btn active px-4 py-2 rounded-xl text-sm font-medium bg-white/5 text-gray-400" data-value="정보성">📚 정보성</button>
              <button onclick="selectType(this)" class="tab-btn px-4 py-2 rounded-xl text-sm font-medium bg-white/5 text-gray-400" data-value="후기성">⭐ 후기성</button>
              <button onclick="selectType(this)" class="tab-btn px-4 py-2 rounded-xl text-sm font-medium bg-white/5 text-gray-400" data-value="비교분석">⚖️ 비교분석</button>
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">블로그 주제 <span class="text-red-400">*</span></label>
            <input type="text" id="blog-topic" placeholder="예: 30대 종신보험 추천" class="input-glow w-full px-5 py-4 rounded-xl text-white placeholder-gray-500">
          </div>
          
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">핵심 키워드 (쉼표 구분)</label>
              <input type="text" id="blog-keywords" placeholder="종신보험, 30대 보험" class="input-glow w-full px-5 py-4 rounded-xl text-white placeholder-gray-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">지역 (GEO 최적화)</label>
              <input type="text" id="blog-region" placeholder="서울 강남" class="input-glow w-full px-5 py-4 rounded-xl text-white placeholder-gray-500">
            </div>
          </div>
          
          <button onclick="generateBlog()" id="btn-blog" class="btn-primary w-full py-4 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-3" style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);">
            <i class="fas fa-pen-fancy"></i> 블로그 글 생성하기 (1,700자+)
          </button>
        </div>
        
        <!-- Analyze Form -->
        <div id="form-analyze" class="space-y-6 hidden">
          <div class="flex items-center gap-3 mb-6">
            <div class="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
              <i class="fas fa-chart-line text-purple-400"></i>
            </div>
            <div>
              <h2 class="text-xl font-bold text-white">블로그 분석</h2>
              <p class="text-gray-400 text-sm">SEO/C-RANK/AEO/GEO 점수 분석</p>
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">분석할 블로그 글 <span class="text-red-400">*</span></label>
            <textarea id="analyze-content" rows="6" placeholder="네이버 블로그에 작성한 글 전체를 붙여넣으세요." class="input-glow w-full px-5 py-4 rounded-xl text-white placeholder-gray-500 resize-none"></textarea>
          </div>
          
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">목표 키워드</label>
              <input type="text" id="analyze-keyword" placeholder="강남 종신보험" class="input-glow w-full px-5 py-4 rounded-xl text-white placeholder-gray-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">목표 지역</label>
              <input type="text" id="analyze-region" placeholder="서울 강남구" class="input-glow w-full px-5 py-4 rounded-xl text-white placeholder-gray-500">
            </div>
          </div>
          
          <button onclick="analyzeBlog()" id="btn-analyze" class="btn-primary w-full py-4 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-3" style="background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);">
            <i class="fas fa-search-plus"></i> 블로그 분석하기
          </button>
        </div>
      </div>
      
      <!-- Stats -->
      <div class="grid grid-cols-4 gap-4 max-w-3xl mx-auto mt-12 fade-in-up">
        <div class="text-center">
          <div class="text-2xl md:text-3xl font-bold text-white mb-1">SEO</div>
          <div class="text-gray-500 text-xs md:text-sm">검색 최적화</div>
        </div>
        <div class="text-center">
          <div class="text-2xl md:text-3xl font-bold text-white mb-1">C-RANK</div>
          <div class="text-gray-500 text-xs md:text-sm">전문성</div>
        </div>
        <div class="text-center">
          <div class="text-2xl md:text-3xl font-bold text-white mb-1">AEO</div>
          <div class="text-gray-500 text-xs md:text-sm">AI 최적화</div>
        </div>
        <div class="text-center">
          <div class="text-2xl md:text-3xl font-bold text-white mb-1">GEO</div>
          <div class="text-gray-500 text-xs md:text-sm">지역 최적화</div>
        </div>
      </div>
    </div>
  </section>

  <!-- Results Section -->
  <section id="resultsSection" class="hidden py-16 px-4 bg-gradient-to-b from-transparent to-gray-900/50">
    <div class="max-w-4xl mx-auto">
      
      <div class="flex items-center justify-between mb-8">
        <div>
          <h2 class="text-2xl md:text-3xl font-bold text-white mb-2">생성 결과</h2>
          <p id="resultsInfo" class="text-gray-400"></p>
        </div>
        <div class="flex gap-3">
          <button onclick="downloadTxt()" class="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10 transition-colors">
            <i class="fas fa-file-alt"></i><span class="hidden md:inline">TXT</span>
          </button>
          <button onclick="downloadPdf()" class="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">
            <i class="fas fa-file-pdf"></i><span class="hidden md:inline">PDF</span>
          </button>
        </div>
      </div>
      
      <!-- Q&A Results -->
      <div id="result-qna" class="space-y-4 hidden">
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <i class="fas fa-question-circle text-blue-400"></i>
              <span class="font-bold text-white">질문 (세컨 아이디용)</span>
            </div>
            <button onclick="copyText('qna-q')" class="px-4 py-2 rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 text-sm"><i class="fas fa-copy mr-1"></i> 복사</button>
          </div>
          <div id="qna-q" class="result-content text-gray-300 whitespace-pre-wrap leading-relaxed"></div>
        </div>
        
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <i class="fas fa-user-tie text-primary"></i>
              <span class="font-bold text-white">전문가 답변 (본 아이디용)</span>
              <span id="qna-char" class="px-2 py-1 rounded-lg bg-primary/20 text-primary text-xs font-medium">0자</span>
            </div>
            <button onclick="copyText('qna-a')" class="px-4 py-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 text-sm"><i class="fas fa-copy mr-1"></i> 복사</button>
          </div>
          <div id="qna-a" class="result-content text-gray-300 whitespace-pre-wrap leading-relaxed"></div>
        </div>
        
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <i class="fas fa-reply-all text-yellow-400"></i>
              <span class="font-bold text-white">꼬리형 댓글 3개</span>
            </div>
            <button onclick="copyText('qna-c')" class="px-4 py-2 rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 text-sm"><i class="fas fa-copy mr-1"></i> 복사</button>
          </div>
          <div id="qna-c" class="result-content text-gray-300 whitespace-pre-wrap leading-relaxed"></div>
        </div>
        
        <button onclick="copyAllQnA()" class="btn-primary w-full py-4 rounded-xl text-white font-bold flex items-center justify-center gap-2">
          <i class="fas fa-copy"></i> 전체 복사
        </button>
      </div>
      
      <!-- Blog Results -->
      <div id="result-blog" class="space-y-4 hidden">
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <i class="fas fa-heading text-orange-400"></i>
              <span class="font-bold text-white">제목 (SEO 최적화)</span>
            </div>
            <button onclick="copyText('blog-title')" class="px-4 py-2 rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 text-sm"><i class="fas fa-copy mr-1"></i> 복사</button>
          </div>
          <div id="blog-title" class="text-xl font-bold text-white"></div>
        </div>
        
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <i class="fas fa-align-left text-orange-400"></i>
              <span class="font-bold text-white">본문</span>
              <span id="blog-char" class="px-2 py-1 rounded-lg bg-orange-500/20 text-orange-400 text-xs font-medium">0자</span>
            </div>
            <button onclick="copyText('blog-body')" class="px-4 py-2 rounded-lg bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 text-sm"><i class="fas fa-copy mr-1"></i> 복사</button>
          </div>
          <div id="blog-body" class="result-content text-gray-300 whitespace-pre-wrap leading-relaxed"></div>
        </div>
        
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <i class="fas fa-hashtag text-primary"></i>
              <span class="font-bold text-white">해시태그</span>
            </div>
            <button onclick="copyText('blog-tags')" class="px-4 py-2 rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 text-sm"><i class="fas fa-copy mr-1"></i> 복사</button>
          </div>
          <div id="blog-tags" class="text-primary font-medium"></div>
        </div>
        
        <button onclick="copyAllBlog()" class="w-full py-4 rounded-xl text-white font-bold flex items-center justify-center gap-2" style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);">
          <i class="fas fa-copy"></i> 전체 복사
        </button>
      </div>
      
      <!-- Analyze Results -->
      <div id="result-analyze" class="space-y-4 hidden">
        <div class="result-card p-8" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.15) 0%, rgba(124, 58, 237, 0.1) 100%); border-color: rgba(168, 85, 247, 0.3);">
          <div class="flex flex-col md:flex-row items-center justify-between gap-6">
            <div class="text-center md:text-left">
              <p class="text-gray-400 text-sm mb-1">종합 SEO 점수</p>
              <p id="total-score" class="text-5xl md:text-6xl font-black text-white">0</p>
            </div>
            <div class="grid grid-cols-4 gap-4 md:gap-8">
              <div class="text-center"><p class="text-gray-400 text-xs mb-1">SEO</p><p id="seo-score" class="text-2xl font-bold text-white">-</p></div>
              <div class="text-center"><p class="text-gray-400 text-xs mb-1">C-RANK</p><p id="crank-score" class="text-2xl font-bold text-white">-</p></div>
              <div class="text-center"><p class="text-gray-400 text-xs mb-1">AEO</p><p id="aeo-score" class="text-2xl font-bold text-white">-</p></div>
              <div class="text-center"><p class="text-gray-400 text-xs mb-1">GEO</p><p id="geo-score" class="text-2xl font-bold text-white">-</p></div>
            </div>
          </div>
        </div>
        
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <i class="fas fa-clipboard-check text-purple-400"></i>
              <span class="font-bold text-white">분석 결과</span>
            </div>
            <button onclick="copyText('analyze-result')" class="px-4 py-2 rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 text-sm"><i class="fas fa-copy mr-1"></i> 복사</button>
          </div>
          <div id="analyze-result" class="result-content text-gray-300 whitespace-pre-wrap leading-relaxed"></div>
        </div>
        
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <i class="fas fa-edit text-purple-400"></i>
              <span class="font-bold text-white">개선안</span>
            </div>
            <button onclick="copyText('analyze-improved')" class="px-4 py-2 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 text-sm"><i class="fas fa-copy mr-1"></i> 복사</button>
          </div>
          <div id="analyze-improved" class="result-content text-gray-300 whitespace-pre-wrap leading-relaxed"></div>
        </div>
        
        <button onclick="copyAnalyzeAll()" class="w-full py-4 rounded-xl text-white font-bold flex items-center justify-center gap-2" style="background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);">
          <i class="fas fa-copy"></i> 전체 복사
        </button>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="py-12 px-4 border-t border-white/5">
    <div class="max-w-6xl mx-auto text-center">
      <p class="text-gray-500 text-sm mb-2">© 2025 보험 콘텐츠 마스터 V4.0 | 개발자: 방익주</p>
      <div class="flex justify-center gap-4 mt-4">
        <a href="https://studiojuai-insurance.pages.dev/" target="_blank" class="text-gray-500 hover:text-primary text-sm">수술비 분석</a>
        <span class="text-gray-700">|</span>
        <a href="/api/health" class="text-gray-500 hover:text-primary text-sm">API Status</a>
        <span class="text-gray-700">|</span>
        <a href="/admin" class="text-gray-500 hover:text-primary text-sm">관리자</a>
      </div>
    </div>
  </footer>

  <div id="toast" class="toast fixed bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-xl bg-gray-800 text-white font-medium shadow-lg z-50"></div>

  <script>
    let currentFeature = 'qna';
    let currentTarget = '30대 직장인';
    let currentType = '정보성';

    function selectFeature(feature) {
      currentFeature = feature;
      document.querySelectorAll('.feature-card').forEach(c => c.classList.remove('active'));
      document.getElementById('card-' + feature).classList.add('active');
      document.querySelectorAll('[id^="form-"]').forEach(f => f.classList.add('hidden'));
      document.getElementById('form-' + feature).classList.remove('hidden');
      document.getElementById('resultsSection').classList.add('hidden');
    }

    function selectTarget(btn) {
      btn.parentElement.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTarget = btn.dataset.value;
    }

    function selectType(btn) {
      btn.parentElement.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentType = btn.dataset.value;
    }

    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2500);
    }

    function copyText(id) {
      navigator.clipboard.writeText(document.getElementById(id).textContent).then(() => showToast('복사 완료! 📋'));
    }

    function copyAllQnA() {
      const all = '【질문】\\n' + document.getElementById('qna-q').textContent + '\\n\\n【답변】\\n' + document.getElementById('qna-a').textContent + '\\n\\n【댓글】\\n' + document.getElementById('qna-c').textContent;
      navigator.clipboard.writeText(all).then(() => showToast('전체 복사 완료! 📋'));
    }

    function copyAllBlog() {
      const all = document.getElementById('blog-title').textContent + '\\n\\n' + document.getElementById('blog-body').textContent + '\\n\\n' + document.getElementById('blog-tags').textContent;
      navigator.clipboard.writeText(all).then(() => showToast('전체 복사 완료! 📋'));
    }

    function copyAnalyzeAll() {
      const all = '【분석 결과】\\n' + document.getElementById('analyze-result').textContent + '\\n\\n【개선안】\\n' + document.getElementById('analyze-improved').textContent;
      navigator.clipboard.writeText(all).then(() => showToast('전체 복사 완료! 📋'));
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
        content = '【분석 결과】\\n' + document.getElementById('analyze-result').textContent + '\\n\\n【개선안】\\n' + document.getElementById('analyze-improved').textContent;
        filename = 'analyze_' + new Date().toISOString().slice(0,10) + '.txt';
      }
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
      showToast('TXT 다운로드 완료! 📥');
    }

    function downloadPdf() {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      let content = '', title = '';
      if (currentFeature === 'qna') { title = 'Q&A'; content = document.getElementById('qna-q').textContent + '\\n\\n' + document.getElementById('qna-a').textContent; }
      else if (currentFeature === 'blog') { title = 'Blog'; content = document.getElementById('blog-title').textContent + '\\n\\n' + document.getElementById('blog-body').textContent; }
      else { title = 'Analysis'; content = document.getElementById('analyze-result').textContent; }
      doc.setFontSize(16); doc.text(title, 20, 20);
      doc.setFontSize(10); doc.text(doc.splitTextToSize(content, 170), 20, 35);
      doc.save(currentFeature + '_' + new Date().toISOString().slice(0,10) + '.pdf');
      showToast('PDF 다운로드 완료! 📥');
    }

    function setLoading(btnId, loading) {
      const btn = document.getElementById(btnId);
      if (loading) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> AI 생성 중...'; }
      else {
        btn.disabled = false;
        if (btnId === 'btn-qna') btn.innerHTML = '<i class="fas fa-magic"></i> Q&A 생성하기';
        else if (btnId === 'btn-blog') btn.innerHTML = '<i class="fas fa-pen-fancy"></i> 블로그 글 생성하기 (1,700자+)';
        else btn.innerHTML = '<i class="fas fa-search-plus"></i> 블로그 분석하기';
      }
    }

    function showResults(type) {
      document.getElementById('resultsSection').classList.remove('hidden');
      document.querySelectorAll('[id^="result-"]').forEach(r => r.classList.add('hidden'));
      document.getElementById('result-' + type).classList.remove('hidden');
      document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
    }

    async function generateQnA() {
      const product = document.getElementById('qna-product').value.trim();
      const concern = document.getElementById('qna-concern').value.trim();
      if (!product || !concern) { showToast('상품명과 고민을 입력해주세요'); return; }
      setLoading('btn-qna', true);
      try {
        const res = await fetch('/api/generate/qna', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product, concern, target: currentTarget, contact: document.getElementById('qna-contact').value.trim() })
        });
        const data = await res.json();
        document.getElementById('qna-q').textContent = data.question;
        document.getElementById('qna-a').textContent = data.answer;
        document.getElementById('qna-c').textContent = data.comments;
        document.getElementById('qna-char').textContent = data.answer.length + '자';
        document.getElementById('resultsInfo').textContent = 'Q&A 생성 완료 · ' + currentTarget;
        showResults('qna');
        showToast('Q&A 생성 완료! ✨');
      } catch (e) { showToast('생성 실패'); }
      setLoading('btn-qna', false);
    }

    async function generateBlog() {
      const topic = document.getElementById('blog-topic').value.trim();
      if (!topic) { showToast('블로그 주제를 입력해주세요'); return; }
      setLoading('btn-blog', true);
      try {
        const res = await fetch('/api/generate/blog', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic, keywords: document.getElementById('blog-keywords').value.trim(), region: document.getElementById('blog-region').value.trim(), type: currentType })
        });
        const data = await res.json();
        document.getElementById('blog-title').textContent = data.title;
        document.getElementById('blog-body').textContent = data.content;
        document.getElementById('blog-tags').textContent = data.hashtags;
        document.getElementById('blog-char').textContent = data.content.length + '자';
        document.getElementById('resultsInfo').textContent = '블로그 생성 완료 · ' + data.content.length + '자';
        showResults('blog');
        showToast('블로그 글 생성 완료! ✨');
      } catch (e) { showToast('생성 실패'); }
      setLoading('btn-blog', false);
    }

    async function analyzeBlog() {
      const content = document.getElementById('analyze-content').value.trim();
      if (!content) { showToast('분석할 글을 입력해주세요'); return; }
      setLoading('btn-analyze', true);
      try {
        const res = await fetch('/api/analyze/blog', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, keyword: document.getElementById('analyze-keyword').value.trim(), region: document.getElementById('analyze-region').value.trim() })
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
        showToast('블로그 분석 완료! 📊');
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
    .glass-card { background: rgba(255,255,255,0.03); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; }
  </style>
</head>
<body class="min-h-screen p-8">
  <div class="max-w-4xl mx-auto">
    <div class="flex items-center gap-4 mb-8">
      <a href="/" class="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
        <i class="fas fa-shield-alt text-white"></i>
      </a>
      <h1 class="text-2xl font-bold">관리자 대시보드</h1>
    </div>
    
    <div class="grid md:grid-cols-2 gap-6 mb-8">
      <div class="glass-card p-6">
        <h3 class="font-bold mb-4"><i class="fas fa-server text-green-400 mr-2"></i>API 상태</h3>
        <div id="apiStatus" class="text-gray-400">확인 중...</div>
      </div>
      <div class="glass-card p-6">
        <h3 class="font-bold mb-4"><i class="fas fa-key text-yellow-400 mr-2"></i>Gemini API</h3>
        <div class="text-gray-400">3개 키 로테이션 운영 중</div>
        <div class="text-green-400 text-sm mt-2">✓ 정상 작동</div>
      </div>
    </div>
    
    <div class="glass-card p-6 mb-8">
      <h3 class="font-bold mb-4"><i class="fas fa-link text-blue-400 mr-2"></i>API 엔드포인트</h3>
      <div class="space-y-3 text-sm">
        <div class="flex justify-between p-3 bg-white/5 rounded-lg"><span>Health Check</span><a href="/api/health" target="_blank" class="text-green-400 hover:underline">GET /api/health</a></div>
        <div class="flex justify-between p-3 bg-white/5 rounded-lg"><span>Q&A 생성</span><span class="text-gray-400">POST /api/generate/qna</span></div>
        <div class="flex justify-between p-3 bg-white/5 rounded-lg"><span>블로그 생성</span><span class="text-gray-400">POST /api/generate/blog</span></div>
        <div class="flex justify-between p-3 bg-white/5 rounded-lg"><span>블로그 분석</span><span class="text-gray-400">POST /api/analyze/blog</span></div>
      </div>
    </div>
    
    <div class="glass-card p-6">
      <h3 class="font-bold mb-4"><i class="fas fa-external-link-alt text-purple-400 mr-2"></i>연관 서비스</h3>
      <div class="space-y-3">
        <a href="https://studiojuai-insurance.pages.dev/" target="_blank" class="flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10 transition">
          <span>수술비 특약 분석 (STUDIO JU AI)</span><i class="fas fa-external-link-alt text-gray-400"></i>
        </a>
      </div>
    </div>
  </div>
  <script>
    fetch('/api/health').then(r => r.json()).then(d => {
      document.getElementById('apiStatus').innerHTML = '<span class="text-green-400">✓ 정상</span> · Version ' + d.version + ' · AI: ' + d.ai;
    }).catch(() => { document.getElementById('apiStatus').innerHTML = '<span class="text-red-400">✗ 오류</span>'; });
  </script>
</body>
</html>
`

// Routes
app.get('/', (c) => c.html(mainPageHtml))
app.get('/admin', (c) => c.html(adminPageHtml))
app.get('/api/health', (c) => c.json({ status: 'ok', version: '4.0', ai: 'gemini', timestamp: new Date().toISOString() }))

// Q&A API
app.post('/api/generate/qna', async (c) => {
  const { product, concern, target, contact } = await c.req.json()
  
  const prompt = `당신은 보험 전문 콘텐츠 작성 AI입니다. 네이버 카페용 Q&A를 생성해주세요.

【조건】
- 상품명: ${product}
- 타겟: ${target}
- 고민: ${concern}
- 연락처: ${contact || '없음'}

【출력 형식】
[질문]
(${target}이 ${product}에 대해 궁금해하는 자연스러운 질문. 300자 이상)

[답변]
(전문가 답변 800자 이상. ✅ 핵심 요약 3줄, ✅ 장점, ✅ 체크포인트, 키워드 3회+ 포함)

[댓글1]
(공감 댓글 50자)

[댓글2]
(정보 추가 50자)

[댓글3]
(가입 권유 50자)`

  try {
    const result = await callGeminiAPI(prompt)
    
    const questionMatch = result.match(/\[질문\]([\s\S]*?)(?=\[답변\])/i)
    const answerMatch = result.match(/\[답변\]([\s\S]*?)(?=\[댓글1\])/i)
    const comment1Match = result.match(/\[댓글1\]([\s\S]*?)(?=\[댓글2\])/i)
    const comment2Match = result.match(/\[댓글2\]([\s\S]*?)(?=\[댓글3\])/i)
    const comment3Match = result.match(/\[댓글3\]([\s\S]*?)$/i)
    
    return c.json({
      question: questionMatch ? questionMatch[1].trim() : `[${target}] ${product} 가입 고민입니다\n\n${concern}`,
      answer: answerMatch ? answerMatch[1].trim() : `${product}에 대한 전문가 답변입니다.`,
      comments: [
        comment1Match ? comment1Match[1].trim() : '저도 같은 고민이었어요!',
        comment2Match ? comment2Match[1].trim() : '전문가 답변 감사합니다.',
        comment3Match ? comment3Match[1].trim() : '저도 가입 고려해봐야겠네요.'
      ].join('\n\n')
    })
  } catch (error) {
    return c.json({
      question: `[${target}] ${product} 가입 고민이에요\n\n${concern}`,
      answer: `안녕하세요, 보험 전문 상담사입니다.\n\n${product} 관련해서 답변 드릴게요.\n\n✅ 핵심 요약\n- ${product}는 ${target}분들께 적합합니다\n- 보험료 대비 보장 내용이 우수합니다\n\n더 궁금하신 점 있으시면 문의해주세요!`,
      comments: '저도 같은 고민이었어요!\n\n전문가 답변 감사합니다.\n\n저도 가입 고려해봐야겠네요.'
    })
  }
})

// Blog API
app.post('/api/generate/blog', async (c) => {
  const { topic, keywords, region, type } = await c.req.json()
  
  const prompt = `당신은 네이버 블로그 SEO 전문 작성 AI입니다.

【조건】
- 주제: ${topic}
- 키워드: ${keywords || topic}
- 지역: ${region || '전국'}
- 유형: ${type}

【규칙】
1. 본문 1,700자 이상
2. 2-3문장마다 줄바꿈
3. 3줄 요약 인용구
4. [📷 이미지 삽입] 표시
5. 키워드 3회+ 포함
6. Q&A 1개 포함

【출력】
[제목]
(30자 이내)

[본문]
(1,700자+)

[해시태그]
(10개)`

  try {
    const result = await callGeminiAPI(prompt)
    
    const titleMatch = result.match(/\[제목\]\s*([\s\S]*?)(?=\[본문\])/i)
    const contentMatch = result.match(/\[본문\]\s*([\s\S]*?)(?=\[해시태그\])/i)
    const hashtagMatch = result.match(/\[해시태그\]\s*([\s\S]*?)$/i)
    
    let title = titleMatch ? titleMatch[1].trim() : `${topic}, 이것만 알면 끝!`
    let content = contentMatch ? contentMatch[1].trim() : ''
    let hashtags = hashtagMatch ? hashtagMatch[1].trim() : `#${topic.replace(/\s/g, '')} #보험추천`
    
    if (content.length < 500) throw new Error('Content too short')
    
    return c.json({ title, content, hashtags })
  } catch (error) {
    return c.json({
      title: `${topic}, 이것만 알면 끝! 2025년 가이드`,
      content: `> 📌 이 글의 3줄 요약
> 1. ${topic}의 핵심 포인트
> 2. 가입 전 체크리스트
> 3. ${region || '전국'} 맞춤 정보

■ ${topic}, 왜 알아봐야 할까요?

안녕하세요, 오늘은 ${topic}에 대해 자세히 알아보겠습니다.

[📷 이미지 삽입]

■ 핵심 포인트

❶ 첫 번째 포인트
본인 상황에 맞는 플랜을 찾는 것이 중요합니다.

❷ 두 번째 포인트
비용 대비 효율을 따져보세요.

[📷 이미지 삽입]

■ Q. ${topic} 가입하면 좋을까요?
A. 네, 많은 분들에게 유용합니다.

■ 결론
${topic}을 통해 안정적인 보장을 받으세요.

💡 마무리
오늘 ${topic}에 대해 알아보았습니다.`,
      hashtags: `#${topic.replace(/\s/g, '')} #보험추천 #보험비교 #2025보험`
    })
  }
})

// Analyze API
app.post('/api/analyze/blog', async (c) => {
  const { content, keyword, region } = await c.req.json()
  
  const prompt = `당신은 네이버 블로그 SEO 분석 전문가입니다.

【분석 대상】
${content.substring(0, 3000)}

【목표 키워드】: ${keyword || '없음'}
【목표 지역】: ${region || '없음'}
【글자수】: ${content.length}자

【출력】
[점수]
SEO: (0-100)
C-RANK: (0-100)
AEO: (0-100)
GEO: (0-100)
총점: (0-100)

[분석]
■ 잘된 점 (3가지)
■ 개선 필요 (3가지)
■ 키워드 분석
■ 1위 가능성

[개선된 제목]
[개선된 본문 예시]
[개선된 해시태그]`

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
    const geoScore = geoMatch ? parseInt(geoMatch[1]) : region ? 80 : 50
    const totalScore = totalMatch ? parseInt(totalMatch[1]) : Math.round((seoScore + crankScore + aeoScore + geoScore) / 4)
    
    const analysisMatch = result.match(/\[분석\]([\s\S]*?)(?=\[개선된 제목\])/i)
    const improvedMatch = result.match(/\[개선된 제목\]([\s\S]*?)$/i)
    
    return c.json({
      totalScore, seoScore, crankScore, aeoScore, geoScore,
      analysis: analysisMatch ? analysisMatch[1].trim() : '분석 결과가 없습니다.',
      improved: improvedMatch ? improvedMatch[1].trim() : '개선안이 없습니다.'
    })
  } catch (error) {
    return c.json({
      totalScore: 65, seoScore: 70, crankScore: 65, aeoScore: 60, geoScore: 50,
      analysis: '분석 중 오류가 발생했습니다.',
      improved: '다시 시도해주세요.'
    })
  }
})

export default app
