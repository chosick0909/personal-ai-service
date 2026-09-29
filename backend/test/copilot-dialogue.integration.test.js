import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('conversation-aware classifier and generator integration (isolated model and DB)', () => {
  const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--test',
    new URL('./fixtures/copilot-dialogue.fixture.mjs', import.meta.url).pathname], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, OPENAI_API_KEY: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
