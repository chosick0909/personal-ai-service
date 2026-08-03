import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { __scriptAssistantTest } from '../src/lib/script-assistant.js'
import { semanticInstructionFromModelOutput } from '../src/lib/copilot/semantic-schema.js'

const copilotSemanticEvalCases = JSON.parse(
  readFileSync(new URL('./fixtures/copilot-semantic-eval.json', import.meta.url), 'utf8'),
)

const {
  buildEditPlan,
  parseSemanticEditInstruction,
} = __scriptAssistantTest

const currentDraft = {
  hook: '현재 훅입니다.',
  body: '현재 바디입니다.',
  cta: '현재 CTA입니다.',
}

for (const evalCase of copilotSemanticEvalCases) {
  test(`copilot semantic eval: ${evalCase.name}`, () => {
    const semanticInstruction = parseSemanticEditInstruction({
      userMessage: evalCase.message,
      intentResult: {
        intent: 'edit_request',
        editTarget: 'all',
      },
    })

    assert.equal(semanticInstruction.intent, evalCase.expectedIntent)
    assert.equal(semanticInstruction.topicChange.requested, evalCase.topicChangeRequested)
    assert.deepEqual(
      semanticInstruction.operations.map(({ type, target }) => ({ type, target })),
      evalCase.expectedOperations,
    )

    if (evalCase.expectedNewSubject) {
      assert.equal(semanticInstruction.topicChange.newSubject, evalCase.expectedNewSubject)
    } else {
      assert.equal(semanticInstruction.topicChange.newSubject, null)
    }

    if (evalCase.expectedOldSubjects) {
      assert.deepEqual(semanticInstruction.topicChange.oldSubjects, evalCase.expectedOldSubjects)
    }

    if (semanticInstruction.intent !== 'edit_script' && semanticInstruction.intent !== 'apply_feedback') {
      return
    }

    const plan = buildEditPlan({
      userRequest: evalCase.message,
      currentSections: currentDraft,
      intentResult: {
        semanticInstruction,
      },
    })

    if (evalCase.expectedPlanTargets) {
      assert.deepEqual(plan.targetSections, evalCase.expectedPlanTargets)
    }
    if (evalCase.expectedPreservedSections) {
      assert.deepEqual(plan.preserveSections, evalCase.expectedPreservedSections)
    }
    assert.equal(plan.semanticTrace.finalDecisionSource, 'validated_semantic_instruction')
  })
}

test('validated semantic instruction cannot be overwritten by reparsing raw request', () => {
  const semanticInstruction = semanticInstructionFromModelOutput(
    {
      intent: 'edit_script',
      confidence: 0.97,
      topicChange: {
        requested: false,
        oldSubjects: [],
        newSubject: null,
        confidence: 0,
        evidence: null,
      },
      operations: [
        {
          type: 'tone_adjust',
          target: 'hook',
          goal: 'HOOK 말투를 존댓말로 통일',
          styleTarget: '존댓말',
          evidence: '훅을 존댓말로',
          confidence: 0.98,
        },
      ],
      locks: [
        {
          target: 'body',
          lockType: 'do_not_touch',
          evidence: 'BODY 유지',
        },
        {
          target: 'cta',
          lockType: 'do_not_touch',
          evidence: 'CTA 유지',
        },
      ],
      metadata: {
        requestedMaterials: [],
        forbiddenSurfacePhrases: [],
        salesContext: null,
        toneHint: '존댓말',
        explicitKeep: ['body', 'cta'],
        explicitRemove: [],
        allowComparisonWithOldSubject: false,
        targetDurationSeconds: null,
      },
      userFacingNeed: 'modify_script',
      clarificationQuestion: null,
    },
    {
      userMessage: '훅을 존댓말로 바꿔줘',
      regexSignals: {},
    },
  )

  const plan = buildEditPlan({
    // Deliberately conflicting raw text verifies that the validated instruction
    // remains the final decision source.
    userRequest: '주제를 치킨너겟으로 전부 바꿔줘',
    currentSections: currentDraft,
    semanticInstruction,
  })

  assert.equal(plan.operationType, 'tone_adjust')
  assert.equal(plan.newSubject, '')
  assert.deepEqual(plan.targetSections, ['hook'])
  assert.deepEqual(plan.preserveSections, ['body', 'cta'])
  assert.equal(plan.semanticTrace.semantic.parserSource, 'llm_strict_schema')
})
