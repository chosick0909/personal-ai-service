const PLACEHOLDER_PATTERNS = [
  /your-project-ref/i,
  /your-service-role-key/i,
  /your-anon-key/i,
  /VALUE or \$\{\{REF\}\}/i,
]

function isPlaceholder(value) {
  const text = String(value || '').trim()
  if (!text) {
    return true
  }

  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text))
}

function looksLikeJwt(value) {
  const text = String(value || '').trim()
  const parts = text.split('.')
  return parts.length === 3 && parts.every((part) => part.length > 0)
}

export function assertBackendEnv() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]

  const invalid = required.filter((key) => isPlaceholder(process.env[key]))
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  const environment = String(process.env.NODE_ENV || 'development').trim().toLowerCase()
  const isProduction = environment === 'production'
  const supabaseTlsInsecure = String(process.env.SUPABASE_TLS_INSECURE || '').trim().toLowerCase() === 'true'
  const openaiTlsInsecure = String(process.env.OPENAI_TLS_INSECURE || '').trim().toLowerCase() === 'true'

  if (supabaseUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
    invalid.push('SUPABASE_URL(format)')
  }

  if (serviceRoleKey && !/^sb_secret_/i.test(serviceRoleKey) && !looksLikeJwt(serviceRoleKey)) {
    invalid.push('SUPABASE_SERVICE_ROLE_KEY(format)')
  }

  if (invalid.length) {
    const message =
      `[env] Invalid backend env: ${invalid.join(', ')}. ` +
      'Set real production values in Railway Variables.'
    console.error(message)
  }

  if (isProduction && (supabaseTlsInsecure || openaiTlsInsecure)) {
    throw new Error(
      '[env] Refusing to start with *_TLS_INSECURE=true in production. ' +
        'Enable proper CA trust instead of disabling certificate verification.',
    )
  }
}
