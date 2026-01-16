# 보험 콘텐츠 마스터 V15.0 - Self-Correction System

AI 기반 보험 콘텐츠 자동 생성 플랫폼 + Chrome Extension (네이버 마케팅 프록시)

## 🌐 라이브 URL

### ■ 프론트엔드
- **메인 (Production)**: https://insurance-content-master.pages.dev
- **관리자 페이지**: https://insurance-content-master.pages.dev/admin

### ■ 백엔드 API
- **API 서버**: https://insurance-content-master.pages.dev/api/
- **Health Check**: https://insurance-content-master.pages.dev/api/health

### ■ API 엔드포인트
| 엔드포인트 | 메서드 | 설명 |
|------------|--------|------|
| `/api/health` | GET | 서버 상태 확인 |
| `/api/naver/keywords` | GET | 네이버 키워드 분석 |
| `/api/generate/qna-full` | POST | Q&A 전체 자동 생성 (**V15.0 Self-Correction**) |
| `/api/generate/proposal-image` | POST | 설계서 이미지 생성 |
| `/api/generate/blog` | POST | 블로그 글 생성 |
| `/api/analyze/blog` | POST | 블로그 SEO 분석 |
| `/api/proxy/change-ip` | POST | Bright Data IP 변경 |
| `/api/proxy/current-ip` | GET | 현재 프록시 IP 확인 |
| `/api/proxy/status` | GET | 프록시 상태 조회 |

## ✅ V15.0 핵심 업데이트 - Self-Correction System

### ❶ Self-Correction Loop (할루시네이션 방지)
**문제점 해결**: 단계 간 컨텍스트 단절로 핵심 고민이 Q&A에는 반영되나 전문가 답변/댓글에서 증발하거나 Hallucination 발생하는 문제 해결

**Agentic Workflow 구조**:
```
입력 → AI 생성(Draft) → 자가 진단 검수 → 재생성 판단(최대 2회) → 배포
```

- **최대 2회 재생성**: 검수 실패 시 Context 강화 후 재생성
- **재생성 이력 추적**: 각 시도의 점수와 실패 사유 기록
- **Context 강제 주입**: 재생성 시 핵심 고민/보험종류를 더 강하게 주입

### ❷ 4대 검수 기준 (auditQnAContent)
| 기준 | 검증 내용 | 감점 조건 |
|------|----------|----------|
| **SEO 최적화** | C-Rank / D.I.A.+ / Agent N | 보험종류 미포함 -30점, 키워드 밀도 부족 -20점 |
| **문맥 일치성** | 핵심고민이 질문/답변/댓글 전반에 반영 | 질문 미반영 -25점, 답변 미반영 -30점 |
| **전문가 다각화** | 3명의 서로 다른 관점 전문가 | 답변 3개 미만 -40점, 300자 미만 -15점/개 |
| **댓글 현실성** | 단순 칭찬 금지, 경험담 중심 | 댓글 3개 미만 -30점, 단순 칭찬만 -20점 |

### ❸ 응답에 포함되는 Self-Correction 정보
```json
{
  "selfCorrection": {
    "totalAttempts": 2,           // 총 시도 횟수
    "maxAttempts": 2,             // 최대 허용 횟수
    "wasRegenerated": true,       // 재생성 여부
    "finalScore": 85,             // 최종 검수 점수
    "regenerationHistory": [      // 재생성 이력
      {
        "attempt": 1,
        "score": 65,
        "failReasons": ["문맥: 질문에 핵심고민이 충분히 반영되지 않음"]
      }
    ]
  },
  "audit": {
    "passed": true,
    "totalScore": 85,
    "scores": {
      "seoOptimization": 90,
      "contextConsistency": 80,
      "expertDiversity": 85,
      "commentRealism": 85
    }
  },
  "version": "V15.0-SelfCorrection"
}
```

## ✅ 기존 기능 (V13.0+)

### ❶ Q&A 자동 생성 (보험카페용)
- **제목 2개** (다양한 어그로성)
- **질문 3개** (각기 다른 화자 사연)
- **전문가 답변 3개** (A: 팩트형, B: 공감형, C: 분석형)
- **현실적 댓글 3개** (공감/경험담 중심)
- SEO 키워드 5개 + 최적화 제목 2개 출력

### ❷ 도메인 지식 (2026년 기준)
- 2025년 통계 + 2026년 개정 약관 비교 설명
- 보험종류별 전문 지식:
  - 암보험, 뇌/심장(2대질환), 3대 질환
  - 운전자보험, 간병/치매/요양
  - 종합보험, 실손보험

### ❸ 설계서 이미지 생성
- 보험사별 브랜드 컬러 적용
- Compact Card 스타일 설계서
- PDF 다운로드 지원

## 🔧 Chrome Extension (네이버 마케팅 프록시)

### ■ 기능 개요
보험 설계사들이 보안 프로그램 충돌 없이 네이버 마케팅을 수행하도록 지원

### ■ 기술 요구사항 (Critical Spec)
- **Manifest V3** 기반
- **externally_connectable** 권한으로 지정 도메인만 통신
- **PAC Script 기반 분할 터널링**:
  - `*.naver.com` 트래픽 → Bright Data Proxy 경유
  - 그 외 트래픽 → DIRECT (보안 프로그램 충돌 방지)

### ■ Bright Data 연동
- Host: `brd.superproxy.io`
- Port: `33335`
- Country: KR (한국 IP 할당)
- Session ID 관리로 IP 유지

### ■ 파일 구조
```
chrome-extension/
├── manifest.json          # MV3 매니페스트
├── background.js          # Service Worker (프록시 제어)
├── popup.html             # Popup UI
├── popup.js               # Popup 스크립트
└── icons/
    ├── icon16.png
    ├── icon48.png
    ├── icon128.png
    └── *-active.png       # 활성 상태 아이콘
```

### ■ 설치 방법
1. `naver-marketing-proxy-v1.0.0.zip` 다운로드
2. Chrome → `chrome://extensions` 접속
3. "개발자 모드" 활성화
4. "압축해제된 확장 프로그램 로드" → zip 압축 해제 폴더 선택

## 📁 프로젝트 구조

```
webapp/
├── src/
│   └── index.tsx          # 메인 애플리케이션 (4,900줄+)
├── chrome-extension/      # Chrome Extension 소스
│   ├── manifest.json
│   ├── background.js
│   ├── popup.html
│   ├── popup.js
│   └── icons/
├── dist/                  # 빌드 결과물
├── public/                # 정적 파일
├── ecosystem.config.cjs   # PM2 설정
├── wrangler.jsonc         # Cloudflare 설정
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 🛠️ 기술 스택

- **프레임워크**: Hono (TypeScript)
- **배포**: Cloudflare Pages
- **AI**: Google Gemini 2.0 Flash (4개 키 로테이션)
- **키워드 분석**: NAVER DataLab API
- **프록시**: Bright Data Residential Proxy
- **폰트**: Pretendard Variable
- **아이콘**: Font Awesome 6

## 🚀 버전 히스토리

| 버전 | 날짜 | 주요 변경사항 |
|------|------|---------------|
| **V15.0** | **2026-01-16** | **Self-Correction Loop 도입, 할루시네이션 방지, 재생성 이력 추적** |
| V14.0 | 2026-01-16 | Context 강제 주입 프롬프트, 재생성 함수 분리 |
| V13.0 | 2026-01-16 | Agentic Workflow, 제목 2개/질문 3개 확장, Chrome Extension 완성 |
| V12.2 | 2026-01-16 | 자가진단 워크플로우, SEO 키워드/최적화 제목 출력 |
| V11.4 | 2026-01-15 | 전문가 답변 3종 다각화, 도메인 지식 2026 기준 |

## ⚠️ 주의사항

- Gemini API 키는 서버사이드에서만 사용됩니다
- API 키 로테이션 시스템으로 안정성 확보
- 금소법 관련 내용은 참고용이며, 실제 활용 시 법적 검토 필요
- Chrome Extension은 Chrome Web Store 등록 전 개발자 모드로 사용

## 👨‍💻 개발자 정보

- **개발자**: 방익주
- **버전**: V15.0
- **최종 업데이트**: 2026-01-16
