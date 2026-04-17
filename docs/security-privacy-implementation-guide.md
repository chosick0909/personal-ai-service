# 보안·개인정보보호 구현 가이드 (프로젝트 적용판)

이 문서는 기능 구현보다 **보안/개인정보보호/규정 준수**를 우선하기 위한 실무 체크리스트다.

## 1) 원칙

- 기본 거부(Default Deny)
- 최소 권한(Least Privilege)
- 안전한 기본값(Secure by Default)
- 개인정보 최소수집/목적제한/보관기간 제한
- Privacy by Design / Privacy by Default
- Fail Closed (검증 실패 시 거부)

## 2) 이 프로젝트의 현재 적용 상태

### 인증/인가
- API 전역 인증 미들웨어 적용 (`/api` 하위 보호)
- 계정 선택 시 `owner_user_id` 기준 서버측 소유권 검증
- `x-account-id`가 전달돼도 소유권 불일치면 접근 거부

### API/전송 보안
- CORS allowlist 기반 허용 (`CLIENT_ORIGINS`)
- 보안 헤더 적용
- JSON body 크기 제한 적용
- 주요 AI/생성 API rate limit 적용

### 업로드 보안
- PDF/Video 파일 타입 allowlist 검증
- 업로드 최대 용량 제한

### 오류/로그
- 운영환경 5xx 상세정보 응답 숨김
- 요청 추적 ID 기반 에러 추적

## 3) 개인정보 체크리스트 (출시 전 필수)

- [ ] 수집 항목 표 작성(항목/목적/근거/보관기간/삭제 정책)
- [ ] 설정 텍스트/대화/분석 데이터의 보관기간 명시
- [ ] 동의/철회/삭제 요청 처리 프로세스 문서화
- [ ] 외부 전송(OpenAI/Sentry/Supabase) 항목과 목적 고지
- [ ] 로그/에러 추적에 개인정보 원문이 남지 않는지 샘플 검수
- [ ] 데이터 다운로드(열람권) 및 삭제(삭제권) 운영 절차 정의

## 4) 보안 체크리스트 (출시 전 필수)

- [ ] `.env` 유출 이력 키 전량 회전 (OpenAI/Supabase service role)
- [ ] 운영에서는 `ENABLE_TEST_ROUTES=false`
- [ ] 운영 `CLIENT_ORIGINS`에 `localhost` 제거
- [ ] Supabase RLS 점검 SQL 실행
  - `supabase/sql/rls_audit_checklist.sql`
- [ ] 관리자 엔드포인트 접근 정책 정의(허용 사용자/사내망/VPN 등)
- [ ] 업로드 파일 악성 샘플 테스트 (MIME 위장, 확장자 위장)
- [ ] 과도 요청/봇 트래픽 대응 임계값 운영 모니터링

## 5) 권장 운영 정책

- 비밀키는 레포/클라이언트에 절대 저장하지 않는다.
- 운영 DB 백업에도 동일한 접근통제를 적용한다.
- 릴리즈마다 보안 회귀 테스트(인증 우회/IDOR/업로드 우회)를 수행한다.
- 사고 대응(탐지, 차단, 보고, 복구) 런북을 별도 문서화한다.

