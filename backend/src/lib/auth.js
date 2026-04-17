import { AppError } from './errors.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'

function getAuthVerifierClient() {
  if (!hasSupabaseAdminConfig()) {
    throw new AppError('Supabase admin client is not configured', {
      code: 'SUPABASE_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  return getSupabaseAdmin()
}

function extractBearerToken(authorizationHeader = '') {
  const header = String(authorizationHeader || '')
  if (!header.startsWith('Bearer ')) {
    return ''
  }

  return header.slice('Bearer '.length).trim()
}

export async function requireAuth(req, _res, next) {
  try {
    const token = extractBearerToken(req.headers.authorization)

    if (!token) {
      throw new AppError('Authorization token is required', {
        code: 'UNAUTHORIZED',
        statusCode: 401,
      })
    }

    const authClient = getAuthVerifierClient()
    const { data, error } = await authClient.auth.getUser(token)

    if (error || !data?.user) {
      throw new AppError('Invalid or expired authorization token', {
        code: 'UNAUTHORIZED',
        statusCode: 401,
        cause: error || undefined,
      })
    }

    req.auth = {
      userId: data.user.id,
      email: data.user.email || '',
    }

    next()
  } catch (error) {
    next(error)
  }
}

function getAdminUserIdSet() {
  return new Set(
    String(process.env.ADMIN_USER_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
}

function getAdminEmailSet() {
  return new Set(
    String(process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function requireAdmin(req, _res, next) {
  try {
    const userId = String(req.auth?.userId || '').trim()
    const email = String(req.auth?.email || '').trim().toLowerCase()
    const adminUserIds = getAdminUserIdSet()
    const adminEmails = getAdminEmailSet()

    const isAdmin =
      (userId && adminUserIds.has(userId)) ||
      (email && adminEmails.has(email))

    if (!isAdmin) {
      throw new AppError('Admin permission is required', {
        code: 'FORBIDDEN',
        statusCode: 403,
      })
    }

    next()
  } catch (error) {
    next(error)
  }
}
