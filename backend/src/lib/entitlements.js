import { AppError, isTransientFetchError } from './errors.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'

export const COUPON_CODES = {
  openBeta: 'WELCOME2OPENBETA_0425',
  student: 'WELCOME2INSTACAMPUS_0425',
  challenge: 'CHEER_TO_CHALLENGE',
}

export const UNLIMITED_STUDENT_COUPON_CODES = new Set([
  'WELCOME2INSTACAMPUS_0425',
  'WELCOME2INSTACAMPUS_0518',
])

const UNLIMITED_LIMITS = {
  monthlyReferenceLimit: null,
  perReferenceCopilotLimit: null,
  perReferenceFeedbackLimit: null,
}

const FORCE_UNLIMITED_USAGE_LIMITS = true

const PLAN_LIMITS = {
  open_beta: {
    monthlyReferenceLimit: null,
    perReferenceCopilotLimit: null,
    perReferenceFeedbackLimit: null,
  },
  student: {
    monthlyReferenceLimit: null,
    perReferenceCopilotLimit: null,
    perReferenceFeedbackLimit: null,
  },
  challenge: {
    monthlyReferenceLimit: null,
    perReferenceCopilotLimit: null,
    perReferenceFeedbackLimit: null,
  },
  paid: {
    monthlyReferenceLimit: null,
    perReferenceCopilotLimit: null,
    perReferenceFeedbackLimit: null,
  },
}

const PLAN_PRIORITY = {
  paid: 4,
  challenge: 3,
  student: 2,
  open_beta: 1,
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

function addMilliseconds(date, milliseconds) {
  return new Date(date.getTime() + milliseconds)
}

function getMonthStartIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString()
}

function getPlanLimits(planType) {
  return PLAN_LIMITS[planType] || PLAN_LIMITS.paid
}

export function getCouponPlanLimits(planType, couponCode) {
  const normalizedCode = normalizeCouponCode(couponCode)
  if (planType === 'student' && UNLIMITED_STUDENT_COUPON_CODES.has(normalizedCode)) {
    return UNLIMITED_LIMITS
  }

  return getPlanLimits(planType)
}

function getPlanPriority(planType) {
  return PLAN_PRIORITY[planType] || 0
}

function compareActiveEntitlements(left, right) {
  const planPriorityDelta = getPlanPriority(right?.plan_type) - getPlanPriority(left?.plan_type)
  if (planPriorityDelta !== 0) {
    return planPriorityDelta
  }

  const leftUnlimited = !left?.ends_at
  const rightUnlimited = !right?.ends_at
  if (leftUnlimited !== rightUnlimited) {
    return leftUnlimited ? -1 : 1
  }

  const leftEndsAt = left?.ends_at ? new Date(left.ends_at).getTime() : Number.POSITIVE_INFINITY
  const rightEndsAt = right?.ends_at ? new Date(right.ends_at).getTime() : Number.POSITIVE_INFINITY
  if (leftEndsAt !== rightEndsAt) {
    return rightEndsAt - leftEndsAt
  }

  const leftCreatedAt = left?.created_at ? new Date(left.created_at).getTime() : 0
  const rightCreatedAt = right?.created_at ? new Date(right.created_at).getTime() : 0
  return rightCreatedAt - leftCreatedAt
}

async function runEntitlementQuery(action, operation) {
  try {
    return await operation()
  } catch (cause) {
    if (isTransientFetchError(cause)) {
      throw new AppError('서버 연결이 일시적으로 불안정해 이용권 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.', {
        code: 'ENTITLEMENT_SERVICE_UNAVAILABLE',
        statusCode: 503,
        exposeMessage: true,
        details: { action },
        cause,
      })
    }

    throw new AppError('이용권 정보를 처리하지 못했습니다. 잠시 후 다시 시도해주세요.', {
      code: 'ENTITLEMENT_QUERY_FAILED',
      statusCode: 500,
      exposeMessage: true,
      details: { action },
      cause,
    })
  }
}

function readLimitValue(limitsRow, field, fallback) {
  if (limitsRow && Object.prototype.hasOwnProperty.call(limitsRow, field)) {
    return limitsRow[field]
  }

  return fallback
}

export function resolveEntitlementLimits(planType, limitsRow) {
  if (FORCE_UNLIMITED_USAGE_LIMITS) {
    return UNLIMITED_LIMITS
  }

  const planLimits = getPlanLimits(planType)
  return {
    monthlyReferenceLimit: readLimitValue(
      limitsRow,
      'monthly_reference_limit',
      planLimits.monthlyReferenceLimit,
    ),
    perReferenceCopilotLimit: readLimitValue(
      limitsRow,
      'per_reference_copilot_limit',
      planLimits.perReferenceCopilotLimit,
    ),
    perReferenceFeedbackLimit: readLimitValue(
      limitsRow,
      'per_reference_feedback_limit',
      planLimits.perReferenceFeedbackLimit,
    ),
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

  const limits = resolveEntitlementLimits(row.plan_type, limitsRow)

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
      .order('created_at', { ascending: false }),
  )

  if (error) {
    throw new AppError('이용권 조회에 실패했습니다.', {
      code: 'ENTITLEMENT_LOOKUP_FAILED',
      statusCode: 500,
      exposeMessage: true,
      cause: error,
    })
  }

  return Array.isArray(data) && data.length
    ? [...data].sort(compareActiveEntitlements)[0]
    : null
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

async function loadActiveOrFutureEntitlements({ supabaseAdmin, userId, planType, nowIso }) {
  let query = supabaseAdmin
    .from('user_entitlements')
    .select('id, user_id, coupon_id, plan_type, status, starts_at, ends_at, created_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order('starts_at', { ascending: true })

  if (planType) {
    query = query.eq('plan_type', planType)
  }

  const { data, error } = await runEntitlementQuery('loadActiveOrFutureEntitlements', () => query)

  if (error) {
    throw new AppError('예정 이용권 조회에 실패했습니다.', {
      code: 'ENTITLEMENT_SCHEDULE_LOOKUP_FAILED',
      statusCode: 500,
      exposeMessage: true,
      cause: error,
    })
  }

  return Array.isArray(data) ? data : []
}

function getCouponPlanType(couponType) {
  if (couponType === 'student') return 'student'
  if (couponType === 'challenge') return 'challenge'
  return 'open_beta'
}

function getEntitlementEndAt(planType, startsAt) {
  if (planType === 'student') return addMonths(startsAt, 3)
  if (planType === 'challenge') return addMonths(startsAt, 1)
  return addDays(startsAt, 7)
}

async function getStudentStartAt({ supabaseAdmin, userId, now, nowIso }) {
  const scheduledChallenges = await loadActiveOrFutureEntitlements({
    supabaseAdmin,
    userId,
    planType: 'challenge',
    nowIso,
  })

  const activeOrFutureChallengeEnds = scheduledChallenges
    .map((row) => (row.ends_at ? new Date(row.ends_at) : null))
    .filter((endsAt) => endsAt && endsAt.getTime() > now.getTime())
    .sort((left, right) => right.getTime() - left.getTime())

  return activeOrFutureChallengeEnds[0] || now
}

async function deferStudentEntitlementsUntil({ supabaseAdmin, userId, startsAt, now, nowIso }) {
  const students = await loadActiveOrFutureEntitlements({
    supabaseAdmin,
    userId,
    planType: 'student',
    nowIso,
  })

  for (const row of students) {
    if (!row.ends_at) {
      continue
    }

    const currentStart = new Date(row.starts_at)
    const currentEnd = new Date(row.ends_at)
    if (currentEnd.getTime() <= now.getTime() || currentStart.getTime() >= startsAt.getTime()) {
      continue
    }

    const remainingStart = currentStart.getTime() > now.getTime() ? currentStart : now
    const remainingDurationMs = Math.max(0, currentEnd.getTime() - remainingStart.getTime())
    const nextEndsAt = addMilliseconds(startsAt, remainingDurationMs)

    const { error } = await runEntitlementQuery('deferStudentEntitlement', () =>
      supabaseAdmin
        .from('user_entitlements')
        .update({
          starts_at: startsAt.toISOString(),
          ends_at: nextEndsAt.toISOString(),
        })
        .eq('id', row.id),
    )

    if (error) {
      throw new AppError('수강생 이용권 대기 처리에 실패했습니다.', {
        code: 'STUDENT_ENTITLEMENT_DEFER_FAILED',
        statusCode: 500,
        exposeMessage: true,
        cause: error,
      })
    }
  }
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
    if (isTransientFetchError(error)) {
      throw new AppError('서버 연결이 일시적으로 불안정해 사용량을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.', {
        code: 'USAGE_SERVICE_UNAVAILABLE',
        statusCode: 503,
        exposeMessage: true,
        cause: error,
      })
    }

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

  const planType = getCouponPlanType(coupon.type)
  const startsAt = planType === 'student'
    ? await getStudentStartAt({ supabaseAdmin, userId: normalizedUserId, now, nowIso })
    : now
  const endsAt = getEntitlementEndAt(planType, startsAt)
  const planLimits = getCouponPlanLimits(planType, coupon.code)

  const { data: entitlement, error: insertError } = await runEntitlementQuery('createEntitlement', () =>
    supabaseAdmin
      .from('user_entitlements')
      .insert({
        user_id: normalizedUserId,
        coupon_id: coupon.id,
        plan_type: planType,
        status: 'active',
        starts_at: startsAt.toISOString(),
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

  if (planType === 'challenge') {
    await deferStudentEntitlementsUntil({
      supabaseAdmin,
      userId: normalizedUserId,
      startsAt: endsAt,
      now,
      nowIso,
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

export async function assertEntitlementAccess({ userId }) {
  const status = await getUserEntitlementStatus({ userId })

  if (!status.hasAccess || !status.entitlement) {
    throw new AppError('이용권이 필요합니다. 쿠폰을 적용하거나 이용권을 활성화해주세요.', {
      code: 'ENTITLEMENT_REQUIRED',
      statusCode: 402,
      exposeMessage: true,
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
