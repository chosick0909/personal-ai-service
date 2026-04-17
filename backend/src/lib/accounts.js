import { AppError } from './errors.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'

const DEFAULT_ACCOUNT_SLUG = process.env.DEFAULT_ACCOUNT_SLUG?.trim() || 'legacy-mvp'
const MAX_ACCOUNT_NAME_LENGTH = 60
const MAX_ACCOUNT_SLUG_LENGTH = 60

function requireSupabaseAdmin() {
  if (!hasSupabaseAdminConfig()) {
    throw new AppError('Supabase admin client is not configured', {
      code: 'SUPABASE_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  return getSupabaseAdmin()
}

function slugifyAccountName(value = '') {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return normalized || 'account'
}

function normalizeAccountName(value = '') {
  const trimmed = String(value || '').trim()
  return trimmed.slice(0, MAX_ACCOUNT_NAME_LENGTH)
}

function normalizeAccountSlug(value = '') {
  return slugifyAccountName(value).slice(0, MAX_ACCOUNT_SLUG_LENGTH)
}

export async function resolveAccount({
  accountId,
  accountSlug,
  userId,
} = {}) {
  const supabaseAdmin = requireSupabaseAdmin()
  const normalizedUserId = String(userId || '').trim()
  const normalizedAccountId = accountId?.trim()
  const normalizedAccountSlug = accountSlug?.trim() || DEFAULT_ACCOUNT_SLUG

  if (!normalizedUserId) {
    throw new AppError('Authenticated user is required', {
      code: 'UNAUTHORIZED',
      statusCode: 401,
    })
  }

  if (normalizedAccountId) {
    const { data, error } = await supabaseAdmin
      .from('accounts')
      .select('id, slug, name')
      .eq('id', normalizedAccountId)
      .eq('owner_user_id', normalizedUserId)
      .single()

    if (error) {
      throw new AppError('Account not found', {
        code: 'ACCOUNT_NOT_FOUND',
        statusCode: 404,
        cause: error,
      })
    }

    return data
  }

  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select('id, slug, name')
    .eq('slug', normalizedAccountSlug)
    .eq('owner_user_id', normalizedUserId)
    .single()

  if (error) {
    throw new AppError('Account not found', {
      code: 'ACCOUNT_NOT_FOUND',
      statusCode: 404,
      cause: error,
      details: {
        accountSlug: normalizedAccountSlug,
      },
    })
  }

  return data
}

export async function resolveRequestAccount(req, { body = true, query = true } = {}) {
  const bodySource = body ? req.body ?? {} : {}
  const querySource = query ? req.query ?? {} : {}

  return resolveAccount({
    accountId:
      bodySource.accountId ||
      bodySource.account_id ||
      querySource.accountId ||
      querySource.account_id ||
      req.headers['x-account-id'],
    accountSlug:
      bodySource.accountSlug ||
      bodySource.account_slug ||
      querySource.accountSlug ||
      querySource.account_slug ||
      req.headers['x-account-slug'],
    userId: req.auth?.userId,
  })
}

export function getDefaultAccountSlug() {
  return DEFAULT_ACCOUNT_SLUG
}

export async function listAccounts(userId) {
  const supabaseAdmin = requireSupabaseAdmin()
  const normalizedUserId = String(userId || '').trim()

  if (!normalizedUserId) {
    throw new AppError('Authenticated user is required', {
      code: 'UNAUTHORIZED',
      statusCode: 401,
    })
  }

  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select('id, slug, name, created_at, updated_at')
    .eq('owner_user_id', normalizedUserId)
    .order('created_at', { ascending: true })

  if (error) {
    throw new AppError('Failed to load accounts', {
      code: 'ACCOUNT_LIST_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  return data || []
}

export async function createAccount(input = {}, userId) {
  const supabaseAdmin = requireSupabaseAdmin()
  const normalizedUserId = String(userId || '').trim()
  const name = normalizeAccountName(input.name)

  if (!normalizedUserId) {
    throw new AppError('Authenticated user is required', {
      code: 'UNAUTHORIZED',
      statusCode: 401,
    })
  }

  if (!name) {
    throw new AppError('Account name is required', {
      code: 'ACCOUNT_NAME_REQUIRED',
      statusCode: 400,
    })
  }

  const baseSlug = normalizeAccountSlug(input.slug || name)
  let nextSlug = baseSlug
  let suffix = 1

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('accounts')
      .select('id')
      .eq('slug', nextSlug)
      .maybeSingle()

    if (error) {
      throw new AppError('Failed to validate account slug', {
        code: 'ACCOUNT_SLUG_CHECK_FAILED',
        statusCode: 500,
        cause: error,
      })
    }

    if (!data) {
      break
    }

    suffix += 1
    nextSlug = `${baseSlug}-${suffix}`
  }

  const { data, error } = await supabaseAdmin
    .from('accounts')
    .insert({
      name,
      slug: nextSlug,
      owner_user_id: normalizedUserId,
    })
    .select('id, slug, name, created_at, updated_at')
    .single()

  if (error) {
    throw new AppError('Failed to create account', {
      code: 'ACCOUNT_CREATE_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  return data
}

export async function updateAccount(accountId, input = {}, userId) {
  const supabaseAdmin = requireSupabaseAdmin()
  const normalizedUserId = String(userId || '').trim()

  if (!normalizedUserId) {
    throw new AppError('Authenticated user is required', {
      code: 'UNAUTHORIZED',
      statusCode: 401,
    })
  }

  const payload = {}

  if (typeof input.name === 'string') {
    payload.name = normalizeAccountName(input.name) || 'Untitled Account'
  }

  if (typeof input.slug === 'string' && input.slug.trim()) {
    payload.slug = normalizeAccountSlug(input.slug)
  }

  if (!Object.keys(payload).length) {
    throw new AppError('No account fields to update', {
      code: 'ACCOUNT_UPDATE_EMPTY',
      statusCode: 400,
    })
  }

  const { data, error } = await supabaseAdmin
    .from('accounts')
    .update(payload)
    .eq('id', accountId)
    .eq('owner_user_id', normalizedUserId)
    .select('id, slug, name, created_at, updated_at')
    .single()

  if (error) {
    throw new AppError('Failed to update account', {
      code: 'ACCOUNT_UPDATE_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  return data
}

export async function deleteAccount(accountId, userId) {
  const supabaseAdmin = requireSupabaseAdmin()
  const normalizedUserId = String(userId || '').trim()
  const normalizedAccountId = accountId?.trim()

  if (!normalizedAccountId) {
    throw new AppError('Account id is required', {
      code: 'ACCOUNT_ID_REQUIRED',
      statusCode: 400,
    })
  }

  if (!normalizedUserId) {
    throw new AppError('Authenticated user is required', {
      code: 'UNAUTHORIZED',
      statusCode: 401,
    })
  }

  const { data, error } = await supabaseAdmin
    .from('accounts')
    .delete()
    .eq('id', normalizedAccountId)
    .eq('owner_user_id', normalizedUserId)
    .select('id, slug, name')
    .single()

  if (error) {
    throw new AppError('Failed to delete account', {
      code: 'ACCOUNT_DELETE_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  return data
}
