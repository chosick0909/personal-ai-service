# 직접 지급 이용권의 Creator Studio 접근 복구

## 원인과 범위
2026-10-20 사용자는 오류 계정이 쿠폰 ID 없이 직접 지급된 무제한 이용권임을 확인했고, 동일하게 인정하도록 직접 승인했다. 운영 Supabase 로그인은 처음 Google 본인 인증 단계에서 중단됐다. 이후 지정 Chrome에서 인증된 SQL Editor를 확인했으나 운영 이용권 쿼리 결과는 확보하지 못했다. 운영 이용권 데이터는 변경하지 않았다.

스튜디오 게이트는 coupon_id가 있는 지급 내역만 허용했고, 기존 entitlement 체계의 직접 지급 paid 이용권을 배제했다. 기존 무제한 지급 migration은 coupon_id=null, plan_type=paid, status=active, ends_at=null을 사용한다. 특정 이메일 예외는 추가하지 않는다.

수정: 본인 소유의 active 이용권 중 시작 시각이 지났고 아직 만료되지 않은 coupon-linked 또는 paid 지급을 인정한다. 직접 지급 paid의 유효기간이 있으면 같은 만료 조건 적용. coupon_id 없는 open_beta/student/challenge 지급은 무료 접근 우회로 사용하지 않는다. 기존 DB 데이터/제한/사용량/모델 변경 없음.

## 검증
`node --experimental-test-module-mocks --test backend/test/creator-coupon-access.test.js`: 11/11 통과.
- 무기한/기간제 직접 지급 paid 허용
- 만료, 취소, 시작 전, 다른 소유자, 잘못된 날짜 거부
- 쿠폰 없는 다른 플랜 차단
- 기존 유효 쿠폰·조회 장애·기능 경로·기존 /api 비간섭 회귀 유지

이는 통제된 DB 응답을 사용하는 실제 HTTP 라우트 테스트이다. 배포 후 기존에 로그인된 HookAI Chrome에서 /creatorstudio 진입을 확인했다. 쿠폰 차단 화면 대신 작업 계정과 스튜디오 도구 화면이 표시됐다. 세션 이메일 자체는 이번 화면에서 별도로 조회하지 않았으며, 유료 생성 검증은 실행하지 않았다.

## 분리
최근 내역 구현은 별도 기능 브랜치 codex/tool-history-20261020의 6552a3d로 보존했다. tool_history 테이블은 미적용이며 이 접근 복구 커밋에 포함하지 않는다. Claude 메인페이지 디자인 66f7c22를 기반으로 일반 fast-forward 배포한다.

## 운영 배포 확인
접근 복구 커밋: ac428ecac15ea6927b1d9b079342e2883ced8ec0. backend a199fd28-e1a1-4089-99dc-619ea6a2a53a, creator-discovery bbfec651-b093-447b-9784-cf02c959b8b6, creator-media 2587344e-1a73-4745-8053-e88334f6876c 모두 SUCCESS 확인(2026-10-20 15:08 KST). frontend는 변경 없음으로 SKIPPED. 이후 Claude의 ae49057 메인페이지 변경은 별도로 유지한다.

추가 운영 읽기 확인: 지정 Chrome에서 해당 계정의 활성 지급1건, 쿠폰 연결0건, 직접 paid 지급1건을 집계 확인했다. 이메일·UUID 원문은 보고서에 기록하지 않았다.
