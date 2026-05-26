import dotenv from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from '../src/lib/supabase.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../../.env') })

function parseDays() {
  const arg = process.argv.find((item) => item.startsWith('--days='))
  const value = Number(arg ? arg.split('=')[1] : 14)
  return Number.isFinite(value) ? Math.max(1, Math.min(90, Math.round(value))) : 14
}

function dayKey(value) {
  return new Date(value).toISOString().slice(0, 10)
}

function increment(map, day, field, amount = 1) {
  const current = map.get(day) || {
    day,
    referenceAnalyses: 0,
    copilotMessages: 0,
    suggestionCreated: 0,
    suggestionApplied: 0,
    feedbackCreated: 0,
    feedbackApplied: 0,
    referencesCreated: 0,
    scriptsCreated: 0,
    aiCalls: 0,
    aiCostUsd: 0,
  }
  current[field] += amount
  map.set(day, current)
}

async function fetchAll(table, select, sinceIso) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from(table)
    .select(select)
    .gte('created_at', sinceIso)

  if (error) {
    if (String(error.message || '').includes('Could not find the table')) {
      console.warn(`[metrics] ${table} table is not available yet. Returning empty rows.`)
      return []
    }
    throw new Error(`${table} query failed: ${error.message}`)
  }

  return Array.isArray(data) ? data : []
}

function rate(numerator, denominator) {
  if (!denominator) return '0.0%'
  return `${((numerator / denominator) * 100).toFixed(1)}%`
}

function formatUsd(value) {
  return `$${Number(value || 0).toFixed(4)}`
}

async function main() {
  if (!hasSupabaseAdminConfig()) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  }

  const days = parseDays()
  const since = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000)
  since.setUTCHours(0, 0, 0, 0)
  const sinceIso = since.toISOString()
  const rowsByDay = new Map()

  const [usageEvents, qualityEvents, aiUsageLogs, references, scripts] = await Promise.all([
    fetchAll('usage_events', 'event_type, created_at', sinceIso),
    fetchAll('copilot_quality_events', 'event_type, created_at', sinceIso),
    fetchAll('ai_usage_logs', 'operation, estimated_cost_usd, created_at', sinceIso),
    fetchAll('reference_videos', 'id, created_at', sinceIso),
    fetchAll('scripts', 'id, created_at', sinceIso),
  ])

  for (const event of usageEvents) {
    const day = dayKey(event.created_at)
    if (event.event_type === 'reference_analysis') increment(rowsByDay, day, 'referenceAnalyses')
    if (event.event_type === 'copilot_message') increment(rowsByDay, day, 'copilotMessages')
  }

  for (const event of qualityEvents) {
    const day = dayKey(event.created_at)
    if (event.event_type === 'suggestion_created') increment(rowsByDay, day, 'suggestionCreated')
    if (event.event_type === 'suggestion_applied') increment(rowsByDay, day, 'suggestionApplied')
    if (event.event_type === 'feedback_created') increment(rowsByDay, day, 'feedbackCreated')
    if (event.event_type === 'feedback_applied') increment(rowsByDay, day, 'feedbackApplied')
  }

  for (const item of references) {
    increment(rowsByDay, dayKey(item.created_at), 'referencesCreated')
  }

  for (const item of scripts) {
    increment(rowsByDay, dayKey(item.created_at), 'scriptsCreated')
  }

  for (const item of aiUsageLogs) {
    const day = dayKey(item.created_at)
    increment(rowsByDay, day, 'aiCalls')
    increment(rowsByDay, day, 'aiCostUsd', Number(item.estimated_cost_usd || 0))
  }

  const rows = Array.from(rowsByDay.values()).sort((a, b) => a.day.localeCompare(b.day))

  const header = [
    'day'.padEnd(10),
    'refs'.padStart(5),
    'copilot'.padStart(7),
    'sugg apply'.padStart(11),
    'feedback apply'.padStart(14),
    'A/B/C select'.padStart(12),
    'ai calls'.padStart(8),
    'ai cost'.padStart(10),
  ].join(' | ')

  console.log(header)
  console.log('-'.repeat(header.length))

  for (const row of rows) {
    console.log(
      [
        row.day.padEnd(10),
        String(row.referenceAnalyses).padStart(5),
        String(row.copilotMessages).padStart(7),
        rate(row.suggestionApplied, row.suggestionCreated).padStart(11),
        rate(row.feedbackApplied, row.feedbackCreated).padStart(14),
        rate(row.scriptsCreated, row.referencesCreated).padStart(12),
        String(row.aiCalls).padStart(8),
        formatUsd(row.aiCostUsd).padStart(10),
      ].join(' | '),
    )
  }
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
