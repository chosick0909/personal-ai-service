# 직접 지급 이용권의 Creator Studio 접근 복구

## 원인과 범위
2026-10-20 사용자는 오류 계정이 쿠폰 ID 없이 직접 지급된 무제한 이용권임을 확인했고, 동일하게 인정하도록 직접 승인했다. 운영 Supabase 로그인은 Google 본인 인증 단계에서 중단됐으며 운영 데이터 조회/변경은 하지 않았다.

스튜디오 게이트는 coupon_id가 있는 지급 내역만 허용했고, 기존 entitlement 체계의 직접 지급 paid 이용권을 배제했다. 기존 무제한 지급 migration은 coupon_id=null, plan_type=paid, status=active, ends_at=null을 사용한다. 특정 이메일 예외는 추가하지 않는다.

수정: 본인 소유의 active 이용권 중 시작 시각이 지났고 아직 만료되지 않은 coupon-linked 또는 paid 지급을 인정한다. 직접 지급 paid의 유효기간이 있으면 같은 만료 조건 적용. coupon_id 없는 open_beta/student/challenge 지급은 무료 접근 우회로 사용하지 않는다. 기존 DB 데이터/제한/사용량/모델 변경 없음.

## 검증
`node --experimental-test-module-mocks --test backend/test/creator-coupon-access.test.js`: 11/11 통과.
- 무기한/기간제 직접 지급 paid 허용
- 만료, 취소, 시작 전, 다른 소유자, 잘못된 날짜 거부
- 쿠폰 없는 다른 플랜 차단
- 기존 유효 쿠폰·조회 장애·기능 경로·기존 /api 비간섭 회귀 유지

이는 통제된 DB 응답을 사용하는 실제 HTTP 라우트 테스트이다. 해당 운영 사용자 로그인 E2E는 배포 후 별도 확인하며, 수행하지 않은 결과를 통과로 쓰지 않는다.

## 분리
최근 내역 구현은 미커밋 상태로 보존한다. tool_history 테이블은 미적용이며 이 접근 복구 커밋에 포함하지 않는다. Claude 메인페이지 디자인 66f7c22를 기반으로 일반 fast-forward 배포한다.
