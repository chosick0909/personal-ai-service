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

export function assertBackendEnv() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]

  const invalid = required.filter((key) => isPlaceholder(process.env[key]))

  if (invalid.length) {
    const message =
      `[env] Invalid backend env: ${invalid.join(', ')}. ` +
      'Set real production values in Railway Variables.'
    throw new Error(message)
  }
}

