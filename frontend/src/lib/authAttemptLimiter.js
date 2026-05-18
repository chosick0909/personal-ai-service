import { safeGetStorageItem, safeRemoveStorageItem, safeSetStorageItem } from './safeStorage'

const LOGIN_ATTEMPT_LIMIT_KEY = 'personal-ai-service:auth-login-attempts:v1'
const MAX_ATTEMPTS_BEFORE_LOCK = 5
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000
const BASE_LOCK_MS = 5 * 60 * 1000
const MAX_LOCK_MS = 60 * 60 * 1000

function normalizeLoginId(loginId = '') {
  return String(loginId || '').trim().toLowerCase() || '__empty__'
}

function readAttemptMap() {
  const raw = safeGetStorageItem(LOGIN_ATTEMPT_LIMIT_KEY)
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAttemptMap(map) {
  safeSetStorageItem(LOGIN_ATTEMPT_LIMIT_KEY, JSON.stringify(map))
}

function formatRetryMessage(retryAfterMs) {
  const retryAfterMinutes = Math.max(1, Math.ceil(Number(retryAfterMs || 0) / 60_000))
  return `로그인 실패가 반복되어 잠시 제한되었습니다. 약 ${retryAfterMinutes}분 후 다시 시도해주세요.`
}

export function getLoginAttemptStatus(loginId) {
  const key = normalizeLoginId(loginId)
  const map = readAttemptMap()
  const current = map[key]
  const now = Date.now()

  if (!current || typeof current !== 'object') {
    return { allowed: true, retryAfterMs: 0, message: '' }
  }

  const lockedUntil = Number(current.lockedUntil || 0)
  if (lockedUntil > now) {
    const retryAfterMs = lockedUntil - now
    return {
      allowed: false,
      retryAfterMs,
      message: formatRetryMessage(retryAfterMs),
    }
  }

  return { allowed: true, retryAfterMs: 0, message: '' }
}

export function recordLoginFailure(loginId) {
  const key = normalizeLoginId(loginId)
  const map = readAttemptMap()
  const now = Date.now()
  const current = map[key] && typeof map[key] === 'object' ? map[key] : {}
  const firstAttemptAt = Number(current.firstAttemptAt || 0)
  const isSameWindow = firstAttemptAt > 0 && now - firstAttemptAt <= ATTEMPT_WINDOW_MS
  const attempts = isSameWindow ? Number(current.attempts || 0) + 1 : 1
  const lockCount = Number(current.lockCount || 0)
  const next = {
    firstAttemptAt: isSameWindow ? firstAttemptAt : now,
    attempts,
    lockCount,
    lockedUntil: 0,
  }

  if (attempts >= MAX_ATTEMPTS_BEFORE_LOCK) {
    const nextLockCount = lockCount + 1
    const lockMs = Math.min(BASE_LOCK_MS * 2 ** Math.max(nextLockCount - 1, 0), MAX_LOCK_MS)
    next.lockCount = nextLockCount
    next.lockedUntil = now + lockMs
    next.attempts = 0
    next.firstAttemptAt = now
  }

  map[key] = next
  writeAttemptMap(map)

  return getLoginAttemptStatus(loginId)
}

export function clearLoginAttempts(loginId) {
  const key = normalizeLoginId(loginId)
  const map = readAttemptMap()

  if (!(key in map)) {
    return
  }

  delete map[key]

  if (Object.keys(map).length === 0) {
    safeRemoveStorageItem(LOGIN_ATTEMPT_LIMIT_KEY)
    return
  }

  writeAttemptMap(map)
}
