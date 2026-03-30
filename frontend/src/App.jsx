import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { addUserBreadcrumb } from './lib/sentry'

const apiBase = '/api'

function App() {
  const [apiStatus, setApiStatus] = useState('checking')
  const [apiMessage, setApiMessage] = useState('Express server pinging')
  const [supabaseStatus, setSupabaseStatus] = useState('checking')

  useEffect(() => {
    let cancelled = false

    const loadStatus = async () => {
      addUserBreadcrumb('system', 'health-check-started')

      try {
        const response = await fetch(`${apiBase}/health`)
        if (!response.ok) {
          throw new Error(`API returned ${response.status}`)
        }

        const data = await response.json()
        if (!cancelled) {
          setApiStatus(data.status)
          setApiMessage(data.message)
        }
        addUserBreadcrumb('api', 'health-check-succeeded', {
          status: data.status,
        })
      } catch (error) {
        if (!cancelled) {
          setApiStatus('offline')
          setApiMessage(error.message)
        }
        addUserBreadcrumb('api', 'health-check-failed', {
          message: error.message,
        })
      }

      try {
        const hasUrl = Boolean(import.meta.env.VITE_SUPABASE_URL)
        const hasAnonKey = Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY)

        if (!hasUrl || !hasAnonKey) {
          throw new Error('VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing')
        }

        await supabase.auth.getSession()

        if (!cancelled) {
          setSupabaseStatus('ready')
        }
        addUserBreadcrumb('supabase', 'session-check-succeeded')
      } catch (error) {
        if (!cancelled) {
          setSupabaseStatus(error.message)
        }
        addUserBreadcrumb('supabase', 'session-check-failed', {
          message: error.message,
        })
      }
    }

    loadStatus()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,186,73,0.16),transparent_30%),linear-gradient(180deg,#14110f_0%,#1d1713_48%,#110f12_100%)] text-stone-100">
      <section className="mx-auto max-w-7xl px-6 pb-10 pt-18">
        <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.78rem] uppercase tracking-[0.12em] text-amber-50/90">
          React + Express + Supabase + Tailwind
        </span>
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div>
            <h1 className="m-0 max-w-4xl text-5xl font-semibold tracking-[-0.05em] text-stone-50 md:text-7xl">
              혜빈 언니 AI 서비스 시작 준비 완료
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-stone-300">
              프론트엔드는 React(Vite), 백엔드는 Express, 데이터 계층은
              Supabase 기준으로 묶었습니다. 이제 환경변수만 채우면 바로 기능
              개발로 넘어갈 수 있습니다.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-stone-100">
                Frontend on :5173
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-stone-100">
                API on :3001
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-stone-100">
                Supabase wired
              </span>
            </div>
          </div>

          <aside className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/20 backdrop-blur-xl">
            <h2 className="mb-4 text-base font-semibold text-stone-50">
              Runtime Status
            </h2>
            <div className="grid gap-3">
              <div className="flex flex-col gap-2 rounded-2xl bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-stone-400">Express API</span>
                <span className={apiStatus === 'ok' ? 'font-semibold text-emerald-300' : 'font-semibold text-amber-300'}>
                  {apiStatus}
                </span>
              </div>
              <div className="flex flex-col gap-2 rounded-2xl bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-stone-400">API message</span>
                <span className="font-semibold text-stone-100">{apiMessage}</span>
              </div>
              <div className="flex flex-col gap-2 rounded-2xl bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-stone-400">Supabase client</span>
                <span className={supabaseStatus === 'ready' ? 'font-semibold text-emerald-300' : 'font-semibold text-amber-300'}>
                  {supabaseStatus}
                </span>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-6 pb-10 md:grid-cols-2">
        <article className="rounded-[28px] border border-white/10 bg-white/5 p-7 shadow-2xl shadow-black/20 backdrop-blur-xl">
          <h2 className="mb-4 text-base font-semibold text-stone-50">Next Steps</h2>
          <div className="grid gap-3">
            <div className="flex flex-col gap-2 rounded-2xl bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span>1. `.env` 값 채우기</span>
              <span className="text-sm text-stone-300">
                Supabase URL / anon key / service role
              </span>
            </div>
            <div className="flex flex-col gap-2 rounded-2xl bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span>2. API 라우트 추가</span>
              <span className="text-sm text-stone-300">
                `backend/src/index.js`에 기능별 엔드포인트 확장
              </span>
            </div>
            <div className="flex flex-col gap-2 rounded-2xl bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span>3. DB 스키마 작업</span>
              <span className="text-sm text-stone-300">
                Supabase MCP 또는 SQL Editor로 진행
              </span>
            </div>
          </div>
        </article>

        <article className="rounded-[28px] border border-white/10 bg-white/5 p-7 shadow-2xl shadow-black/20 backdrop-blur-xl">
          <h2 className="mb-4 text-base font-semibold text-stone-50">Current Wiring</h2>
          <p className="mb-4 leading-7 text-stone-300">
            프론트는 Vite 프록시를 통해 `/api`로 Express를 호출하고, 서버는
            별도 Supabase admin client를 준비합니다.
          </p>
          <div className="grid gap-3">
            <div className="flex flex-col gap-2 rounded-2xl bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span>Frontend</span>
              <span className="text-sm text-stone-300">`frontend/src/lib/supabase.js`</span>
            </div>
            <div className="flex flex-col gap-2 rounded-2xl bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span>Backend</span>
              <span className="text-sm text-stone-300">`backend/src/lib/supabase.js`</span>
            </div>
            <div className="flex flex-col gap-2 rounded-2xl bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span>Env Example</span>
              <span className="text-sm text-stone-300">루트 `.env.example`</span>
            </div>
          </div>
        </article>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-7 shadow-2xl shadow-black/20 backdrop-blur-xl">
          <h2 className="mb-4 text-base font-semibold text-stone-50">Run</h2>
          <pre className="overflow-x-auto text-sm text-amber-100">{`cp .env.example .env
npm run dev`}</pre>
          <div className="mt-5">
            <ErrorButton />
          </div>
        </div>
      </section>
    </main>
  )
}

function ErrorButton() {
  return (
    <button
      type="button"
      onClick={() => {
        addUserBreadcrumb('ui', 'manual-sentry-test-clicked')
        throw new Error('This is your first error!')
      }}
      className="rounded-full border border-rose-300/20 bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20"
    >
      Test Sentry Error
    </button>
  )
}

export default App
