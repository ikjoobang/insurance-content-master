# Cloudflare Pages 환경변수 설정 방법

# 방법 1: CLI로 Secret 설정 (권장)
# npx wrangler secret put GEMINI_API_KEY --project-name insurance-content-master

# 방법 2: Cloudflare 대시보드
# 1. dash.cloudflare.com 접속
# 2. Pages → insurance-content-master → Settings → Environment variables
# 3. GEMINI_API_KEY 추가 (Production/Preview 모두)

# 로컬 개발용 .dev.vars 파일 (git에 커밋 금지!)

