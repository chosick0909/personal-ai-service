# personal-ai-service

React, Express, and Supabase starter for the personal AI service.

## Stack

- React + Vite frontend in `frontend`
- Express API in `backend`
- Supabase client wiring for browser and server

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Frontend: `http://localhost:5173`  
API health: `http://localhost:3001/api/health`

## Docker

Use Docker Desktop on Windows or macOS, then run:

```bash
cp .env.example .env
docker compose up --build
```

Frontend: `http://localhost:5173`  
API health: `http://localhost:3001/api/health`

Stop containers:

```bash
docker compose down
```

This setup is Linux-container based, which is the normal choice for React, Vite, Node, and Express even when teammates use Windows.

## Environment Variables

Fill these values in `.env`.

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_BASE_URL=
NODE_ENV=development
APP_RELEASE=local-dev
VITE_SENTRY_DSN=
VITE_APP_RELEASE=local-dev
SUPABASE_URL=
SENTRY_DSN=
SUPABASE_SERVICE_ROLE_KEY=
CLIENT_ORIGIN=http://localhost:5173
CLIENT_ORIGINS=http://localhost:5173
ENABLE_TEST_ROUTES=false
PORT=3001
```

## Production Deploy Checklist

1. Supabase Auth 설정
- `Site URL`: 프론트 배포 도메인
- `Additional Redirect URLs`:
  - `http://localhost:5173/analyze`
  - `https://<YOUR_FRONTEND_DOMAIN>/analyze`

2. Google OAuth 설정 (Google Cloud)
- Authorized redirect URI:
  - `https://<YOUR_SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback`

3. Frontend 환경변수
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL` (백엔드 도메인, 예: `https://api.yourdomain.com`)

4. Backend 환경변수
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `CLIENT_ORIGINS` (쉼표로 다중 도메인 허용)
  - 예: `https://app.yourdomain.com,http://localhost:5173`
- `ENABLE_TEST_ROUTES=false` (운영에서 테스트 라우트 비활성화)

5. 보안 필수
- `.env`에 있는 기존 키는 노출 이력이 있으면 모두 회전(재발급) 후 반영
- 서비스 롤 키/AI 키는 프론트에 절대 노출 금지

## Security Docs

- 보안/개인정보 구현 가이드:
  - `docs/security-privacy-implementation-guide.md`
- Codex 보안 우선 프롬프트:
  - `docs/codex-security-priority-prompt.md`
- Supabase RLS 점검 SQL:
  - `supabase/sql/rls_audit_checklist.sql`
