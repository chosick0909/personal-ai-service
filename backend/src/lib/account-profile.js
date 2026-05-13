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

function isMissingCharacterSchema(error) {
  if (!error) {
    return false
  }

  return (
    error.code === '42P01' ||
    error.code === '42703' ||
    error.code === 'PGRST205' ||
    error.code === 'PGRST204' ||
    String(error.message || '').includes('characters') ||
    String(error.message || '').includes('schema cache')
  )
}

async function syncDefaultCharacterSettings(supabaseAdmin, accountId, settings) {
  const normalizedSettings = settings && typeof settings === 'object' ? settings : {}
  const { data: updatedCharacters, error: updateError } = await supabaseAdmin
    .from('characters')
    .update({ settings: normalizedSettings })
    .eq('account_id', accountId)
    .eq('is_default', true)
    .select('id')

  if (updateError) {
    if (isMissingCharacterSchema(updateError)) {
      return
    }

    throw new AppError('Failed to sync default character settings', {
      code: 'DEFAULT_CHARACTER_SETTINGS_SYNC_FAILED',
      statusCode: 500,
      cause: updateError,
    })
  }

  if (Array.isArray(updatedCharacters) && updatedCharacters.length > 0) {
    return
  }

  const { data: account, error: accountError } = await supabaseAdmin
    .from('accounts')
    .select('id, name, slug')
    .eq('id', accountId)
    .maybeSingle()

  if (accountError) {
    throw new AppError('Failed to load account for default character sync', {
      code: 'DEFAULT_CHARACTER_ACCOUNT_FETCH_FAILED',
      statusCode: 500,
      cause: accountError,
    })
  }

  if (!account) {
    return
  }

  const { error: insertError } = await supabaseAdmin.from('characters').insert({
    account_id: account.id,
    name: account.name || 'Default Character',
    slug: account.slug || null,
    settings: normalizedSettings,
    is_default: true,
  })

  if (insertError) {
    if (isMissingCharacterSchema(insertError)) {
      return
    }

    if (insertError.code === '23505') {
      const retry = await supabaseAdmin
        .from('characters')
        .update({ settings: normalizedSettings })
        .eq('account_id', accountId)
        .eq('is_default', true)

      if (!retry.error || isMissingCharacterSchema(retry.error)) {
        return
      }
    }

    throw new AppError('Failed to create default character settings', {
      code: 'DEFAULT_CHARACTER_SETTINGS_CREATE_FAILED',
      statusCode: 500,
      cause: insertError,
    })
  }
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

  await syncDefaultCharacterSettings(supabaseAdmin, accountId, payload.settings)

  return data
}
