import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COUPON_CODES,
  getCouponPlanLimits,
  getCouponPlanType,
  getEntitlementEndAt,
  resolveEntitlementLimits,
} from '../src/lib/entitlements.js'

test('management coupon maps to unlimited paid access', () => {
  const startsAt = new Date('2026-08-05T00:00:00.000Z')

  assert.equal(COUPON_CODES.management, 'HOOK_AI_MANAGE')
  assert.equal(getCouponPlanType('admin'), 'paid')
  assert.equal(getEntitlementEndAt('paid', startsAt, 'admin'), null)
  assert.deepEqual(getCouponPlanLimits('paid', COUPON_CODES.management), {
    monthlyReferenceLimit: null,
    perReferenceCopilotLimit: null,
    perReferenceFeedbackLimit: null,
  })
})

test('existing coupon durations remain unchanged', () => {
  const startsAt = new Date('2026-08-05T00:00:00.000Z')

  assert.equal(getCouponPlanType('student'), 'student')
  assert.equal(getEntitlementEndAt('student', startsAt, 'student').toISOString(), '2026-11-05T00:00:00.000Z')
  assert.equal(getCouponPlanType('challenge'), 'challenge')
  assert.equal(getEntitlementEndAt('challenge', startsAt, 'challenge').toISOString(), '2026-09-05T00:00:00.000Z')
  assert.equal(getCouponPlanType('open_beta'), 'open_beta')
  assert.equal(getEntitlementEndAt('open_beta', startsAt, 'open_beta').toISOString(), '2026-08-12T00:00:00.000Z')
})

test('instacampus student coupons create unlimited usage limits', () => {
  for (const code of ['WELCOME2INSTACAMPUS_0425', 'welcome2instacampus_0518']) {
    assert.deepEqual(getCouponPlanLimits('student', code), {
      monthlyReferenceLimit: null,
      perReferenceCopilotLimit: null,
      perReferenceFeedbackLimit: null,
    })
  }
})

test('regular student coupons resolve to unlimited usage limits', () => {
  assert.deepEqual(getCouponPlanLimits('student', 'SOME_OTHER_STUDENT_COUPON'), {
    monthlyReferenceLimit: null,
    perReferenceCopilotLimit: null,
    perReferenceFeedbackLimit: null,
  })
})

test('explicit null entitlement limit values stay unlimited', () => {
  assert.deepEqual(
    resolveEntitlementLimits('student', {
      monthly_reference_limit: null,
      per_reference_copilot_limit: null,
      per_reference_feedback_limit: null,
    }),
    {
      monthlyReferenceLimit: null,
      perReferenceCopilotLimit: null,
      perReferenceFeedbackLimit: null,
    },
  )
})

test('missing entitlement limit rows fall back to plan defaults', () => {
  assert.deepEqual(resolveEntitlementLimits('student', null), {
    monthlyReferenceLimit: null,
    perReferenceCopilotLimit: null,
    perReferenceFeedbackLimit: null,
  })
})

test('stored finite entitlement limit rows are ignored while limits are forced unlimited', () => {
  assert.deepEqual(resolveEntitlementLimits('student', {
    monthly_reference_limit: 30,
    per_reference_copilot_limit: 5,
    per_reference_feedback_limit: 2,
  }), {
    monthlyReferenceLimit: null,
    perReferenceCopilotLimit: null,
    perReferenceFeedbackLimit: null,
  })
})
