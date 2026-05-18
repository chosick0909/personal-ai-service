import { setPostAuthRedirectPath } from '../lib/authRedirect'
import { useAppState } from '../store/AppState'

export default function LandingScreen() {
  const { isLoggedIn, currentUser, logout } = useAppState()

  return (
    <main
      className="relative min-h-screen overflow-hidden bg-[#0D0F14] text-[#F3F4F6]"
      style={{
        fontFamily: 'Matter, Inter, Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
        backgroundImage:
          'radial-gradient(ellipse 76% 64% at 14% 10%, rgba(250,249,246,0.10) 0%, rgba(250,249,246,0.045) 28%, rgba(250,249,246,0) 62%), radial-gradient(ellipse 62% 54% at 88% 86%, rgba(148,163,184,0.09) 0%, rgba(148,163,184,0.035) 32%, rgba(148,163,184,0) 66%), linear-gradient(180deg, #141820 0%, #0D1118 48%, #11151D 100%)',
      }}
    >
      {isLoggedIn ? (
        <div className="absolute right-6 top-6 z-20 flex items-center gap-3">
          <div className="hidden max-w-[220px] truncate text-sm text-[#AEB6C5] md:block">
            {currentUser?.email || '로그인됨'}
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                await logout()
                window.location.assign('/')
              } catch (error) {
                window.alert(error.message || '로그아웃에 실패했습니다.')
              }
            }}
            className="rounded-full border border-[#3A414F] bg-[#111827] px-3 py-1.5 text-xs font-semibold text-[#E5E7EB] transition hover:bg-[#1F2937]"
          >
            로그아웃
          </button>
        </div>
      ) : null}

      <div className="relative z-10 flex min-h-screen items-center justify-center px-5 py-16">
        <section className="relative flex min-h-[620px] w-full flex-col items-center justify-center px-6 py-16 text-center md:px-12">
          <div className="relative z-10">
            <div className="inline-flex h-10 items-center justify-center rounded-full border border-[#4B5563] bg-[#111827]/70 px-6 text-sm font-semibold text-[#D1D5DB] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] md:h-12 md:text-base">
              베타서비스
            </div>
            <h1 className="mt-10 text-[38px] font-black leading-[1.18] tracking-[-0.04em] text-[#F8FAFC] md:text-[66px] lg:text-[86px]">
              검증 가능한 기준으로
              <br />
              숏폼 기획을 표준화하세요
            </h1>
            <p className="mx-auto mt-8 max-w-[720px] text-base font-medium leading-8 text-[#9CA3AF] md:text-[22px] md:leading-[1.7]">
              레퍼런스 분석, 초안 생성, 에디팅, 피드백까지
              <br className="hidden md:block" />
              한 플로우에서 운영 가능한 콘텐츠 제작 워크스테이션입니다.
            </p>

            <div className="mt-12 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="/recommend"
                className="btn-solid-contrast inline-flex h-[58px] min-w-[270px] items-center justify-center gap-3 rounded-full px-8 text-lg font-bold shadow-[0_18px_42px_rgba(0,0,0,0.38)] transition hover:bg-white"
              >
                <span>내 콘텐츠 방향 추천받기</span>
                <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
                  <path
                    d="M6.67 3.33 13.34 10l-6.67 6.67"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
              <a
                href={isLoggedIn ? '/analyze' : '/login'}
                className="inline-flex h-[58px] min-w-[220px] items-center justify-center rounded-full border border-[#4B5563] bg-[#111827]/82 px-8 text-lg font-bold !text-[#F8FAFC] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:bg-[#1F2937]"
              >
                바로 시작하기
              </a>
            </div>
            <p className="mt-6 text-sm font-medium text-[#9CA3AF]">
              Free trial · 신용카드 없이 시작
              <span className="mx-2 text-[#4B5563]">·</span>
              <a
                href="/purchase"
                onClick={() => setPostAuthRedirectPath('/purchase')}
                className="font-semibold text-[#E5E7EB] underline-offset-4 transition hover:text-white hover:underline"
              >
                쿠폰 등록하기
              </a>
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
