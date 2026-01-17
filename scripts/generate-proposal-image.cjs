#!/usr/bin/env node
/**
 * XIVIX V25.1 Bento Grid 제안서 이미지 생성 스크립트
 * - Puppeteer로 HTML/CSS 렌더링 후 PNG 스크린샷 캡처
 * - 한글 폰트 지원 (Noto Sans CJK)
 * - 텍스트 선택 가능한 웹 버전 + 이미지 저장 버전
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// 제안서 데이터 샘플 (실제 사용시 API 데이터로 대체)
const sampleProposalData = {
  // 헤더 정보
  header: {
    title: '맞춤 보험 분석 리포트',
    score: 87,
    scoreGrade: 'A',
    summary: '현재 보장 분석 결과, 암 진단비와 뇌/심장 특약 강화가 필요합니다',
    customerType: '40대 가장',
    insuranceType: '종신보험'
  },
  
  // Bento Grid: 핵심 담보 진단
  criticalChecks: [
    { item: '암 진단비', status: 'warning', current: '3,000만원', recommend: '5,000만원', icon: '🎯' },
    { item: '뇌혈관질환', status: 'danger', current: '미가입', recommend: '3,000만원', icon: '🧠' },
    { item: '심장질환', status: 'danger', current: '미가입', recommend: '3,000만원', icon: '❤️' },
    { item: '수술비 (1-5종)', status: 'ok', current: '1,000만원', recommend: '적정', icon: '🏥' },
    { item: '입원일당', status: 'ok', current: '5만원', recommend: '적정', icon: '🛏️' },
    { item: '후유장해', status: 'warning', current: '5,000만원', recommend: '1억원', icon: '🦽' }
  ],
  
  // 비교 테이블
  comparison: {
    existing: {
      company: '기존 보험사',
      items: [
        { name: '사망보험금', amount: '1억원' },
        { name: '암진단비', amount: '3,000만원' },
        { name: '수술비', amount: '1,000만원' }
      ],
      totalPremium: '85,000원'
    },
    xivix: {
      company: 'XIVIX 제안',
      items: [
        { name: '사망보험금', amount: '1억원' },
        { name: '암진단비', amount: '5,000만원' },
        { name: '뇌출혈진단', amount: '3,000만원' },
        { name: '급성심근경색', amount: '3,000만원' },
        { name: '수술비(1-5종)', amount: '1,000만원' }
      ],
      totalPremium: '119,500원'
    }
  },
  
  // AI 코멘트 (사업비 금지)
  aiComment: [
    '40대 가장에게 3대 진단비(암/뇌/심장)는 필수입니다. 현재 뇌/심장 보장이 없어 위험합니다.',
    '비갱신형 특약으로 구성하여 향후 보험료 인상 걱정이 없습니다.',
    '납입면제 특약 포함으로 3대 진단 시 이후 보험료를 면제받을 수 있습니다.'
  ],
  
  // 경고/유의사항
  warnings: [
    '뇌혈관질환(I60-I69) 보장범위는 보험사별 약관 확인이 필요합니다.',
    '수술비 급수(1-5종 vs 1-9종)는 보험사 체계에 따라 다릅니다.'
  ],
  
  // 생성일
  generatedAt: new Date().toISOString().split('T')[0]
};

/**
 * Bento Grid 제안서 HTML 생성
 */
function generateProposalHTML(data) {
  const statusColor = {
    ok: { bg: '#1a472a', text: '#4ade80', icon: '✔' },
    warning: { bg: '#713f12', text: '#facc15', icon: '!' },
    danger: { bg: '#7f1d1d', text: '#f87171', icon: '✖' }
  };

  const criticalGridHTML = data.criticalChecks.map(item => {
    const color = statusColor[item.status];
    return `
      <div class="bento-item" style="background: ${color.bg};">
        <div class="bento-icon">${item.icon}</div>
        <div class="bento-label">${item.item}</div>
        <div class="bento-status" style="color: ${color.text};">
          <span class="status-icon">${color.icon}</span>
          ${item.status === 'ok' ? '적정' : item.status === 'warning' ? '보완필요' : '미가입'}
        </div>
        <div class="bento-current">현재: ${item.current}</div>
        <div class="bento-recommend">권장: ${item.recommend}</div>
      </div>
    `;
  }).join('');

  const existingItemsHTML = data.comparison.existing.items.map(i => 
    `<tr><td>${i.name}</td><td class="amount">${i.amount}</td></tr>`
  ).join('');

  const xivixItemsHTML = data.comparison.xivix.items.map(i => 
    `<tr><td>${i.name}</td><td class="amount highlight">${i.amount}</td></tr>`
  ).join('');

  const aiCommentsHTML = data.aiComment.map(c => `<li>${c}</li>`).join('');
  const warningsHTML = data.warnings.map(w => `<li>${w}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>XIVIX 보험 분석 리포트</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap');
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      /* 텍스트 선택 허용 */
      user-select: text !important;
      -webkit-user-select: text !important;
      -moz-user-select: text !important;
      -ms-user-select: text !important;
    }
    
    body {
      font-family: 'Noto Sans KR', 'Noto Sans CJK KR', 'NanumGothic', sans-serif;
      background: #000000;
      color: #E0E0E0;
      line-height: 1.6;
      letter-spacing: -0.2px;
      padding: 0;
      margin: 0;
    }
    
    #proposal-container {
      width: 800px;
      min-height: 1200px;
      background: #000000;
      padding: 32px;
      margin: 0 auto;
    }
    
    /* 헤더 섹션 */
    .header {
      background: linear-gradient(135deg, #111111 0%, #1a1a1a 100%);
      border: 1px solid #333;
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      position: relative;
      overflow: hidden;
    }
    
    .header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #10B981 0%, #3B82F6 50%, #8B5CF6 100%);
    }
    
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
    }
    
    .header-title {
      font-size: 28px;
      font-weight: 900;
      color: #FFFFFF;
      letter-spacing: -0.5px;
    }
    
    .header-meta {
      font-size: 14px;
      color: #888;
      margin-top: 8px;
    }
    
    .score-badge {
      background: linear-gradient(135deg, #10B981 0%, #059669 100%);
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      text-align: center;
    }
    
    .score-value {
      font-size: 36px;
      font-weight: 900;
    }
    
    .score-label {
      font-size: 12px;
      opacity: 0.9;
    }
    
    .summary-text {
      background: #1a1a1a;
      border-left: 4px solid #10B981;
      padding: 16px;
      border-radius: 0 8px 8px 0;
      font-size: 16px;
      color: #FFFFFF;
    }
    
    /* Bento Grid 섹션 */
    .section-title {
      font-size: 18px;
      font-weight: 700;
      color: #FFFFFF;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .section-title::before {
      content: '';
      width: 4px;
      height: 20px;
      background: #10B981;
      border-radius: 2px;
    }
    
    .bento-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 32px;
    }
    
    .bento-item {
      padding: 20px;
      border-radius: 12px;
      border: 1px solid #333;
      transition: transform 0.2s;
    }
    
    .bento-icon {
      font-size: 24px;
      margin-bottom: 8px;
    }
    
    .bento-label {
      font-size: 14px;
      font-weight: 700;
      color: #FFFFFF;
      margin-bottom: 4px;
    }
    
    .bento-status {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    .status-icon {
      display: inline-flex;
      width: 18px;
      height: 18px;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: rgba(255,255,255,0.1);
      font-size: 11px;
    }
    
    .bento-current, .bento-recommend {
      font-size: 12px;
      color: #AAA;
    }
    
    .bento-recommend {
      color: #4ade80;
    }
    
    /* 비교 테이블 섹션 */
    .comparison-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-bottom: 32px;
    }
    
    .comparison-card {
      background: #111111;
      border: 1px solid #333;
      border-radius: 12px;
      overflow: hidden;
    }
    
    .comparison-card.xivix {
      border-color: #10B981;
    }
    
    .comparison-header {
      padding: 16px;
      background: #1a1a1a;
      font-weight: 700;
      font-size: 16px;
      color: #FFFFFF;
      border-bottom: 1px solid #333;
    }
    
    .comparison-card.xivix .comparison-header {
      background: linear-gradient(135deg, #064e3b 0%, #065f46 100%);
    }
    
    .comparison-table {
      width: 100%;
      border-collapse: collapse;
    }
    
    .comparison-table td {
      padding: 12px 16px;
      border-bottom: 1px solid #222;
      font-size: 14px;
    }
    
    .comparison-table .amount {
      text-align: right;
      font-weight: 600;
      color: #FFFFFF;
    }
    
    .comparison-table .amount.highlight {
      color: #4ade80;
    }
    
    .total-row {
      padding: 16px;
      background: #1a1a1a;
      display: flex;
      justify-content: space-between;
      font-weight: 700;
    }
    
    .total-row .amount {
      color: #FFFFFF;
      font-size: 18px;
    }
    
    .comparison-card.xivix .total-row .amount {
      color: #4ade80;
    }
    
    /* AI 코멘트 섹션 */
    .ai-comment-section {
      background: #111111;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 32px;
    }
    
    .ai-comment-section .section-title::before {
      background: #3B82F6;
    }
    
    .ai-comment-list {
      list-style: none;
    }
    
    .ai-comment-list li {
      padding: 12px 0;
      border-bottom: 1px solid #222;
      font-size: 15px;
      line-height: 1.7;
      position: relative;
      padding-left: 24px;
    }
    
    .ai-comment-list li:last-child {
      border-bottom: none;
    }
    
    .ai-comment-list li::before {
      content: '▸';
      position: absolute;
      left: 0;
      color: #3B82F6;
    }
    
    /* 경고/유의사항 */
    .warnings-section {
      background: #1f1507;
      border: 1px solid #713f12;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    
    .warnings-section .section-title {
      color: #facc15;
    }
    
    .warnings-section .section-title::before {
      background: #facc15;
    }
    
    .warnings-list {
      list-style: none;
    }
    
    .warnings-list li {
      padding: 8px 0;
      font-size: 13px;
      color: #fcd34d;
      position: relative;
      padding-left: 20px;
    }
    
    .warnings-list li::before {
      content: '⚠';
      position: absolute;
      left: 0;
    }
    
    /* 푸터 */
    .footer {
      text-align: center;
      padding: 16px;
      font-size: 12px;
      color: #666;
      border-top: 1px solid #222;
    }
    
    .footer-brand {
      font-weight: 700;
      color: #10B981;
    }
  </style>
</head>
<body>
  <div id="proposal-container">
    <!-- 헤더 -->
    <div class="header">
      <div class="header-top">
        <div>
          <div class="header-title">${data.header.title}</div>
          <div class="header-meta">
            ${data.header.customerType} · ${data.header.insuranceType} · ${data.generatedAt}
          </div>
        </div>
        <div class="score-badge">
          <div class="score-value">${data.header.score}</div>
          <div class="score-label">종합점수 ${data.header.scoreGrade}</div>
        </div>
      </div>
      <div class="summary-text">
        ${data.header.summary}
      </div>
    </div>
    
    <!-- 핵심 담보 진단 (Bento Grid) -->
    <div class="section-title">핵심 담보 진단</div>
    <div class="bento-grid">
      ${criticalGridHTML}
    </div>
    
    <!-- 비교 테이블 -->
    <div class="section-title">보장 비교</div>
    <div class="comparison-section">
      <!-- 기존 보험 -->
      <div class="comparison-card">
        <div class="comparison-header">${data.comparison.existing.company}</div>
        <table class="comparison-table">
          ${existingItemsHTML}
        </table>
        <div class="total-row">
          <span>월 보험료</span>
          <span class="amount">${data.comparison.existing.totalPremium}</span>
        </div>
      </div>
      
      <!-- XIVIX 제안 -->
      <div class="comparison-card xivix">
        <div class="comparison-header">${data.comparison.xivix.company}</div>
        <table class="comparison-table">
          ${xivixItemsHTML}
        </table>
        <div class="total-row">
          <span>월 보험료</span>
          <span class="amount">${data.comparison.xivix.totalPremium}</span>
        </div>
      </div>
    </div>
    
    <!-- AI 코멘트 -->
    <div class="ai-comment-section">
      <div class="section-title">AI 분석 코멘트</div>
      <ul class="ai-comment-list">
        ${aiCommentsHTML}
      </ul>
    </div>
    
    <!-- 경고/유의사항 -->
    <div class="warnings-section">
      <div class="section-title">유의사항</div>
      <ul class="warnings-list">
        ${warningsHTML}
      </ul>
    </div>
    
    <!-- 푸터 -->
    <div class="footer">
      <span class="footer-brand">XIVIX</span> 보험 분석 엔진 V25.1 · 2026년 기준 · 실제 보험료는 상담 필요
    </div>
  </div>
</body>
</html>`;
}

/**
 * Puppeteer로 HTML을 PNG 이미지로 캡처
 */
async function generateProposalImage(data, outputPath) {
  const html = generateProposalHTML(data);
  
  console.log('🚀 Puppeteer 브라우저 시작...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none'
    ]
  });
  
  try {
    const page = await browser.newPage();
    
    // 뷰포트 설정 (2x 해상도)
    await page.setViewport({
      width: 800,
      height: 1200,
      deviceScaleFactor: 2
    });
    
    console.log('📄 HTML 콘텐츠 로드 중...');
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    
    // 폰트 로딩 대기
    await page.evaluateHandle('document.fonts.ready');
    
    // 추가 대기 (폰트 렌더링 안정화)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('📸 스크린샷 캡처 중...');
    const element = await page.$('#proposal-container');
    
    if (element) {
      await element.screenshot({
        path: outputPath,
        type: 'png'
      });
      console.log(`✅ 이미지 저장 완료: ${outputPath}`);
    } else {
      throw new Error('proposal-container 요소를 찾을 수 없습니다');
    }
    
    // HTML도 저장 (웹 표시용)
    const htmlPath = outputPath.replace('.png', '.html');
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log(`✅ HTML 저장 완료: ${htmlPath}`);
    
    return { imagePath: outputPath, htmlPath };
    
  } finally {
    await browser.close();
    console.log('🔒 브라우저 종료');
  }
}

/**
 * 테스트용 메인 함수
 */
async function main() {
  const outputDir = path.join(__dirname, '..', 'public', 'proposals');
  
  // 출력 디렉토리 생성
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const outputPath = path.join(outputDir, `proposal-sample-${Date.now()}.png`);
  
  console.log('\n========================================');
  console.log('  XIVIX V25.1 Bento Grid 제안서 생성기');
  console.log('========================================\n');
  
  try {
    const result = await generateProposalImage(sampleProposalData, outputPath);
    
    console.log('\n✅ 생성 완료!');
    console.log(`   이미지: ${result.imagePath}`);
    console.log(`   HTML:   ${result.htmlPath}`);
    console.log('\n');
    
  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
    process.exit(1);
  }
}

// CLI 실행
if (require.main === module) {
  main();
}

// 모듈 내보내기
module.exports = {
  generateProposalHTML,
  generateProposalImage,
  sampleProposalData
};
