import assert from 'node:assert/strict'
import test from 'node:test'

import { getCouponPlanLimits, resolveEntitlementLimits } from '../src/lib/entitlements.js'

test('instacampus student coupons create unlimited usage limits', () => {
  for (const code of ['WELCOME2INSTACAMPUS_0425', 'welcome2instacampus_0518']) {
    assert.deepEqual(getCouponPlanLimits('student', code), {
      monthlyReferenceLimit: null,
      perReferenceCopilotLimit: null,
      perReferenceFeedbackLimit: null,
    })
  }
})

test('regular student coupons keep student usage limits', () => {
  assert.deepEqual(getCouponPlanLimits('student', 'SOME_OTHER_STUDENT_COUPON'), {
    monthlyReferenceLimit: 30,
    perReferenceCopilotLimit: 5,
    perReferenceFeedbackLimit: 2,
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
    monthlyReferenceLimit: 30,
    perReferenceCopilotLimit: 5,
    perReferenceFeedbackLimit: 2,
  })
})
