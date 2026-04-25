import { AppError } from './errors.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'

export const COUPON_CODES = {
  openBeta: 'WELCOME2OPENBETA_0425',
  student: 'WELCOME2INSTACAMPUS_0425',
}

const PLAN_LIMITS = {
  open_beta: {
    monthlyReferenceLimit: null,
    perReferenceCopilotLimit: null,
    perReferenceFeedbackLimit: null,
  },
  student: {
    monthlyReferenceLimit: 30,
    perReferenceCopilotLimit: 5,
    perReferenceFeedbackLimit: 2,
  },
  paid: {
    monthlyReferenceLimit: null,
    perReferenceCopilotLimit: null,
    perReferenceFeedbackLimit: null,
  },
}

const EVENT_TYPES = new Set(['reference_analysis', 'copilot_message', 'feedback_request'])

function requireSupabaseAdmin() {
  if (!hasSupabaseAdminConfig()) {
    throw new AppError('Supabase admin client is not configured', {
      code: 'SUPABASE_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  return getSupabaseAdmin()
}

function normalizeCouponCode(value = '') {
  return String(value || '').trim().toUpperCase()
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function addMonths(date, months) {
  const next = new Date(date)
  next.setMonth(next.getMonth() + months)
  return next
}

function getMonthStartIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString()
}

function getPlanLimits(planType) {
  return PLAN_LIMITS[planType] || PLAN_LIMITS.paid
}

async function runEntitlementQuery(action, operation) {
  try {
    return await operation()
  } catch (cause) {
    throw new AppError('이용권 정보를 처리하지 못했습니다. 잠시 후 다시 시도해주세요.', {
      code: 'ENTITLEMENT_QUERY_FAILED',
      statusCode: 500,
      exposeMessage: true,
      details: { action },
      cause,
    })
  }
}

function normalizeEntitlement(row, limitsRow, usage = {}) {
  if (!row) {
    return {
      hasAccess: false,
      entitlement: null,
      usage: null,
    }
  }

  const planLimits = getPlanLimits(row.plan_type)
  const limits = {
    monthlyReferenceLimit:
      limitsRow?.monthly_reference_limit ?? planLimits.monthlyReferenceLimit,
    perReferenceCopilotLimit:
      limitsRow?.per_reference_copilot_limit ?? planLimits.perReferenceCopilotLimit,
    perReferenceFeedbackLimit:
      limitsRow?.per_reference_feedback_limit ?? planLimits.perReferenceFeedbackLimit,
  }

  return {
    hasAccess: true,
    entitlement: {
      id: row.id,
      planType: row.plan_type,
      status: row.status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      limits,
    },
    usage: {
      monthlyReferenceUsed: usage.monthlyReferenceUsed ?? 0,
      currentReferenceCopilotUsed: usage.currentReferenceCopilotUsed ?? null,
      currentReferenceFeedbackUsed: usage.currentReferenceFeedbackUsed ?? null,
      limits,
    },
  }
}

async function loadActiveEntitlementRows(supabaseAdmin, userId) {
  const nowIso = new Date().toISOString()
  const { data, error } = await runEntitlementQuery('loadActiveEntitlement', () =>
    supabaseAdmin
      .from('user_entitlements')
      .select('id, user_id, coupon_id, plan_type, status, starts_at, ends_at, created_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .lte('starts_at', nowIso)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .order('ends_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(1),
  )

  if (error) {
    throw new AppError('이용권 조회에 실패했습니다.', {
      code: 'ENTITLEMENT_LOOKUP_FAILED',
      statusCode: 500,
      exposeMessage: true,
      cause: error,
    })
  }

  return data?.[0] || null
}

async function loadEntitlementLimits(supabaseAdmin, entitlementId) {
  if (!entitlementId) {
    return null
  }

  const { data, error } = await runEntitlementQuery('loadEntitlementLimits', () =>
    supabaseAdmin
      .from('entitlement_limits')
      .select('monthly_reference_limit, per_reference_copilot_limit, per_reference_feedback_limit')
      .eq('entitlement_id', entitlementId)
      .maybeSingle(),
  )

  if (error) {
    throw new AppError('이용권 제한 조회에 실패했습니다.', {
      code: 'ENTITLEMENT_LIMIT_LOOKUP_FAILED',
      statusCode: 500,
      exposeMessage: true,
      cause: error,
    })
  }

  return data || null
}

async function countUsageEvents({ supabaseAdmin, userId, entitlementId, eventType, referenceId, since }) {
  let query = supabaseAdmin
    .from('usage_events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('entitlement_id', entitlementId)
    .eq('event_type', eventType)

  if (referenceId) {
    query = query.eq('reference_id', referenceId)
  }

  if (since) {
    query = query.gte('created_at', since)
  }

  const { count, error } = await runEntitlementQuery('countUsageEvents', () => query)

  if (error) {
    throw new AppError('사용량 조회에 실패했습니다.', {
      code: 'USAGE_LOOKUP_FAILED',
      statusCode: 500,
      exposeMessage: true,
      cause: error,
    })
  }

  return count || 0
}

export async function getUserEntitlementStatus({ userId, referenceId = null }) {
  const normalizedUserId = String(userId || '').trim()
  if (!normalizedUserId) {
    throw new AppError('로그인이 필요합니다.', {
      code: 'UNAUTHORIZED',
      statusCode: 401,
      exposeMessage: true,
    })
  }

  const supabaseAdmin = requireSupabaseAdmin()
  const entitlement = await loadActiveEntitlementRows(supabaseAdmin, normalizedUserId)

  if (!entitlement) {
    return normalizeEntitlement(null, null)
  }

  const limits = await loadEntitlementLimits(supabaseAdmin, entitlement.id)
  const monthlyReferenceUsed = await countUsageEvents({
    supabaseAdmin,
    userId: normalizedUserId,
    entitlementId: entitlement.id,
    eventType: 'reference_analysis',
    since: getMonthStartIso(),
  })
  const currentReferenceCopilotUsed = referenceId
    ? await countUsageEvents({
        supabaseAdmin,
        userId: normalizedUserId,
        entitlementId: entitlement.id,
        eventType: 'copilot_message',
        referenceId,
      })
    : null
  const currentReferenceFeedbackUsed = referenceId
    ? await countUsageEvents({
        supabaseAdmin,
        userId: normalizedUserId,
        entitlementId: entitlement.id,
        eventType: 'feedback_request',
        referenceId,
      })
    : null

  return normalizeEntitlement(entitlement, limits, {
    monthlyReferenceUsed,
    currentReferenceCopilotUsed,
    currentReferenceFeedbackUsed,
  })
}

export async function applyCouponToUser({ userId, couponCode }) {
  const normalizedUserId = String(userId || '').trim()
  const normalizedCode = normalizeCouponCode(couponCode)

  if (!normalizedUserId) {
    throw new AppError('로그인이 필요합니다.', {
      code: 'UNAUTHORIZED',
      statusCode: 401,
      exposeMessage: true,
    })
  }

  if (!normalizedCode) {
    throw new AppError('쿠폰 코드를 입력해주세요.', {
      code: 'COUPON_CODE_REQUIRED',
      statusCode: 400,
      exposeMessage: true,
    })
  }

  const supabaseAdmin = requireSupabaseAdmin()
  const now = new Date()
  const nowIso = now.toISOString()

  const { data: coupon, error: couponError } = await runEntitlementQuery('loadCoupon', () =>
    supabaseAdmin
      .from('coupons')
      .select('id, code, type, active, max_redemptions, redeemed_count, expires_at')
      .eq('code', normalizedCode)
      .maybeSingle(),
  )

  if (couponError) {
    throw new AppError('쿠폰 조회에 실패했습니다.', {
      code: 'COUPON_LOOKUP_FAILED',
      statusCode: 500,
      exposeMessage: true,
      cause: couponError,
    })
  }

  if (!coupon || !coupon.active) {
    throw new AppError('유효하지 않은 쿠폰 코드입니다.', {
      code: 'INVALID_COUPON',
      statusCode: 404,
      exposeMessage: true,
    })
  }

  if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= now.getTime()) {
    throw new AppError('만료된 쿠폰입니다.', {
      code: 'COUPON_EXPIRED',
      statusCode: 410,
      exposeMessage: true,
    })
  }

  if (
    coupon.max_redemptions !== null &&
    Number(coupon.max_redemptions) > 0 &&
    Number(coupon.redeemed_count || 0) >= Number(coupon.max_redemptions)
  ) {
    throw new AppError('사용 가능한 쿠폰 수량이 모두 소진되었습니다.', {
      code: 'COUPON_REDEEMED_OUT',
      statusCode: 409,
      exposeMessage: true,
    })
  }

  const { data: existingRedemption, error: redemptionError } = await runEntitlementQuery(
    'loadExistingCouponRedemption',
    () =>
      supabaseAdmin
        .from('user_entitlements')
        .select('id')
        .eq('user_id', normalizedUserId)
        .eq('coupon_id', coupon.id)
        .limit(1),
  )

  if (redemptionError) {
    throw new AppError('쿠폰 사용 이력 조회에 실패했습니다.', {
      code: 'COUPON_REDEMPTION_LOOKUP_FAILED',
      statusCode: 500,
      exposeMessage: true,
      cause: redemptionError,
    })
  }

  if (existingRedemption?.length) {
    throw new AppError('이미 이 계정에서 사용한 쿠폰입니다.', {
      code: 'COUPON_ALREADY_REDEEMED',
      statusCode: 409,
      exposeMessage: true,
    })
  }

  const planType = coupon.type === 'student' ? 'student' : 'open_beta'
  const endsAt = planType === 'student' ? addMonths(now, 3) : addDays(now, 7)
  const planLimits = getPlanLimits(planType)

  const { data: entitlement, error: insertError } = await runEntitlementQuery('createEntitlement', () =>
    supabaseAdmin
      .from('user_entitlements')
      .insert({
        user_id: normalizedUserId,
        coupon_id: coupon.id,
        plan_type: planType,
        status: 'active',
        starts_at: nowIso,
        ends_at: endsAt.toISOString(),
      })
      .select('id, user_id, coupon_id, plan_type, status, starts_at, ends_at, created_at')
      .single(),
  )

  if (insertError) {
    throw new AppError('이용권 활성화에 실패했습니다.', {
      code: 'ENTITLEMENT_CREATE_FAILED',
      statusCode: 500,
      exposeMessage: true,
      cause: insertError,
    })
  }

  const { data: limits, error: limitsError } = await runEntitlementQuery('createEntitlementLimits', () =>
    supabaseAdmin
      .from('entitlement_limits')
      .insert({
        entitlement_id: entitlement.id,
        monthly_reference_limit: planLimits.monthlyReferenceLimit,
        per_reference_copilot_limit: planLimits.perReferenceCopilotLimit,
        per_reference_feedback_limit: planLimits.perReferenceFeedbackLimit,
      })
      .select('monthly_reference_limit, per_reference_copilot_limit, per_reference_feedback_limit')
      .single(),
  )

  if (limitsError) {
    throw new AppError('이용권 제한 설정에 실패했습니다.', {
      code: 'ENTITLEMENT_LIMIT_CREATE_FAILED',
      statusCode: 500,
      exposeMessage: true,
      cause: limitsError,
    })
  }

  await runEntitlementQuery('incrementCouponRedemption', () =>
    supabaseAdmin
      .from('coupons')
      .update({ redeemed_count: Number(coupon.redeemed_count || 0) + 1 })
      .eq('id', coupon.id),
  )

  return normalizeEntitlement(entitlement, limits)
}

function requireReferenceIdForEvent(eventType, referenceId) {
  if (eventType !== 'reference_analysis' && !String(referenceId || '').trim()) {
    throw new AppError('레퍼런스 ID가 필요합니다.', {
      code: 'REFERENCE_ID_REQUIRED',
      statusCode: 400,
      exposeMessage: true,
    })
  }
}

export async function assertUsageAllowed({ userId, eventType, referenceId = null }) {
  if (!EVENT_TYPES.has(eventType)) {
    throw new AppError('지원하지 않는 사용량 이벤트입니다.', {
      code: 'INVALID_USAGE_EVENT',
      statusCode: 400,
      exposeMessage: true,
    })
  }

  requireReferenceIdForEvent(eventType, referenceId)

  const status = await getUserEntitlementStatus({ userId, referenceId })

  if (!status.hasAccess || !status.entitlement) {
    throw new AppError('이용권이 필요합니다. 쿠폰을 적용하거나 이용권을 활성화해주세요.', {
      code: 'ENTITLEMENT_REQUIRED',
      statusCode: 402,
      exposeMessage: true,
    })
  }

  const { limits } = status.entitlement

  if (
    eventType === 'reference_analysis' &&
    limits.monthlyReferenceLimit !== null &&
    status.usage.monthlyReferenceUsed >= limits.monthlyReferenceLimit
  ) {
    throw new AppError('이번 달 레퍼런스 분석 한도 30회를 모두 사용했습니다.', {
      code: 'MONTHLY_REFERENCE_LIMIT_REACHED',
      statusCode: 429,
      exposeMessage: true,
      details: {
        used: status.usage.monthlyReferenceUsed,
        limit: limits.monthlyReferenceLimit,
      },
    })
  }

  if (
    eventType === 'copilot_message' &&
    limits.perReferenceCopilotLimit !== null &&
    status.usage.currentReferenceCopilotUsed >= limits.perReferenceCopilotLimit
  ) {
    throw new AppError('이 레퍼런스의 코파일럿 대화 5회를 모두 사용했습니다.', {
      code: 'REFERENCE_COPILOT_LIMIT_REACHED',
      statusCode: 429,
      exposeMessage: true,
      details: {
        used: status.usage.currentReferenceCopilotUsed,
        limit: limits.perReferenceCopilotLimit,
      },
    })
  }

  if (
    eventType === 'feedback_request' &&
    limits.perReferenceFeedbackLimit !== null &&
    status.usage.currentReferenceFeedbackUsed >= limits.perReferenceFeedbackLimit
  ) {
    throw new AppError('이 레퍼런스의 피드백 2회를 모두 사용했습니다.', {
      code: 'REFERENCE_FEEDBACK_LIMIT_REACHED',
      statusCode: 429,
      exposeMessage: true,
      details: {
        used: status.usage.currentReferenceFeedbackUsed,
        limit: limits.perReferenceFeedbackLimit,
      },
    })
  }

  return status
}

export async function recordUsageEvent({ userId, entitlementId, eventType, referenceId = null }) {
  if (!EVENT_TYPES.has(eventType)) {
    return null
  }

  const normalizedUserId = String(userId || '').trim()
  const normalizedEntitlementId = String(entitlementId || '').trim()
  if (!normalizedUserId || !normalizedEntitlementId) {
    return null
  }

  const supabaseAdmin = requireSupabaseAdmin()
  const { data, error } = await runEntitlementQuery('recordUsageEvent', () =>
    supabaseAdmin
      .from('usage_events')
      .insert({
        user_id: normalizedUserId,
        entitlement_id: normalizedEntitlementId,
        reference_id: referenceId || null,
        event_type: eventType,
      })
      .select('id, created_at')
      .single(),
  )

  if (error) {
    throw new AppError('사용량 기록에 실패했습니다.', {
      code: 'USAGE_RECORD_FAILED',
      statusCode: 500,
      exposeMessage: true,
      cause: error,
    })
  }

  return data
}
