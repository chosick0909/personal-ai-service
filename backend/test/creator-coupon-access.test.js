import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (!mock.module) {
  test('creator coupon HTTP access policy', () => {
    const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--test', fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    assert.equal(child.status, 0, child.stdout + child.stderr)
  })
} else {
  const user = '11111111-1111-4111-8111-111111111111'
  const valid = { id: 'grant', user_id: user, coupon_id: 'coupon', status: 'active', starts_at: '2020-01-01', ends_at: '2099-01-01' }
  let rows = [], dbError = null, calls = 0
  const db = { from(table) {
    assert.equal(table, 'user_entitlements', 'access must be checked before any product query')
    calls++
    const filters = []
    const q = {
      select() { return q },
      eq(k, v) { filters.push(row => row[k] === v); return q },
      not(k, op, v) { assert.equal(op, 'is'); filters.push(row => row[k] !== v); return q },
      lte(k, v) { filters.push(row => Date.parse(row[k]) <= Date.parse(v)); return q },
      or(value) { assert.match(value, /^ends_at.is.null,ends_at.gt./); return q },
      then(resolve, reject) { return Promise.resolve({ data: rows.filter(row => filters.every(fn => fn(row))), error: dbError }).then(resolve, reject) },
    }
    return q
  } }
  mock.module(new URL('../src/lib/supabase.js', import.meta.url).href, { namedExports: { getSupabaseAdmin: () => db, hasSupabaseAdminConfig: () => true } })
  const { default: express } = await import('express')
  const { createCreatorRouter } = await import('../src/creator-tools/routes.js')
  const { assertCreatorCoupon } = await import('../src/creator-tools/access.js')
  const app = express()
  app.use((req, res, next) => { if (req.headers['x-test-user']) req.auth = { userId: req.headers['x-test-user'] }; next() })
  app.use('/api', createCreatorRouter())
  app.get('/api/scripts/control', (req, res) => res.json({ unchanged: true }))
  app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ code: err.code }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const origin = `http://127.0.0.1:${server.address().port}/api`
  const request = (path, method = 'GET', login = true) => fetch(origin + path, { method, headers: login ? { 'x-test-user': user } : {} })
  test.after(() => server.close())
  test('anonymous users cannot enter Studio APIs', async () => {
    const response = await request('/creator-tools/access', 'GET', false)
    assert.equal(response.status, 401)
  })
  test('valid redeemed coupon allows access and supplies expiry', async () => {
    rows = [valid]; dbError = null
    const response = await request('/creator-tools/access')
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { allowed: true, endsAt: valid.ends_at })
  })
  test('no coupon, manual grant, expired, revoked, future, malformed dates, and another owner are denied', async () => {
    for (const overrides of [null, {coupon_id: null}, {ends_at: '2000-01-01'}, {status: 'revoked'}, {starts_at: '2099-01-01'}, {ends_at: 'invalid'}, {user_id: 'other'}]) {
      rows = overrides === null ? [] : [{...valid, ...overrides}]
      const response = await request('/creator-tools/access')
      assert.equal(response.status, 403, JSON.stringify(overrides))
    }
  })
  test('all existing Studio endpoints, including reads, replay and preference changes, reject expired access', async () => {
    rows = [{...valid, ends_at: '2000-01-01'}]
    for (const [method, path] of [
      ['GET','/creator-tools/capabilities'], ['GET','/creator-tools/jobs'], ['GET','/creator-tools/jobs/test'],
      ['POST','/creator-tools/jobs/test/retry'], ['POST','/discovery/reference-accounts'], ['POST','/discovery/trend-keywords'],
      ['GET','/discovery/reference-accounts/test'], ['GET','/discovery/account-preferences'], ['PUT','/discovery/account-preferences/test'],
      ['POST','/reference-videos/import-link'], ['POST','/media-projects'], ['GET','/media-projects/test'],
      ['POST','/media-projects/test/import-transcript'], ['POST','/media-projects/test/analyze'],
      ['PATCH','/media-projects/test/edit-manifest'], ['POST','/media-projects/test/render'],
    ]) assert.equal((await request(path, method)).status, 403, `${method} ${path}`)
  })
  test('historical production and local bypass flags cannot open access', async () => {
    rows = []
    process.env.CREATOR_TOOLS_BYPASS_ENTITLEMENT = 'true'
    process.env.CREATOR_LOCAL_PREVIEW_BYPASS_ENTITLEMENT = 'true'
    process.env.CLIENT_ORIGIN = 'http://localhost:8080'
    assert.equal((await request('/creator-tools/access')).status, 403)
  })
  test('database outage fails closed and reports retryable service failure', async () => {
    rows = [valid]; dbError = {message: 'unavailable'}
    assert.equal((await request('/creator-tools/access')).status, 503)
    dbError = null
  })
  test('expiry boundary and multiple grants are correct', async () => {
    const now = Date.parse('2030-01-01')
    rows = [{...valid, ends_at: '2030-01-01'}]
    await assert.rejects(assertCreatorCoupon(db, user, now), {code: 'CREATOR_COUPON_REQUIRED'})
    rows = [{...valid, ends_at: '2000-01-01'}, {...valid, id:'manual', coupon_id:null}, valid]
    assert.equal((await assertCreatorCoupon(db, user, now)).id, 'grant')
  })
  test('revocation is observed on next request, no access decision cache', async () => {
    rows = [valid]
    assert.equal((await request('/creator-tools/access')).status, 200)
    rows = [{...valid, status:'revoked'}]
    assert.equal((await request('/creator-tools/access')).status, 403)
  })
  test('shared /api mount does not gate existing writer endpoints', async () => {
    rows = []; const previousCalls = calls
    assert.equal((await request('/scripts/control')).status, 200)
    assert.equal(calls, previousCalls)
  })
}
