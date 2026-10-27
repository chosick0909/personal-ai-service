import { createHash, randomBytes } from 'node:crypto'
import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { asyncHandler } from '../lib/errors.js'
import { fail } from './domain.js'
import { database, query } from './store.js'
import { setDemoUsers } from './demo-access.js'

// Client trial links. 지영 creates a link; opening it signs the visitor in as that link's trial account (made once,
// email already confirmed, nothing is sent), which can use Creator Studio 2 without a coupon until the link expires
// or is turned off. Only the SHA-256 of the link's key is stored.
const hash = token => createHash('sha256').update(String(token)).digest('hex')

export async function refreshDemoUsers(db = database()) {
  const rows = await query(db.from('creator_demo_links').select('user_id,expires_at,revoked_at')).catch(() => null)
  if (rows) setDemoUsers(rows)
  return rows
}
export function startDemoRefresh() {
  void refreshDemoUsers()
  setInterval(() => { void refreshDemoUsers() }, 60000).unref?.()
}

export async function createDemoLink(db, { label, days, createdBy, origin }) {
  const token = randomBytes(24).toString('base64url')
  const id = randomBytes(5).toString('hex')
  const expiresAt = new Date(Date.now() + Math.max(1, Math.min(90, Number(days) || 30)) * 86400000).toISOString()
  const { data, error } = await db.auth.admin.createUser({ email: `trial-${id}@trial.hookai.kr`, email_confirm: true, user_metadata: { hookaiTrial: true, label } })
  if (error || !data?.user?.id) fail('TRIAL_ACCOUNT_FAILED', '체험 계정을 만들지 못했어요.', 502)
  const row = await query(db.from('creator_demo_links').insert({ token_hash: hash(token), label, user_id: data.user.id, email: data.user.email, expires_at: expiresAt, created_by: createdBy })
    .select('id,label,expires_at,created_at').single())
  await refreshDemoUsers(db)
  return { ...row, url: `${origin}/studio?trial=${token}` }
}

// The key in a trial link becomes a normal signed-in session for its trial account.
export async function trialSession(db, token, now = Date.now()) {
  const link = await query(db.from('creator_demo_links').select('id,email,expires_at,revoked_at').eq('token_hash', hash(token)).maybeSingle())
  if (!link || link.revoked_at || Date.parse(link.expires_at) <= now) fail('TRIAL_LINK_INVALID', '사용할 수 없는 체험 링크예요. 링크를 보내준 분께 새 링크를 받아 주세요.', 404)
  const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: link.email })
  const tokenHash = data?.properties?.hashed_token
  if (error || !tokenHash) fail('TRIAL_SIGNIN_FAILED', '체험 계정으로 들어가지 못했어요. 잠시 후 다시 열어 주세요.', 502)
  const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const verified = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
  const session = verified.data?.session
  if (verified.error || !session) fail('TRIAL_SIGNIN_FAILED', '체험 계정으로 들어가지 못했어요. 잠시 후 다시 열어 주세요.', 502)
  await query(db.from('creator_demo_links').update({ last_used_at: new Date(now).toISOString() }).eq('id', link.id)).catch(() => {})
  return { access_token: session.access_token, refresh_token: session.refresh_token }
}

// Mounted before user authentication: the trial key is the credential. A few tries per address per minute.
export function createTrialRouter() {
  const router = Router()
  const tries = new Map()
  router.post('/session', asyncHandler(async (req, res) => {
    const key = req.ip || 'unknown', now = Date.now()
    const recent = (tries.get(key) || []).filter(t => t > now - 60000)
    if (recent.length >= 10) fail('TOO_MANY_REQUESTS', '잠시 후 다시 열어 주세요.', 429)
    tries.set(key, [...recent, now])
    const token = String(req.body?.token || '')
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) fail('TRIAL_LINK_INVALID', '사용할 수 없는 체험 링크예요.', 404)
    res.set('Cache-Control', 'no-store').json(await trialSession(database(), token))
  }))
  return router
}
