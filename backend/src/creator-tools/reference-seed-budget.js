import { stableHash, fail } from './domain.js'
import { accountSearchQueries } from './public-discovery.js'
import { REFERENCE_QUALITY_VERSION } from './reference-quality.js'

const positive = (env, key, fallback) => {
  const value = Number(env[key] ?? fallback)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} must be a positive number`)
  return value
}
export function seedPlan(categories, env = process.env) {
  const maxCalls = positive(env, 'CREATOR_CATALOG_CATEGORY_MAX_CALLS', 100)
  if (!Number.isSafeInteger(maxCalls)) throw new Error('CREATOR_CATALOG_CATEGORY_MAX_CALLS must be an integer')
  const maxUsd = positive(env, 'CREATOR_CATALOG_CATEGORY_MAX_USD', 2)
  // Operator-supplied conservative reservation prices, not a claim about current billing.
  const rates = Object.fromEntries(['SEARCH', 'PROFILE', 'REEL', 'RANK'].map(key =>
    [key.toLowerCase(), positive(env, `CREATOR_CATALOG_${key}_USD`)]))
  const scenarios = categories.map(category => {
    const searches = accountSearchQueries({ category, accountSize:'any' }).length
    // One page, one 20-profile batch, two 240-reel batches, ready on first poll, one rank call.
    const calls = searches + 3 + 6 + 1
    return { category, estimatedCalls:calls, estimatedUsd:Number((searches * rates.search + 20 * rates.profile + 480 * rates.reel + rates.rank).toFixed(6)) }
  })
  const plan = { qualityVersion:REFERENCE_QUALITY_VERSION, region:'KR', performance:{ recentReels:12, minimumMedianViews:10000 }, categories, scenarios, maxCallsPerCategory:maxCalls, maxUsdPerCategory:maxUsd, rates,
    maxCallsTotal:maxCalls * categories.length, maxUsdTotal:maxUsd * categories.length,
    model:env.CREATOR_TEXT_MODEL || env.OPENAI_CHAT_MODEL || 'gpt-4.1',
    note:'Scenario estimate only; cache hits can cost zero, expansion/polling can cost more. Reservations stop before either cap is exceeded. Dataset triggers reserve every requested record; in-flight collections may finish after stopping.' }
  return { ...plan, approval:stableHash(plan).slice(0, 20) }
}
export function createSeedBudget(plan, signal) {
  let calls = 0, reservedUsd = 0
  const beforeCall = ({ provider, operation, units = 1 }) => {
    if (signal?.aborted) fail('SEED_CANCELLED', 'Catalog collection cancelled', 409)
    let cost
    if (provider === 'openai' && operation === 'rank-accounts') cost = plan.rates.rank
    else if (provider === 'brightdata' && operation === 'account-search') cost = plan.rates.search
    else if (provider === 'brightdata' && operation === 'profiles-trigger') cost = units * plan.rates.profile
    else if (provider === 'brightdata' && operation === 'account-reels-trigger') cost = units * plan.rates.reel
    else if (provider === 'brightdata' && /^(profiles|account-reels)-(progress|download)$/.test(operation)) cost = 0
    else fail('SEED_BUDGET', 'Unbudgeted catalog provider operation', 429)
    if (!Number.isSafeInteger(units) || units < 1 || calls >= plan.maxCallsPerCategory
      || reservedUsd >= plan.maxUsdPerCategory || reservedUsd + cost > plan.maxUsdPerCategory + 1e-9) {
      fail('SEED_BUDGET', 'Category call/cost reservation cap reached; collection stopped', 429)
    }
    calls += 1
    reservedUsd = Number((reservedUsd + cost).toFixed(9))
  }
  return { beforeCall, summary:() => ({ calls, reservedUsd }) }
}
export function requireSeedApproval(args, plan) {
  if (!args.includes('--execute') || !args.includes(`--approve=${plan.approval}`)) {
    throw new Error(`No paid call made. After reviewing this plan, use --execute --approve=${plan.approval}`)
  }
}
