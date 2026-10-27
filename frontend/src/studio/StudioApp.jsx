import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Flame, Lightbulb, FolderHeart, FileText, Wand2, BookOpen, Scissors, MessageSquareText, Sparkles, Menu, X, CheckCircle2, LoaderCircle, TriangleAlert, ArrowLeft, Sun, Moon, BookOpenCheck } from 'lucide-react'
import hookLogo from './assets/hookai-avatar.webp'
import { useAppState } from '../store/AppState'
import { studio } from './api'
import ReelsPage from './pages/ReelsPage'
import ReferenceDetail from './pages/ReferenceDetail'
import ReferencesPage from './pages/ReferencesPage'
import PlansPage from './pages/PlansPage'
import IdeasPage from './pages/IdeasPage'
import PlanStart from './pages/PlanStart'
import PlanWizard from './pages/PlanWizard'
import FormulasPage from './pages/FormulasPage'
import LibraryPage from './pages/LibraryPage'
import StylePage from './pages/StylePage'
import EditPage from './pages/EditPage'
import PrintView from './pages/PrintView'
import ManualPage from './pages/ManualPage'
import { UpdatePopup, Tour } from './Guide'
import KakaoIcon, { KAKAO_CHAT } from './KakaoIcon'
import { popupHidden, popupClosedThisVisit, tourDone } from './guideData'
import './studio.css'

import { StudioContext } from './context'
import { rotatingLine, ANALYSIS_TIPS } from './waitLines'

const MENU = [
  ['reels', '영감 찾기', Flame], ['ideas', '주제 찾기', Lightbulb], ['references', '내 레퍼런스', FolderHeart], ['plans', '내 기획안', FileText], ['formulas', '내 공식', Wand2],
  ['library', '공식 사전', BookOpen], ['edit', '영상 편집', Scissors], ['style', '내 말투', MessageSquareText],
]
const TITLES = { manual: ['사용 설명서', '화면 사진의 번호를 따라 하나씩 해보세요'], reels: ['영감 찾기', '매일 쌓이는 터진 영상. 마음에 드는 걸 분석해 보세요'], reference: ['레퍼런스 분석', ''], references: ['내 레퍼런스', '분석한 영상이 여기 모여요'],
  ideas: ['주제 찾기', '훅ai와 대화하며 찍을 수 있을 만큼 구체적인 주제를 찾고 보관해요'], plans: ['내 기획안', '진행 중인 기획안을 이어서 만들어요'], new: ['내 기획안 만들기', '어떻게 시작할지 골라주세요'], plan: ['내 기획안', ''], formulas: ['내 공식', '저장한 후킹·전개·촬영·캡션 공식'],
  library: ['공식 사전', '터진 영상이 쓰는 공식 모음'], edit: ['영상 편집', '훅ai 피드백 · 컷 편집 · 자막 · 완성 영상 · 영상 소스'], style: ['내 말투', '훅ai가 이 말투로 써드려요'], print: ['기획안 인쇄', ''] }

function readRoute() {
  const q = new URLSearchParams(window.location.search)
  return { page: q.get('p') || 'reels', params: Object.fromEntries([...q.entries()].filter(([k]) => k !== 'p')) }
}

// While an analysis runs, the toast keeps talking so the wait does not feel stuck: the tip changes every few seconds.
function WaitingBody({ body, startedAt }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const base = startedAt || Date.now()
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - base) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  const tip = rotatingLine(ANALYSIS_TIPS, elapsed)
  return <>{body}{tip && <em className="st-toast-tip">{tip}</em>}</>
}

export default function StudioApp() {
  const { currentUser } = useAppState()
  const [route, setRoute] = useState(readRoute)
  const [menuOpen, setMenuOpen] = useState(false)
  // Same key as the old studio, so a student's choice carries between the two.
  // The studio always opens light; the switch changes the theme only for this visit (the old studio's saved dark choice no longer carries over).
  const [theme, setTheme] = useState('light')
  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')
  const [features, setFeatures] = useState(null)
  const [categories, setCategories] = useState([])
  const [toasts, setToasts] = useState([])
  const [tracking, setTracking] = useState({})
  const routeRef = useRef(route)
  useEffect(() => { routeRef.current = route }, [route])

  useEffect(() => {
    const onPop = () => setRoute(readRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    studio.capabilities().then(data => { setFeatures(data.features); setCategories(data.successReelCategories || []) }).catch(() => setFeatures({}))
  }, [])

  const go = useCallback((page, params = {}, { replace = false } = {}) => {
    const q = new URLSearchParams({ p: page, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '')) })
    window.history[replace ? 'replaceState' : 'pushState']({}, '', `/studio?${q}`)
    setRoute({ page, params })
    setMenuOpen(false)
    window.scrollTo(0, 0)
  }, [])
  const toast = useCallback((item) => {
    const id = item.id || `${Date.now()}-${Math.random()}`
    setToasts(list => [...list.filter(t => t.id !== id), { ...item, id }])
    if (item.ttl !== 0) setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), item.ttl || 6000)
    return id
  }, [])
  const dismiss = useCallback(id => setToasts(list => list.filter(t => t.id !== id)), [])

  // Reel analyses run on the server; this tracker polls them and opens the result when it is ready.
  // A finished analysis is announced with a toast; the result opens when the student taps it, never by itself.
  const announceReady = useCallback((code, username) => toast({ id: `an:${code}`, kind: 'ready', title: '분석 완료', body: `@${username}`, action: { label: '결과 보기', onClick: () => go('reference', { ref: code }) }, ttl: 15000 }), [toast, go])
  const analyze = useCallback(async (reel, { started = false } = {}) => {
    const code = reel.shortcode
    setTracking(t => ({ ...t, [code]: { reel, status: 'running' } }))
    toast({ id: `an:${code}`, kind: 'running', title: '분석 중…', body: `@${reel.username} · 보통 1~2분 걸려요`, startedAt: Date.now(), ttl: 0 })
    if (started) return
    try {
      const result = await studio.analyze(code)
      // An analysis that already exists still shows a short wait first, then the same toast as a fresh one.
      if (result.status === 'ready') { await new Promise(resolve => setTimeout(resolve, 5000)); setTracking(t => { const n = { ...t }; delete n[code]; return n }); announceReady(code, reel.username) }
    } catch (e) {
      setTracking(t => { const n = { ...t }; delete n[code]; return n })
      toast({ id: `an:${code}`, kind: 'failed', title: '분석 실패', body: e.message, ttl: 8000 })
    }
  }, [toast, announceReady])
  const running = Object.keys(tracking).join(',')
  useEffect(() => {
    if (!running) return undefined
    const codes = running.split(',')
    const timer = setInterval(() => {
      for (const code of codes) studio.reel(code).then(data => {
        if (data.analysisStatus === 'running') return
        setTracking(t => { const n = { ...t }; delete n[code]; return n })
        if (data.analysisStatus === 'ready') {
          const r = routeRef.current
          if (r.page === 'reference' && r.params.ref === code) { dismiss(`an:${code}`); go('reference', { ref: code }, { replace: true }) }
          else announceReady(code, data.username)
        } else toast({ id: `an:${code}`, kind: 'failed', title: '분석 실패', body: data.analysisError || '잠시 후 다시 시도해주세요.', ttl: 8000 })
      }).catch(() => {})
    }, 4000)
    return () => clearInterval(timer)
  }, [running, go, toast, dismiss, announceReady])

  const value = useMemo(() => ({ go, route, toast, dismiss, analyze, tracking, categories, features, user: currentUser }), [go, route, toast, dismiss, analyze, tracking, categories, features, currentUser])
  const [title, sub] = TITLES[route.page] || TITLES.reels
  // Every visit opens with the upgrade popup until it is closed in that visit ('24시간 동안 보지 않기' skips it for a day), then the guided tour once.
  const [guide, setGuide] = useState(null)
  // A trial link is for showing the studio to someone new: on every load its guided tour runs first, whatever was dismissed before.
  const isTrial = /@trial\.hookai\.kr$/.test(currentUser?.email || '')
  const trialTourShown = useRef(false)
  useEffect(() => {
    if (!features?.studio2 || route.page === 'print') return
    if (isTrial) {
      if (trialTourShown.current) return
      trialTourShown.current = true
      if (route.page !== 'reels') go('reels')
      setTimeout(() => setGuide('tour'), 500)
      return
    }
    if (!popupHidden() && !popupClosedThisVisit()) setGuide('popup')
    else if (!tourDone()) setGuide('tour')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, isTrial])
  const active = ['reference'].includes(route.page) ? 'reels' : ['plan', 'new', 'print'].includes(route.page) ? 'plans' : route.page

  if (features && !features.studio2) {
    return <main className="st" style={{ gridTemplateColumns: '1fr' }}><div className="st-content"><div className="st-empty"><strong>아직 공개되지 않은 화면이에요</strong><span>새 크리에이터 스튜디오는 준비 중이에요.</span><a className="st-btn st-btn-soft" href="/creatorstudio">크리에이터 스튜디오로 가기</a></div></div></main>
  }
  if (route.page === 'print') return <StudioContext.Provider value={value}><main className="st" style={{ gridTemplateColumns: '1fr' }}><PrintView sessionId={route.params.session} /></main></StudioContext.Provider>

  return <StudioContext.Provider value={value}>
    <main className="st" data-theme={theme}>
      {menuOpen && <div className="st-backdrop" onClick={() => setMenuOpen(false)} />}
      <aside className={`st-side${menuOpen ? ' is-open' : ''}`}>
        <div className="st-brand"><img src={hookLogo} alt="" /><div><strong>HookAI</strong><span>크리에이터 스튜디오</span></div></div>
        {MENU.map(([id, label, icon]) => { const Icon = icon; return <button type="button" key={id} data-tour={id} className="st-nav" aria-current={active === id ? 'page' : undefined} onClick={() => { go(id); setMenuOpen(false) }}><Icon size={22} />{label}</button> })}
        <div className="st-side-foot">
          <button type="button" data-tour="manual" className="st-manual-btn" aria-current={route.page === 'manual' ? 'page' : undefined} onClick={() => { go('manual'); setMenuOpen(false) }}><BookOpenCheck size={26} /><span><strong>사용 설명서</strong><small>처음이세요? 여기부터 보세요</small></span></button>
          <a className="st-kakao-btn" href={KAKAO_CHAT} target="_blank" rel="noopener noreferrer"><KakaoIcon size={22} />1:1 문의</a>
          <a className="st-nav" href="/" style={{ fontSize: 15 }}><ArrowLeft size={18} />홈으로</a>
          <div className="st-side-user">{currentUser?.email || '내 계정'}</div>
        </div>
      </aside>
      <div className="st-main">
        <header className="st-top">
          <button type="button" className="st-icon-btn st-menu-btn" aria-label="메뉴" onClick={() => setMenuOpen(v => !v)}>{menuOpen ? <X size={22} /> : <Menu size={22} />}</button>
          <h1>{title}</h1>{sub && <span className="st-sub">{sub}</span>}
          <div className="st-top-actions" id="st-top-actions" />
          <button type="button" className="st-icon-btn" title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'} aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}</button>
        </header>
        <div className="st-content">
          {!features ? <p className="st-muted">불러오는 중…</p>
            : route.page === 'reels' ? <ReelsPage />
            : route.page === 'reference' ? <ReferenceDetail shortcode={route.params.ref} />
            : route.page === 'ideas' ? <IdeasPage threadId={route.params.thread} />
            : route.page === 'references' ? <ReferencesPage />
            : route.page === 'plans' ? <PlansPage />
            : route.page === 'new' ? <PlanStart preset={route.params} />
            : route.page === 'plan' ? <PlanWizard key={route.params.session} sessionId={route.params.session} />
            : route.page === 'formulas' ? <FormulasPage />
            : route.page === 'library' ? <LibraryPage />
            : route.page === 'edit' ? <EditPage key={route.params.job || route.params.tab || 'start'} jobId={route.params.job} tab={route.params.tab} />
            : route.page === 'style' ? <StylePage />
            : route.page === 'manual' ? <ManualPage onTour={() => { go('reels'); setTimeout(() => setGuide('tour'), 600) }} />
            : <ReelsPage />}
        </div>
      </div>
      {route.page !== 'plan' && route.page !== 'new' && !(route.page === 'edit' && route.params.job) && <button type="button" data-tour="new" className="st-fab" aria-label="내 기획안 만들기" onClick={() => go('new')}><Sparkles size={22} /><span className="st-fab-label">내 기획안 만들기</span></button>}
      {guide === 'popup' && <UpdatePopup onClose={() => setGuide(g => g === 'popup' ? null : g)} onTour={() => { if (route.page !== 'reels') go('reels'); setTimeout(() => setGuide('tour'), 500) }} />}
      {guide === 'tour' && <Tour onClose={() => setGuide(null)} />}
      <div className="st-toasts" aria-live="polite">{toasts.map(t => <div key={t.id} className={`st-toast st-toast-${t.kind}`}>
        {t.kind === 'running' ? <LoaderCircle size={20} className="st-spin" /> : t.kind === 'ready' ? <CheckCircle2 size={20} /> : <TriangleAlert size={20} />}
        <div><strong>{t.title}</strong><span>{t.kind === 'running' ? <WaitingBody body={t.body} startedAt={t.startedAt} /> : t.body}</span></div>
        {t.action && <button type="button" className="st-btn st-btn-sm st-btn-primary" onClick={() => { dismiss(t.id); t.action.onClick() }}>{t.action.label}</button>}
        <button type="button" className="st-icon-btn" style={{ width: 36, height: 36, border: 0 }} aria-label="닫기" onClick={() => dismiss(t.id)}><X size={16} /></button>
      </div>)}</div>
    </main>
  </StudioContext.Provider>
}
