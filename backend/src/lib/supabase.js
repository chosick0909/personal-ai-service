import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { Agent, fetch as undiciFetch } from 'undici'

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim()
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const caCertPath =
    process.env.SUPABASE_CA_CERT_PATH?.trim() ||
    process.env.NODE_EXTRA_CA_CERTS?.trim() ||
    ''
  const insecureTls = process.env.SUPABASE_TLS_INSECURE === 'true'

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    caCertPath,
    insecureTls,
    hasConfig: Boolean(supabaseUrl && supabaseServiceRoleKey),
  }
}

let cachedDispatcher

function getSupabaseDispatcher({ caCertPath, insecureTls }) {
  if (cachedDispatcher) {
    return cachedDispatcher
  }

  if (insecureTls) {
    cachedDispatcher = new Agent({
      connect: {
        rejectUnauthorized: false,
      },
    })

    return cachedDispatcher
  }

  if (caCertPath) {
    cachedDispatcher = new Agent({
      connect: {
        ca: readFileSync(caCertPath, 'utf8'),
      },
    })

    return cachedDispatcher
  }

  return undefined
}

function createSupabaseFetch(config) {
  const dispatcher = getSupabaseDispatcher(config)

  if (!dispatcher) {
    return undefined
  }

  return (input, init) =>
    undiciFetch(input, {
      ...init,
      dispatcher,
    })
}

export function hasSupabaseAdminConfig() {
  return getSupabaseConfig().hasConfig
}

export function getSupabaseAdmin() {
  const config = getSupabaseConfig()
  const { hasConfig, supabaseUrl, supabaseServiceRoleKey } = config

  if (!hasConfig) {
    return null
  }

  const customFetch = createSupabaseFetch(config)

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: customFetch
      ? {
          fetch: customFetch,
        }
      : undefined,
  })
}
