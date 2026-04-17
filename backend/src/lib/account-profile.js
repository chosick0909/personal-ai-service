import { updateAccount } from './accounts.js'
import { AppError } from './errors.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'

const MAX_TEXT_FIELD = 1200
const MAX_SETTINGS_JSON_BYTES = 100_000

function trimText(value) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  return trimmed.slice(0, MAX_TEXT_FIELD)
}

function normalizeSettings(value) {
  const normalized = value && typeof value === 'object' ? value : {}
  const raw = JSON.stringify(normalized)

  if (raw.length > MAX_SETTINGS_JSON_BYTES) {
    throw new AppError('Settings payload is too large', {
      code: 'ACCOUNT_SETTINGS_TOO_LARGE',
      statusCode: 400,
      details: {
        maxBytes: MAX_SETTINGS_JSON_BYTES,
      },
    })
  }

  return normalized
}

function requireSupabaseAdmin() {
  if (!hasSupabaseAdminConfig()) {
    throw new AppError('Supabase admin client is not configured', {
      code: 'SUPABASE_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  return getSupabaseAdmin()
}

export async function getAccountProfile(accountId) {
  const supabaseAdmin = requireSupabaseAdmin()

  const { data, error } = await supabaseAdmin
    .from('account_profiles')
    .select('account_id, tone, persona, target_audience, goal, strategy, settings, created_at, updated_at')
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) {
    throw new AppError('Failed to load account profile', {
      code: 'ACCOUNT_PROFILE_FETCH_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  return (
    data || {
      account_id: accountId,
      tone: '',
      persona: '',
      target_audience: '',
      goal: '',
      strategy: '',
      settings: {},
      created_at: null,
      updated_at: null,
    }
  )
}

export async function upsertAccountProfile(accountId, input = {}, userId) {
  const supabaseAdmin = requireSupabaseAdmin()

  if (typeof input.accountName === 'string' && input.accountName.trim()) {
    await updateAccount(accountId, {
      name: input.accountName,
    }, userId)
  }

  const payload = {
    account_id: accountId,
    tone: trimText(input.tone),
    persona: trimText(input.persona),
    target_audience: trimText(input.targetAudience),
    goal: trimText(input.goal),
    strategy: trimText(input.strategy),
    settings: normalizeSettings(input.settings),
  }

  const { data, error } = await supabaseAdmin
    .from('account_profiles')
    .upsert(payload, { onConflict: 'account_id' })
    .select('account_id, tone, persona, target_audience, goal, strategy, settings, created_at, updated_at')
    .single()

  if (error) {
    throw new AppError('Failed to save account profile', {
      code: 'ACCOUNT_PROFILE_SAVE_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  return data
}
