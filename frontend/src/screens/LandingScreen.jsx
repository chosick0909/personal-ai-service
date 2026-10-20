import { setPostAuthRedirectPath } from '../lib/authRedirect'
import { useAppState } from '../store/AppState'

const FONT = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'

const ICON_PATHS = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
      <path d="M8.5 11h5M11 8.5v5" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  chat: (
    <>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8.5 9.5h7M8.5 12.5h4" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />
    </>
  ),
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
  review: (
    <>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="m8.5 10.5 2.5 2.5 4.5-4.5" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  cross: <path d="M7 7l10 10M17 7 7 17" />,
}

function Icon({ name, size = 24, color = 'currentColor', strokeWidth = 2 }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none"
    >
      {ICON_PATHS[name]}
    </svg>
  )
}

const BEFORE = [
  ['잘 된 영상을 봐도 뭐가 먹힌 건지 모르겠어요', -2],
  ['대본 한 편 쓰는 데 하루가 걸려요', 1.5],
  ['첫 3초에 뭘 말할지 막막해요', -1],
]

const AFTER = ['왜 터졌는지 문장마다 짚어줘요', '바로 찍을 대본 3개가 한 번에 나와요', '터진 공식으로 내 이야기를 새로 써요']

const FEATURES = [
  ['layers', '바로 찍는 대본 3개', '방향이 다른 세 가지 안 중 마음에 드는 걸 골라요.'],
  ['chat', '채팅으로 고치는 코파일럿', '"훅만 더 세게" 한마디면 바뀐 부분만 보여줘요.'],
  ['bulb', '주제만 있어도 기획', '주제만 적어도 세 가지 방향의 대본이 나와요.'],
]

const FORMULA = [
  ['0~3초', '훅', '"하지 마세요"로 멈춰 세우기'],
  ['3~15초', '공감', '나도 그랬던 순간 꺼내기'],
  ['15~25초', '반전', '의외의 이유 하나'],
  ['마지막', 'CTA', '저장할 이유 주기'],
]

const STEPS = [
  ['영상 넣기', '눈여겨본 릴스 영상이나 대본을 올리기만 하세요.'],
  ['공식 확인하기', '훅·구조·심리, 터진 이유를 공식으로 보여드려요.'],
  ['골라서 다듬기', 'A/B/C 중 고르고, 채팅으로 수정을 요청하세요.'],
]

const STUDIO_FEATURES = [
  ['users', '비슷한 계정 추천', '내 주제와 닮은 계정을 추천 이유와 함께'],
  ['link', '링크로 후킹 분석', '해외 영상도 원문·한국어 해석과 잘 된 이유까지'],
  ['scissors', '자막·컷편집', '자동 자막에, 지울 구간은 미리 보고 확정'],
  ['review', '영상·캡션 피드백', '올리기 전에 고칠 곳을 구간별로 짚어줘요'],
]

const STUDIO_STICKERS = [
  ['계정 추천', '#8A5BFF', -3],
  ['링크 분석', '#FFFFFF', 4],
  ['자막·컷편집', '#5A1FE0', -3],
  ['영상 피드백', '#E5D8FF', 3],
]

const HERO_POINTS = ['히트 공식 분석', 'A/B/C 대본 3개', '채팅으로 수정']

function Eyebrow({ children, light }) {
  return (
    <p
      className="m-0 text-[13px] font-extrabold uppercase tracking-[0.16em]"
      style={{ color: light ? '#6A2BF5' : '#A98BFF' }}
    >
      {children}
    </p>
  )
}

export default function LandingScreen() {
  const { isLoggedIn, logout } = useAppState()
  const startHref = isLoggedIn ? '/analyze' : '/login'

  return (
    <main
      className="min-h-screen overflow-hidden [&_a]:no-underline [&_a]:transition [&_a:hover]:opacity-90"
      style={{ background: '#111017', color: '#FFFFFF', fontFamily: FONT, wordBreak: 'keep-all' }}
    >
      <div
        style={{
          background:
            'radial-gradient(52% 60% at 82% 40%, rgba(122,77,255,0.38) 0%, rgba(122,77,255,0) 70%), linear-gradient(180deg, #111017 0%, #15122A 55%, #2E1677 100%)',
        }}
      >
        <header className="relative z-[3] mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-4 px-6 py-[22px]">
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
              className="cursor-pointer transition hover:bg-white/10"
              style={{ height: 40, padding: '0 18px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.28)', background: 'transparent', color: '#FFFFFF', fontSize: 14, fontWeight: 700, fontFamily: FONT }}
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
              style={{ height: 40, padding: '0 18px', display: 'inline-flex', alignItems: 'center', borderRadius: 999, background: '#7A4DFF', color: '#FFFFFF', fontSize: 14, fontWeight: 700 }}
            >
              로그인
            </a>
          )}
        </header>

        <section className="mx-auto grid max-w-[1160px] items-center gap-16 px-6 pb-28 pt-10 md:pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:pb-36">
          <div className="text-center lg:text-left">
            <p
              className="m-0 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-bold"
              style={{ border: '1px solid rgba(122,77,255,0.5)', background: 'rgba(122,77,255,0.14)', color: '#CBB9FF' }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#9B7BFF' }} />
              성공 기획 AI 플랫폼
            </p>
            <h1 style={{ margin: '24px 0 0', fontSize: 'clamp(40px, 5.4vw, 72px)', lineHeight: 1.15, fontWeight: 900, letterSpacing: '-0.05em', color: '#FFFFFF' }}>
              히트 공식
              하나로
              <br />
              <span
                  style={{
                    background: 'linear-gradient(90deg, #C9B6FF 0%, #8C63FF 100%)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                  }}
                >
                  내 대본
                </span>
              까지 완성!
            </h1>
            <p style={{ margin: '28px 0 0', fontSize: 'clamp(17px, 1.6vw, 20px)', lineHeight: 1.7, color: '#BDB7D0' }}>
              잘 된 영상이 왜 터졌는지 공식을 뽑아,
              <br />
              내 이야기로 바로 찍을 대본 3개를 만들어 드려요.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <a
                href={startHref}
                className="inline-flex h-14 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-7 text-[17px] font-extrabold"
                style={{ background: 'linear-gradient(90deg, #8D5CFF 0%, #6A2BF5 100%)', color: '#FFFFFF', boxShadow: '0 14px 36px rgba(122,77,255,0.45)' }}
              >
                무료로 대본 만들기
                <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 10h11M11 5.5 15.5 10 11 14.5" />
                </svg>
              </a>
              <a
                href="/recommend"
                className="inline-flex h-14 items-center justify-center whitespace-nowrap rounded-xl px-7 text-[17px] font-bold"
                style={{ border: '1px solid rgba(255,255,255,0.22)', background: 'rgba(255,255,255,0.05)', color: '#FFFFFF' }}
              >
                내 콘텐츠 방향 추천받기
              </a>
            </div>
            <p style={{ margin: '16px 0 0', fontSize: 14, color: '#8F89A6' }}>
              신용카드 없이 무료로 시작 ·{' '}
              <a
                href="/purchase"
                onClick={() => setPostAuthRedirectPath('/purchase')}
                style={{ color: '#D9CCFF', textDecoration: 'underline', textUnderlineOffset: 4 }}
              >
                쿠폰 등록하기
              </a>
            </p>
            <ul className="m-0 mt-9 flex list-none flex-wrap justify-center gap-x-6 gap-y-2 p-0 lg:justify-start">
              {HERO_POINTS.map((point) => (
                <li key={point} className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: '#D7D2E6' }}>
                  <Icon name="check" size={18} color="#9B7BFF" strokeWidth={2.4} />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative mx-auto flex w-full max-w-[420px] flex-col lg:block">
            <div
              className="relative z-10 -mb-4 self-start lg:absolute lg:-left-14 lg:-top-8 lg:mb-0"
              style={{ padding: '12px 16px', borderRadius: 14, background: '#FFFFFF', color: '#24183F', textAlign: 'left', transform: 'rotate(-6deg)', boxShadow: '0 16px 40px rgba(10,0,40,0.45)' }}
            >
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#6A2BF5' }}>히트 공식</p>
              <p style={{ margin: '3px 0 0', fontSize: 15, fontWeight: 800 }}>훅: '하지 마세요'로 멈춰 세우기</p>
            </div>
            <div
              className="mx-auto"
              style={{ width: 'min(100%, 340px)', borderRadius: 36, background: '#0B0A10', border: '1px solid #3B3360', padding: 12, boxShadow: '0 40px 90px rgba(5,0,25,0.65)' }}
            >
              <div className="flex flex-col gap-3 text-left" style={{ borderRadius: 26, background: '#17151F', padding: '20px 16px' }}>
                <div className="flex items-center justify-between">
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#FFFFFF' }}>
                    C안 <span style={{ color: '#9C93B8', fontWeight: 600 }}>후킹형</span>
                  </p>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#B9A2FF' }}>30초</p>
                </div>
                <div style={{ borderRadius: 12, background: '#2A1640', padding: '12px 14px' }}>
                  <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: '#F2A7C3' }}>HOOK</p>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, fontWeight: 600, color: '#FFFFFF' }}>
                    토너, 화장솜으로 닦고 계시죠? 오늘부터 그거 하지 마세요.
                  </p>
                </div>
                <div style={{ borderRadius: 12, background: '#1E1B33', padding: '12px 14px' }}>
                  <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: '#A9B8FF' }}>BODY</p>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: '#D5D0E6' }}>
                    반은 화장솜이 다 먹어요. 손바닥에 덜어서 세 번만 꾹꾹 눌러주세요. 내일 아침 화장 먹는 게 달라요.
                  </p>
                </div>
                <div style={{ borderRadius: 12, background: '#182624', padding: '12px 14px' }}>
                  <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: '#9FE0C2' }}>CTA</p>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: '#D5D0E6' }}>까먹기 전에 저장! 해보고 댓글로 후기 알려주세요.</p>
                </div>
              </div>
            </div>
            <div
              className="relative z-10 -mt-4 self-end lg:absolute lg:-bottom-8 lg:-right-8 lg:mt-0"
              style={{ padding: '12px 16px', borderRadius: 14, background: '#7A4DFF', color: '#FFFFFF', textAlign: 'left', transform: 'rotate(5deg)', boxShadow: '0 16px 40px rgba(10,0,40,0.45)' }}
            >
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#E5D8FF' }}>채팅으로 수정</p>
              <p style={{ margin: '3px 0 0', fontSize: 15, fontWeight: 800 }}>"훅만 더 짧게 해줘"</p>
            </div>
          </div>
        </section>
      </div>

      <section className="relative px-6 py-24 md:py-28" style={{ background: '#16151D' }}>
        <div className="mx-auto max-w-[1160px]">
          <Eyebrow>Why HookAI</Eyebrow>
          <h2 style={{ margin: '12px 0 0', fontSize: 'clamp(30px, 3.8vw, 46px)', lineHeight: 1.25, fontWeight: 900, letterSpacing: '-0.045em' }}>
            잘 된 영상은 많은데,
            <br />
            내 대본은 <span style={{ color: '#A98BFF' }}>왜 안 나올까요?</span>
          </h2>
          <div className="mt-12 grid items-center gap-6 md:grid-cols-[1fr_auto_1fr]">
            <div className="flex flex-col gap-4 py-2">
              {BEFORE.map(([item, deg], index) => (
                <p
                  key={item}
                  className={`relative m-0 max-w-[420px] rounded-2xl px-5 py-4 text-[16px] font-semibold ${index % 2 ? 'self-end' : 'self-start'}`}
                  style={{ background: '#24232D', border: '1px solid #33313F', color: '#C3BED2', transform: `rotate(${deg}deg)` }}
                >
                  "{item}"
                  <span
                    aria-hidden="true"
                    className={`absolute -bottom-[7px] h-3.5 w-3.5 rotate-45 ${index % 2 ? 'right-8' : 'left-8'}`}
                    style={{ background: '#24232D', borderRight: '1px solid #33313F', borderBottom: '1px solid #33313F' }}
                  />
                </p>
              ))}
            </div>
            <div
              aria-hidden="true"
              className="mx-auto flex h-14 w-14 rotate-90 items-center justify-center rounded-full md:rotate-0"
              style={{ background: '#7A4DFF', boxShadow: '0 0 0 8px rgba(122,77,255,0.18)' }}
            >
              <svg viewBox="0 0 20 20" width="22" height="22" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 10h11M11 5.5 15.5 10 11 14.5" />
              </svg>
            </div>
            <div
              className="relative rounded-3xl p-7 md:p-9"
              style={{ background: 'linear-gradient(135deg, #3A22A0 0%, #241460 100%)', border: '1px solid rgba(155,123,255,0.45)', boxShadow: '0 24px 60px rgba(60,20,160,0.35)' }}
            >
              <p
                className="absolute -top-4 right-6 m-0 rounded-full px-3.5 py-1.5 text-[13px] font-extrabold"
                style={{ background: '#FFFFFF', color: '#4A1FB8', transform: 'rotate(4deg)' }}
              >
                훅AI로 쓰면
              </p>
              <ul className="m-0 flex list-none flex-col gap-4 p-0">
                {AFTER.map((item) => (
                  <li key={item} className="flex items-center gap-3 text-[17px] font-bold" style={{ color: '#FFFFFF' }}>
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full" style={{ background: 'rgba(229,216,255,0.2)' }}>
                      <Icon name="check" size={16} color="#E5D8FF" strokeWidth={2.6} />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-24 grid gap-5 md:grid-cols-2 md:grid-rows-3">
            <div
              className="relative overflow-hidden rounded-3xl p-7 md:row-span-3 md:p-9"
              style={{ background: 'linear-gradient(160deg, #8A5BFF 0%, #6A2BF5 55%, #4A1FB8 100%)' }}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'rgba(255,255,255,0.18)' }}>
                <Icon name="search" size={24} color="#FFFFFF" />
              </span>
              <h3 style={{ margin: '20px 0 0', fontSize: 28, fontWeight: 900, letterSpacing: '-0.035em' }}>왜 터졌는지 한눈에</h3>
              <p style={{ margin: '8px 0 0', fontSize: 16, lineHeight: 1.6, color: '#E5D8FF' }}>훅·구조·시청 심리를 문장마다 뜯어 공식으로 정리해요.</p>
              <ol className="m-0 mt-8 flex list-none flex-col gap-2.5 p-0">
                {FORMULA.map(([time, label, desc]) => (
                  <li
                    key={label}
                    className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3"
                    style={{ color: '#1E1B2E', boxShadow: '0 10px 24px rgba(30,0,90,0.25)' }}
                  >
                    <span className="w-[58px] flex-none text-[12px] font-bold" style={{ color: '#8A84A0' }}>{time}</span>
                    <span className="flex-none rounded-md px-2 py-0.5 text-[12px] font-extrabold" style={{ background: '#EFE8FF', color: '#6A2BF5' }}>{label}</span>
                    <span className="min-w-0 text-[14px] font-bold">{desc}</span>
                  </li>
                ))}
              </ol>
            </div>
            {FEATURES.map(([icon, title, desc]) => (
              <div key={title} className="flex items-start gap-5 rounded-3xl p-7" style={{ background: '#1D1C25', border: '1px solid #2C2A37' }}>
                <span className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl" style={{ background: 'rgba(122,77,255,0.18)' }}>
                  <Icon name={icon} size={24} color="#B49BFF" />
                </span>
                <div className="min-w-0">
                  <h3 style={{ margin: 0, fontSize: 21, fontWeight: 800, letterSpacing: '-0.03em' }}>{title}</h3>
                  <p style={{ margin: '6px 0 0', fontSize: 16, lineHeight: 1.6, color: '#A7A2B8' }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        className="px-6 py-24 md:py-28"
        style={{
          color: '#1E1B2E',
          backgroundColor: '#F4F0FF',
        }}
      >
        <div className="mx-auto max-w-[1160px]">
          <Eyebrow light>How it works</Eyebrow>
          <h2 style={{ margin: '12px 0 0', fontSize: 'clamp(30px, 3.8vw, 46px)', lineHeight: 1.25, fontWeight: 900, letterSpacing: '-0.045em' }}>
            넣고, 고르고, <span style={{ color: '#6A2BF5' }}>다듬으면 끝</span>
          </h2>
          <ol className="m-0 mt-12 grid list-none gap-5 p-0 md:grid-cols-3">
            {STEPS.map(([title, desc], index) => (
              <li
                key={title}
                className="rounded-3xl p-7"
                style={{
                  background: index === 2 ? '#6A2BF5' : '#FFFFFF',
                  color: index === 2 ? '#FFFFFF' : '#1E1B2E',
                  border: index === 2 ? 'none' : '1px solid #E4DAFF',
                  boxShadow: '0 16px 40px rgba(90,40,200,0.12)',
                }}
              >
                <span className="text-[14px] font-extrabold tracking-[0.08em]" style={{ color: index === 2 ? '#E5D8FF' : '#6A2BF5' }}>
                  STEP {index + 1}
                </span>
                <h3 style={{ margin: '18px 0 0', fontSize: 26, fontWeight: 900, letterSpacing: '-0.04em' }}>{title}</h3>
                <p style={{ margin: '8px 0 0', fontSize: 16, lineHeight: 1.6, color: index === 2 ? '#E5D8FF' : '#5A5670' }}>{desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="px-6 py-24 md:py-28" style={{ background: '#FFFFFF', color: '#1E1B2E' }}>
        <div className="mx-auto grid max-w-[1160px] gap-12 md:grid-cols-[0.8fr_1.2fr] md:items-center">
          <div>
            <p className="m-0 flex items-center gap-2 text-[14px] font-bold" style={{ color: '#3A3550' }}>
              <span className="rounded-md px-2 py-0.5 text-[12px] font-extrabold tracking-[0.06em]" style={{ background: '#6A2BF5', color: '#FFFFFF' }}>
                NEW
              </span>
              크리에이터스튜디오
            </p>
            <h2 style={{ margin: '16px 0 0', fontSize: 'clamp(30px, 3.8vw, 46px)', lineHeight: 1.25, fontWeight: 900, letterSpacing: '-0.045em' }}>
              찍기 전부터
              <br />
              <span style={{ color: '#6A2BF5' }}>올리기 전까지</span>
            </h2>
            <p style={{ margin: '16px 0 0', fontSize: 17, lineHeight: 1.7, color: '#5A5670' }}>
              계정 추천부터 자막·컷편집, 올리기 전 피드백까지 한곳에서 끝내요.
            </p>
            <div aria-hidden="true" className="mt-8 flex flex-wrap gap-2.5">
              {STUDIO_STICKERS.map(([label, bg, deg]) => (
                <span
                  key={label}
                  className="rounded-xl px-4 py-2 text-[16px] font-black"
                  style={{
                    background: bg,
                    color: bg === '#FFFFFF' || bg === '#E5D8FF' ? '#3F088C' : '#FFFFFF',
                    border: bg === '#FFFFFF' ? '2px solid #6A2BF5' : 'none',
                    transform: `rotate(${deg}deg)`,
                    boxShadow: '0 10px 22px rgba(90,40,200,0.18)',
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
            <a href="/creatorstudio" className="mt-8 inline-flex items-center gap-2 text-[16px] font-extrabold" style={{ color: '#6A2BF5' }}>
              크리에이터스튜디오 보기
              <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 10h11M11 5.5 15.5 10 11 14.5" />
              </svg>
            </a>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {STUDIO_FEATURES.map(([icon, title, desc]) => (
              <div
                key={title}
                className="rounded-3xl p-6"
                style={{ background: '#F7F4FF', border: '1px solid #ECE4FF' }}
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg, #8D5CFF 0%, #6A2BF5 100%)' }}>
                  <Icon name={icon} size={22} color="#FFFFFF" />
                </span>
                <h3 style={{ margin: '16px 0 0', fontSize: 19, fontWeight: 800, letterSpacing: '-0.02em' }}>{title}</h3>
                <p style={{ margin: '6px 0 0', fontSize: 15, lineHeight: 1.6, color: '#5A5670' }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 pb-24 pt-8 md:pb-28" style={{ background: 'linear-gradient(180deg, #FFFFFF 0%, #EFE8FF 100%)' }}>
        <div className="relative mx-auto max-w-[1160px]">
        <div
          className="relative flex flex-col gap-8 overflow-hidden rounded-[28px] px-7 py-14 md:flex-row md:items-center md:justify-between md:px-14 md:py-16"
          style={{ background: 'linear-gradient(120deg, #8558FF 0%, #6A2BF5 50%, #4A1FB8 100%)', boxShadow: '0 30px 70px rgba(90,40,200,0.3)' }}
        >
          <div className="relative">
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#E5D8FF' }}>숏폼 대본 플랫폼 훅AI</p>
            <h2 style={{ margin: '10px 0 0', fontSize: 'clamp(28px, 3.4vw, 42px)', lineHeight: 1.3, fontWeight: 900, letterSpacing: '-0.045em', color: '#FFFFFF' }}>
              릴스 하나 넣으면,
              <br />
              오늘 찍을 대본 3개 완성
            </h2>
          </div>
          <div className="relative flex flex-col gap-3 sm:flex-row md:flex-col lg:flex-row [&_a]:whitespace-nowrap">
            <a
              href={startHref}
              className="inline-flex h-14 items-center justify-center rounded-xl px-7 text-[17px] font-extrabold"
              style={{ background: '#FFFFFF', color: '#4A1FB8' }}
            >
              무료로 대본 만들기
            </a>
            <a
              href="/recommend"
              className="inline-flex h-14 items-center justify-center rounded-xl px-7 text-[17px] font-bold"
              style={{ border: '1px solid rgba(255,255,255,0.5)', color: '#FFFFFF' }}
            >
              내 콘텐츠 방향 추천받기
            </a>
          </div>
        </div>
        </div>
      </section>

      <footer style={{ background: '#111017', color: '#8F8BA3' }}>
        <div className="mx-auto flex max-w-[1160px] flex-wrap justify-between gap-4 px-6 py-8" style={{ fontSize: 13 }}>
          <span style={{ fontSize: 16, fontWeight: 900, color: '#E6E3EF' }}>
            Hook<span style={{ color: '#9B7BFF' }}>AI</span>
          </span>
          <span>© 2026 HookAI</span>
        </div>
      </footer>
    </main>
  )
}
