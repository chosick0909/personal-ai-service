# Creator Studio 계정 인사이트 즉시 조회 (2026-09-23)

사용자 요청: 검수 중이더라도 기존 품질 기준을 통과한 후보를 서비스 결과에 포함한다. 승인/미승인 표시는 내부 검수 자료에만 남긴다. 무료 사용자 권한 변경은 다른 작업이며 이번 범위에 포함하지 않는다.

원인: 운영 카탈로그에는 살림 44개만 있었고, 육아 등 미반영 카테고리는 라이브 검색으로 전환되어 단일 discovery worker에서 대기했다. 제보 조건 요청은 434초 후 빈 결과였고, 뒤의 살림 요청도 126~257초 대기했다.

수정: 계정 인사이트 요청/조회/재시도는 카탈로그만 즉시 조회하며 기존 작업 소유권·사용량·멱등성 처리를 유지한다. worker 복구 경로도 카탈로그만 사용한다. 유료 검색, AI 심사, Redis 대기를 사용자 요청 경로에서 제거했다. 수집 스크립트의 기존 discovery 기본 동작은 유지한다.

검수 중 후보는 reviewedByOperator=false를 유지하고 별도의 candidatePublication 명시적 공개 허가 기록을 저장했다. 품질 필터·국내 여부·최근 릴스 중앙값·50만 조회·팔로워·30일 유효기간은 유지한다. 응답에는 검수 상태나 공개 허가 기록을 넣지 않는다.

운영 반영: 기존 44개 무수정 보존, 신규 113개 추가, 총 157개. 원본 백업과 반영 자료는 격리 저장소 output/loading-fix에 보관했다. 일부 원자료의 잘린 이모지에 해당하는 잘못된 Unicode surrogate를 대체 문자로 정리한 뒤 저장했다.

검증: backend 관련 91개 테스트 통과. 육아/가족·얼굴 일부·5~10만·한국어 조건으로 동일 배포 코드에서 운영 DB를 읽었을 때 5개, 732ms. 화면 전체 왕복 시간은 측정하지 않았다. 결과에 내부 검수 필드 없음 확인. 유료 API 호출 없음.

배포:
- backend d50be87e-33c5-4b69-b49e-42853ecd86c7 SUCCESS
- creator-discovery 90899a0e-c93c-400d-aeb2-3eafe35bedb4 SUCCESS
- frontend/media/다른 기능 및 환경변수는 변경하지 않음.

격리 저장소: /Users/seojiyeong/.local/hookai-creatorstudio-loading-20260923
기반: codex/reference-accounts-quality cf22bf87 / 작업 브랜치 codex/creator-insights-loading
원본 작업 저장소의 미커밋 파일은 수정하지 않음.
