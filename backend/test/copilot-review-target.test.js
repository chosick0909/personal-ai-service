import test from 'node:test'
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (typeof mock.module !== 'function') {
  test('revision review contract in isolated process', () => {
    const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--test', fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  })
} else {
  let calls = [], reviewIssues = []
  const client = { chat: { completions: { async create(request) {
    calls.push(request)
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ issues: reviewIssues }) } }] }
  } } } }
  const { topicFlowHarness } = await import('./fixtures/topic-flow-harness.mjs')
  await topicFlowHarness(client)
  const { validateRefinedScriptQuality } = await import('../src/lib/script-assistant.js')
  const source = { hook: '', body: '기존 체험 옵션으로 신청하세요.', cta: '' }
  const candidate = { hook: '', body: '상품 설명을 확인하고 필요한 구성을 선택하세요.', cta: '' }
  const conversationContext = { recentTurns: [{ role: 'assistant', content: '체험 옵션을 추천해요.', proposedSections: source, suggestionApplied: true }] }
  const args = { accountId: 'synthetic-only', referenceId: 'synthetic-only', originalSections: source,
    proposedSections: candidate, request: '체험 옵션은 없어요. 해당 내용 빼줘.', conversationContext, editTarget: 'all' }

  test('only the revised candidate is labeled as review target; baseline and historical suggestions remain comparison data', async () => {
    calls = []; reviewIssues = []
    const result = await validateRefinedScriptQuality(args)
    assert.equal(result.ok, true)
    const request = calls[0]
    assert.equal(request.messages.filter(x => x.role === 'assistant').length, 0, 'previous assistant answers cannot become the reviewer dialogue')
    const payload = request.messages.at(-1).content.split('\n').map(line => { try { return JSON.parse(line) } catch { return null } }).find(x => x?.revisionReview)?.revisionReview
    assert.ok(payload, 'review documents must have explicit, distinct roles')
    assert.deepEqual(payload.baselineBeforeEdit, source)
    assert.deepEqual(payload.candidateAfterEdit, candidate)
    assert.equal(payload.reviewTarget, 'candidateAfterEdit')
    assert.doesNotMatch(request.messages.at(-1).content, /현재 초안\(source of truth/)
    assert.ok(request.messages.some(x => x.content.includes('historicalConversationForContextOnly')))
  })

  test('review receives explicit locks and candidate facts without promoting generated writing advice to requirements', async () => {
    calls = []; reviewIssues = []
    const lockedSource = { hook: '잠근 첫 문장입니다.', body: '기존 설명입니다.', cta: '' }
    await validateRefinedScriptQuality({ ...args, originalSections: lockedSource,
      proposedSections: { ...lockedSource, body: '요청한 새로운 설명입니다.' }, request: '첫 문장은 그대로 두고 설명만 바꿔줘.',
      targetSections: ['body'], preserveSections: ['hook', 'cta'],
      editPlan: { sectionInstructions: { hook: { action: 'keep' }, body: { action: 'revise' } }, mustChange: ['자동 계획의 불필요한 문체 권고'] } })
    const payload = JSON.parse(calls[0].messages.at(-1).content)
    assert.deepEqual(payload.allowedEditSections, ['body'])
    assert.ok(payload.lockedSections.some(item => item.section === 'hook' && item.text === lockedSource.hook))
    assert.equal(JSON.stringify(payload).includes('자동 계획의 불필요한 문체 권고'), false)
    assert.equal(payload.qaMode, undefined)
  })

  test('real unsupported facts in the revised candidate still fail critical review', async () => {
    reviewIssues = [{ type: 'unsupported_experience', severity: 'high', section: 'body', text: '직접 써서 매출이 두 배가 됐어요.', reason: '사용자가 제공하지 않은 경험과 실적', suggestion: '경험과 실적 주장 제거' }]
    const result = await validateRefinedScriptQuality({ ...args, proposedSections: { ...candidate, body: '직접 써서 매출이 두 배가 됐어요.' } })
    assert.equal(result.shouldRepair, true)
    assert.ok(result.issueTypes.includes('unsupported_experience'))
  })

  test('a requested deletion left in the actual candidate is still rejected before semantic review', async () => {
    reviewIssues = []
    const result = await validateRefinedScriptQuality({ ...args, proposedSections: source, oldSubjectToRemove: ['체험 옵션'] })
    assert.equal(result.shouldRepair, true)
    assert.ok(result.issueTypes.includes('old_subject_leakage'))
  })
}
