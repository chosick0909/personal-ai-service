# 계정 추천 릴스 링크 수정 — 2026-09-28

제보: hello._.mom89의 50만+ 조회 콘텐츠를 누르면 다른 계정 영상이 표시됨.

재현: 운영 카탈로그와 9/20 수집 원자료 모두 C4u94F7vq0l, 6,496,413회, 게시자 hello._.mom89를 가리킨다. 실제 브라우저에서 /reel/C4u94F7vq0l/를 열면 /reels/로 전환된 뒤 /reels/Ddv5YtytTPZ/의 다른 계정으로 넘어갔다. 같은 shortcode의 /p/C4u94F7vq0l/는 해당 계정과 “엄마가 누웠을 때 vs 아빠가 누웠을 때” 영상을 정확히 표시했다. 제보 사례는 수집 계정 혼합이 아니라 Instagram 릴스 뷰어의 자동 이동으로 재현됨.

수정: AccountResults의 50만+ 조회 콘텐츠 및 공개 콘텐츠 링크만 /p/{동일 shortcode}/ 상세 링크로 출력한다. 계정 프로필 링크·링크 분석 입력·수집 URL·DB 원본·다른 기능은 변경하지 않는다. 기존 작업 결과도 렌더링 시 동일하게 처리한다. 악성 호스트/프로토콜/인증정보/잘못된 경로를 거부한다.

검증: 회귀 테스트 3개 통과, frontend build 통과(기존 번들 크기 경고). 운영 157개 자료에서 50만+ 링크 중복 및 저장된 owner 불일치 0. 이는 저장 자료 감사이며 157개 Instagram 영상을 전부 실시간 재검증한 것은 아님. 제보 영상은 실제 Instagram 상세 페이지의 계정·내용 확인. 유료 API 호출 없음.

작업 위치: /Users/seojiyeong/.local/hookai-creatorstudio-loading-20260923
원본 저장소 미커밋 변경과 이전 9/23 즉시조회 변경은 보존.

운영 배포 완료: frontend 93667f3c-09d6-485e-b71a-8bddeb855d28 SUCCESS. www.hookai.kr이 제공하는 CreatorTools-CYNjjReC.js에서 /p/{shortcode}/ 변환 함수 반영 확인. 157개 계정의 콘텐츠 링크 2,041개 모두 기존 shortcode 유지 검증. 로그인된 훅AI 결과 화면에서 클릭하는 전체 흐름은 이번에 재실행하지 못했으며, 제보 Instagram 원본의 상세 링크는 브라우저에서 직접 검증했다. 백엔드 및 운영 DB 수정 없음.
