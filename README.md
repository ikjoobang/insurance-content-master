# 🛡️ XIVIX 보험 콘텐츠 마스터 V25.5

> **AI 기반 보험 마케팅 콘텐츠 자동 생성 플랫폼**  
> 보험 설계사의 네이버 카페 마케팅을 위한 Q&A, 분석 리포트, 제안서 자동 생성

---

## 🌐 라이브 서비스

| 서비스 | URL |
|--------|-----|
| **메인 서비스** | https://insurance-content-master.pages.dev |
| **관리자 패널** | https://insurance-content-master.pages.dev/admin |
| **API Health** | https://insurance-content-master.pages.dev/api/health |
| **GitHub** | https://github.com/ikjoobang/insurance-content-master |

---

## 🎯 누가 사용하나요?

### ■ 보험 설계사 / GA
- 네이버 카페에 올릴 Q&A 콘텐츠 자동 생성
- 고객 맞춤형 보험 제안서 자동 작성
- 보험 증권 분석 리포트 생성

### ■ 보험 마케터
- SEO 최적화된 보험 콘텐츠 생성
- 실시간 보험 트렌드 키워드 분석
- 타깃별 맞춤 톤앤매너 콘텐츠

---

## ✨ 핵심 기능

### ❶ Q&A 자동 생성 (보험카페용)
```
입력: 타깃(40대 가장) + 보험종류(암보험) + 고객고민(갱신형이 좋을까요?)
출력: 제목 2개 + 질문 3개 + 전문가 답변 3개 + 댓글 5개 + SEO 키워드
```

**특징:**
- 3개 페르소나 시스템 (전문/설득형, 리얼토크형, 친근형)
- RAG 4단계 파이프라인 (할루시네이션 Zero)
- 네이버 검색 API 기반 실시간 팩트 수집
- 자가진단 루프 (70점 미만 시 재생성)

### ❷ Bento Grid 분석 리포트
```
입력: 보험 증권 이미지 또는 보장 정보
출력: 인포그래픽 스타일 분석 리포트
```

**분석 항목:**
- 🧠 **뇌혈관질환 (I60-I69)** 보장 범위 정밀 분석
- ❤️ **심장질환 (I49, 급성심근경색)** 보장 여부
- 🏥 **수술비 급수 체계** 자동 감지 (1-5종 vs 1-9종)
- ⚠️ **민감 데이터 경고** (불확실 정보 명시)

### ❸ 보험 설계서 자동 생성
```
입력: 고객 정보 + 보험 유형
출력: 브랜드 컬러 적용 설계서 (PDF/이미지)
```

### ❹ 실시간 트렌드 분석
- 네이버 DataLab 연동
- 12개 보험 카테고리 키워드 분석
- SEO 최적화 제목 자동 생성

---

## 🏗️ 기술 아키텍처

### ■ RAG 4단계 파이프라인
```
┌─────────────────────────────────────────────────────────────────────┐
│  Step 1: 팩트 수집      Step 2: 전략 수립     Step 3: 콘텐츠 생성   │
│  [네이버 검색 API] →    [전략 JSON]    →     [RAG 기반 작성]       │
│  블로그 5개 + 뉴스 3개  SEO 키워드 5개       JSON에 없는 내용      │
│                        팩트 체크 3개         절대 생성 금지         │
│                                                                     │
│                            ↓ 자가진단 실패 시 재생성 (최대 2회)     │
│                                                                     │
│  Step 4: 자가 진단                                                  │
│  [Self-Diagnosis Loop]                                              │
│  핵심고민 포함 여부 / 2026년 트렌드 반영 / 검수 점수 70점 이상     │
└─────────────────────────────────────────────────────────────────────┘
```

### ■ 기술 스택
| 구분 | 기술 |
|------|------|
| **프레임워크** | Hono (TypeScript) |
| **배포** | Cloudflare Pages (Edge Runtime) |
| **AI 텍스트** | Google Gemini 1.5 Pro (4키 로테이션) |
| **AI 이미지** | Google Gemini 2.5 Flash Image |
| **검색 연동** | NAVER Search API (블로그 + 뉴스) |
| **키워드 분석** | NAVER DataLab API |
| **UI** | Tailwind CSS + Font Awesome 6 |
| **폰트** | Pretendard Variable, Noto Sans KR |

### ■ 주요 원칙 (XIVIX Principles)
| 원칙 | 설명 |
|------|------|
| **Negative Constraints** | '사업비', '수수료', '운영비' 등 금지어 원천 차단 |
| **I-Code Verification** | 뇌혈관(I60-I69), 부정맥(I49) 약관 1:1 대조 |
| **Surgery Class Validation** | 1-5종(생보) vs 1-9종(손보) 체계 자동 감지 |
| **Hallucination Zero** | RAG 기반 팩트만 사용, 추측 금지 |
| **Text Selectable UI** | 모든 텍스트 드래그/복사 허용 |

---

## 📡 API 엔드포인트

| 엔드포인트 | 메서드 | 설명 |
|------------|--------|------|
| `/api/health` | GET | 서버 상태 및 버전 정보 |
| `/api/generate/qna-full` | POST | Q&A 전체 자동 생성 |
| `/api/generate/proposal-report` | POST | Bento Grid 제안서 리포트 |
| `/api/analyze/insurance-report` | POST | 보험 증권 분석 |
| `/api/trends/insurance` | GET | 실시간 보험 트렌드 |
| `/api/naver/keywords` | GET | 네이버 키워드 분석 |
| `/api/analyze/photo` | POST | 사진 분석 (OCR) |

### ■ Q&A 생성 API 예시
```bash
curl -X POST https://insurance-content-master.pages.dev/api/generate/qna-full \
  -H "Content-Type: application/json" \
  -d '{
    "target": "40대 가장",
    "insuranceType": "암보험",
    "customerConcern": "갱신형이 좋을지 비갱신형이 좋을지 모르겠어요",
    "tone": "전문"
  }'
```

### ■ 분석 리포트 API 예시
```bash
curl -X POST https://insurance-content-master.pages.dev/api/analyze/insurance-report \
  -H "Content-Type: application/json" \
  -d '{
    "company": "삼성생명",
    "productName": "무배당 삼성 암보험",
    "coverages": [
      {"name": "암진단비", "amount": "5,000만원", "premium": "28,000원"},
      {"name": "뇌출혈진단", "amount": "3,000만원", "premium": "12,000원"}
    ],
    "totalPremium": "119,500원"
  }'
```

---

## 🎨 UI/UX 특징

### ■ 디자인 시스템
- **테마**: Deep Black (#000000) + Soft Silver (#E0E0E0)
- **레이아웃**: Bento Grid 기반 인포그래픽
- **반응형**: PC 전체 너비 활용, 모바일 최적화
- **접근성**: 모든 텍스트 선택/복사 가능

### ■ 원클릭 복사
- 제목, 질문, 답변, 댓글 각각 원클릭 복사
- 설계서 텍스트/HTML 버전 복사
- SEO 키워드 일괄 복사

---

## 📁 프로젝트 구조

```
webapp/
├── src/
│   └── index.tsx          # 메인 애플리케이션 (7,000줄+)
├── scripts/
│   └── generate-proposal-image.cjs  # Puppeteer 이미지 생성
├── public/
│   ├── proposals/         # 생성된 제안서 이미지
│   └── static/            # 정적 파일
├── dist/                  # 빌드 결과물
├── ecosystem.config.cjs   # PM2 설정
├── wrangler.jsonc         # Cloudflare 설정
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 🚀 버전 히스토리

| 버전 | 날짜 | 주요 변경사항 |
|------|------|---------------|
| **V25.5** | **2026-01-17** | **텍스트 선택/복사 완전 허용, body 인라인 이벤트 제거** |
| V25.4 | 2026-01-17 | XIVIX 원칙 적용, 정밀 프롬프트 설계, Negative Constraints 강화 |
| V25.3 | 2026-01-17 | XIVIX 표준 JSON 스키마, I-코드 정밀 분석, 수술비 체계 자동 감지 |
| V25.2 | 2026-01-17 | Bento Grid 제안서 API, 한글 폰트 설치, Puppeteer 이미지 엔진 |
| V25.1 | 2026-01-16 | 민감 데이터 필터, 수술비 급수 검증, I-코드 검증 |
| V25.0 | 2026-01-16 | 실시간 트렌드, 12개 보험 카테고리, 가독성 최적화 |

---

## ⚠️ 주의사항

- Gemini API 키는 서버사이드에서만 사용 (4키 로테이션)
- 금소법 관련 내용은 참고용이며, 실제 활용 시 법적 검토 필요
- 뇌혈관질환(I60-I69), 부정맥(I49) 보장은 보험사별 약관 확인 필수
- 수술비 급수(1-5종 vs 1-9종)는 보험사별로 상이

---

## 👨‍💻 개발 정보

- **개발자**: 방익주
- **버전**: V25.5
- **최종 업데이트**: 2026-01-17
- **기술 지원**: XIVIX Dev Team

---

## 📞 빠른 시작

1. https://insurance-content-master.pages.dev 접속
2. **타깃** 선택 (예: 40대 가장)
3. **보험종류** 선택 (예: 암보험)
4. **고객 고민** 입력 (예: 갱신형이 좋을까요?)
5. **생성하기** 클릭
6. 결과물 **원클릭 복사** → 네이버 카페에 붙여넣기 🎉
