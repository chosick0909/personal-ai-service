import { setPostAuthRedirectPath } from '../lib/authRedirect'
import { useAppState } from '../store/AppState'

const FONT = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'

const heroPill = {
  margin: 0,
  padding: '12px 22px',
  borderRadius: 14,
  fontSize: 'clamp(18px, 2vw, 24px)',
  fontWeight: 900,
  letterSpacing: '-0.03em',
  color: '#FFFFFF',
  boxShadow: '0 14px 30px rgba(60,20,160,0.45)',
}

const primaryButton = {
  height: 62,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 14,
  background: 'linear-gradient(90deg, #8D5CFF 0%, #6A2BF5 100%)',
  color: '#FFFFFF',
  fontSize: 19,
  fontWeight: 800,
}

const whiteButton = {
  height: 62,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 14,
  background: '#FFFFFF',
  color: '#3F088C',
  fontSize: 19,
  fontWeight: 800,
}

const painBubble = {
  maxWidth: 520,
  padding: '20px 26px',
  borderRadius: 18,
  background: '#24232B',
  border: '1px solid #34323D',
  fontSize: 18,
  fontWeight: 600,
  textAlign: 'left',
  color: '#E6E3EF',
}

const accent = { color: '#B9A2FF', fontWeight: 800 }

const FEATURES = [
  ['01', '왜 터졌는지 한눈에', '훅·구조·시청 심리를 레퍼런스 문장마다 분석'],
  ['02', '바로 찍는 대본 3개', '원본형·대화형·후킹형 중 마음에 드는 걸 골라요'],
  ['03', '말로 고치는 코파일럿', '"훅만 더 세게" 한마디면 바뀐 부분만 보여줘요'],
  ['04', '레퍼런스 없이도 기획', '주제만 적어도 세 가지 방향의 대본이 나와요'],
]

const STEPS = [
  ['레퍼런스 넣기', '릴스 영상을 올리거나 대본을 붙여넣기만 하세요'],
  ['분석 확인하기', '훅·구조·심리, 잘 된 이유를 먼저 보여드려요'],
  ['골라서 다듬기', 'A/B/C 중 고르고, 코파일럿에게 말로 수정 요청'],
]

const STUDIO_PILLS = [
  ['계정 추천', '#8A5BFF', -4],
  ['링크 분석', '#6A2BF5', 3],
  ['자막·컷편집', '#5A1FE0', -3],
  ['영상 피드백', '#3F088C', 4],
]

const STUDIO_ICONS = {
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
      <path d="M18.5 13.9c1.8.9 3 2.9 3 5.1" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M8.6 7.6 20 18" />
      <path d="M8.6 16.4 20 6" />
    </>
  ),
  chat: (
    <>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="m8.5 10.5 2.5 2.5 4.5-4.5" />
    </>
  ),
}

const STUDIO_FEATURES = [
  ['users', '비슷한 계정 추천', '내 주제와 닮은 계정을 추천 이유와 함께'],
  ['link', '링크로 후킹 분석', '해외 영상도 원문·한국어 해석과 잘 된 이유까지'],
  ['scissors', '자막·컷편집', '자동 자막에, 지울 구간은 미리 보고 확정'],
  ['chat', '영상·캡션 피드백', '올리기 전에 고칠 곳을 구간별로 짚어줘요'],
]

export default function LandingScreen() {
  const { isLoggedIn, logout } = useAppState()
  const startHref = isLoggedIn ? '/analyze' : '/login'

  return (
    <main
      className="min-h-screen overflow-hidden [&_a]:no-underline [&_a]:transition-opacity [&_a:hover]:opacity-90"
      style={{ background: '#16161B', color: '#FFFFFF', fontFamily: FONT, wordBreak: 'keep-all' }}
    >
      <header className="relative z-[3] mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-4 px-6 py-[22px]">
        <a href="/" aria-label="HookAI 홈" style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.04em', color: '#FFFFFF' }}>
          Hook<span style={{ color: '#9B7BFF' }}>AI</span>
        </a>
        <nav
          aria-label="주요 메뉴"
          className="order-3 flex w-full justify-center gap-7 sm:order-none sm:w-auto"
          style={{ fontSize: 15, fontWeight: 600 }}
        >
          <a href="/analyze" style={{ color: '#C9C6D6' }}>대본작업실</a>
          <a href="/creatorstudio" style={{ color: '#C9C6D6' }}>크리에이터스튜디오</a>
        </nav>
        {isLoggedIn ? (
          <button
            type="button"
            className="cursor-pointer border-0 transition-opacity hover:opacity-90"
            style={{ height: 40, padding: '0 20px', borderRadius: 10, background: '#7A4DFF', color: '#FFFFFF', fontSize: 14, fontWeight: 700, fontFamily: FONT }}
            onClick={async () => {
              try {
                await logout()
                window.location.assign('/')
              } catch (error) {
                window.alert(error.message || '로그아웃에 실패했습니다.')
              }
            }}
          >
            로그아웃
          </button>
        ) : (
          <a
            href="/login"
            style={{ height: 40, padding: '0 20px', display: 'inline-flex', alignItems: 'center', borderRadius: 10, background: '#7A4DFF', color: '#FFFFFF', fontSize: 14, fontWeight: 700 }}
          >
            로그인
          </a>
        )}
      </header>

      <section
        className="relative px-6 pb-[120px] pt-10 text-center"
        style={{ background: 'linear-gradient(180deg, #16161B 0%, #1B1530 45%, #3A1A8C 100%)' }}
      >
        <p
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[10px] m-0 -translate-x-1/2 whitespace-nowrap"
          style={{ fontSize: 'clamp(140px, 24vw, 340px)', fontWeight: 900, letterSpacing: '-0.06em', lineHeight: 1, color: 'rgba(155,123,255,0.07)' }}
        >
          HOOK
        </p>
        <div className="relative mx-auto flex max-w-[900px] flex-col items-center">
          <div className="mt-9 flex flex-wrap justify-center gap-[14px]">
            <p style={{ ...heroPill, background: '#7A4DFF', transform: 'rotate(-4deg)' }}>레퍼런스 분석</p>
            <p style={{ ...heroPill, background: '#5B2BE0', transform: 'rotate(3deg) translateY(10px)' }}>A/B/C 대본</p>
            <p style={{ ...heroPill, background: '#4A1FB8', transform: 'rotate(-2deg)' }}>채팅으로 수정</p>
          </div>
          <h1 style={{ margin: '56px 0 0', fontSize: 'clamp(40px, 6.6vw, 88px)', lineHeight: 1.14, fontWeight: 900, letterSpacing: '-0.05em', color: '#FFFFFF' }}>
            잘 된 릴스 하나로
            <br />
            <span
              style={{
                background: 'linear-gradient(90deg, #B9A2FF 0%, #8C63FF 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              내 대본
            </span>
            까지 완성!
          </h1>
          <p style={{ margin: '28px 0 0', fontSize: 'clamp(17px, 1.7vw, 21px)', lineHeight: 1.7, color: '#CFC8E8' }}>
            레퍼런스를 넣으면 왜 터졌는지 분석하고,
            <br />
            바로 찍을 수 있는 대본 3개를 만들어 드려요.
          </p>
          <div className="mt-10 flex w-full max-w-[420px] flex-col gap-3">
            <a href={startHref} style={{ ...primaryButton, boxShadow: '0 18px 40px rgba(106,43,245,0.45)' }}>
              무료로 대본 만들기
            </a>
            <a href="/recommend" style={whiteButton}>
              내 콘텐츠 방향 추천받기
            </a>
          </div>
          <p style={{ margin: '18px 0 0', fontSize: 14, color: '#A99FC9' }}>
            신용카드 없이 무료로 시작 ·{' '}
            <a
              href="/purchase"
              onClick={() => setPostAuthRedirectPath('/purchase')}
              style={{ color: '#E5D8FF', textDecoration: 'underline', textUnderlineOffset: 4 }}
            >
              쿠폰 등록하기
            </a>
          </p>

          <div className="relative mt-[72px] flex w-full max-w-[760px] flex-col sm:block">
            <div
              className="relative z-10 -mb-5 self-start sm:absolute sm:left-0 sm:top-[70px] sm:mb-0"
              style={{ padding: '14px 18px', borderRadius: 16, background: '#FFFFFF', color: '#2B1A55', textAlign: 'left', transform: 'rotate(-5deg)', boxShadow: '0 20px 40px rgba(20,0,60,0.45)' }}
            >
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#7A4DFF' }}>레퍼런스 분석</p>
              <p style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 800 }}>훅: 자주 받는 질문으로 공감</p>
            </div>
            <div
              className="mx-auto"
              style={{ width: 'min(100%, 360px)', borderRadius: 40, background: '#0F0E14', border: '1px solid #3B3360', padding: 14, boxShadow: '0 40px 100px rgba(10,0,40,0.7)' }}
            >
              <div className="flex flex-col gap-3 text-left" style={{ borderRadius: 28, background: '#17151F', padding: '22px 18px' }}>
                <div className="flex items-center justify-between">
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#FFFFFF' }}>
                    C안 <span style={{ color: '#9C93B8', fontWeight: 600 }}>후킹형</span>
                  </p>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#B9A2FF' }}>60초</p>
                </div>
                <div style={{ borderRadius: 12, background: '#2A1640', padding: '12px 14px' }}>
                  <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: '#F2A7C3' }}>HOOK</p>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, fontWeight: 600, color: '#FFFFFF' }}>
                    거울 봤을 때 '번들'만 보이면, 토너에서 이미 끝난 거예요.
                  </p>
                </div>
                <div style={{ borderRadius: 12, background: '#1E1B33', padding: '12px 14px' }}>
                  <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: '#A9B8FF' }}>BODY</p>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: '#D5D0E6' }}>
                    세안 직후, 얇게 세 번. 광은 많이 바른 게 아니라 잘 쌓은 결과예요.
                  </p>
                </div>
                <div style={{ borderRadius: 12, background: '#182624', padding: '12px 14px' }}>
                  <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: '#9FE0C2' }}>CTA</p>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: '#D5D0E6' }}>저장해두고 내일 아침에 바로 해보세요.</p>
                </div>
              </div>
            </div>
            <div
              className="relative z-10 -mt-5 self-end sm:absolute sm:bottom-[60px] sm:right-0 sm:mt-0"
              style={{ padding: '14px 18px', borderRadius: 16, background: '#7A4DFF', color: '#FFFFFF', textAlign: 'left', transform: 'rotate(4deg)', boxShadow: '0 20px 40px rgba(20,0,60,0.45)' }}
            >
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#E5D8FF' }}>코파일럿</p>
              <p style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 800 }}>"훅만 더 짧게 해줘"</p>
            </div>
          </div>
        </div>
      </section>

      <section
        className="relative px-6 pb-[140px] pt-[120px] text-center"
        style={{ background: 'linear-gradient(180deg, #16161B 0%, #16161B 40%, #2B1764 100%)' }}
      >
        <div className="mx-auto flex max-w-[640px] flex-col gap-[22px]">
          <div className="self-start" style={painBubble}>
            잘 된 릴스는 많이 봤는데, <span style={accent}>내 걸로 못 바꾸겠어요</span>
          </div>
          <div className="self-end" style={painBubble}>
            <span style={accent}>대본 한 편</span> 쓰는 데 하루가 걸려요
          </div>
          <div className="self-start" style={painBubble}>
            첫 3초에 <span style={accent}>뭘 말해야 할지</span> 모르겠어요
          </div>
          <p style={{ margin: '18px 0 0', fontSize: 17, fontWeight: 600, color: '#B9A2FF' }}>크리에이터들의 똑같은 고민</p>
          <div
            aria-hidden="true"
            style={{ margin: '8px auto 0', width: 2, height: 120, background: 'linear-gradient(180deg, rgba(185,162,255,0) 0%, #B9A2FF 100%)' }}
          />
          <div aria-hidden="true" style={{ margin: '-4px auto 0', width: 12, height: 12, borderRadius: 999, background: '#B9A2FF' }} />
          <p style={{ margin: '48px 0 0', fontSize: 18, fontWeight: 600, color: '#D9D3FF' }}>그 고민을 해결한</p>
          <h2 style={{ margin: '4px 0 0', fontSize: 'clamp(36px, 4.6vw, 56px)', fontWeight: 900, letterSpacing: '-0.045em', color: '#FFFFFF' }}>
            <span style={{ color: '#9B7BFF' }}>훅AI</span>의 특장점
          </h2>
        </div>
        <div className="mx-auto mt-14 flex max-w-[760px] flex-col gap-4">
          {FEATURES.map(([num, title, desc], index) => (
            <div
              key={num}
              className="relative overflow-hidden"
              style={{ padding: '34px 28px', borderRadius: 20, background: 'rgba(58,30,130,0.55)', border: '1px solid rgba(185,162,255,0.16)' }}
            >
              <p
                aria-hidden="true"
                className="absolute m-0"
                style={{ [index % 2 ? 'right' : 'left']: 24, top: -6, fontSize: 96, fontWeight: 900, color: 'rgba(185,162,255,0.08)', letterSpacing: '-0.05em' }}
              >
                {num}
              </p>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#B9A2FF' }}>{num}</p>
              <h3 style={{ margin: '8px 0 0', fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', color: '#FFFFFF' }}>{title}</h3>
              <p style={{ margin: '10px 0 0', fontSize: 17, color: '#C9C2E2' }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section
        className="relative px-6 pb-[130px] pt-[120px] text-center"
        style={{ background: 'linear-gradient(180deg, #8A5BFF 0%, #6A2BF5 55%, #5A1FE0 100%)' }}
      >
        <p
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[-20px] m-0 -translate-x-1/2 whitespace-nowrap"
          style={{ fontSize: 'clamp(160px, 26vw, 360px)', fontWeight: 900, lineHeight: 1, letterSpacing: '-0.05em', color: 'rgba(255,255,255,0.09)' }}
        >
          HOW
        </p>
        <div className="relative mx-auto max-w-[760px]">
          <h2 style={{ margin: 0, fontSize: 'clamp(34px, 4.4vw, 54px)', fontWeight: 900, letterSpacing: '-0.045em', lineHeight: 1.2, color: '#FFFFFF' }}>
            넣고, 고르고, 다듬으면 끝
          </h2>
          <div className="mt-14 flex flex-col gap-10 sm:gap-[22px]">
            {STEPS.map(([title, desc], index) => (
              <div
                key={title}
                className="relative px-7 pb-[34px] pt-[42px] sm:py-[34px] sm:pl-[72px]"
                style={{ borderRadius: 20, background: '#F1ECFF', color: '#1E1B2E' }}
              >
                <p
                  className="absolute left-1/2 top-0 m-0 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center sm:left-[-20px] sm:top-1/2 sm:translate-x-0"
                  style={{ width: 48, height: 48, borderRadius: 999, background: '#3F088C', color: '#FFFFFF', fontSize: 22, fontWeight: 900 }}
                >
                  {index + 1}
                </p>
                <h3 style={{ margin: 0, fontSize: 'clamp(26px, 3vw, 34px)', fontWeight: 900, letterSpacing: '-0.04em' }}>{title}</h3>
                <p style={{ margin: '10px 0 0', fontSize: 17, color: '#5A5670' }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        className="relative px-6 pb-[120px] pt-[130px] text-center"
        style={{ background: 'linear-gradient(180deg, #FFFFFF 0%, #F3EEFF 55%, #DCCFFF 100%)', color: '#1E1B2E' }}
      >
        <div className="mx-auto max-w-[900px]">
          <div className="flex flex-wrap justify-center gap-3">
            {STUDIO_PILLS.map(([label, color, deg]) => (
              <p
                key={label}
                style={{ margin: 0, padding: '10px 18px', borderRadius: 12, background: color, color: '#FFFFFF', fontSize: 18, fontWeight: 900, transform: `rotate(${deg}deg)` }}
              >
                {label}
              </p>
            ))}
          </div>
          <p style={{ margin: '56px 0 0', fontSize: 20, fontWeight: 700, color: '#3A3550' }}>찍기 전부터 올리기 전까지</p>
          <div
            className="mt-[14px] inline-block px-5 py-4 sm:px-[34px] sm:py-[18px]"
            style={{ borderRadius: 18, background: '#FFFFFF', boxShadow: '0 18px 40px rgba(90,40,200,0.18)' }}
          >
            <h2 style={{ margin: 0, fontSize: 'clamp(24px, 6.2vw, 48px)', fontWeight: 900, letterSpacing: '-0.045em' }}>
              크리에이터스튜디오 <span style={{ color: '#6A2BF5' }}>오픈!</span>
            </h2>
          </div>
          <div className="mt-14 flex flex-wrap gap-4 text-left">
            {STUDIO_FEATURES.map(([icon, title, desc]) => (
              <div
                key={title}
                className="flex min-w-0 items-start gap-5"
                style={{ flex: '1 1 360px', padding: 28, borderRadius: 20, background: '#FFFFFF', boxShadow: '0 10px 30px rgba(90,40,200,0.10)' }}
              >
                <div className="flex flex-none items-center justify-center" style={{ width: 56, height: 56, borderRadius: 16, background: '#EFE8FF' }}>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    width="28"
                    height="28"
                    fill="none"
                    stroke="#6A2BF5"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {STUDIO_ICONS[icon]}
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 style={{ margin: 0, fontSize: 21, fontWeight: 800 }}>{title}</h3>
                  <p style={{ margin: '10px 0 0', fontSize: 16, lineHeight: 1.6, color: '#5A5670' }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        className="px-6 py-[120px] text-center"
        style={{ background: 'linear-gradient(180deg, #DCCFFF 0%, #B49BFF 100%)', color: '#1E1B2E' }}
      >
        <div className="mx-auto flex max-w-[560px] flex-col items-center">
          <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#3A3550' }}>릴스 하나 넣으면, 오늘 찍을 대본 3개 완성</p>
          <div className="mt-[14px]" style={{ padding: '18px 30px', borderRadius: 18, background: '#FFFFFF', boxShadow: '0 18px 40px rgba(90,40,200,0.2)' }}>
            <h2 style={{ margin: 0, fontSize: 'clamp(30px, 4vw, 46px)', fontWeight: 900, letterSpacing: '-0.045em' }}>
              숏폼 대본 플랫폼 <span style={{ color: '#6A2BF5' }}>훅AI!</span>
            </h2>
          </div>
          <div className="mt-12 flex w-full flex-col gap-3">
            <a href="/recommend" style={whiteButton}>
              내 콘텐츠 방향 추천받기
            </a>
            <a href={startHref} style={{ ...primaryButton, boxShadow: '0 18px 40px rgba(106,43,245,0.35)' }}>
              무료로 대본 만들기
            </a>
          </div>
        </div>
      </section>

      <footer style={{ background: '#16161B', color: '#8F8BA3' }}>
        <div className="mx-auto flex max-w-[1120px] flex-wrap justify-between gap-4 px-6 py-8" style={{ fontSize: 13 }}>
          <span style={{ fontSize: 16, fontWeight: 900, color: '#E6E3EF' }}>
            Hook<span style={{ color: '#9B7BFF' }}>AI</span>
          </span>
          <span>© 2026 HookAI</span>
        </div>
      </footer>
    </main>
  )
}
