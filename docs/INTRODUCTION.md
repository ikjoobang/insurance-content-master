# XIVIX 보험 콘텐츠 마스터 소개 자료

> 다양한 대상(보험설계사, 일반인, 개발자)을 위한 맞춤형 소개

---

## 📋 목차
1. [원라인 피치 (한 줄 소개)](#-원라인-피치)
2. [보험설계사용 소개](#-보험설계사용-소개)
3. [일반인용 소개](#-일반인용-소개)
4. [개발자용 소개](#-개발자용-소개)
5. [SNS 공유용 문구](#-sns-공유용-문구)
6. [프레젠테이션용](#-프레젠테이션용)

---

## 🎯 원라인 피치

### 한 줄 소개 (10초 버전)
> "AI가 네이버 카페용 보험 Q&A를 자동으로 만들어주는 서비스입니다."

### 엘리베이터 피치 (30초 버전)
> "보험설계사분들이 네이버 카페 마케팅할 때 가장 힘든 게 뭔지 아세요? 매번 질문/답변 콘텐츠 만드는 거예요. XIVIX는 AI가 타깃, 보험종류, 고객 고민만 입력하면 **제목 2개 + 질문 3개 + 전문가 답변 3개 + 댓글 5개**를 자동으로 생성해줍니다. 복사해서 바로 올리면 끝이에요."

---

## 👔 보험설계사용 소개

### ✅ 이런 분께 추천해요
- 네이버 카페 마케팅하는데 글 쓰는 게 막막한 분
- 매일 다른 콘텐츠 올려야 하는데 시간이 없는 분
- 전문적인 답변 글을 쓰고 싶은데 어려운 분

### ✅ 이렇게 사용하세요

**1️⃣ 3가지만 선택하세요**
- 타깃: 40대 가장 / 30대 신혼부부 / 50대 자영업자 등
- 보험: 암보험 / 종신보험 / 실손보험 등 12종
- 고민: "갱신형이 좋을까요?" / "지금 가입해도 될까요?"

**2️⃣ 생성 버튼 누르세요**
- 5초 안에 결과물이 나와요

**3️⃣ 복사해서 카페에 올리세요**
- 제목, 질문, 답변, 댓글 각각 원클릭 복사
- 그대로 붙여넣기만 하면 끝!

### ✅ 뭐가 생성되나요?

```
📝 제목 2개 (어그로성 + 일반형)
❓ 질문 3개 (각기 다른 사연과 화자)
💬 전문가 답변 3개 (팩트형, 공감형, 분석형)
🗣️ 현실적 댓글 5개 (공감/경험담 중심)
🔑 SEO 키워드 5개 (검색 최적화)
```

### ✅ 왜 좋은가요?

| 기존 방식 | XIVIX 사용 시 |
|----------|---------------|
| 글 하나 쓰는데 30분~1시간 | **5초**면 끝 |
| 매번 비슷한 내용 반복 | **매번 다른 콘텐츠** 생성 |
| 전문 용어 쓰기 어려움 | **2026년 최신 정보** 반영 |
| 댓글까지 쓰기 귀찮음 | **댓글 5개**까지 자동 생성 |

### ✅ 무료인가요?
- 네, **완전 무료**입니다.
- 회원가입도 필요 없어요.
- 바로 사용하시면 됩니다.

### 📱 바로 사용하기
👉 https://insurance-content-master.pages.dev

---

## 👨‍👩‍👧 일반인용 소개

### ✅ 이게 뭔가요?
보험설계사분들이 네이버 카페에 올릴 **Q&A 글**을 AI가 자동으로 만들어주는 서비스예요.

### ✅ 어떻게 작동하나요?
1. "40대 가장이 암보험 갱신형 vs 비갱신형 고민 중" 이렇게 입력하면
2. AI가 **현실적인 질문글 + 전문가 답변 + 공감 댓글**을 자동으로 만들어줘요
3. 그대로 복사해서 카페에 올리면 끝!

### ✅ 뭐가 좋은가요?
- **시간 절약**: 글 하나 30분 → 5초
- **품질 향상**: 2026년 최신 보험 정보 반영
- **무료**: 회원가입 없이 바로 사용

### 📱 구경하러 가기
👉 https://insurance-content-master.pages.dev

---

## 💻 개발자용 소개

### ✅ 기술 요약
**Hono + Cloudflare Pages 기반 AI 콘텐츠 생성 플랫폼**

- **프레임워크**: Hono (TypeScript)
- **배포**: Cloudflare Pages (Edge Runtime)
- **AI 모델**: Google Gemini 1.5 Pro / 2.5 Flash Image
- **RAG 파이프라인**: NAVER Search API → Strategy JSON → Content Gen → Self-Diagnosis

### ✅ 아키텍처 특징

**1️⃣ RAG 4단계 파이프라인**
```
네이버 검색 API → 전략 JSON 수립 → RAG 기반 콘텐츠 생성 → 자가진단 루프
```
- 할루시네이션 제로: 검색 결과(Fact)만 사용
- 자가진단 루프: 70점 미만 시 최대 2회 재생성

**2️⃣ Multi-Persona 시스템**
```typescript
type Persona = 'expert' | 'realtalk' | 'friendly'
// 전문/설득형, 리얼토크형, 친근형 3가지 페르소나 지원
```

**3️⃣ XIVIX Principles (도메인 규칙)**
```typescript
// Negative Constraints (금지어 필터링)
const FORBIDDEN_KEYWORDS = ['사업비', '수수료', '운영비', '판매수수료']

// I-Code Verification (질병코드 검증)
const BRAIN_CODES = ['I60', 'I61', 'I62', 'I63', 'I64', 'I65', 'I66', 'I67', 'I68', 'I69']

// Surgery Class Validation (수술비 급수 검증)
type SurgerySystem = '1-5종' | '1-9종' | 'unknown'
```

**4️⃣ 민감 데이터 처리**
- 뇌혈관질환(I60-I69): 약관 1:1 대조 후 명시
- 부정맥(I49): 데이터 증명 불가 시 "확인 필요" 리턴
- 고액 비급여 수술: 특약 확인 안내 자동 삽입

### ✅ API 스펙

**Health Check**
```bash
GET /api/health
# Response: { version: "25.5", features: [...], ragPipeline: "..." }
```

**Q&A 생성**
```bash
POST /api/generate/qna-full
Content-Type: application/json

{
  "target": "40대 가장",
  "insuranceType": "암보험",
  "customerConcern": "갱신형 vs 비갱신형",
  "tone": "전문"
}
```

**보험 분석 리포트**
```bash
POST /api/analyze/insurance-report
Content-Type: application/json

{
  "company": "삼성생명",
  "productName": "암보험",
  "coverages": [...],
  "totalPremium": "119,500원"
}
```

### ✅ 소스코드
- **GitHub**: https://github.com/ikjoobang/insurance-content-master
- **라이선스**: Private (문의 필요)

### ✅ 기술 스택 상세

| 카테고리 | 기술 |
|----------|------|
| **Runtime** | Cloudflare Workers (V8 Isolates) |
| **Framework** | Hono v4 (TypeScript) |
| **Build** | Vite + @hono/vite-cloudflare-pages |
| **AI Text** | Gemini 1.5 Pro 002 (4키 로테이션) |
| **AI Image** | Gemini 2.5 Flash Image |
| **Search API** | NAVER Search API (Blog + News) |
| **Keyword API** | NAVER DataLab API |
| **UI** | Tailwind CSS CDN + Font Awesome 6 |
| **Font** | Pretendard Variable, Noto Sans KR |

### ✅ 로컬 개발 환경

```bash
# 클론
git clone https://github.com/ikjoobang/insurance-content-master.git
cd insurance-content-master

# 의존성 설치
npm install

# 환경변수 설정
cp .dev.vars.example .dev.vars
# GEMINI_API_KEY, NAVER_CLIENT_ID, NAVER_CLIENT_SECRET 설정

# 개발 서버 시작
npm run build
npm run dev:sandbox  # 또는 npx wrangler pages dev dist --ip 0.0.0.0 --port 3000
```

---

## 📱 SNS 공유용 문구

### Twitter/X (280자)
```
🛡️ 보험설계사 필수템 공개

네이버 카페 마케팅할 때 글쓰기 힘드셨죠?

AI가 Q&A 콘텐츠 자동 생성해드립니다
✅ 제목 2개
✅ 질문 3개
✅ 전문가 답변 3개
✅ 댓글 5개

5초면 끝, 무료입니다 👇
https://insurance-content-master.pages.dev
```

### LinkedIn
```
[보험업계 마케터분들께 공유드립니다]

보험 콘텐츠 마스터 - AI 기반 Q&A 자동 생성 서비스를 소개합니다.

📌 문제:
보험설계사분들이 네이버 카페 마케팅 시 가장 시간이 많이 드는 작업이 
"질문 글 + 전문가 답변 + 댓글" 콘텐츠 제작입니다.

📌 솔루션:
타깃, 보험종류, 고객 고민만 입력하면 AI가 자동으로:
- 제목 2개 (어그로형 + 일반형)
- 질문 3개 (각기 다른 사연)
- 전문가 답변 3개 (팩트형/공감형/분석형)
- 현실적 댓글 5개

📌 기술:
- RAG 파이프라인으로 할루시네이션 제로
- 2026년 최신 보험 정보 반영
- Gemini 1.5 Pro + NAVER Search API 연동

무료로 사용해보세요 👇
https://insurance-content-master.pages.dev

#보험마케팅 #AI #콘텐츠자동화 #InsurTech
```

### 카카오톡/문자 (짧은 버전)
```
[보험설계사 필수 무료 툴]
네이버 카페 Q&A 글 AI가 자동 생성해줘요!
5초면 끝 → https://insurance-content-master.pages.dev
```

---

## 🎤 프레젠테이션용

### 슬라이드 1: 문제 정의
```
❌ 보험설계사의 고민

"네이버 카페 마케팅 해야 하는데..."
- 글 하나 쓰는데 30분~1시간
- 매번 비슷한 내용 반복
- 전문적인 답변 쓰기 어려움
- 댓글까지 달아야 해서 귀찮음
```

### 슬라이드 2: 솔루션
```
✅ XIVIX 보험 콘텐츠 마스터

AI가 Q&A 콘텐츠를 자동 생성합니다

입력: 타깃 + 보험종류 + 고객 고민
출력: 제목 2개 + 질문 3개 + 답변 3개 + 댓글 5개

⏱️ 소요 시간: 5초
💰 비용: 무료
```

### 슬라이드 3: 기술 차별점
```
🔬 RAG 파이프라인 (할루시네이션 Zero)

1️⃣ 네이버 검색 API로 실시간 팩트 수집
2️⃣ 전략 JSON 수립 (SEO 키워드 + 팩트 체크)
3️⃣ RAG 기반 콘텐츠 생성 (팩트만 사용)
4️⃣ 자가진단 루프 (70점 미만 시 재생성)

→ 검색 결과만 사용하므로 환각 현상 없음
→ 2026년 최신 보험 정보 자동 반영
```

### 슬라이드 4: 데모
```
👉 라이브 데모
https://insurance-content-master.pages.dev

[스크린샷 또는 화면 공유]
```

---

## 📞 연락처

- **개발자**: 방익주
- **GitHub**: https://github.com/ikjoobang/insurance-content-master
- **서비스**: https://insurance-content-master.pages.dev
