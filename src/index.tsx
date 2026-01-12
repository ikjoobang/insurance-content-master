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
  <title>보험 콘텐츠 마스터 | AI 기반 블로그 SEO 최적화</title>
  <meta name="description" content="AI 기반 네이버 블로그 SEO 최적화 콘텐츠 자동 생성 도구">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
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
    
    /* Hero Gradient - Beyond Reality Style */
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
    .glass-card-hover:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(3, 199, 90, 0.3);
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
      box-shadow: 0 0 0 4px rgba(3, 199, 90, 0.12), 0 0 40px rgba(3, 199, 90, 0.08);
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
      border-color: rgba(255, 255, 255, 0.15);
    }
    .chip.active {
      background: linear-gradient(135deg, rgba(3, 199, 90, 0.2) 0%, rgba(3, 199, 90, 0.1) 100%);
      border-color: rgba(3, 199, 90, 0.5);
      color: #03C75A;
    }
    
    /* Primary Button - Naver Green */
    .btn-primary {
      background: linear-gradient(135deg, #03C75A 0%, #00B050 100%);
      border-radius: 16px;
      font-weight: 700;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    }
    .btn-primary::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: linear-gradient(135deg, #04D862 0%, #00C454 100%);
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    .btn-primary:hover::before { opacity: 1; }
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
    .btn-primary span, .btn-primary i { position: relative; z-index: 1; }
    
    /* Feature Cards */
    .feature-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 24px;
      transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      cursor: pointer;
      position: relative;
      overflow: hidden;
    }
    .feature-card::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, transparent 0%, rgba(255, 255, 255, 0.02) 100%);
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    .feature-card:hover::before { opacity: 1; }
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
    
    /* Animations */
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(40px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes pulse-glow {
      0%, 100% { box-shadow: 0 0 20px rgba(3, 199, 90, 0.3); }
      50% { box-shadow: 0 0 40px rgba(3, 199, 90, 0.5); }
    }
    .fade-in-up { animation: fadeInUp 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
    .delay-100 { animation-delay: 0.1s; opacity: 0; }
    .delay-200 { animation-delay: 0.2s; opacity: 0; }
    .delay-300 { animation-delay: 0.3s; opacity: 0; }
    
    /* Spinner */
    .spinner {
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-top-color: #fff;
      border-radius: 50%;
      width: 24px; height: 24px;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    
    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.02); }
    ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.25); }
    
    /* Toast */
    .toast {
      transform: translateY(120px);
      opacity: 0;
      transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .toast.show { transform: translateY(0); opacity: 1; }
    
    /* Score Badge */
    .score-badge {
      background: linear-gradient(135deg, rgba(3, 199, 90, 0.2) 0%, rgba(3, 199, 90, 0.1) 100%);
      border: 1px solid rgba(3, 199, 90, 0.3);
    }
    
    /* Section Divider */
    .section-divider {
      height: 1px;
      background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%);
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
            <span class="text-xs text-gray-500 ml-2">V5.0</span>
          </div>
        </a>
        <div class="flex items-center gap-2 sm:gap-4">
          <div class="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
            <span class="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
            <span class="text-xs text-primary font-medium">Gemini AI</span>
          </div>
          <a href="/admin" class="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-all text-sm">
            <i class="fas fa-cog"></i>
            <span class="hidden md:inline">관리자</span>
          </a>
          <a href="https://studiojuai-insurance.pages.dev/" target="_blank" class="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 transition-all text-sm font-medium">
            <i class="fas fa-external-link-alt"></i>
            <span class="hidden md:inline">수술비 분석</span>
          </a>
        </div>
      </div>
    </div>
  </nav>

  <!-- Hero Section -->
  <section class="hero-gradient min-h-screen px-4 pt-28 pb-12">
    <div class="max-w-7xl mx-auto">
      
      <!-- Header -->
      <div class="text-center mb-12 fade-in-up">
        <div class="inline-flex items-center gap-3 mb-6">
          <span class="px-4 py-2 rounded-full text-sm font-medium bg-white/5 border border-white/10 text-gray-400">
            <i class="fas fa-sparkles text-primary mr-2"></i>네이버 블로그 SEO 최적화
          </span>
        </div>
        <h1 class="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black text-white mb-6 leading-tight tracking-tight">
          AI 기반<br class="sm:hidden">
          <span class="text-transparent bg-clip-text bg-gradient-to-r from-primary via-emerald-400 to-primary">콘텐츠 자동 생성</span>
        </h1>
        <p class="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
          Q&A, 블로그, SEO 분석까지<br class="sm:hidden"> 원클릭으로 완성하세요
        </p>
      </div>
      
      <!-- Feature Selection Cards -->
      <div class="grid md:grid-cols-3 gap-4 md:gap-6 mb-10 fade-in-up delay-100">
        
        <button onclick="selectFeature('qna')" id="card-qna" class="feature-card active p-6 md:p-8 text-left">
          <div class="flex items-start justify-between mb-6">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 flex items-center justify-center">
              <i class="fas fa-comments text-blue-400 text-2xl"></i>
            </div>
            <span class="px-3 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
              네이버 카페
            </span>
          </div>
          <h3 class="text-xl font-bold text-white mb-2">Q&A 생성</h3>
          <p class="text-gray-400 text-sm leading-relaxed mb-4">질문 + 전문가 답변 + 꼬리형 댓글 3개 자동 생성</p>
          <div class="flex items-center gap-2 text-xs text-gray-500">
            <i class="fas fa-clock"></i>
            <span>약 10초 소요</span>
          </div>
        </button>
        
        <button onclick="selectFeature('blog')" id="card-blog" class="feature-card p-6 md:p-8 text-left">
          <div class="flex items-start justify-between mb-6">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500/20 to-orange-600/10 flex items-center justify-center">
              <i class="fas fa-pen-fancy text-orange-400 text-2xl"></i>
            </div>
            <span class="px-3 py-1 rounded-full text-xs font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">
              네이버 블로그
            </span>
          </div>
          <h3 class="text-xl font-bold text-white mb-2">블로그 생성</h3>
          <p class="text-gray-400 text-sm leading-relaxed mb-4">SEO 최적화 블로그 글 1,700자 이상 자동 생성</p>
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
              SEO 분석
            </span>
          </div>
          <h3 class="text-xl font-bold text-white mb-2">블로그 분석</h3>
          <p class="text-gray-400 text-sm leading-relaxed mb-4">기존 글 SEO/C-RANK/AEO/GEO 점수 분석</p>
          <div class="flex items-center gap-2 text-xs text-gray-500">
            <i class="fas fa-clock"></i>
            <span>약 20초 소요</span>
          </div>
        </button>
      </div>
      
      <!-- Main Form Container -->
      <div class="glass-card p-6 md:p-10 max-w-4xl mx-auto fade-in-up delay-200">
        
        <!-- ========== Q&A Form ========== -->
        <div id="form-qna" class="space-y-8">
          <div class="flex items-center gap-4 pb-6 border-b border-white/5">
            <div class="w-12 h-12 rounded-2xl bg-blue-500/20 flex items-center justify-center">
              <i class="fas fa-comments text-blue-400 text-xl"></i>
            </div>
            <div>
              <h2 class="text-2xl font-bold text-white">Q&A 생성</h2>
              <p class="text-gray-400 text-sm">네이버 카페 Q&A용 콘텐츠</p>
            </div>
          </div>
          
          <!-- 타겟 고객 선택 -->
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
          
          <!-- 문체 톤 선택 -->
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
          
          <!-- 보험 종류 선택 -->
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
          
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-semibold text-white mb-3">
                <i class="fas fa-tag text-blue-400 mr-2"></i>구체적인 상품명 <span class="text-red-400">*</span>
              </label>
              <input type="text" id="qna-product" placeholder="예: 삼성생명 종신보험" class="input-premium w-full px-5 py-4 text-white">
            </div>
            <div>
              <label class="block text-sm font-semibold text-white mb-3">
                <i class="fas fa-phone text-blue-400 mr-2"></i>연락처 (선택)
              </label>
              <input type="text" id="qna-contact" placeholder="카카오톡 오픈채팅 링크" class="input-premium w-full px-5 py-4 text-white">
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-question-circle text-blue-400 mr-2"></i>핵심 고민/질문 <span class="text-red-400">*</span>
            </label>
            <textarea id="qna-concern" rows="4" placeholder="예: 종신보험 가입을 고민 중인데요, 보험료가 부담되고 중도해지하면 손해라고 하더라고요. 어떤 상품이 좋을까요?" class="input-premium w-full px-5 py-4 text-white resize-none"></textarea>
          </div>
          
          <button onclick="generateQnA()" id="btn-qna" class="btn-primary w-full py-5 text-white text-lg flex items-center justify-center gap-3">
            <i class="fas fa-magic"></i>
            <span>Q&A 생성하기</span>
          </button>
        </div>
        
        <!-- ========== Blog Form ========== -->
        <div id="form-blog" class="space-y-8 hidden">
          <div class="flex items-center gap-4 pb-6 border-b border-white/5">
            <div class="w-12 h-12 rounded-2xl bg-orange-500/20 flex items-center justify-center">
              <i class="fas fa-pen-fancy text-orange-400 text-xl"></i>
            </div>
            <div>
              <h2 class="text-2xl font-bold text-white">블로그 생성</h2>
              <p class="text-gray-400 text-sm">SEO 최적화 1,700자+ 블로그 글</p>
            </div>
          </div>
          
          <!-- 콘텐츠 유형 선택 -->
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-file-alt text-orange-400 mr-2"></i>콘텐츠 유형
            </label>
            <div class="flex flex-wrap gap-2" id="blog-type-chips">
              <button onclick="selectChip(this, 'blog-type')" data-value="정보성" class="chip active">📚 정보성 (가이드)</button>
              <button onclick="selectChip(this, 'blog-type')" data-value="후기성" class="chip">⭐ 후기성 (경험담)</button>
              <button onclick="selectChip(this, 'blog-type')" data-value="비교분석" class="chip">⚖️ 비교분석</button>
              <button onclick="selectChip(this, 'blog-type')" data-value="뉴스형" class="chip">📰 뉴스/트렌드</button>
              <button onclick="selectChip(this, 'blog-type')" data-value="체크리스트" class="chip">✅ 체크리스트</button>
            </div>
          </div>
          
          <!-- 타겟 독자 선택 -->
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-users text-orange-400 mr-2"></i>타겟 독자
            </label>
            <div class="flex flex-wrap gap-2" id="blog-target-chips">
              <button onclick="selectChip(this, 'blog-target')" data-value="20대" class="chip">👶 20대</button>
              <button onclick="selectChip(this, 'blog-target')" data-value="30대" class="chip active">👔 30대</button>
              <button onclick="selectChip(this, 'blog-target')" data-value="40대" class="chip">👨‍👩‍👧 40대</button>
              <button onclick="selectChip(this, 'blog-target')" data-value="50대 이상" class="chip">🏖️ 50대 이상</button>
              <button onclick="selectChip(this, 'blog-target')" data-value="전 연령" class="chip">👥 전 연령</button>
            </div>
          </div>
          
          <!-- 문체 톤 선택 -->
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-font text-orange-400 mr-2"></i>문체 톤
            </label>
            <div class="flex flex-wrap gap-2" id="blog-tone-chips">
              <button onclick="selectChip(this, 'blog-tone')" data-value="친근한" class="chip active">😊 친근한</button>
              <button onclick="selectChip(this, 'blog-tone')" data-value="전문적인" class="chip">🎓 전문적인</button>
              <button onclick="selectChip(this, 'blog-tone')" data-value="캐주얼한" class="chip">✌️ 캐주얼한</button>
              <button onclick="selectChip(this, 'blog-tone')" data-value="신뢰감 있는" class="chip">🤝 신뢰감 있는</button>
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-heading text-orange-400 mr-2"></i>블로그 주제 <span class="text-red-400">*</span>
            </label>
            <input type="text" id="blog-topic" placeholder="예: 30대 종신보험 추천, 암보험 가입 시 주의사항" class="input-premium w-full px-5 py-4 text-white">
          </div>
          
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-semibold text-white mb-3">
                <i class="fas fa-key text-orange-400 mr-2"></i>핵심 키워드 (쉼표 구분)
              </label>
              <input type="text" id="blog-keywords" placeholder="종신보험, 30대 보험, 보험 추천" class="input-premium w-full px-5 py-4 text-white">
            </div>
            <div>
              <label class="block text-sm font-semibold text-white mb-3">
                <i class="fas fa-map-marker-alt text-orange-400 mr-2"></i>지역 (GEO 최적화)
              </label>
              <input type="text" id="blog-region" placeholder="서울 강남, 경기 분당" class="input-premium w-full px-5 py-4 text-white">
            </div>
          </div>
          
          <!-- 추가 옵션 -->
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-plus-circle text-orange-400 mr-2"></i>포함 옵션
            </label>
            <div class="flex flex-wrap gap-2" id="blog-options-chips">
              <button onclick="toggleChip(this, 'blog-options')" data-value="Q&A 섹션" class="chip active">❓ Q&A 섹션</button>
              <button onclick="toggleChip(this, 'blog-options')" data-value="3줄 요약" class="chip active">📌 3줄 요약</button>
              <button onclick="toggleChip(this, 'blog-options')" data-value="이미지 위치" class="chip active">📷 이미지 위치</button>
              <button onclick="toggleChip(this, 'blog-options')" data-value="CTA 버튼" class="chip">🔔 CTA 버튼</button>
              <button onclick="toggleChip(this, 'blog-options')" data-value="표/비교" class="chip">📊 표/비교</button>
              <button onclick="toggleChip(this, 'blog-options')" data-value="체크리스트" class="chip">✅ 체크리스트</button>
            </div>
          </div>
          
          <button onclick="generateBlog()" id="btn-blog" class="btn-primary w-full py-5 text-white text-lg flex items-center justify-center gap-3" style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);">
            <i class="fas fa-pen-fancy"></i>
            <span>블로그 글 생성하기 (1,700자+)</span>
          </button>
        </div>
        
        <!-- ========== Analyze Form ========== -->
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
          
          <!-- 분석 유형 선택 -->
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-search text-purple-400 mr-2"></i>분석 유형
            </label>
            <div class="flex flex-wrap gap-2" id="analyze-type-chips">
              <button onclick="selectChip(this, 'analyze-type')" data-value="종합 분석" class="chip active">📊 종합 분석</button>
              <button onclick="selectChip(this, 'analyze-type')" data-value="SEO 집중" class="chip">🔍 SEO 집중</button>
              <button onclick="selectChip(this, 'analyze-type')" data-value="C-RANK 집중" class="chip">🏆 C-RANK 집중</button>
              <button onclick="selectChip(this, 'analyze-type')" data-value="개선안 중심" class="chip">✏️ 개선안 중심</button>
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-semibold text-white mb-3">
              <i class="fas fa-file-alt text-purple-400 mr-2"></i>분석할 블로그 글 <span class="text-red-400">*</span>
            </label>
            <textarea id="analyze-content" rows="8" placeholder="네이버 블로그에 작성한 글 전체를 붙여넣으세요.&#10;&#10;제목과 본문을 모두 포함해주세요." class="input-premium w-full px-5 py-4 text-white resize-none"></textarea>
            <p class="text-gray-500 text-xs mt-2">💡 글자수가 많을수록 정확한 분석이 가능합니다</p>
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
          
          <!-- 점수 설명 카드 -->
          <div class="grid md:grid-cols-2 gap-4 pt-4">
            <div class="bg-white/5 rounded-xl p-4">
              <h4 class="font-bold text-white text-sm mb-2">📊 점수 기준</h4>
              <ul class="text-gray-400 text-xs space-y-1">
                <li>• <span class="text-primary">SEO</span>: 키워드 배치, 글자수, 구조</li>
                <li>• <span class="text-yellow-400">C-RANK</span>: 전문성, 출처, 신뢰도</li>
                <li>• <span class="text-blue-400">AEO</span>: AI 검색 답변 최적화</li>
                <li>• <span class="text-purple-400">GEO</span>: 지역 키워드 최적화</li>
              </ul>
            </div>
            <div class="bg-white/5 rounded-xl p-4">
              <h4 class="font-bold text-white text-sm mb-2">🎯 목표 점수</h4>
              <ul class="text-gray-400 text-xs space-y-1">
                <li>• <span class="text-green-400">90점 이상</span>: 상위 노출 가능성 높음</li>
                <li>• <span class="text-yellow-400">70-89점</span>: 개선 후 상위 노출 기대</li>
                <li>• <span class="text-red-400">70점 미만</span>: 개선 필수</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Quick Stats -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto mt-12 fade-in-up delay-300">
        <div class="glass-card p-6 text-center">
          <div class="text-3xl font-black text-white mb-1">SEO</div>
          <div class="text-gray-500 text-sm">검색 최적화</div>
        </div>
        <div class="glass-card p-6 text-center">
          <div class="text-3xl font-black text-white mb-1">C-RANK</div>
          <div class="text-gray-500 text-sm">전문성 지표</div>
        </div>
        <div class="glass-card p-6 text-center">
          <div class="text-3xl font-black text-white mb-1">AEO</div>
          <div class="text-gray-500 text-sm">AI 최적화</div>
        </div>
        <div class="glass-card p-6 text-center">
          <div class="text-3xl font-black text-white mb-1">GEO</div>
          <div class="text-gray-500 text-sm">지역 최적화</div>
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
      
      <!-- Q&A Results -->
      <div id="result-qna" class="space-y-4 hidden">
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
            <button onclick="copyText('qna-q')" class="px-4 py-2 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10 text-sm transition-all">
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
            <button onclick="copyText('qna-a')" class="px-4 py-2 rounded-xl bg-primary/20 text-primary hover:bg-primary/30 text-sm transition-all">
              <i class="fas fa-copy mr-1"></i> 복사
            </button>
          </div>
          <div id="qna-a" class="result-content text-gray-300 whitespace-pre-wrap leading-relaxed bg-white/5 rounded-xl p-4"></div>
        </div>
        
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-yellow-500/20 flex items-center justify-center">
                <i class="fas fa-reply-all text-yellow-400"></i>
              </div>
              <span class="font-bold text-white">꼬리형 댓글 3개</span>
            </div>
            <button onclick="copyText('qna-c')" class="px-4 py-2 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10 text-sm transition-all">
              <i class="fas fa-copy mr-1"></i> 복사
            </button>
          </div>
          <div id="qna-c" class="result-content text-gray-300 whitespace-pre-wrap leading-relaxed bg-white/5 rounded-xl p-4"></div>
        </div>
        
        <button onclick="copyAllQnA()" class="btn-primary w-full py-5 text-white font-bold text-lg flex items-center justify-center gap-3">
          <i class="fas fa-copy"></i>
          <span>전체 복사</span>
        </button>
      </div>
      
      <!-- Blog Results -->
      <div id="result-blog" class="space-y-4 hidden">
        <div class="result-card p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
                <i class="fas fa-heading text-orange-400"></i>
              </div>
              <span class="font-bold text-white">제목 (SEO 최적화)</span>
            </div>
            <button onclick="copyText('blog-title')" class="px-4 py-2 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10 text-sm transition-all">
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
            <button onclick="copyText('blog-body')" class="px-4 py-2 rounded-xl bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 text-sm transition-all">
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
            <button onclick="copyText('blog-tags')" class="px-4 py-2 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10 text-sm transition-all">
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
      
      <!-- Analyze Results -->
      <div id="result-analyze" class="space-y-4 hidden">
        <!-- Score Overview -->
        <div class="result-card p-8" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.12) 0%, rgba(124, 58, 237, 0.06) 100%); border-color: rgba(168, 85, 247, 0.25);">
          <div class="flex flex-col md:flex-row items-center justify-between gap-8">
            <div class="text-center md:text-left">
              <p class="text-gray-400 text-sm mb-2">종합 SEO 점수</p>
              <div class="flex items-end gap-2">
                <span id="total-score" class="text-6xl md:text-7xl font-black text-white">0</span>
                <span class="text-2xl text-gray-500 mb-2">/100</span>
              </div>
            </div>
            <div class="grid grid-cols-4 gap-6 md:gap-10">
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
              <span class="font-bold text-white">상세 분석 결과</span>
            </div>
            <button onclick="copyText('analyze-result')" class="px-4 py-2 rounded-xl bg-white/5 text-gray-300 hover:bg-white/10 text-sm transition-all">
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
              <span class="font-bold text-white">개선안 제안</span>
            </div>
            <button onclick="copyText('analyze-improved')" class="px-4 py-2 rounded-xl bg-primary/20 text-primary hover:bg-primary/30 text-sm transition-all">
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
            <p class="font-bold text-white">보험 콘텐츠 마스터 V5.0</p>
            <p class="text-gray-500 text-sm">© 2025 개발자: 방익주</p>
          </div>
        </div>
        <div class="flex items-center gap-6">
          <a href="https://studiojuai-insurance.pages.dev/" target="_blank" class="text-gray-400 hover:text-primary transition-colors text-sm">수술비 분석</a>
          <a href="/api/health" class="text-gray-400 hover:text-primary transition-colors text-sm">API Status</a>
          <a href="/admin" class="text-gray-400 hover:text-primary transition-colors text-sm">관리자</a>
        </div>
      </div>
    </div>
  </footer>

  <!-- Toast -->
  <div id="toast" class="toast fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-4 rounded-2xl bg-gray-800/90 backdrop-blur-lg text-white font-medium shadow-2xl z-50 border border-white/10"></div>

  <script>
    // State Management
    let currentFeature = 'qna';
    const selections = {
      'qna-target': '30대 직장인',
      'qna-tone': '친근한',
      'qna-insurance': '종신보험',
      'blog-type': '정보성',
      'blog-target': '30대',
      'blog-tone': '친근한',
      'blog-options': ['Q&A 섹션', '3줄 요약', '이미지 위치'],
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

    // Single Select Chip
    function selectChip(btn, group) {
      const container = btn.parentElement;
      container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      selections[group] = btn.dataset.value;
    }

    // Multi Select Chip (Toggle)
    function toggleChip(btn, group) {
      btn.classList.toggle('active');
      const container = btn.parentElement;
      selections[group] = Array.from(container.querySelectorAll('.chip.active')).map(c => c.dataset.value);
    }

    // Toast Notification
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
      const all = '【분석 결과】\\n' + document.getElementById('analyze-result').textContent + '\\n\\n【개선안】\\n' + document.getElementById('analyze-improved').textContent;
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
        content = '【분석 결과】\\n' + document.getElementById('analyze-result').textContent + '\\n\\n【개선안】\\n' + document.getElementById('analyze-improved').textContent;
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

    // Loading State
    function setLoading(btnId, loading) {
      const btn = document.getElementById(btnId);
      if (loading) {
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner"></div><span>AI 생성 중...</span>';
      } else {
        btn.disabled = false;
        if (btnId === 'btn-qna') btn.innerHTML = '<i class="fas fa-magic"></i><span>Q&A 생성하기</span>';
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

    // API Calls
    async function generateQnA() {
      const product = document.getElementById('qna-product').value.trim();
      const concern = document.getElementById('qna-concern').value.trim();
      if (!product || !concern) { showToast('⚠️ 상품명과 고민을 입력해주세요'); return; }
      
      setLoading('btn-qna', true);
      try {
        const res = await fetch('/api/generate/qna', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product,
            concern,
            target: selections['qna-target'],
            tone: selections['qna-tone'],
            insuranceType: selections['qna-insurance'],
            contact: document.getElementById('qna-contact').value.trim()
          })
        });
        const data = await res.json();
        document.getElementById('qna-q').textContent = data.question;
        document.getElementById('qna-a').textContent = data.answer;
        document.getElementById('qna-c').textContent = data.comments;
        document.getElementById('qna-char').textContent = data.answer.length + '자';
        document.getElementById('resultsInfo').textContent = 'Q&A 생성 완료 · ' + selections['qna-target'] + ' · ' + selections['qna-tone'] + ' 톤';
        showResults('qna');
        showToast('✨ Q&A 생성 완료!');
      } catch (e) { showToast('❌ 생성 실패. 다시 시도해주세요.'); }
      setLoading('btn-qna', false);
    }

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
            target: selections['blog-target'],
            tone: selections['blog-tone'],
            options: selections['blog-options']
          })
        });
        const data = await res.json();
        document.getElementById('blog-title').textContent = data.title;
        document.getElementById('blog-body').textContent = data.content;
        document.getElementById('blog-tags').textContent = data.hashtags;
        document.getElementById('blog-char').textContent = data.content.length + '자';
        document.getElementById('resultsInfo').textContent = '블로그 생성 완료 · ' + data.content.length + '자 · ' + selections['blog-type'];
        showResults('blog');
        showToast('✨ 블로그 글 생성 완료!');
      } catch (e) { showToast('❌ 생성 실패. 다시 시도해주세요.'); }
      setLoading('btn-blog', false);
    }

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
        document.getElementById('resultsInfo').textContent = '분석 완료 · 종합 ' + data.totalScore + '점 · ' + selections['analyze-type'];
        showResults('analyze');
        showToast('📊 블로그 분석 완료!');
      } catch (e) { showToast('❌ 분석 실패. 다시 시도해주세요.'); }
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
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background: #0a0a0a; color: white; }
    .glass-card { background: rgba(255,255,255,0.03); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; }
    .stat-card { background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%); }
  </style>
</head>
<body class="min-h-screen p-4 md:p-8">
  <div class="max-w-6xl mx-auto">
    
    <!-- Header -->
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-4">
        <a href="/" class="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-green-500/20">
          <i class="fas fa-shield-alt text-white text-xl"></i>
        </a>
        <div>
          <h1 class="text-2xl font-bold text-white">관리자 대시보드</h1>
          <p class="text-gray-500 text-sm">보험 콘텐츠 마스터 V5.0</p>
        </div>
      </div>
      <a href="/" class="px-4 py-2 rounded-xl bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-all text-sm">
        <i class="fas fa-arrow-left mr-2"></i>메인으로
      </a>
    </div>
    
    <!-- Stats Grid -->
    <div class="grid md:grid-cols-3 gap-6 mb-8">
      <div class="glass-card p-6">
        <div class="flex items-center gap-4 mb-4">
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
        <div class="flex items-center gap-4 mb-4">
          <div class="w-12 h-12 rounded-xl bg-yellow-500/20 flex items-center justify-center">
            <i class="fas fa-key text-yellow-400 text-xl"></i>
          </div>
          <div>
            <p class="text-gray-400 text-sm">Gemini API</p>
            <p class="text-white font-bold">3개 키 로테이션</p>
          </div>
        </div>
        <p class="text-green-400 text-sm"><i class="fas fa-check-circle mr-1"></i> 정상 작동</p>
      </div>
      <div class="glass-card p-6">
        <div class="flex items-center gap-4 mb-4">
          <div class="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
            <i class="fas fa-code text-blue-400 text-xl"></i>
          </div>
          <div>
            <p class="text-gray-400 text-sm">버전</p>
            <p class="text-white font-bold">V5.0</p>
          </div>
        </div>
        <p class="text-gray-500 text-sm">Premium Dark UI</p>
      </div>
    </div>
    
    <!-- API Endpoints -->
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
            <span class="text-gray-300">Q&A 생성</span>
          </div>
          <span class="text-gray-500 text-sm">/api/generate/qna</span>
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
    
    <!-- Related Services -->
    <div class="glass-card p-6">
      <h3 class="font-bold text-white text-lg mb-6"><i class="fas fa-external-link-alt text-purple-400 mr-2"></i>연관 서비스</h3>
      <div class="space-y-3">
        <a href="https://studiojuai-insurance.pages.dev/" target="_blank" class="flex items-center justify-between p-4 bg-white/5 rounded-xl hover:bg-white/10 transition-all group">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
              <i class="fas fa-stethoscope text-purple-400"></i>
            </div>
            <div>
              <p class="text-white font-medium">수술비 특약 분석</p>
              <p class="text-gray-500 text-sm">STUDIO JU AI</p>
            </div>
          </div>
          <i class="fas fa-external-link-alt text-gray-500 group-hover:text-white transition-colors"></i>
        </a>
        <a href="https://beyond-reality.pages.dev/" target="_blank" class="flex items-center justify-between p-4 bg-white/5 rounded-xl hover:bg-white/10 transition-all group">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <i class="fas fa-video text-blue-400"></i>
            </div>
            <div>
              <p class="text-white font-medium">Beyond Reality</p>
              <p class="text-gray-500 text-sm">AI 영상 제작 스튜디오</p>
            </div>
          </div>
          <i class="fas fa-external-link-alt text-gray-500 group-hover:text-white transition-colors"></i>
        </a>
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
app.get('/api/health', (c) => c.json({ status: 'ok', version: '5.0', ai: 'gemini', timestamp: new Date().toISOString() }))

// Q&A API
app.post('/api/generate/qna', async (c) => {
  const { product, concern, target, tone, insuranceType, contact } = await c.req.json()
  
  const prompt = `당신은 보험 전문 콘텐츠 작성 AI입니다. 네이버 카페용 Q&A를 생성해주세요.

【조건】
- 보험 종류: ${insuranceType || '종신보험'}
- 구체적 상품명: ${product}
- 타겟: ${target}
- 문체 톤: ${tone || '친근한'}
- 고민: ${concern}
- 연락처: ${contact || '없음'}

【출력 형식 - 반드시 이 형식을 따르세요】
[질문]
(${target}이 ${product}에 대해 궁금해하는 자연스러운 질문. 300자 이상. ${tone} 톤으로 작성)

[답변]
(전문가 답변 800자 이상. ${tone} 톤으로 작성)
✅ 핵심 요약 3줄
✅ ${insuranceType}의 장점 3가지
✅ 가입 전 체크포인트 3가지
✅ 키워드(${product}, ${insuranceType}) 3회+ 자연스럽게 포함

[댓글1]
(공감하는 댓글 50자 이상)

[댓글2]
(정보 추가하는 댓글 50자 이상)

[댓글3]
(상담/가입 권유 댓글 50자 이상. ${contact ? '연락처 자연스럽게 포함' : ''})`

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
      answer: `안녕하세요, 보험 전문 상담사입니다.\n\n${product} 관련해서 답변 드릴게요.\n\n✅ 핵심 요약\n- ${product}는 ${target}분들께 적합합니다\n- 보험료 대비 보장 내용이 우수합니다\n- ${insuranceType}의 핵심 혜택을 확인하세요\n\n더 궁금하신 점 있으시면 문의해주세요!`,
      comments: '저도 같은 고민이었어요!\n\n전문가 답변 감사합니다.\n\n저도 가입 고려해봐야겠네요.'
    })
  }
})

// Blog API
app.post('/api/generate/blog', async (c) => {
  const { topic, keywords, region, type, target, tone, options } = await c.req.json()
  
  const optionsText = Array.isArray(options) ? options.join(', ') : ''
  
  const prompt = `당신은 네이버 블로그 SEO 전문 작성 AI입니다.

【조건】
- 주제: ${topic}
- 키워드: ${keywords || topic}
- 지역: ${region || '전국'}
- 콘텐츠 유형: ${type}
- 타겟 독자: ${target || '30대'}
- 문체 톤: ${tone || '친근한'}
- 포함 옵션: ${optionsText || 'Q&A 섹션, 3줄 요약, 이미지 위치'}

【규칙 - 반드시 준수】
1. 본문 1,700자 이상 (필수)
2. 2-3문장마다 줄바꿈으로 가독성 확보
3. ${optionsText.includes('3줄 요약') ? '> 📌 3줄 요약 인용구 포함' : ''}
4. ${optionsText.includes('이미지 위치') ? '[📷 이미지 삽입] 표시 3-4회' : ''}
5. 핵심 키워드 3회 이상 자연스럽게 포함
6. ${optionsText.includes('Q&A 섹션') ? 'Q&A 섹션 1개 포함' : ''}
7. ${region ? `지역(${region}) 정보 자연스럽게 포함` : ''}
8. ${tone} 톤으로 ${target} 독자에 맞게 작성

【출력 형식】
[제목]
(30자 이내, SEO 최적화, 키워드 포함)

[본문]
(1,700자 이상, 위 규칙 모두 적용)

[해시태그]
(10개, #으로 시작)`

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
      title: `${topic}, 이것만 알면 끝! 2025년 완벽 가이드`,
      content: `> 📌 이 글의 3줄 요약
> 1. ${topic}의 핵심 포인트를 알려드립니다
> 2. ${target || '30대'}를 위한 맞춤 정보
> 3. ${region || '전국'} 기준 실용적인 가이드

안녕하세요, 오늘은 ${topic}에 대해 자세히 알아보겠습니다.

[📷 이미지 삽입]

■ ${topic}, 왜 알아봐야 할까요?

최근 많은 분들이 ${topic}에 대해 관심을 가지고 계십니다.
특히 ${target || '30대'} 분들에게 중요한 정보입니다.

■ 핵심 포인트 3가지

❶ 첫 번째 포인트
본인 상황에 맞는 선택이 가장 중요합니다.
${topic}을 결정할 때 꼼꼼히 비교해보세요.

[📷 이미지 삽입]

❷ 두 번째 포인트
비용 대비 효율을 따져보는 것이 핵심입니다.
무조건 저렴한 것보다 가성비를 고려하세요.

❸ 세 번째 포인트
장기적인 관점에서 바라봐야 합니다.
${topic}은 한 번 결정하면 오래 유지됩니다.

[📷 이미지 삽입]

■ Q. ${topic} 선택 시 주의사항은?

A. 가장 중요한 것은 본인의 상황에 맞는지 확인하는 것입니다.
${region ? `${region} 지역에서는 특히` : '특히'} 아래 사항을 체크해보세요.

✅ 체크리스트
□ 나에게 맞는 조건인가?
□ 비용은 적정한가?
□ 장기적으로 유리한가?

■ 마무리

오늘 ${topic}에 대해 알아보았습니다.
${target || '30대'} 분들에게 도움이 되셨으면 좋겠습니다.

궁금한 점은 댓글로 남겨주세요! 💬`,
      hashtags: `#${topic.replace(/\s/g, '')} #${target || '30대'}추천 #보험비교 #2025보험 #${region ? region.replace(/\s/g, '') : '전국'}`
    })
  }
})

// Analyze API
app.post('/api/analyze/blog', async (c) => {
  const { content, keyword, region, type } = await c.req.json()
  
  const prompt = `당신은 네이버 블로그 SEO 분석 전문가입니다.

【분석 대상】
${content.substring(0, 4000)}

【분석 조건】
- 목표 키워드: ${keyword || '미지정'}
- 목표 지역: ${region || '미지정'}
- 분석 유형: ${type || '종합 분석'}
- 글자수: ${content.length}자

【평가 기준】
- SEO (0-100): 키워드 배치, 제목 최적화, 메타 정보, 글자수, 구조
- C-RANK (0-100): 전문성, 출처 명시, 신뢰도, 일관성
- AEO (0-100): AI 검색 답변 최적화, 질문-답변 구조, 명확성
- GEO (0-100): 지역 키워드 포함, 로컬 SEO, 지역 관련성

【출력 형식】
[점수]
SEO: (숫자)
C-RANK: (숫자)
AEO: (숫자)
GEO: (숫자)
총점: (숫자)

[분석]
■ 잘된 점 (3가지 이상)
■ 개선 필요한 점 (3가지 이상)
■ 키워드 분석 결과
■ 상위 노출 가능성 평가

[개선된 제목]
(SEO 최적화된 새로운 제목 제안)

[개선된 본문 예시]
(첫 문단 개선 예시 300자)

[개선된 해시태그]
(최적화된 해시태그 10개)`

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
    const geoScore = geoMatch ? parseInt(geoMatch[1]) : region ? 75 : 50
    const totalScore = totalMatch ? parseInt(totalMatch[1]) : Math.round((seoScore + crankScore + aeoScore + geoScore) / 4)
    
    const analysisMatch = result.match(/\[분석\]([\s\S]*?)(?=\[개선된 제목\])/i)
    const improvedMatch = result.match(/\[개선된 제목\]([\s\S]*?)$/i)
    
    return c.json({
      totalScore, seoScore, crankScore, aeoScore, geoScore,
      analysis: analysisMatch ? analysisMatch[1].trim() : '분석 결과를 생성하지 못했습니다.',
      improved: improvedMatch ? improvedMatch[1].trim() : '개선안을 생성하지 못했습니다.'
    })
  } catch (error) {
    return c.json({
      totalScore: 65, seoScore: 70, crankScore: 65, aeoScore: 60, geoScore: 50,
      analysis: '분석 중 오류가 발생했습니다. 다시 시도해주세요.',
      improved: '개선안을 생성하지 못했습니다.'
    })
  }
})

export default app
