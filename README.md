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
NODE_ENV=development
APP_RELEASE=local-dev
VITE_SENTRY_DSN=
VITE_APP_RELEASE=local-dev
SUPABASE_URL=
SENTRY_DSN=
SUPABASE_SERVICE_ROLE_KEY=
CLIENT_ORIGIN=http://localhost:5173
PORT=3001
```
