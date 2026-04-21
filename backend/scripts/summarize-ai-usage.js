import { readFileSync } from 'node:fs'

const PRICE_MAP = {
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4.1': { inputPer1M: 2, outputPer1M: 8 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
}

function formatCurrencyKRW(value, exchangeRate = 1350) {
  const krw = value * exchangeRate
  return `${Math.round(krw).toLocaleString('ko-KR')}원`
}

function formatUsd(value) {
  return `$${value.toFixed(4)}`
}

function normalizeOperation(operation = '') {
  if (String(operation).startsWith('abc-')) {
    return 'abc'
  }
  if (operation === 'copilot-feedback') {
    return 'feedback'
  }
  if (operation === 'copilot-refine') {
    return 'copilot'
  }
  return String(operation || 'other')
}

function estimateCost({ model, promptTokens = 0, completionTokens = 0 }) {
  const pricing = PRICE_MAP[model]
  if (!pricing) return 0
  return (
    (promptTokens / 1_000_000) * pricing.inputPer1M +
    (completionTokens / 1_000_000) * pricing.outputPer1M
  )
}

function parseUsageLines(input) {
  return input
    .split(/\r?\n/)
    .filter((line) => line.includes('[ai-usage]'))
    .map((line) => {
      const jsonStart = line.indexOf('{')
      if (jsonStart < 0) return null
      try {
        const parsed = JSON.parse(line.slice(jsonStart))
        return {
          operation: String(parsed.operation || ''),
          normalizedOperation: normalizeOperation(parsed.operation),
          promptTokens: Number(parsed.promptTokens || 0),
          completionTokens: Number(parsed.completionTokens || 0),
          totalTokens: Number(parsed.totalTokens || 0),
          model: String(parsed.model || ''),
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function summarize(entries) {
  const groups = new Map()

  for (const entry of entries) {
    const key = `${entry.normalizedOperation}__${entry.model}`
    const current = groups.get(key) || {
      operation: entry.normalizedOperation,
      model: entry.model,
      count: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
    }

    current.count += 1
    current.promptTokens += entry.promptTokens
    current.completionTokens += entry.completionTokens
    current.totalTokens += entry.totalTokens || entry.promptTokens + entry.completionTokens
    current.totalCostUsd += estimateCost(entry)

    groups.set(key, current)
  }

  return Array.from(groups.values()).sort((a, b) => {
    const order = ['abc', 'feedback', 'copilot', 'other']
    const orderDiff = order.indexOf(a.operation) - order.indexOf(b.operation)
    if (orderDiff !== 0) return orderDiff
    return a.model.localeCompare(b.model)
  })
}

function printSummary(rows) {
  if (!rows.length) {
    console.log('No [ai-usage] lines found.')
    process.exit(0)
  }

  const header = [
    'operation'.padEnd(10),
    'model'.padEnd(16),
    'count'.padStart(5),
    'avg prompt'.padStart(12),
    'avg completion'.padStart(15),
    'avg total'.padStart(12),
    'avg cost'.padStart(12),
    'total cost'.padStart(12),
  ].join(' | ')

  console.log(header)
  console.log('-'.repeat(header.length))

  for (const row of rows) {
    const avgPrompt = Math.round(row.promptTokens / row.count)
    const avgCompletion = Math.round(row.completionTokens / row.count)
    const avgTotal = Math.round(row.totalTokens / row.count)
    const avgCostUsd = row.totalCostUsd / row.count

    console.log(
      [
        row.operation.padEnd(10),
        row.model.padEnd(16),
        String(row.count).padStart(5),
        String(avgPrompt).padStart(12),
        String(avgCompletion).padStart(15),
        String(avgTotal).padStart(12),
        formatCurrencyKRW(avgCostUsd).padStart(12),
        formatCurrencyKRW(row.totalCostUsd).padStart(12),
      ].join(' | '),
    )
  }

  const overallCount = rows.reduce((sum, row) => sum + row.count, 0)
  const overallCost = rows.reduce((sum, row) => sum + row.totalCostUsd, 0)
  console.log('')
  console.log(`총 호출 수: ${overallCount}`)
  console.log(`총 추정 비용: ${formatUsd(overallCost)} / ${formatCurrencyKRW(overallCost)}`)
}

function main() {
  const path = process.argv[2]
  const input = path ? readFileSync(path, 'utf8') : readFileSync(0, 'utf8')
  const entries = parseUsageLines(input)
  const summary = summarize(entries)
  printSummary(summary)
}

main()
