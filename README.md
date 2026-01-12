# 보험 콘텐츠 마스터 V2.0

AI 기반 보험 콘텐츠 자동 생성 플랫폼

## 🌐 라이브 URL

### ■ 프론트엔드
- **메인 (Production)**: https://insurance-content-master.pages.dev
- **미리보기 (Preview)**: https://52516032.insurance-content-master.pages.dev
- **샌드박스 (개발)**: https://3000-it76dqh2zidiverpa9gm8-18e660f9.sandbox.novita.ai

### ■ 백엔드 API
- **API 서버**: https://insurance-content-master.pages.dev/api/
- **Health Check**: https://insurance-content-master.pages.dev/api/health

### ■ API 엔드포인트
| 엔드포인트 | 메서드 | 설명 |
|------------|--------|------|
| `/api/health` | GET | 서버 상태 확인 |
| `/api/generate/qna` | POST | Q&A 생성 (질문+답변+댓글) |
| `/api/generate/blog` | POST | 블로그 글 생성 (1,700자+) |
| `/api/analyze/blog` | POST | 블로그 SEO 분석 |
| `/api/generate/titles` | POST | 제목 생성 |
| `/api/generate/keywords` | POST | 키워드 분석 |

## ✅ 구현 완료 기능

### ❶ Q&A 생성기 (보험카페용)
- 타겟 고객 선택 (30대 직장인, 40대 가장, 50대 은퇴준비, 신혼부부)
- 문체 선택 (해요체, 습니다체, 혼합체)
- AI 자동 생성: 질문 + 전문가 답변 + 꼬리형 댓글 3개
- 금소법 우회 전략 적용

### ❷ 블로그 생성기 (네이버 최적화)
- **본문 1,700자 이상** 자동 생성
- 콘텐츠 유형: 정보성, 후기성, 비교분석, 상담유도
- 네이버 블로그 UI/UX 최적화:
  - 2-3문장마다 줄바꿈 (모바일 가독성)
  - 인용구 형식 3줄 요약
  - [📷 이미지 삽입] 위치 표시
  - 이모지 기반 구조 (❶❷❸, ■, ✅, 💡)
- SEO/C-RANK/AEO/GEO 최적화 적용

### ❸ 블로그 분석기
- 글자수 체크 (1,700자 기준)
- SEO 점수 (키워드 밀도, 제목 최적화)
- C-RANK 점수 (전문성, 구조화, 일관성)
- AEO 점수 (Q&A 구조)
- GEO 점수 (지역 키워드)
- 개선된 제목/본문/해시태그 제안

### ❹ 제목 생성기
- 스타일: 궁금증유발, 정보제공, 비교분석, 후기형
- 생성 개수: 3/5/10개 선택

### ❺ 키워드 분석기
- 메인 키워드 → 롱테일 키워드 추출
- 지역 키워드 (GEO) 조합
- SEO 활용 팁 제공

### ❻ 복사/다운로드
- 원클릭 복사 (각 섹션별, 전체)
- TXT 다운로드
- PDF 다운로드

## 🛠️ 기술 스택

- **프레임워크**: Hono (TypeScript)
- **배포**: Cloudflare Pages
- **AI**: Google Gemini 2.0 Flash
- **폰트**: Noto Sans KR
- **아이콘**: Font Awesome

## 📊 SEO 최적화 항목

| 항목 | 설명 |
|------|------|
| SEO | 키워드 밀도, 메타 구조, 제목 최적화 |
| C-RANK | 전문성 구조, 일관성, 체계적 구성 |
| AEO | Q&A 구조, 질문-답변 최적화 |
| GEO | 지역 키워드 포함 |

## 📁 프로젝트 구조

```
webapp/
├── src/
│   └── index.tsx          # 메인 애플리케이션
├── dist/                   # 빌드 결과물
│   └── _worker.js
├── public/                 # 정적 파일
├── ecosystem.config.cjs    # PM2 설정
├── wrangler.jsonc          # Cloudflare 설정
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 🚀 개발자 정보

- **개발자**: 방익주
- **버전**: V2.0
- **최종 업데이트**: 2025-01-12

## 📝 사용 방법

1. **Q&A 생성**: 상품명과 고민 입력 → AI Q&A 생성
2. **블로그 생성**: 주제와 키워드 입력 → 1,700자+ 블로그 글 생성
3. **블로그 분석**: 기존 글 붙여넣기 → SEO 점수 및 개선안 확인
4. **복사/저장**: 원클릭 복사 또는 TXT/PDF 다운로드

## ⚠️ 주의사항

- Gemini API 키는 서버사이드에서만 사용됩니다
- API 키 로테이션 시스템으로 안정성 확보
- 금소법 관련 내용은 참고용이며, 실제 활용 시 법적 검토 필요
