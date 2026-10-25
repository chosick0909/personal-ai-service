// Creator Studio 2 is visible only to listed users until 지영 opens it up.
const DEFAULT_PREVIEW_USER_IDS = ['15c6e788-7d77-4954-be5d-200c2c410dad'] // pizzab4@g.hongik.ac.kr

export function studio2Enabled(userId, env = process.env) {
  if (env.CREATOR_STUDIO2_ENABLED === 'true') return true
  const listed = String(env.CREATOR_STUDIO2_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean)
  return (listed.length ? listed : DEFAULT_PREVIEW_USER_IDS).includes(userId)
}
