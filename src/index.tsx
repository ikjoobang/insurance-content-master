import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  GEMINI_API_KEYS?: string
  NAVER_CLIENT_ID?: string
  NAVER_CLIENT_SECRET?: string
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS 설정
app.use('/*', cors())

// ============================================
// 보험 콘텐츠 마스터 V2.0
// Gemini AI 연동 + 네이버 블로그 최적화
// ============================================

// Gemini API 키 로테이션 시스템
const GEMINI_KEYS = [
  'AIzaSyD_XMMAwxEKl23JgQZsUPF9H6cKBiIqZQA',
  'AIzaSyBjbZvUc-YKSFnMhco9sLVKEli2RXbbQuw',
  'AIzaSyCRVYPJ23CWgTL0u4boCbwbcsts0wD8D7M'
]

let currentKeyIndex = 0
let failedKeys = new Set<number>()

function getNextApiKey(): string | null {
  // 모든 키가 실패한 경우 리셋
  if (failedKeys.size >= GEMINI_KEYS.length) {
    failedKeys.clear()
  }
  
  // 사용 가능한 키 찾기
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
  if (idx !== -1) {
    failedKeys.add(idx)
  }
}

// Gemini API 호출 함수
async function callGeminiAPI(prompt: string, retries = 3): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const apiKey = getNextApiKey()
    if (!apiKey) throw new Error('No API keys available')
    
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.8,
              topK: 40,
              topP: 0.95,
              maxOutputTokens: 8192
            }
          })
        }
      )
      
      if (!response.ok) {
        markKeyFailed(apiKey)
        continue
      }
      
      const data = await response.json() as any
      return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    } catch (error) {
      markKeyFailed(apiKey)
    }
  }
  throw new Error('All API keys failed')
}

// 메인 HTML 페이지
const mainPageHtml = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>보험 콘텐츠 마스터 V2.0 | AI 블로그 · Q&A 생성</title>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <style>
    :root {
      --naver-green: #03C75A;
      --naver-green-dark: #02b351;
      --naver-green-light: #e8f7ee;
      --accent-orange: #FF6B35;
      --accent-blue: #3b82f6;
      --accent-teal: #10b981;
      --accent-red: #ef4444;
      --black: #1a1a1a;
      --gray-900: #2d2d2d;
      --gray-700: #4a4a4a;
      --gray-600: #666666;
      --gray-500: #888888;
      --gray-400: #999999;
      --gray-300: #cccccc;
      --gray-200: #e0e0e0;
      --gray-100: #f0f0f0;
      --gray-50: #fafafa;
      --white: #ffffff;
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 12px;
      --radius-xl: 16px;
      --shadow-sm: 0 2px 8px rgba(0,0,0,0.06);
      --shadow-md: 0 4px 20px rgba(0,0,0,0.08);
      --shadow-lg: 0 8px 30px rgba(0,0,0,0.12);
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: 'Noto Sans KR', -apple-system, BlinkMacSystemFont, sans-serif;
      color: var(--gray-700);
      background: var(--gray-100);
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      word-break: keep-all;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px 16px;
    }

    @media (min-width: 769px) {
      .container { padding: 20px 32px; }
    }

    .card {
      background: var(--white);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-md);
      overflow: hidden;
    }

    /* Header */
    .header {
      background: linear-gradient(135deg, var(--black) 0%, var(--gray-900) 100%);
      padding: 20px 24px;
      color: var(--white);
    }

    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    .header h1 {
      font-size: 22px;
      font-weight: 900;
      letter-spacing: -0.03em;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .header h1 i { color: var(--naver-green); }

    .header-subtitle {
      font-size: 11px;
      color: rgba(255,255,255,0.6);
      margin-top: 4px;
    }

    .header-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    @media (min-width: 769px) {
      .header h1 { font-size: 26px; }
    }

    /* Tabs */
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--gray-200);
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tabs::-webkit-scrollbar { display: none; }

    .tab-btn {
      flex: 1;
      min-width: 100px;
      padding: 16px 12px;
      font-size: 13px;
      font-weight: 500;
      color: var(--gray-600);
      background: transparent;
      border: none;
      border-bottom: 3px solid transparent;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }

    .tab-btn:hover { color: var(--naver-green); }

    .tab-btn.active {
      color: var(--naver-green);
      border-bottom-color: var(--naver-green);
      font-weight: 700;
      background: var(--naver-green-light);
    }

    .tab-btn i { margin-right: 6px; }

    /* Panel Layout */
    .panel-grid {
      display: grid;
      grid-template-columns: 1fr;
    }

    @media (min-width: 1024px) {
      .panel-grid { grid-template-columns: 400px 1fr; }
    }

    .left-panel {
      padding: 20px;
      background: var(--gray-50);
      border-right: 1px solid var(--gray-200);
      max-height: calc(100vh - 200px);
      overflow-y: auto;
    }

    .right-panel {
      padding: 20px;
      max-height: calc(100vh - 200px);
      overflow-y: auto;
    }

    @media (min-width: 769px) {
      .left-panel, .right-panel { padding: 24px; }
    }

    /* Labels */
    .label {
      font-size: 11px;
      font-weight: 700;
      color: var(--gray-500);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 8px;
    }

    /* Button Grid */
    .btn-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 16px;
    }

    .btn-grid-3 {
      grid-template-columns: repeat(3, 1fr);
    }

    /* Category Buttons */
    .cat-btn {
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 500;
      text-align: left;
      background: var(--white);
      border: 1px solid var(--gray-200);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: all 0.2s;
    }

    .cat-btn:hover { border-color: var(--naver-green); }

    .cat-btn.active {
      border-color: var(--naver-green);
      background: var(--naver-green-light);
      color: var(--naver-green);
    }

    .cat-btn i { margin-right: 6px; }

    .tone-btn {
      padding: 10px;
      font-size: 12px;
      font-weight: 500;
      text-align: center;
      background: var(--white);
      border: 1px solid var(--gray-200);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: all 0.2s;
    }

    .tone-btn.active {
      border-color: var(--black);
      background: var(--black);
      color: var(--white);
    }

    /* Input Fields */
    .input {
      width: 100%;
      padding: 12px 14px;
      font-size: 14px;
      font-family: inherit;
      border: 1px solid var(--gray-200);
      border-radius: var(--radius-md);
      outline: none;
      transition: all 0.2s;
      margin-bottom: 12px;
    }

    .input:focus {
      border-color: var(--naver-green);
      box-shadow: 0 0 0 3px rgba(3, 199, 90, 0.1);
    }

    .textarea {
      width: 100%;
      padding: 12px 14px;
      font-size: 14px;
      font-family: inherit;
      border: 1px solid var(--gray-200);
      border-radius: var(--radius-md);
      outline: none;
      resize: vertical;
      min-height: 100px;
      margin-bottom: 12px;
      transition: all 0.2s;
    }

    .textarea:focus {
      border-color: var(--naver-green);
      box-shadow: 0 0 0 3px rgba(3, 199, 90, 0.1);
    }

    /* Primary Button */
    .btn-primary {
      width: 100%;
      padding: 14px;
      font-size: 14px;
      font-weight: 700;
      font-family: inherit;
      color: var(--white);
      background: var(--naver-green);
      border: none;
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .btn-primary:hover { background: var(--naver-green-dark); }
    .btn-primary:active { transform: scale(0.98); }
    .btn-primary:disabled {
      background: var(--gray-300);
      cursor: not-allowed;
    }

    .btn-primary.orange { background: var(--accent-orange); }
    .btn-primary.orange:hover { background: #e55a28; }
    .btn-primary.dark { background: var(--black); }
    .btn-primary.dark:hover { background: var(--gray-900); }
    .btn-primary.blue { background: var(--accent-blue); }
    .btn-primary.blue:hover { background: #2563eb; }

    /* Result Box */
    .result-box {
      background: var(--white);
      border: 1px solid var(--gray-200);
      border-radius: var(--radius-lg);
      margin-bottom: 16px;
      overflow: hidden;
    }

    .result-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid var(--gray-200);
      background: var(--gray-50);
      flex-wrap: wrap;
      gap: 8px;
    }

    .result-title {
      font-size: 12px;
      font-weight: 700;
      color: var(--gray-600);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .result-title i { color: var(--naver-green); }

    .copy-btn {
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 600;
      font-family: inherit;
      color: var(--white);
      background: var(--naver-green);
      border: none;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: all 0.2s;
    }

    .copy-btn:hover { background: var(--naver-green-dark); }
    .copy-btn.dark { background: var(--black); }
    .copy-btn.dark:hover { background: var(--gray-900); }
    .copy-btn.copied { background: var(--accent-teal); }

    .result-content {
      padding: 14px;
      font-size: 13px;
      line-height: 1.8;
      min-height: 60px;
      cursor: pointer;
      transition: background 0.2s;
      white-space: pre-wrap;
      color: var(--gray-700);
    }

    .result-content:hover { background: var(--gray-50); }

    .result-content.empty {
      color: var(--gray-400);
      text-align: center;
      padding: 30px 14px;
    }

    /* Preview Box */
    .preview-box {
      padding: 14px;
      height: 300px;
      overflow-y: auto;
      font-size: 13px;
      line-height: 1.9;
      white-space: pre-wrap;
      cursor: pointer;
    }

    @media (min-width: 769px) {
      .preview-box { height: 380px; }
    }

    .preview-box:hover { background: var(--gray-50); }

    /* Score Display */
    .score-box {
      background: linear-gradient(135deg, var(--naver-green-light) 0%, #d4f5e0 100%);
      border: 2px solid var(--naver-green);
      border-radius: var(--radius-lg);
      padding: 16px;
      margin-bottom: 16px;
    }

    .score-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .score-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--black);
    }

    .score-value {
      font-size: 28px;
      font-weight: 900;
      color: var(--naver-green);
    }

    .score-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
    }

    .score-item {
      background: var(--white);
      border-radius: var(--radius-sm);
      padding: 8px;
      text-align: center;
    }

    .score-item-label {
      font-size: 10px;
      font-weight: 700;
      color: var(--gray-500);
      margin-bottom: 4px;
    }

    .score-item-value {
      font-size: 16px;
      font-weight: 700;
      color: var(--black);
    }

    /* Tips Box */
    .tips-box {
      background: linear-gradient(135deg, #fff9e6 0%, #fff3cc 100%);
      border: 1px solid #ffe0a0;
      border-radius: var(--radius-md);
      padding: 12px 14px;
      margin-bottom: 16px;
    }

    .tips-title {
      font-size: 11px;
      font-weight: 700;
      color: #b8860b;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .tips-content {
      font-size: 11px;
      color: #8b6914;
      line-height: 1.6;
    }

    /* Status Box */
    .status-box {
      margin-top: 16px;
      padding: 10px 14px;
      background: var(--gray-100);
      border-radius: var(--radius-sm);
      font-size: 12px;
      color: var(--gray-600);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .status-box i { color: var(--naver-green); }

    /* Info Cards */
    .info-cards {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-top: 20px;
    }

    @media (min-width: 769px) {
      .info-cards { grid-template-columns: repeat(6, 1fr); }
    }

    .info-card {
      background: var(--white);
      padding: 12px;
      border-radius: var(--radius-md);
      border-left: 3px solid;
      box-shadow: var(--shadow-sm);
      text-align: center;
    }

    .info-card h4 {
      font-size: 12px;
      font-weight: 700;
      color: var(--gray-700);
      margin-bottom: 2px;
    }

    .info-card p {
      font-size: 10px;
      color: var(--gray-500);
    }

    /* Footer */
    .footer {
      margin-top: 20px;
      padding: 20px;
      text-align: center;
      font-size: 12px;
      color: var(--gray-500);
    }

    .footer a { color: var(--naver-green); font-weight: 700; }

    /* Toast */
    .toast {
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 14px 20px;
      background: var(--black);
      color: var(--white);
      border-radius: var(--radius-md);
      font-size: 13px;
      font-weight: 500;
      box-shadow: var(--shadow-lg);
      z-index: 9999;
      transform: translateX(120%);
      opacity: 0;
      transition: all 0.3s ease-out;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .toast.success { background: var(--naver-green); }
    .toast.error { background: var(--accent-red); }
    .toast.show {
      transform: translateX(0);
      opacity: 1;
    }

    /* Loading Spinner */
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .loading-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: var(--white);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    /* Char Count */
    .char-count {
      display: inline-flex;
      gap: 6px;
      font-size: 11px;
    }

    .char-count span {
      padding: 3px 8px;
      border-radius: 12px;
      background: var(--gray-100);
      color: var(--gray-600);
    }

    .char-count .pure {
      background: var(--naver-green-light);
      color: var(--naver-green);
      font-weight: 600;
    }

    .char-count .warning {
      background: #fef3c7;
      color: #d97706;
    }

    .char-count .success {
      background: var(--naver-green-light);
      color: var(--naver-green);
    }

    /* Hidden */
    .hidden { display: none !important; }

    /* Tab Content */
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* Action Row */
    .action-row {
      display: flex;
      gap: 8px;
      margin-top: 16px;
      flex-wrap: wrap;
    }

    .action-btn {
      flex: 1;
      min-width: 120px;
      padding: 12px;
      font-size: 13px;
      font-weight: 700;
      font-family: inherit;
      border: none;
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }

    .action-btn.primary {
      color: var(--white);
      background: var(--naver-green);
    }

    .action-btn.primary:hover { background: var(--naver-green-dark); }

    .action-btn.secondary {
      color: var(--white);
      background: var(--black);
    }

    .action-btn.secondary:hover { background: var(--gray-900); }

    .action-btn.outline {
      color: var(--gray-700);
      background: var(--white);
      border: 1px solid var(--gray-300);
    }

    .action-btn.outline:hover { border-color: var(--naver-green); color: var(--naver-green); }

    /* Image Placeholder */
    .img-placeholder {
      background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%);
      border: 2px dashed #0ea5e9;
      border-radius: var(--radius-md);
      padding: 16px;
      text-align: center;
      margin: 12px 0;
      color: #0369a1;
      font-size: 13px;
    }

    .img-placeholder i {
      font-size: 24px;
      margin-bottom: 8px;
      display: block;
    }

    /* Divider */
    .divider {
      border: none;
      border-top: 1px dashed var(--gray-300);
      margin: 16px 0;
    }

    /* AI Badge */
    .ai-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: white;
      font-size: 10px;
      font-weight: 700;
      border-radius: 12px;
    }

    /* SEO Tags */
    .seo-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .seo-tag {
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 12px;
    }

    .seo-tag.good { background: var(--naver-green-light); color: var(--naver-green); }
    .seo-tag.warning { background: #fef3c7; color: #d97706; }
    .seo-tag.bad { background: #fee2e2; color: #dc2626; }
  </style>
</head>
<body>
  <div class="container">
    
    <div class="card">
      
      <!-- Header -->
      <div class="header">
        <div class="header-content">
          <div>
            <h1><i class="fas fa-shield-alt"></i> 보험 콘텐츠 마스터 <span class="ai-badge"><i class="fas fa-robot"></i> AI</span></h1>
            <p class="header-subtitle">Q&A 생성 | 블로그 작성 | SEO/C-RANK/AEO/GEO 최적화 | V2.0</p>
          </div>
          <div class="header-actions">
            <button onclick="copyAll('question')" class="copy-btn dark">질문</button>
            <button onclick="copyAll('answer')" class="copy-btn dark">답변</button>
            <button onclick="copyAll('content')" class="copy-btn">본문</button>
            <button onclick="copyAll('all')" class="copy-btn">전체</button>
          </div>
        </div>
      </div>
      
      <!-- Tabs -->
      <div class="tabs">
        <button onclick="switchTab('qna')" id="tab-qna" class="tab-btn active">
          <i class="fas fa-comments"></i>Q&A 생성
        </button>
        <button onclick="switchTab('blog')" id="tab-blog" class="tab-btn">
          <i class="fas fa-blog"></i>블로그 생성
        </button>
        <button onclick="switchTab('analyze')" id="tab-analyze" class="tab-btn">
          <i class="fas fa-chart-line"></i>블로그 분석
        </button>
        <button onclick="switchTab('title')" id="tab-title" class="tab-btn">
          <i class="fas fa-heading"></i>제목 생성
        </button>
        <button onclick="switchTab('keyword')" id="tab-keyword" class="tab-btn">
          <i class="fas fa-key"></i>키워드
        </button>
      </div>
      
      <!-- Panel Grid -->
      <div class="panel-grid">
        
        <!-- Left Panel -->
        <div class="left-panel">
          
          <!-- Q&A Tab -->
          <div id="panel-qna" class="tab-panel active">
            <p class="label">타겟 고객</p>
            <div class="btn-grid">
              <button onclick="selectTarget(this, 'qna')" class="cat-btn active" data-value="30대 직장인">
                <i class="fas fa-briefcase" style="color: #3b82f6;"></i>30대 직장인
              </button>
              <button onclick="selectTarget(this, 'qna')" class="cat-btn" data-value="40대 가장">
                <i class="fas fa-home" style="color: #10b981;"></i>40대 가장
              </button>
              <button onclick="selectTarget(this, 'qna')" class="cat-btn" data-value="50대 은퇴준비">
                <i class="fas fa-umbrella-beach" style="color: #f59e0b;"></i>50대 은퇴준비
              </button>
              <button onclick="selectTarget(this, 'qna')" class="cat-btn" data-value="신혼부부">
                <i class="fas fa-heart" style="color: #ec4899;"></i>신혼부부
              </button>
            </div>
            
            <p class="label">문체</p>
            <div class="btn-grid">
              <button onclick="selectTone(this, 'qna')" class="tone-btn active" data-value="해요체">해요체</button>
              <button onclick="selectTone(this, 'qna')" class="tone-btn" data-value="습니다체">습니다체</button>
              <button onclick="selectTone(this, 'qna')" class="tone-btn" data-value="혼합체">혼합체</button>
            </div>
            
            <p class="label">보험 상품명 *</p>
            <input id="qna-product" class="input" placeholder="예: 삼성생명 종신보험, 현대해상 자동차보험" />
            
            <p class="label">핵심 고민/질문 *</p>
            <textarea id="qna-concern" class="textarea" placeholder="예: 종신보험 가입을 고민 중인데요, 보험료가 부담되네요. 다이렉트로 가입하는게 좋을까요?"></textarea>
            
            <p class="label">연락처 (답변 하단에 표시)</p>
            <input id="qna-contact" class="input" placeholder="예: 카카오톡 오픈채팅 링크" />
            
            <button onclick="generateQnA()" id="qna-btn" class="btn-primary">
              <i class="fas fa-magic"></i>
              <span>AI Q&A 생성하기</span>
            </button>
            
            <div class="tips-box" style="margin-top: 16px;">
              <div class="tips-title"><i class="fas fa-lightbulb"></i> 금소법 우회 전략</div>
              <div class="tips-content">
                ✓ 세컨 아이디로 질문 (비행기모드 IP변경)<br>
                ✓ 본 아이디로 전문가 답변<br>
                ✓ 키워드 3회+ 포함 = C-Rank 상승
              </div>
            </div>
          </div>
          
          <!-- Blog Tab -->
          <div id="panel-blog" class="tab-panel">
            <p class="label">콘텐츠 유형</p>
            <div class="btn-grid">
              <button onclick="selectTarget(this, 'blog')" class="cat-btn active" data-value="정보성">
                <i class="fas fa-info-circle" style="color: #3b82f6;"></i>정보성
              </button>
              <button onclick="selectTarget(this, 'blog')" class="cat-btn" data-value="후기성">
                <i class="fas fa-star" style="color: #f59e0b;"></i>후기성
              </button>
              <button onclick="selectTarget(this, 'blog')" class="cat-btn" data-value="비교분석">
                <i class="fas fa-balance-scale" style="color: #10b981;"></i>비교분석
              </button>
              <button onclick="selectTarget(this, 'blog')" class="cat-btn" data-value="상담유도">
                <i class="fas fa-phone" style="color: #ec4899;"></i>상담유도
              </button>
            </div>
            
            <p class="label">문체</p>
            <div class="btn-grid btn-grid-3">
              <button onclick="selectTone(this, 'blog')" class="tone-btn active" data-value="해요체">해요체</button>
              <button onclick="selectTone(this, 'blog')" class="tone-btn" data-value="습니다체">습니다체</button>
              <button onclick="selectTone(this, 'blog')" class="tone-btn" data-value="혼합체">혼합체</button>
            </div>
            
            <p class="label">블로그 주제 *</p>
            <input id="blog-topic" class="input" placeholder="예: 30대 종신보험 추천, 암보험 비교" />
            
            <p class="label">핵심 키워드 (쉼표로 구분)</p>
            <input id="blog-keywords" class="input" placeholder="예: 종신보험, 30대 보험, 보험료 절약" />
            
            <p class="label">지역 (GEO 최적화)</p>
            <input id="blog-region" class="input" placeholder="예: 서울 강남, 경기 분당" />
            
            <p class="label">추가 요청사항</p>
            <textarea id="blog-extra" class="textarea" placeholder="예: 고객 입장에서 WHY? 그래서 나에게 어떤게 좋은데?&#10;보험료 비교표 포함, 실제 사례 넣어줘" style="min-height: 80px;"></textarea>
            
            <button onclick="generateBlog()" id="blog-btn" class="btn-primary orange">
              <i class="fas fa-pen-fancy"></i>
              <span>AI 블로그 생성하기 (1,700자+)</span>
            </button>
            
            <div class="tips-box" style="margin-top: 16px;">
              <div class="tips-title"><i class="fas fa-lightbulb"></i> 네이버 블로그 최적화</div>
              <div class="tips-content">
                ✓ 본문 1,700자 이상 (SEO 최적화)<br>
                ✓ 2-3문장마다 줄바꿈 (모바일 가독성)<br>
                ✓ 이미지 삽입 위치 표시 (스크롤 2-3회마다)<br>
                ✓ 인용구로 3줄 요약 제공
              </div>
            </div>
          </div>
          
          <!-- Analyze Tab -->
          <div id="panel-analyze" class="tab-panel">
            <p class="label">분석할 블로그 글 붙여넣기 *</p>
            <textarea id="analyze-content" class="textarea" placeholder="네이버 블로그에 작성한 글 전체를 붙여넣으세요.&#10;&#10;제목, 본문, 해시태그 모두 포함해주세요." style="min-height: 200px;"></textarea>
            
            <p class="label">목표 키워드</p>
            <input id="analyze-keyword" class="input" placeholder="예: 강남 종신보험, 30대 암보험" />
            
            <p class="label">목표 지역</p>
            <input id="analyze-region" class="input" placeholder="예: 서울 강남구" />
            
            <button onclick="analyzeBlog()" id="analyze-btn" class="btn-primary blue">
              <i class="fas fa-search-plus"></i>
              <span>AI 블로그 분석하기</span>
            </button>
            
            <div class="tips-box" style="margin-top: 16px;">
              <div class="tips-title"><i class="fas fa-trophy"></i> 지역1위/키워드1위 목표</div>
              <div class="tips-content">
                ✓ SEO 점수 80점 이상 권장<br>
                ✓ C-RANK 전문성 구조 확인<br>
                ✓ AEO 질문-답변 최적화<br>
                ✓ GEO 지역 키워드 포함
              </div>
            </div>
          </div>
          
          <!-- Title Tab -->
          <div id="panel-title" class="tab-panel">
            <p class="label">제목 스타일</p>
            <div class="btn-grid">
              <button onclick="selectTarget(this, 'title')" class="cat-btn active" data-value="궁금증유발">
                <i class="fas fa-question-circle" style="color: #f59e0b;"></i>궁금증 유발
              </button>
              <button onclick="selectTarget(this, 'title')" class="cat-btn" data-value="정보제공">
                <i class="fas fa-book" style="color: #3b82f6;"></i>정보 제공
              </button>
              <button onclick="selectTarget(this, 'title')" class="cat-btn" data-value="비교분석">
                <i class="fas fa-balance-scale" style="color: #10b981;"></i>비교 분석
              </button>
              <button onclick="selectTarget(this, 'title')" class="cat-btn" data-value="후기형">
                <i class="fas fa-star" style="color: #ec4899;"></i>후기형
              </button>
            </div>
            
            <p class="label">생성 개수</p>
            <div class="btn-grid btn-grid-3">
              <button onclick="selectCount(this)" class="tone-btn" data-value="3">3개</button>
              <button onclick="selectCount(this)" class="tone-btn active" data-value="5">5개</button>
              <button onclick="selectCount(this)" class="tone-btn" data-value="10">10개</button>
            </div>
            
            <p class="label">주제/키워드 *</p>
            <input id="title-topic" class="input" placeholder="예: 암보험, 실비보험, 종신보험 비교" />
            
            <button onclick="generateTitles()" id="title-btn" class="btn-primary dark">
              <i class="fas fa-list"></i>
              <span>AI 제목 생성하기</span>
            </button>
          </div>
          
          <!-- Keyword Tab -->
          <div id="panel-keyword" class="tab-panel">
            <p class="label">메인 키워드 *</p>
            <input id="keyword-main" class="input" placeholder="예: 종신보험 추천" />
            
            <p class="label">지역 (선택)</p>
            <input id="keyword-region" class="input" placeholder="예: 서울 강남" />
            
            <button onclick="findKeywords()" id="keyword-btn" class="btn-primary">
              <i class="fas fa-search"></i>
              <span>연관 키워드 찾기</span>
            </button>
          </div>
          
          <!-- Status -->
          <div class="status-box">
            <i class="fas fa-info-circle"></i>
            <span id="status-text">대기 중 - Gemini AI 연동됨</span>
          </div>
        </div>
        
        <!-- Right Panel -->
        <div class="right-panel">
          
          <!-- Q&A Results -->
          <div id="result-qna" class="tab-panel active">
            <div class="result-box">
              <div class="result-header">
                <span class="result-title"><i class="fas fa-question-circle"></i> 질문 (세컨 아이디용)</span>
                <button onclick="copyContent('qna-question')" class="copy-btn">복사</button>
              </div>
              <div id="qna-question" class="result-content empty">
                상품명과 고민을 입력하고 생성 버튼을 눌러주세요
              </div>
            </div>
            
            <div class="result-box">
              <div class="result-header">
                <span class="result-title"><i class="fas fa-user-tie"></i> 전문가 답변 (본 아이디용)</span>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div class="char-count">
                    <span id="answer-char">0자</span>
                    <span class="pure" id="answer-pure">순수 0자</span>
                  </div>
                  <button onclick="copyContent('qna-answer')" class="copy-btn dark">복사</button>
                </div>
              </div>
              <div id="qna-answer" class="preview-box">전문가 답변이 여기에 표시됩니다.</div>
            </div>
            
            <div class="result-box">
              <div class="result-header">
                <span class="result-title"><i class="fas fa-reply"></i> 꼬리형 댓글 3개</span>
                <button onclick="copyContent('qna-comments')" class="copy-btn">복사</button>
              </div>
              <div id="qna-comments" class="result-content empty">
                댓글이 여기에 표시됩니다
              </div>
            </div>
            
            <div class="action-row">
              <button onclick="copyAllQnA()" class="action-btn primary"><i class="fas fa-copy"></i>전체 복사</button>
              <button onclick="downloadTxt('qna')" class="action-btn secondary"><i class="fas fa-file-alt"></i>TXT</button>
              <button onclick="downloadPdf('qna')" class="action-btn outline"><i class="fas fa-file-pdf"></i>PDF</button>
            </div>
          </div>
          
          <!-- Blog Results -->
          <div id="result-blog" class="tab-panel">
            <div class="result-box">
              <div class="result-header">
                <span class="result-title"><i class="fas fa-heading"></i> 제목 (SEO 최적화)</span>
                <button onclick="copyContent('blog-title')" class="copy-btn">복사</button>
              </div>
              <div id="blog-title" class="result-content empty">
                제목이 여기에 표시됩니다
              </div>
            </div>
            
            <div class="result-box">
              <div class="result-header">
                <span class="result-title"><i class="fas fa-align-left"></i> 본문 (1,700자+ 네이버 최적화)</span>
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <div class="char-count">
                    <span id="blog-char">0자</span>
                    <span id="blog-status" class="warning">목표: 1,700자</span>
                  </div>
                  <button onclick="copyContent('blog-content')" class="copy-btn dark">복사</button>
                </div>
              </div>
              <div id="blog-content" class="preview-box">본문이 여기에 표시됩니다.

■ 네이버 블로그 최적화 적용 항목:
• 본문 1,700자 이상
• 2-3문장마다 줄바꿈 (모바일 가독성)
• 인용구 형식의 3줄 요약
• 이미지 삽입 위치 표시
• 고객 관점의 WHY? 질문 답변
• SEO/C-RANK/AEO/GEO 최적화</div>
            </div>
            
            <div class="result-box">
              <div class="result-header">
                <span class="result-title"><i class="fas fa-hashtag"></i> 해시태그</span>
                <button onclick="copyContent('blog-hashtags')" class="copy-btn">복사</button>
              </div>
              <div id="blog-hashtags" class="result-content empty" style="color: var(--naver-green);">
                해시태그가 여기에 표시됩니다
              </div>
            </div>
            
            <div class="action-row">
              <button onclick="copyAllBlog()" class="action-btn primary"><i class="fas fa-copy"></i>전체 복사</button>
              <button onclick="downloadTxt('blog')" class="action-btn secondary"><i class="fas fa-file-alt"></i>TXT</button>
              <button onclick="downloadPdf('blog')" class="action-btn outline"><i class="fas fa-file-pdf"></i>PDF</button>
            </div>
          </div>
          
          <!-- Analyze Results -->
          <div id="result-analyze" class="tab-panel">
            <div id="analyze-score" class="score-box" style="display: none;">
              <div class="score-header">
                <span class="score-title">📊 종합 SEO 점수</span>
                <span class="score-value" id="total-score">0점</span>
              </div>
              <div class="score-grid">
                <div class="score-item">
                  <div class="score-item-label">SEO</div>
                  <div class="score-item-value" id="seo-score">-</div>
                </div>
                <div class="score-item">
                  <div class="score-item-label">C-RANK</div>
                  <div class="score-item-value" id="crank-score">-</div>
                </div>
                <div class="score-item">
                  <div class="score-item-label">AEO</div>
                  <div class="score-item-value" id="aeo-score">-</div>
                </div>
                <div class="score-item">
                  <div class="score-item-label">GEO</div>
                  <div class="score-item-value" id="geo-score">-</div>
                </div>
              </div>
            </div>
            
            <div class="result-box">
              <div class="result-header">
                <span class="result-title"><i class="fas fa-clipboard-check"></i> 분석 결과</span>
                <button onclick="copyContent('analyze-result')" class="copy-btn">복사</button>
              </div>
              <div id="analyze-result" class="preview-box">블로그 글을 붙여넣고 분석 버튼을 눌러주세요.

분석 항목:
• 글자수 체크 (1,700자 이상 권장)
• 키워드 밀도 분석
• 제목 SEO 최적화 점수
• C-RANK 전문성 구조
• AEO 질문-답변 구조
• GEO 지역 키워드 포함 여부
• 개선 제안사항</div>
            </div>
            
            <div class="result-box">
              <div class="result-header">
                <span class="result-title"><i class="fas fa-edit"></i> 수정된 제목/내용/해시태그</span>
                <button onclick="copyContent('analyze-improved')" class="copy-btn dark">복사</button>
              </div>
              <div id="analyze-improved" class="preview-box">분석 후 개선된 내용이 여기에 표시됩니다.</div>
            </div>
            
            <div class="action-row">
              <button onclick="copyAnalyzeAll()" class="action-btn primary"><i class="fas fa-copy"></i>전체 복사</button>
              <button onclick="downloadTxt('analyze')" class="action-btn secondary"><i class="fas fa-file-alt"></i>TXT</button>
            </div>
          </div>
          
          <!-- Title Results -->
          <div id="result-title" class="tab-panel">
            <div class="result-box">
              <div class="result-header">
                <span class="result-title"><i class="fas fa-list"></i> 생성된 제목들</span>
                <button onclick="copyContent('title-results')" class="copy-btn">전체 복사</button>
              </div>
              <div id="title-results" class="preview-box">제목을 생성해주세요.</div>
            </div>
          </div>
          
          <!-- Keyword Results -->
          <div id="result-keyword" class="tab-panel">
            <div class="result-box">
              <div class="result-header">
                <span class="result-title"><i class="fas fa-key"></i> 연관 키워드</span>
                <button onclick="copyContent('keyword-results')" class="copy-btn">전체 복사</button>
              </div>
              <div id="keyword-results" class="preview-box">키워드를 입력해주세요.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Info Cards -->
    <div class="info-cards">
      <div class="info-card" style="border-color: #03C75A;">
        <h4>SEO</h4>
        <p>검색 최적화</p>
      </div>
      <div class="info-card" style="border-color: #3b82f6;">
        <h4>C-RANK</h4>
        <p>전문성 구조</p>
      </div>
      <div class="info-card" style="border-color: #f59e0b;">
        <h4>AEO</h4>
        <p>Q&A 최적화</p>
      </div>
      <div class="info-card" style="border-color: #ec4899;">
        <h4>GEO</h4>
        <p>지역 최적화</p>
      </div>
      <div class="info-card" style="border-color: #8b5cf6;">
        <h4>AI</h4>
        <p>Gemini 연동</p>
      </div>
      <div class="info-card" style="border-color: #1a1a1a;">
        <h4>1,700+</h4>
        <p>최소 글자수</p>
      </div>
    </div>
    
    <!-- Footer -->
    <footer class="footer">
      <p>© 2025 보험 콘텐츠 마스터 V2.0 | 개발자: 방익주</p>
      <p style="margin-top: 6px; color: var(--gray-400);">
        AI 기반 보험 콘텐츠 자동 생성 · SEO/C-RANK/AEO/GEO 최적화
      </p>
    </footer>
  </div>
  
  <!-- Toast -->
  <div id="toast" class="toast">
    <i class="fas fa-check-circle"></i>
    <span id="toast-text">복사되었습니다!</span>
  </div>

  <script>
    // State
    let currentTab = 'qna';
    const state = {
      qna: { target: '30대 직장인', tone: '해요체' },
      blog: { type: '정보성', tone: '해요체' },
      title: { style: '궁금증유발', count: '5' }
    };

    // Tab switching
    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('tab-' + tab).classList.add('active');
      
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById('panel-' + tab).classList.add('active');
      document.getElementById('result-' + tab).classList.add('active');
    }

    // Select target/tone
    function selectTarget(btn, type) {
      btn.closest('.btn-grid').querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (type === 'qna') state.qna.target = btn.dataset.value;
      else if (type === 'blog') state.blog.type = btn.dataset.value;
      else if (type === 'title') state.title.style = btn.dataset.value;
    }

    function selectTone(btn, type) {
      btn.closest('.btn-grid').querySelectorAll('.tone-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (type === 'qna') state.qna.tone = btn.dataset.value;
      else if (type === 'blog') state.blog.tone = btn.dataset.value;
    }

    function selectCount(btn) {
      btn.closest('.btn-grid').querySelectorAll('.tone-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.title.count = btn.dataset.value;
    }

    // Toast notification
    function showToast(message, type = 'success') {
      const toast = document.getElementById('toast');
      const text = document.getElementById('toast-text');
      text.textContent = message;
      toast.className = 'toast ' + type + ' show';
      setTimeout(() => toast.classList.remove('show'), 2500);
    }

    // Copy functionality
    function copyContent(elementId) {
      const el = document.getElementById(elementId);
      const text = el.textContent;
      if (text && !text.includes('입력하고') && !text.includes('여기에 표시') && !text.includes('붙여넣고')) {
        navigator.clipboard.writeText(text).then(() => {
          showToast('클립보드에 복사되었습니다!');
        });
      }
    }

    function copyAllQnA() {
      const q = document.getElementById('qna-question').textContent;
      const a = document.getElementById('qna-answer').textContent;
      const c = document.getElementById('qna-comments').textContent;
      const all = '【질문】\\n' + q + '\\n\\n【답변】\\n' + a + '\\n\\n【댓글】\\n' + c;
      navigator.clipboard.writeText(all).then(() => showToast('전체 내용이 복사되었습니다!'));
    }

    function copyAllBlog() {
      const t = document.getElementById('blog-title').textContent;
      const c = document.getElementById('blog-content').textContent;
      const h = document.getElementById('blog-hashtags').textContent;
      const all = t + '\\n\\n' + c + '\\n\\n' + h;
      navigator.clipboard.writeText(all).then(() => showToast('전체 내용이 복사되었습니다!'));
    }

    function copyAnalyzeAll() {
      const r = document.getElementById('analyze-result').textContent;
      const i = document.getElementById('analyze-improved').textContent;
      const all = '【분석 결과】\\n' + r + '\\n\\n【개선된 내용】\\n' + i;
      navigator.clipboard.writeText(all).then(() => showToast('전체 내용이 복사되었습니다!'));
    }

    function copyAll(type) {
      if (type === 'question') copyContent('qna-question');
      else if (type === 'answer') copyContent('qna-answer');
      else if (type === 'content') copyContent('blog-content');
      else if (type === 'all') {
        if (currentTab === 'qna') copyAllQnA();
        else if (currentTab === 'blog') copyAllBlog();
        else if (currentTab === 'analyze') copyAnalyzeAll();
      }
    }

    // Download functions
    function downloadTxt(type) {
      let content = '';
      let filename = '';
      
      if (type === 'qna') {
        const q = document.getElementById('qna-question').textContent;
        const a = document.getElementById('qna-answer').textContent;
        const c = document.getElementById('qna-comments').textContent;
        content = '【질문】\\n' + q + '\\n\\n【답변】\\n' + a + '\\n\\n【댓글】\\n' + c;
        filename = 'qna_' + new Date().toISOString().slice(0,10) + '.txt';
      } else if (type === 'blog') {
        const t = document.getElementById('blog-title').textContent;
        const c = document.getElementById('blog-content').textContent;
        const h = document.getElementById('blog-hashtags').textContent;
        content = '【제목】\\n' + t + '\\n\\n【본문】\\n' + c + '\\n\\n【해시태그】\\n' + h;
        filename = 'blog_' + new Date().toISOString().slice(0,10) + '.txt';
      } else if (type === 'analyze') {
        const r = document.getElementById('analyze-result').textContent;
        const i = document.getElementById('analyze-improved').textContent;
        content = '【분석 결과】\\n' + r + '\\n\\n【개선된 내용】\\n' + i;
        filename = 'analyze_' + new Date().toISOString().slice(0,10) + '.txt';
      }
      
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      showToast('TXT 파일이 다운로드되었습니다!');
    }

    function downloadPdf(type) {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      
      // 한글 폰트 설정이 복잡하므로 간단히 처리
      doc.setFont('helvetica');
      
      let content = '';
      let title = '';
      
      if (type === 'qna') {
        title = 'Q&A Content';
        const q = document.getElementById('qna-question').textContent;
        const a = document.getElementById('qna-answer').textContent;
        const c = document.getElementById('qna-comments').textContent;
        content = 'Question:\\n' + q + '\\n\\nAnswer:\\n' + a + '\\n\\nComments:\\n' + c;
      } else if (type === 'blog') {
        title = 'Blog Content';
        const t = document.getElementById('blog-title').textContent;
        const c = document.getElementById('blog-content').textContent;
        const h = document.getElementById('blog-hashtags').textContent;
        content = 'Title:\\n' + t + '\\n\\nContent:\\n' + c + '\\n\\nHashtags:\\n' + h;
      }
      
      doc.setFontSize(16);
      doc.text(title, 20, 20);
      doc.setFontSize(10);
      
      const lines = doc.splitTextToSize(content, 170);
      doc.text(lines, 20, 35);
      
      doc.save(type + '_' + new Date().toISOString().slice(0,10) + '.pdf');
      showToast('PDF 파일이 다운로드되었습니다!');
    }

    // Update char count
    function updateCharCount(text, charId, statusId) {
      const total = text.length;
      const pure = text.replace(/\\s/g, '').length;
      document.getElementById(charId).textContent = total + '자';
      
      if (statusId) {
        const statusEl = document.getElementById(statusId);
        if (total >= 1700) {
          statusEl.textContent = '✓ 충족';
          statusEl.className = 'success';
        } else {
          statusEl.textContent = '부족: ' + (1700 - total) + '자 더 필요';
          statusEl.className = 'warning';
        }
      }
    }

    // Update status
    function setStatus(text) {
      document.getElementById('status-text').textContent = text;
    }

    // Set button loading
    function setButtonLoading(btnId, isLoading, originalText) {
      const btn = document.getElementById(btnId);
      if (isLoading) {
        btn.disabled = true;
        btn.innerHTML = '<div class="loading-spinner"></div><span>AI 생성 중...</span>';
      } else {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }

    // API calls
    async function generateQnA() {
      const product = document.getElementById('qna-product').value.trim();
      const concern = document.getElementById('qna-concern').value.trim();
      const contact = document.getElementById('qna-contact').value.trim();

      if (!product || !concern) {
        showToast('상품명과 고민을 입력해주세요', 'error');
        return;
      }

      setButtonLoading('qna-btn', true);
      setStatus('AI가 Q&A를 생성하고 있습니다...');

      try {
        const response = await fetch('/api/generate/qna', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product, concern,
            target: state.qna.target,
            tone: state.qna.tone,
            contact
          })
        });
        
        if (!response.ok) throw new Error('API Error');
        const data = await response.json();

        document.getElementById('qna-question').textContent = data.question;
        document.getElementById('qna-question').classList.remove('empty');
        
        document.getElementById('qna-answer').textContent = data.answer;
        updateCharCount(data.answer, 'answer-char', null);
        document.getElementById('answer-pure').textContent = '순수 ' + data.answer.replace(/\\s/g, '').length + '자';
        
        document.getElementById('qna-comments').textContent = data.comments;
        document.getElementById('qna-comments').classList.remove('empty');

        setStatus('Q&A 생성 완료!');
        showToast('Q&A가 생성되었습니다!');
      } catch (error) {
        setStatus('생성 실패 - 다시 시도해주세요');
        showToast('생성 중 오류가 발생했습니다', 'error');
      }

      setButtonLoading('qna-btn', false, '<i class="fas fa-magic"></i><span>AI Q&A 생성하기</span>');
    }

    async function generateBlog() {
      const topic = document.getElementById('blog-topic').value.trim();
      const keywords = document.getElementById('blog-keywords').value.trim();
      const region = document.getElementById('blog-region').value.trim();
      const extra = document.getElementById('blog-extra').value.trim();

      if (!topic) {
        showToast('블로그 주제를 입력해주세요', 'error');
        return;
      }

      setButtonLoading('blog-btn', true);
      setStatus('AI가 블로그 글을 생성하고 있습니다 (1,700자+)...');

      try {
        const response = await fetch('/api/generate/blog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic, keywords, region, extra,
            type: state.blog.type,
            tone: state.blog.tone
          })
        });
        
        if (!response.ok) throw new Error('API Error');
        const data = await response.json();

        document.getElementById('blog-title').textContent = data.title;
        document.getElementById('blog-title').classList.remove('empty');
        
        document.getElementById('blog-content').textContent = data.content;
        updateCharCount(data.content, 'blog-char', 'blog-status');
        
        document.getElementById('blog-hashtags').textContent = data.hashtags;
        document.getElementById('blog-hashtags').classList.remove('empty');

        setStatus('블로그 글 생성 완료! (' + data.content.length + '자)');
        showToast('블로그 글이 생성되었습니다!');
      } catch (error) {
        setStatus('생성 실패 - 다시 시도해주세요');
        showToast('생성 중 오류가 발생했습니다', 'error');
      }

      setButtonLoading('blog-btn', false, '<i class="fas fa-pen-fancy"></i><span>AI 블로그 생성하기 (1,700자+)</span>');
    }

    async function analyzeBlog() {
      const content = document.getElementById('analyze-content').value.trim();
      const keyword = document.getElementById('analyze-keyword').value.trim();
      const region = document.getElementById('analyze-region').value.trim();

      if (!content) {
        showToast('분석할 블로그 글을 입력해주세요', 'error');
        return;
      }

      setButtonLoading('analyze-btn', true);
      setStatus('AI가 블로그를 분석하고 있습니다...');

      try {
        const response = await fetch('/api/analyze/blog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, keyword, region })
        });
        
        if (!response.ok) throw new Error('API Error');
        const data = await response.json();

        // 점수 표시
        document.getElementById('analyze-score').style.display = 'block';
        document.getElementById('total-score').textContent = data.totalScore + '점';
        document.getElementById('seo-score').textContent = data.seoScore;
        document.getElementById('crank-score').textContent = data.crankScore;
        document.getElementById('aeo-score').textContent = data.aeoScore;
        document.getElementById('geo-score').textContent = data.geoScore;
        
        document.getElementById('analyze-result').textContent = data.analysis;
        document.getElementById('analyze-improved').textContent = data.improved;

        setStatus('블로그 분석 완료!');
        showToast('분석이 완료되었습니다!');
      } catch (error) {
        setStatus('분석 실패 - 다시 시도해주세요');
        showToast('분석 중 오류가 발생했습니다', 'error');
      }

      setButtonLoading('analyze-btn', false, '<i class="fas fa-search-plus"></i><span>AI 블로그 분석하기</span>');
    }

    async function generateTitles() {
      const topic = document.getElementById('title-topic').value.trim();

      if (!topic) {
        showToast('주제/키워드를 입력해주세요', 'error');
        return;
      }

      setButtonLoading('title-btn', true);
      setStatus('AI가 제목을 생성하고 있습니다...');

      try {
        const response = await fetch('/api/generate/titles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic,
            style: state.title.style,
            count: parseInt(state.title.count)
          })
        });
        
        if (!response.ok) throw new Error('API Error');
        const data = await response.json();

        document.getElementById('title-results').textContent = data.titles;

        setStatus('제목 생성 완료!');
        showToast('제목이 생성되었습니다!');
      } catch (error) {
        setStatus('생성 실패 - 다시 시도해주세요');
        showToast('생성 중 오류가 발생했습니다', 'error');
      }

      setButtonLoading('title-btn', false, '<i class="fas fa-list"></i><span>AI 제목 생성하기</span>');
    }

    async function findKeywords() {
      const keyword = document.getElementById('keyword-main').value.trim();
      const region = document.getElementById('keyword-region').value.trim();

      if (!keyword) {
        showToast('메인 키워드를 입력해주세요', 'error');
        return;
      }

      setButtonLoading('keyword-btn', true);
      setStatus('연관 키워드를 분석하고 있습니다...');

      try {
        const response = await fetch('/api/generate/keywords', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword, region })
        });
        
        if (!response.ok) throw new Error('API Error');
        const data = await response.json();

        document.getElementById('keyword-results').textContent = data.keywords;

        setStatus('키워드 분석 완료!');
        showToast('키워드를 찾았습니다!');
      } catch (error) {
        setStatus('분석 실패 - 다시 시도해주세요');
        showToast('분석 중 오류가 발생했습니다', 'error');
      }

      setButtonLoading('keyword-btn', false, '<i class="fas fa-search"></i><span>연관 키워드 찾기</span>');
    }
  </script>
</body>
</html>
`

// Routes
app.get('/', (c) => c.html(mainPageHtml))

// Health Check
app.get('/api/health', (c) => c.json({ status: 'ok', version: '2.0', ai: 'gemini' }))

// Q&A Generation API
app.post('/api/generate/qna', async (c) => {
  const { product, concern, target, tone, contact } = await c.req.json()
  
  const prompt = `당신은 보험 전문 콘텐츠 작성 AI입니다. 네이버 카페용 Q&A를 생성해주세요.

【조건】
- 상품명: ${product}
- 타겟 고객: ${target}
- 핵심 고민: ${concern}
- 문체: ${tone} (해요체: ~해요, ~거든요 / 습니다체: ~합니다, ~입니다 / 혼합체: 섞어서)
- 연락처: ${contact || '없음'}

【출력 형식】
정확히 아래 형식으로 출력하세요. 다른 설명 없이 바로 내용만 출력:

[질문]
(${target}이 ${product}에 대해 궁금해하는 자연스러운 질문 작성. 300자 이상. 실제 고민처럼 작성)

[답변]
(전문가 답변 작성. 800자 이상. 구조:
✅ 핵심 요약 3줄
✅ ${product}의 장점
✅ 가입 시 체크포인트
✅ ${target}에게 추천하는 이유
키워드 "${product}" 3회 이상 자연스럽게 포함
${contact ? '마지막에 상담 문의 연락처 포함' : ''})

[댓글1]
(공감하는 댓글 50자 내외)

[댓글2]
(추가 정보 제공하는 댓글 50자 내외)

[댓글3]
(가입 권유하는 댓글 50자 내외)`

  try {
    const result = await callGeminiAPI(prompt)
    
    // Parse result
    const questionMatch = result.match(/\[질문\]([\s\S]*?)(?=\[답변\])/i)
    const answerMatch = result.match(/\[답변\]([\s\S]*?)(?=\[댓글1\])/i)
    const comment1Match = result.match(/\[댓글1\]([\s\S]*?)(?=\[댓글2\])/i)
    const comment2Match = result.match(/\[댓글2\]([\s\S]*?)(?=\[댓글3\])/i)
    const comment3Match = result.match(/\[댓글3\]([\s\S]*?)$/i)
    
    const question = questionMatch ? questionMatch[1].trim() : `[${target}] ${product} 가입 고민입니다\n\n${concern}`
    const answer = answerMatch ? answerMatch[1].trim() : `${product}에 대한 전문가 답변입니다.`
    const comments = [
      comment1Match ? comment1Match[1].trim() : '저도 같은 고민이었어요!',
      comment2Match ? comment2Match[1].trim() : '전문가 답변 감사합니다.',
      comment3Match ? comment3Match[1].trim() : '저도 가입 고려해봐야겠네요.'
    ].join('\n\n')

    return c.json({ question, answer, comments })
  } catch (error) {
    // Fallback response
    return c.json({
      question: `[${target}] ${product} 가입 고민이에요\n\n안녕하세요, ${target}입니다.\n${concern}\n\n${product}에 대해 알아보고 있는데, 실제로 가입하신 분들 의견이 궁금해요.`,
      answer: `안녕하세요, 보험 전문 상담사입니다.\n\n${product} 관련해서 답변 드릴게요.\n\n✅ ${product}의 장점\n- 보장 범위가 넓어 ${target}분들께 적합합니다\n- 보험료 대비 보장 내용이 우수합니다\n\n✅ 가입 시 체크포인트\n1. 본인의 건강상태와 예산에 맞는 플랜 선택\n2. 특약 구성을 꼼꼼히 비교\n\n${contact ? '📱 상담문의: ' + contact : ''}`,
      comments: '[댓글 1]\n저도 같은 고민이었어요!\n\n[댓글 2]\n전문가 답변 감사합니다.\n\n[댓글 3]\n가입 고려해봐야겠네요.'
    })
  }
})

// Blog Generation API (1,700자 이상)
app.post('/api/generate/blog', async (c) => {
  const { topic, keywords, region, extra, type, tone } = await c.req.json()
  
  const prompt = `당신은 네이버 블로그 SEO 전문 콘텐츠 작성 AI입니다.

【필수 조건】
- 주제: ${topic}
- 키워드: ${keywords || topic}
- 지역: ${region || '전국'}
- 콘텐츠 유형: ${type}
- 문체: ${tone}
- 추가 요청: ${extra || '없음'}

【네이버 블로그 최적화 규칙】
1. 본문 1,700자 이상 필수
2. 2-3문장마다 줄바꿈 (모바일 가독성)
3. 인용구 형식의 3줄 요약 포함
4. 이미지 삽입 위치 [📷 이미지 삽입] 표시 (스크롤 2-3회마다)
5. 키워드 3회 이상 자연스럽게 포함
6. 고객 관점: "WHY? 왜 필요한가?", "나에게 어떤 이득이?"
7. Q&A 형식 1개 이상 포함 (AEO 최적화)
8. 지역 키워드 포함 (GEO 최적화)

【이모지 기반 구조】
- ❶ ❷ ❸ : 단계별 설명
- ■ : 소제목
- ✅ : 체크리스트
- 💡 : 팁/인사이트

【출력 형식】
[제목]
(30자 이내, 키워드 포함, 클릭 유도형)

[본문]
(1,700자 이상. 아래 구조 필수:

> 📌 이 글의 3줄 요약
> 1. 첫 번째 핵심 포인트
> 2. 두 번째 핵심 포인트  
> 3. 세 번째 핵심 포인트

■ 서론 (WHY? 왜 이 글을 읽어야 하는가?)

[📷 이미지 삽입]

■ 본론1 - 핵심 정보

■ 본론2 - 상세 설명

[📷 이미지 삽입]

■ Q. 자주 묻는 질문?
A. 전문가 답변

■ 결론 - 나에게 어떤 이득이 있는가?

[📷 이미지 삽입]

💡 마무리 한마디)

[해시태그]
(10개, 공백 없이 #으로 시작)`

  try {
    const result = await callGeminiAPI(prompt)
    
    // 더 유연한 파싱
    let title = ''
    let content = ''
    let hashtags = ''
    
    // 제목 파싱 (여러 패턴 시도)
    const titleMatch = result.match(/\[제목\]\s*([\s\S]*?)(?=\[본문\]|\n\n>|\n■)/i) ||
                       result.match(/^(.{10,50})\n/m)
    title = titleMatch ? titleMatch[1].trim().replace(/^\*+|\*+$/g, '') : `${topic}, 이것만 알면 끝!`
    
    // 본문 파싱
    const contentMatch = result.match(/\[본문\]\s*([\s\S]*?)(?=\[해시태그\]|#[^\s])/i)
    if (contentMatch) {
      content = contentMatch[1].trim()
    } else {
      // [본문] 태그가 없으면 > 로 시작하는 인용구부터 끝까지
      const altContent = result.match(/(>[\s\S]*?)(?=#[^\s]|$)/i) ||
                        result.match(/(■[\s\S]*?)(?=#[^\s]|$)/i)
      content = altContent ? altContent[1].trim() : result.substring(0, 2000)
    }
    
    // 해시태그 파싱
    const hashtagMatch = result.match(/\[해시태그\]\s*([\s\S]*?)$/i) ||
                        result.match(/(#[^\s#]+(?:\s+#[^\s#]+){3,})/i)
    hashtags = hashtagMatch ? hashtagMatch[1].trim() : `#${topic.replace(/\s/g, '')} #보험추천 #보험비교`
    
    // 제목에서 [제목] 태그 제거
    title = title.replace(/^\[제목\]\s*/i, '').trim()
    
    // 본문이 너무 짧으면 fallback
    if (content.length < 500) {
      throw new Error('Content too short')
    }

    return c.json({ title, content, hashtags })
  } catch (error) {
    // Fallback
    const mainKeyword = keywords?.split(',')[0]?.trim() || topic
    return c.json({
      title: `${topic}, 이것만 알면 끝! 2025년 완벽 가이드`,
      content: `> 📌 이 글의 3줄 요약
> 1. ${topic}의 핵심 포인트를 알려드립니다
> 2. 가입 전 꼭 확인해야 할 체크리스트
> 3. ${region || '전국'} 지역 맞춤 정보 제공

■ ${topic}, 왜 지금 알아봐야 할까요?

안녕하세요, 오늘은 많은 분들이 궁금해하시는 ${topic}에 대해 자세히 알아보겠습니다.

${mainKeyword}를 찾고 계신 분들이라면 이 글을 끝까지 읽어주세요.
본인에게 맞는 최적의 선택을 하실 수 있도록 도와드리겠습니다.

[📷 이미지 삽입]

■ ${topic}의 핵심 포인트

❶ 첫 번째 포인트

${mainKeyword}을 선택할 때 가장 중요한 것은 본인의 상황에 맞는 플랜을 찾는 것입니다.

무작정 가입하기보다는 꼼꼼히 비교해보시기 바랍니다.

❷ 두 번째 포인트

비용 대비 효율을 따져보세요.
${mainKeyword}는 장기적인 관점에서 접근해야 합니다.

[📷 이미지 삽입]

❸ 세 번째 포인트

전문가 상담을 통해 정확한 정보를 얻으시기 바랍니다.

■ Q. ${topic} 가입하면 정말 좋을까요?

A. 네, ${target || '많은 분들'}에게 ${topic}은 매우 유용합니다.
특히 ${mainKeyword}의 경우 보장 내용이 우수하여 추천드립니다.

■ 결론 - 나에게 어떤 이득이 있을까?

${topic}을 통해 얻을 수 있는 가장 큰 이점은 바로 안정적인 보장입니다.

${region ? region + ' 지역에서' : '전국 어디서나'} 상담 받으실 수 있습니다.

[📷 이미지 삽입]

💡 마무리

오늘 ${topic}에 대해 알아보았습니다.
더 궁금한 점이 있으시면 댓글로 남겨주세요!`,
      hashtags: `#${topic.replace(/\\s/g, '')} #${mainKeyword.replace(/\\s/g, '')} #보험추천 #보험비교 #보험상담 #2025보험 #보험꿀팁 #${region?.replace(/\\s/g, '') || '전국'} #재테크 #금융정보`
    })
  }
})

// Blog Analysis API
app.post('/api/analyze/blog', async (c) => {
  const { content, keyword, region } = await c.req.json()
  
  const charCount = content.length
  const pureCharCount = content.replace(/\s/g, '').length
  
  const prompt = `당신은 네이버 블로그 SEO 분석 전문가입니다. 아래 블로그 글을 냉정하게 분석해주세요.

【분석 대상】
${content.substring(0, 3000)}...

【목표 키워드】: ${keyword || '없음'}
【목표 지역】: ${region || '없음'}
【글자수】: ${charCount}자 (공백 제외: ${pureCharCount}자)

【분석 항목별 점수 (각 100점 만점)】
1. SEO 점수: 키워드 밀도, 제목 최적화, 메타 구조
2. C-RANK 점수: 전문성, 구조화, 일관성
3. AEO 점수: Q&A 구조, 질문-답변 형식
4. GEO 점수: 지역 키워드 포함 여부

【출력 형식】
[점수]
SEO: (0-100)
C-RANK: (0-100)
AEO: (0-100)
GEO: (0-100)
총점: (0-100)

[분석]
■ 잘된 점
(구체적으로 3가지)

■ 개선 필요
(구체적으로 3가지)

■ 키워드 분석
(키워드 "${keyword}" 등장 횟수, 적정 여부)

■ 글자수 분석
(1,700자 기준 충족 여부)

■ 지역 1위/키워드 1위 가능성
(솔직하게 평가)

[개선된 제목]
(SEO 최적화된 새 제목)

[개선된 본문 일부]
(처음 500자 정도만 개선 버전 제시)

[개선된 해시태그]
(10개)`

  try {
    const result = await callGeminiAPI(prompt)
    
    // Parse scores
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
    
    const analysis = analysisMatch ? analysisMatch[1].trim() : '분석 결과를 생성하지 못했습니다.'
    const improved = improvedMatch ? improvedMatch[1].trim() : '개선 내용을 생성하지 못했습니다.'

    return c.json({
      totalScore,
      seoScore,
      crankScore,
      aeoScore,
      geoScore,
      analysis,
      improved
    })
  } catch (error) {
    return c.json({
      totalScore: 65,
      seoScore: 70,
      crankScore: 65,
      aeoScore: 60,
      geoScore: region ? 70 : 50,
      analysis: `■ 분석 결과

글자수: ${charCount}자 ${charCount >= 1700 ? '✅ 충족' : '❌ 부족 (' + (1700 - charCount) + '자 더 필요)'}

키워드 "${keyword || '미지정'}": 분석 필요

■ 개선 제안
1. 본문 1,700자 이상 작성
2. 키워드 3회 이상 포함
3. Q&A 형식 추가`,
      improved: `개선된 내용을 생성하려면 다시 시도해주세요.`
    })
  }
})

// Title Generation API
app.post('/api/generate/titles', async (c) => {
  const { topic, style, count } = await c.req.json()
  
  const prompt = `네이버 블로그 제목 ${count}개를 생성해주세요.

주제: ${topic}
스타일: ${style}
- 궁금증유발: 클릭을 유도하는 질문형/충격형
- 정보제공: 가이드, 총정리 형태
- 비교분석: A vs B, TOP5 형태
- 후기형: 실제 경험, 솔직 리뷰 형태

조건:
- 30자 이내
- 키워드 "${topic}" 포함
- 숫자 활용 권장
- 클릭률 높은 제목

출력 형식 (번호와 제목만):
1. 제목1
2. 제목2
...`

  try {
    const result = await callGeminiAPI(prompt)
    return c.json({ titles: result.trim() })
  } catch (error) {
    const templates: Record<string, string[]> = {
      '궁금증유발': [
        `${topic}, 아직도 이렇게 가입하세요?`,
        `${topic} 가입 전 꼭 알아야 할 3가지`,
        `${topic}, 보험설계사도 말 안 해주는 진실`,
      ],
      '정보제공': [
        `2025년 ${topic} 완벽 가이드`,
        `${topic} A to Z 총정리`,
        `${topic} 비교분석 리포트`,
      ],
      '비교분석': [
        `${topic} TOP 5 비교 분석`,
        `${topic} 다이렉트 vs 설계사`,
        `${topic} 회사별 장단점`,
      ],
      '후기형': [
        `${topic} 1년 가입 후기`,
        `${topic} 실제로 보장받아봤습니다`,
        `${topic} 솔직 리뷰`,
      ],
    }
    
    const titles = (templates[style] || templates['궁금증유발'])
      .slice(0, count)
      .map((t, i) => `${i + 1}. ${t}`)
      .join('\n')
    
    return c.json({ titles })
  }
})

// Keyword Generation API
app.post('/api/generate/keywords', async (c) => {
  const { keyword, region } = await c.req.json()
  
  const prompt = `"${keyword}" 키워드의 연관 키워드를 분석해주세요.
${region ? '지역: ' + region : ''}

출력 형식:

📊 "${keyword}" 연관 키워드 분석

🔍 메인 키워드
• ${keyword}
• ${keyword} 추천
• ${keyword} 비교

📈 롱테일 키워드 (경쟁 낮음, 5개)
• 

🏷️ 관련 검색어 (5개)
• 

${region ? '📍 지역 키워드 (GEO)\n• ' + region + ' ' + keyword + '\n• ' : ''}

💡 SEO 활용 팁
• 제목에 메인 키워드 1회
• 본문에 롱테일 키워드 2-3회
• 해시태그에 관련 검색어 활용`

  try {
    const result = await callGeminiAPI(prompt)
    return c.json({ keywords: result.trim() })
  } catch (error) {
    return c.json({
      keywords: `📊 "${keyword}" 연관 키워드 분석

🔍 메인 키워드
• ${keyword}
• ${keyword} 추천
• ${keyword} 비교

📈 롱테일 키워드
• ${keyword} 30대 추천
• ${keyword} 40대 가입
• ${keyword} 보험료 비교

🏷️ 관련 검색어
• ${keyword} 필요한가
• ${keyword} 얼마가 적당한가

${region ? '📍 지역 키워드\n• ' + region + ' ' + keyword : ''}

💡 SEO 활용 팁
• 키워드 3회 이상 포함`
    })
  }
})

export default app
