# [기획서] IP 보안 접속 제어 모듈 UI/UX 명세

> **문서 버전**: v1.0  
> **최종 수정일**: 2026-01-16  
> **작성자**: AI Developer  
> **상태**: ✅ 구현 완료 (배포 준비)

---

## 1. 개요

### 1.1 목적
드래그(슬라이드) 인터랙션으로 프록시 IP를 변경하고, 변경 결과를 시각적으로 확인하여 **네이버 마케팅 도구의 신뢰감을 확보**합니다.

### 1.2 핵심 가치
- ■ **드래그 오작동 방지**: 실수로 인한 IP 변경 방지 (90% 이상 드래그 필요)
- ■ **IP 비교의 시각적 확신**: 이전 IP → 새 IP 전환 과정을 명확히 표시
- ■ **한국 IP 보장**: KR 국가 코드 확인 및 재시도 로직

### 1.3 위치
- **메인 대시보드 > Q&A 섹션 하단**
- HTML 라인 위치: `1444-1545` (src/index.tsx)

---

## 2. UI/UX 구성

### 2.1 모듈 레이아웃

```
┌─────────────────────────────────────────────────────────────────┐
│ 🛡️ IP 보안 접속 제어                           [미연결] 뱃지   │
│    네이버 탐지 우회를 위한 Clean IP 연결                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ [⟷] → 밀어서 새 IP 받기 (Clean IP)                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│  👆 핸들을 오른쪽 끝까지 드래그하세요                            │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ (상태 표시 영역 - 초기 숨김)                                     │
│                                                                 │
│  [로딩] 🔄 보안 서버에 접속 중입니다...                          │
│                                                                 │
│  [성공] ✅ 안전한 한국 IP로 변경되었습니다                       │
│         ┌──────────────────────────────────────────┐           │
│         │  이전 IP        →        새로운 IP       │           │
│         │  ~~211.234.xxx.45~~     175.193.xxx.89   │           │
│         │                         [KR]             │           │
│         └──────────────────────────────────────────┘           │
│         🔒 네이버가 탐지하지 못하는 주거용 IP입니다              │
│                                                                 │
│  [에러] ⚠️ 새 IP 할당 실패. 다시 밀어주세요.                    │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ 🕐 마지막 변경: 오후 3:45:12        [🔄 IP 다시 변경] 버튼      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 조작부 (슬라이드 버튼)

| 상태 | 텍스트 | 아이콘 |
|------|--------|--------|
| 기본 | `밀어서 새 IP 받기 (Clean IP)` | `→` (펄스 애니메이션) |
| 드래그 중 (80% 미만) | `밀어서 새 IP 받기 (Clean IP)` | `→` |
| 드래그 중 (80% 이상) | `손을 떼면 IP 변경!` | `✓` |
| 실행 중 | `IP 교체 중...` | 스피너 |

### 2.3 상태 알림부 (단계별 표기)

#### ❶ 연결 시도
```html
<div class="inline-flex items-center gap-3 px-4 py-2 bg-cyan-500/10 rounded-lg border border-cyan-500/20">
  <div class="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
  <span class="text-cyan-400 text-sm font-medium">보안 서버에 접속 중입니다...</span>
</div>
```

#### ❷ 변경 완료 (성공)
```html
<span class="px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg text-sm font-medium border border-green-500/30">
  <i class="fas fa-check-circle mr-1.5"></i>안전한 한국 IP로 변경되었습니다
</span>
```

#### ❸ 에러 상태
```html
<div class="inline-flex items-center gap-2 px-4 py-2 bg-red-500/10 rounded-lg border border-red-500/20">
  <i class="fas fa-exclamation-triangle text-red-400"></i>
  <span class="text-red-400 text-sm">새 IP 할당 실패. 다시 밀어주세요.</span>
</div>
```

### 2.4 결과 표시 (IP 전/후 비교)

| 요소 | 스타일 |
|------|--------|
| 이전 IP | `text-gray-400 text-sm line-through` (취소선) |
| 새로운 IP | `text-green-400 text-base font-bold` (굵은 초록색) |
| 국가 태그 | `[KR]` - `bg-green-500/20 text-green-400 text-xs` |
| 안내문 | `🔒 네이버가 탐지하지 못하는 주거용 IP입니다` |

### 2.5 연결 뱃지 상태

| 상태 | 클래스 | 텍스트 |
|------|--------|--------|
| 미연결 | `bg-gray-700/50 text-gray-400 border-gray-600/30` | `⚫ 미연결` |
| 보안 연결됨 | `bg-green-500/20 text-green-400 border-green-500/30` | `✅ 보안 연결됨` |

---

## 3. 인터랙션 사양

### 3.1 드래그 동작 흐름

```
[시작] ─→ [드래그 중] ─→ [종료 판정]
  │           │              │
  ▼           ▼              ▼
startDrag   onDrag        endDrag
  │           │              │
  │           │         progress >= 90%?
  │           │          ┌───┴───┐
  │           │         YES     NO
  │           │          │       │
  │           │          ▼       ▼
  │           │   triggerIPChange  resetSlider
```

### 3.2 드래그 임계값

| 조건 | 동작 |
|------|------|
| `progress < 80%` | 기본 텍스트 유지 |
| `progress >= 80%` | 텍스트 변경: "손을 떼면 IP 변경!" |
| `progress >= 90%` | IP 변경 실행 (`triggerIPChange`) |
| `progress < 90%` | 슬라이더 리셋 (`resetSlider`) |

### 3.3 이벤트 바인딩

```javascript
// 마우스 이벤트
handle.addEventListener('mousedown', startDrag);
document.addEventListener('mousemove', onDrag);
document.addEventListener('mouseup', endDrag);

// 터치 이벤트 (모바일)
handle.addEventListener('touchstart', startDrag, { passive: false });
document.addEventListener('touchmove', onDrag, { passive: false });
document.addEventListener('touchend', endDrag);
```

### 3.4 IP 마스킹 규칙

```javascript
function maskIP(ip) {
  if (!ip) return '--.---.---.---';
  const parts = ip.split('.');
  if (parts.length === 4) {
    return parts[0] + '.' + parts[1] + '.xxx.' + parts[3];
  }
  return ip;
}
// 예: 211.234.56.78 → 211.234.xxx.78
```

---

## 4. API 명세

### 4.1 새 IP 요청

```http
POST /api/proxy/change-ip
Content-Type: application/json
```

**Response (성공)**:
```json
{
  "success": true,
  "newIP": "175.193.45.123",
  "country": "KR",
  "sessionId": "session_1768536320189_abc123"
}
```

**Response (해외 IP 감지)**:
```json
{
  "success": true,
  "newIP": "198.51.100.45",
  "country": "US",
  "sessionId": "session_xxx",
  "warning": "해외 IP가 감지되었습니다. 자동으로 재시도합니다.",
  "shouldRetry": true
}
```

**Response (실패)**:
```json
{
  "success": false,
  "error": "새 IP 할당 실패"
}
```

### 4.2 현재 IP 확인

```http
GET /api/proxy/current-ip
```

**Response**:
```json
{
  "ip": "175.193.45.123",
  "sessionId": "session_xxx",
  "connected": true
}
```

### 4.3 프록시 상태 확인

```http
GET /api/proxy/status
```

**Response**:
```json
{
  "configured": true,
  "currentIP": "175.193.45.123",
  "sessionId": "session_xxx",
  "host": "brd.superproxy.io",
  "port": "33335"
}
```

---

## 5. 기술 및 보안

### 5.1 Bright Data 프록시 설정

| 항목 | 값 |
|------|-----|
| **호스트** | `brd.superproxy.io` |
| **포트** | `33335` |
| **프로토콜** | HTTP |
| **인증 방식** | Basic Auth (username:password) |

### 5.2 환경변수 (Cloudflare Secrets)

```bash
# 필수 설정
wrangler secret put BRIGHT_DATA_USERNAME
wrangler secret put BRIGHT_DATA_PASSWORD

# 선택 설정 (기본값 있음)
wrangler secret put BRIGHT_DATA_HOST    # 기본: brd.superproxy.io
wrangler secret put BRIGHT_DATA_PORT    # 기본: 33335
```

### 5.3 타입 정의 (Bindings)

```typescript
type Bindings = {
  // Bright Data Proxy
  BRIGHT_DATA_HOST?: string;
  BRIGHT_DATA_PORT?: string;
  BRIGHT_DATA_USERNAME?: string;
  BRIGHT_DATA_PASSWORD?: string;
  
  // 기존 Bindings...
}
```

### 5.4 자격증명 예시 (다중 포맷)

```
# 형식 1: 일반
username: brd-customer-xxxxx-zone-residential_kr
password: your_password

# 형식 2: cURL
curl -x brd.superproxy.io:33335 -U "brd-customer-xxxxx-zone-residential_kr:password" https://example.com

# 형식 3: 프록시 URL
http://brd-customer-xxxxx-zone-residential_kr-session-{sessionId}:password@brd.superproxy.io:33335
```

---

## 6. 예외 처리

### 6.1 예외 시나리오 및 처리

| 시나리오 | 메시지 | 동작 |
|----------|--------|------|
| API 호출 실패 | `새 IP 할당 실패. 다시 밀어주세요.` | 2초 후 슬라이더 리셋 |
| 해외 IP 감지 | `해외 IP가 감지되었습니다. 자동으로 재시도합니다.` | 자동 재시도 |
| 네트워크 오류 | `연결 오류가 발생했습니다.` | 2초 후 리셋 |
| 환경변수 미설정 | 데모 모드 활성화 (시뮬레이션 IP 반환) | 정상 동작 (테스트용) |

### 6.2 자동 재시도 로직 (KR 아닌 경우)

```javascript
if (data.shouldRetry && data.country !== 'KR') {
  showToast('해외 IP 감지, 재시도 중...');
  setTimeout(() => triggerIPChange(), 1000);
}
```

---

## 7. 스타일 가이드

### 7.1 컬러 팔레트

| 용도 | 색상 | Tailwind 클래스 |
|------|------|-----------------|
| 기본 배경 | 그라디언트 다크 | `from-gray-900/80 to-gray-800/80` |
| 메인 액센트 | 시안 | `cyan-500`, `cyan-400` |
| 성공 | 초록 | `green-500`, `green-400` |
| 에러 | 빨강 | `red-500`, `red-400` |
| 텍스트 (기본) | 회색 | `gray-300`, `gray-400` |

### 7.2 애니메이션

| 요소 | 애니메이션 |
|------|-----------|
| 화살표 아이콘 | `animate-pulse` |
| 로딩 스피너 | `animate-spin` |
| 핸들 호버 | `hover:shadow-cyan-500/50` |
| 핸들 드래그 | `scale-110` |

---

## 8. 구현 현황

### 8.1 완료 항목 ✅

- [x] 슬라이드 드래그 UI 구현 (마우스/터치 지원)
- [x] 드래그 진행률 시각화 (fill bar)
- [x] 단계별 텍스트 변경 (80%, 90% 임계값)
- [x] IP 전/후 비교 표시 (마스킹 적용)
- [x] 연결 상태 뱃지 업데이트
- [x] 로딩/성공/에러 상태 UI
- [x] 백엔드 API 3개 구현 (`/api/proxy/*`)
- [x] Geo-location 확인 (KR 검증)
- [x] 데모 모드 (환경변수 미설정 시)
- [x] 토스트 알림 연동

### 8.2 보류 항목 (배포 후 설정 필요)

- [ ] Cloudflare Secrets 등록 (BRIGHT_DATA_*)
- [ ] 실제 Bright Data 프록시 연동 테스트
- [ ] 자동 재시도 로직 활성화 (현재 메시지만 표시)

---

## 9. 배포 체크리스트

### 9.1 배포 전 확인

```bash
# 1. 빌드 테스트
npm run build

# 2. 로컬 테스트
npm run dev:sandbox
curl http://localhost:3000/api/proxy/status
curl -X POST http://localhost:3000/api/proxy/change-ip

# 3. Git 커밋
git add .
git commit -m "V11.5: IP 보안 접속 제어 모듈 완료"
```

### 9.2 배포 후 설정

```bash
# Cloudflare Secrets 등록
npx wrangler secret put BRIGHT_DATA_USERNAME --project-name insurance-content-master
# 입력: brd-customer-xxxxx-zone-residential_kr

npx wrangler secret put BRIGHT_DATA_PASSWORD --project-name insurance-content-master
# 입력: your_password
```

### 9.3 배포 검증

```bash
# 프로덕션 API 테스트
curl https://insurance-content-master.pages.dev/api/proxy/status
curl -X POST https://insurance-content-master.pages.dev/api/proxy/change-ip
```

---

## 10. 참고 자료

### 10.1 관련 파일

| 파일 | 설명 | 라인 |
|------|------|------|
| `src/index.tsx` | 메인 소스 (UI + API) | - |
| UI 섹션 | HTML 템플릿 | 1444-1545 |
| 프론트엔드 JS | 드래그 로직 | 2202-2403 |
| 백엔드 API | Hono 라우트 | 4061-4210 |

### 10.2 외부 서비스

- **Bright Data**: https://brightdata.com
- **IP 확인**: https://api.ipify.org
- **Geo-location**: https://ipapi.co

---

**📋 이 문서를 개발자에게 전달하여 배포를 진행하세요.**

> ⚠️ **보안 주의**: Bright Data 자격증명은 절대 코드에 하드코딩하지 말고, 반드시 Cloudflare Secrets로 관리하세요.
