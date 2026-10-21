import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEditPlan, runFeedbackFallbackRuleCheck } from '../src/lib/script-assistant.js'
import { semanticInstructionFromModelOutput } from '../src/lib/copilot/semantic-schema.js'

function instruction(type, { requested = false, removed = [], next = null } = {}) {
  return semanticInstructionFromModelOutput({
    intent: 'edit_script', confidence: 0.95,
    topicChange: { requested, oldSubjects: ['수납'], newSubject: next, confidence: 0.95 },
    operations: [{ type, target: 'all', goal: '현재 요청 반영', confidence: 0.95 }],
    locks: [], metadata: { explicitRemove: removed, targetDurationSeconds: 60 },
  })
}
const original = { hook: '수납은 꺼내기 쉬워야 해요.', body: '물건을 쓰는 곳 가까이에 모아두세요.', cta: '오늘 한 칸부터 정리해보세요.' }
const expanded = { ...original, body: '물건을 쓰는 곳 가까이에 모아두세요. 수납 위치는 꺼내고 돌려놓는 동선을 함께 생각해 정해보세요.' }

for (const type of ['duration_expand', 'duration_compress', 'tone_adjust', 'partial_rewrite']) {
  test(`${type}: identified current topic is context, not a removal instruction`, () => {
    const semanticInstruction = instruction(type)
    assert.deepEqual(semanticInstruction.topicChange.oldSubjects, ['수납'])
    assert.deepEqual(semanticInstruction.legacyInstruction.oldSubjectToRemove, [])
    // Also guard records produced before the schema adapter was corrected.
    semanticInstruction.legacyInstruction.oldSubjectToRemove = ['수납']
    const plan = buildEditPlan({ currentSections: original, userRequest: '기존 주제를 유지해서 설명을 보강해줘', semanticInstruction })
    assert.deepEqual(plan.oldSubjectToRemove, [])
    const check = runFeedbackFallbackRuleCheck({ originalSections: original, candidateSections: expanded,
      editPlan: plan, qaMode: plan.qaMode, oldSubjectToRemove: plan.oldSubjectToRemove,
      forbiddenSurfacePhrases: plan.forbiddenSurfacePhrases })
    assert.equal(check.ok, true, JSON.stringify(check))
  })
}

test('genuine topic replacement still rejects the old subject', () => {
  const plan = buildEditPlan({ currentSections: original, userRequest: '수납 말고 청소로 주제를 바꿔줘',
    semanticInstruction: instruction('topic_reframe', { requested: true, next: '청소' }) })
  assert.ok(plan.oldSubjectToRemove.includes('수납'))
  const check = runFeedbackFallbackRuleCheck({ originalSections: original, candidateSections: expanded,
    editPlan: plan, qaMode: plan.qaMode, newSubject: plan.newSubject, oldSubjectToRemove: plan.oldSubjectToRemove })
  assert.ok(check.issueTypes.includes('old_subject_leakage'))
})

test('explicit material removal remains enforced without a topic change', () => {
  const plan = buildEditPlan({ currentSections: original, userRequest: '체험 옵션은 빼고 설명을 보강해줘',
    semanticInstruction: instruction('partial_rewrite', { removed: ['체험 옵션'] }) })
  assert.deepEqual(plan.oldSubjectToRemove, ['체험 옵션'])
  const check = runFeedbackFallbackRuleCheck({ originalSections: original,
    candidateSections: { ...expanded, cta: '체험 옵션을 선택해보세요.' }, editPlan: plan,
    oldSubjectToRemove: plan.oldSubjectToRemove })
  assert.ok(check.issueTypes.includes('old_subject_leakage'))
})
