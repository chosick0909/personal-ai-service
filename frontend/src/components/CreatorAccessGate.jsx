import { useEffect, useState } from 'react'
import { creatorRequest } from '../lib/creatorApi'

export default function CreatorAccessGate({ children }) {
  const [access, setAccess] = useState(null)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let expiryTimer
    let pending = false
    async function check() {
      if (pending) return
      pending = true
      try {
        const result = await creatorRequest('/creator-tools/access', { signal: controller.signal })
        if (controller.signal.aborted) return
        const remaining = result.endsAt === null ? Infinity : Date.parse(result.endsAt) - Date.now()
        if (!result.allowed || !(remaining > 0)) {
          throw Object.assign(new Error('쿠폰 이용기간이 만료되었습니다.'), { code: 'CREATOR_COUPON_REQUIRED' })
        }
        clearTimeout(expiryTimer)
        if (Number.isFinite(remaining)) {
          expiryTimer = setTimeout(() => {
            setAccess(null)
            void check()
          }, Math.min(remaining, 2_147_483_647))
        }
        setAccess(result)
        setError(null)
      } catch (failure) {
        if (controller.signal.aborted) return
        setAccess(null)
        setError(failure)
      } finally {
        pending = false
      }
    }
    void check()
    const interval = setInterval(check, 60_000)
    window.addEventListener('focus', check)
    return () => {
      controller.abort()
      clearTimeout(expiryTimer)
      clearInterval(interval)
      window.removeEventListener('focus', check)
    }
  }, [attempt])

  if (access) return children
  const couponRequired = error?.code === 'CREATOR_COUPON_REQUIRED'
  return (
    <main className="hk-brand flex min-h-screen items-center justify-center bg-[#0D0F14] px-5 text-white">
      <section className="hk-auth-card w-full max-w-md rounded-3xl border border-white/15 bg-white/5 p-8 text-center" aria-live="polite">
        <h1 className="text-xl font-bold">{!error ? '쿠폰 이용기간을 확인하고 있어요' : couponRequired ? '유효한 쿠폰 이용권이 필요해요' : '이용기간을 확인하지 못했어요'}</h1>
        <p className="mt-4 text-sm leading-6 text-white/70">{!error ? '잠시만 기다려주세요.' : couponRequired ? '크리에이터스튜디오는 쿠폰 이용기간이 남아 있는 회원만 이용할 수 있습니다.' : '잠시 후 다시 확인해주세요. 문제가 계속되면 다시 로그인해주세요.'}</p>
        {error && <div className="mt-6 flex flex-wrap justify-center gap-3">
          {couponRequired && <a className="rounded-full bg-white px-5 py-3 text-sm font-semibold !text-[#111827]" href="/purchase">쿠폰 등록하기</a>}
          <button className="rounded-full border border-white/30 px-5 py-3 text-sm" onClick={() => { setError(null); setAttempt((value) => value + 1) }}>다시 확인</button>
          <a className="rounded-full border border-white/30 px-5 py-3 text-sm !text-white" href="/">홈으로</a>
        </div>}
      </section>
    </main>
  )
}
