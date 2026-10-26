// Client trial links: whoever opens a trial link works as that link's own trial account, with no coupon and no
// preview listing. The set of trial accounts lives here (filled from creator_demo_links by the studio routes), so the
// access checks stay synchronous.
const demo = new Map() // userId -> expiresAt (ISO)
export function setDemoUsers(rows, now = Date.now()) {
  demo.clear()
  for (const row of rows) if (row.user_id && !row.revoked_at && Date.parse(row.expires_at) > now) demo.set(row.user_id, row.expires_at)
}
export const isDemoUser = (userId, now = Date.now()) => demo.has(userId) && Date.parse(demo.get(userId)) > now
export const demoEndsAt = userId => demo.get(userId) || null
