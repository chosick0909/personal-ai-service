import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { normalizeReviewedCatalog } from '../src/creator-tools/reference-catalog.js'

const rows = JSON.parse(await readFile(new URL('../catalog/home-2026-09-20.reviewed.json', import.meta.url)))
const reviewedAt = Math.max(...rows.map(row => Date.parse(row.reviewedAt)))
test('user-approved 44-account snapshot satisfies the full import contract at review time', () => {
  const normalized = normalizeReviewedCatalog(rows, reviewedAt + 1000)
  assert.equal(normalized.length, 44)
  assert.equal(new Set(normalized.map(row => row.username)).size, 44)
  assert.ok(normalized.every(row => row.profile.followers >= 10000 && row.profile.reviewedByOperator === true))
  assert.ok(normalized.every(row => row.profile.categories.length === 1 && row.profile.categories[0] === '살림/인테리어'))
  assert.ok(!normalized.some(row => ['karennppo','love1004kgj'].includes(row.username)))
})
test('committed approval never overrides 30-day evidence expiry or missing operator approval', () => {
  assert.throws(() => normalizeReviewedCatalog(rows, reviewedAt + 31 * 86400000))
  assert.throws(() => normalizeReviewedCatalog([{ ...rows[0], reviewedByOperator:false }], reviewedAt + 1000))
})
