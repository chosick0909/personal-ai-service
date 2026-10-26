import test from 'node:test'
import assert from 'node:assert/strict'
import { setDemoUsers, isDemoUser } from '../src/creator-tools/demo-access.js'
import { assertCreatorCoupon } from '../src/creator-tools/access.js'
import { studio2Enabled } from '../src/creator-tools/studio/access.js'
import { successReelsEnabled } from '../src/creator-tools/success-reels-routes.js'
import { featureEnabled } from '../src/creator-tools/domain.js'

test('a trial account uses the studio without a coupon or preview listing until its link expires or is turned off', async () => {
  const now = Date.parse('2026-10-26T00:00:00Z')
  setDemoUsers([
    { user_id: 'trial-1', expires_at: '2026-11-25T00:00:00Z', revoked_at: null },
    { user_id: 'trial-off', expires_at: '2026-11-25T00:00:00Z', revoked_at: '2026-10-25T00:00:00Z' },
    { user_id: 'trial-old', expires_at: '2026-10-01T00:00:00Z', revoked_at: null },
  ], now)
  assert.equal(isDemoUser('trial-1', now), true)
  assert.equal(isDemoUser('trial-off', now), false)
  assert.equal(isDemoUser('trial-old', now), false)
  const noDb = { from: () => assert.fail('a trial account needs no entitlement lookup') }
  const grant = await assertCreatorCoupon(noDb, 'trial-1', now)
  assert.equal(grant.ends_at, '2026-11-25T00:00:00Z')
  assert.equal(studio2Enabled('trial-1', {}), true)
  assert.equal(studio2Enabled('someone', { CREATOR_STUDIO2_USER_IDS: 'x' }), false)
  assert.equal(successReelsEnabled('trial-1', {}), true)
  assert.equal(featureEnabled('media-analyze', 'trial-1', { CREATOR_TOOLS_ENABLED: 'true', CREATOR_TOOLS_FEATURES: 'media-analyze' }), true)
  assert.equal(featureEnabled('media-analyze', 'trial-1', { CREATOR_TOOLS_ENABLED: 'true', CREATOR_TOOLS_FEATURES: '' }), false, 'a feature that is switched off stays off')
  setDemoUsers([])
})
