# 운영 안정화 가이드 (로컬 정상 / 배포 실패 대응)

작성일: 2026-04-17  
기준 도메인: `https://www.hookai.kr` (frontend), `https://api.hookai.kr` (backend)

## 1) 시스템 개요 (계층 기준)

- 프론트 렌더링/상태/라우팅: `frontend/src`
- API 통신 계층: `frontend/src/lib/api.js`
- 백엔드 API 라우팅: `backend/src/index.js`
- 인증/인가 계층: `backend/src/lib/auth.js`
- DB/Supabase 계층: `backend/src/lib/supabase.js`, `backend/src/lib/accounts.js` 등
- 외부 AI(OpenAI) 계층: `backend/src/lib/openai.js`, `backend/src/lib/reference-video-analysis.js`
- 배포/도메인/CORS 계층: Railway Variables + `backend/src/index.js` CORS

---

## 2) 핵심 기능 목록 (운영 점검표)

| 기능 | 로컬 | 배포 | 현재 증상 | 우선 계층 |
|---|---|---|---|---|
| Google OAuth 로그인 | 정상 | 부분 실패 가능 | redirect/callback 불일치 시 세션 반영 실패 | Auth/OAuth |
| 계정 목록 조회 | 정상 | 실패(재현) | `/api/accounts` 500 | Backend/Auth/DB |
| 계정 추가 | 정상 | 실패(재현) | `/api/accounts` 500 | Backend/Auth/DB |
| 레퍼런스 영상 분석 요청 | 정상 | 실패/지연(재현) | 분석 중 고착 또는 500 | Backend/OpenAI/Storage |
| 레퍼런스 분석 결과 렌더링 | 정상 | 부분 실패 | 응답 실패 시 UI 고착 체감 | Front state/API |
| 설정 저장/불러오기 | 정상 | 미확인 | 계정 컨텍스트 누락 시 오류 가능 | API/DB/Auth |
| 로그아웃 | 정상 | 정상 추정 | - | Auth |
| 관리자 API | 로컬 조건부 | 미확인 | admin 권한/env 의존 | Auth/Role |

---

## 3) ENV 인벤토리 (코드 기준)

### Frontend (`import.meta.env`)

| ENV | 사용 위치 | 필요 | 설명 |
|---|---|---|---|
| `VITE_API_BASE_URL` | `frontend/src/lib/api.js` | 필수(배포) | API 도메인 (`https://api.hookai.kr`) |
| `VITE_SUPABASE_URL` | `frontend/src/lib/supabase.js` | 필수 | Supabase 프로젝트 URL |
| `VITE_SUPABASE_ANON_KEY` | `frontend/src/lib/supabase.js` | 필수 | Supabase anon key |
| `VITE_AUTH_REDIRECT_URL` | `frontend/src/App.jsx` | 권장 | OAuth 완료 후 고정 redirect (`https://www.hookai.kr/analyze`) |
| `VITE_SENTRY_DSN` | `frontend/src/lib/sentry.js` | 선택 | 프론트 에러 수집 |
| `VITE_APP_RELEASE` | `frontend/src/lib/sentry.js` | 권장 | 릴리즈 태그 |
| `MODE` | `frontend/src/lib/sentry.js` | 자동 | Vite 모드 값 |

### Backend (`process.env`)

| ENV | 사용 위치 | 필요 | 설명 |
|---|---|---|---|
| `SUPABASE_URL` | `backend/src/lib/supabase.js` | 필수 | Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `backend/src/lib/supabase.js` | 필수 | 서버 전용 key |
| `OPENAI_API_KEY` | `backend/src/lib/openai.js` | 필수(분석 기능) | OpenAI 호출 키 |
| `CLIENT_ORIGIN` | `backend/src/index.js` | 필수 | CORS 단일 origin |
| `CLIENT_ORIGINS` | `backend/src/index.js` | 권장 | CORS origin 목록(쉼표 구분) |
| `NODE_ENV` | 여러 파일 | 필수 | `production` 권장 |
| `PORT` | `backend/src/index.js` | 필수 | Railway 런타임 포트 |
| `APP_RELEASE` | `backend/src/lib/sentry.js` | 권장 | 릴리즈 태그 |
| `SENTRY_DSN` | `backend/src/lib/sentry.js` | 선택 | 백엔드 에러 수집 |
| `ADMIN_USER_IDS`, `ADMIN_EMAILS` | `backend/src/lib/auth.js` | 선택 | 관리자 권한 |
| `ENABLE_TEST_ROUTES` | `backend/src/index.js` | 선택 | 테스트 라우트 노출 제어 |
| `SUPABASE_CA_CERT_PATH`, `SUPABASE_TLS_INSECURE` | supabase | 선택 | TLS 디버깅 |
| `OPENAI_*_MODEL`, `OPENAI_TLS_INSECURE` | openai | 선택 | 모델/네트워크 설정 |

---

## 4) 최근 배포 실패의 구조적 원인 (확정/유력)

1. **Auth 검증 단계 예외가 INTERNAL로 마스킹**
   - 증상: `/api/accounts` 500 + 코드 `INTERNAL_SERVER_ERROR`
   - 로컬 정상/배포 실패 이유: 로컬은 env가 완전하고, 배포는 Supabase auth env 오설정 시 `auth.getUser()`에서 예외 발생 가능
   - 조치: `AUTH_VERIFICATION_FAILED`로 명시 코드 노출되도록 보강

2. **DB 스키마 미적용 가능성 (`accounts.owner_user_id`)**
   - 증상: 계정 생성/조회 500
   - 로컬 정상/배포 실패 이유: 로컬 DB는 최신, 운영 DB는 마이그레이션 누락 가능
   - 조치: schema mismatch 시 명시 오류 `DB_SCHEMA_MISMATCH` 노출

3. **분석 요청 실패 시 UX 고착 체감**
   - 증상: “Analyzing…” 상태 지속
   - 로컬 정상/배포 실패 이유: 운영 네트워크/외부 API 지연에서 timeout 부재
   - 조치: 분석 API 타임아웃 추가 (`8분`)

---

## 5) 반영된 코드 안정화 항목

- 백엔드 env 검증 추가: `backend/src/lib/env-validation.js`
  - placeholder 및 형식 오류 조기 실패
- 인증 예외 가시화: `backend/src/lib/auth.js`
  - 예기치 않은 Supabase auth 검증 실패 → `AUTH_VERIFICATION_FAILED`
- 운영 에러 노출 제어: `backend/src/lib/errors.js`
  - 안전한 범위에서 `exposeMessage` 지원
- 계정 API 스키마 mismatch 감지: `backend/src/lib/accounts.js`
  - `owner_user_id` 누락 등 DB 불일치 시 명시적 메시지 반환
- 프론트 API 진단 강화: `frontend/src/lib/accountApi.js`, `frontend/src/lib/api.js`
  - 코드/requestId 포함 에러 메시지
  - API 타임아웃 지원
- 레퍼런스 분석 타임아웃: `frontend/src/lib/referenceApi.js`

---

## 6) 운영 재검증 루틴 (필수)

1. backend `/api/health` 확인
   - `openaiConfigured`, `supabaseAdminConfigured`가 `true`인지
2. 로그인 → `/analyze` 복귀 확인
3. 계정 추가 클릭
   - 실패 시 alert의 `code`, `requestId` 확인
4. backend 로그에서 동일 `requestId` 검색
5. 영상 업로드 분석
   - 8분 내 성공/실패 상태 전이 확인
6. 결과 카드 렌더링 및 저장/불러오기 확인

---

## 7) 배포 전 체크리스트 (재발 방지)

| 항목 | 확인 |
|---|---|
| `localhost`, `127.0.0.1` 하드코딩 제거 | [ ] |
| 프론트 `VITE_*` env 이름/값 일치 | [ ] |
| 백엔드 필수 env (`SUPABASE_*`, `OPENAI_API_KEY`) 실제값 | [ ] |
| CORS origin에 `https://www.hookai.kr` 포함 | [ ] |
| Supabase Site URL / Redirect URLs 일치 | [ ] |
| Google OAuth callback URI 일치 | [ ] |
| Railway Start Command/Port 일치 | [ ] |
| 운영 DB 마이그레이션 최신 적용 | [ ] |
| Storage/RLS 정책 사용자 흐름 검증 | [ ] |
| 프론트 실패 UI가 무한 로딩에 갇히지 않음 | [ ] |

---

## 8) 다음 액션 (즉시)

1. Railway backend 재배포 (최신 커밋 반영)
2. `/api/accounts` 재호출 후 에러 코드 확인
   - `AUTH_VERIFICATION_FAILED`면 Supabase auth env 문제
   - `DB_SCHEMA_MISMATCH`면 DB migration 적용 문제
3. requestId 기반으로 백엔드 로그 1:1 매핑
4. 분석 기능은 OpenAI key/ffmpeg 실행 로그까지 확인

