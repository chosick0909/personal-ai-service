import assert from 'node:assert/strict'
import test from 'node:test'
import { __scriptAssistantTest } from '../src/lib/script-assistant.js'

const {
  buildDraftBlock,
  buildFeedbackUserPrompt,
  buildRefineUserPrompt,
  buildReferenceContaminationGuard,
  buildReferenceStructureContext,
  compactReferenceSignal,
  normalizeEditTarget,
  getTargetSections,
  inferRequestedSections,
  applyEditScope,
  buildEditOutputInstruction,
  extractProposedSections,
  createSectionDiff,
  validateScriptFlow,
  buildEditScopeInstruction,
  messageMentionsLockedSections,
  logPromptAssembly,
} = __scriptAssistantTest

const currentDraft = {
  hook: '선크림 바르는데도 오후만 되면 얼굴이 칙칙해 보이면, 순서가 문제일 수 있습니다.',
  body: '기초를 다 바른 직후 바로 선크림을 올리면 밀림이 생기고, 양도 줄어듭니다. 흡수 시간을 짧게 두고 얇게 두 번 나누면 지속감이 달라집니다.',
  cta: '오늘 바르는 순서만 바꿔보세요. 오후 피부 톤이 훨씬 덜 무너질 수 있습니다.',
}

const reference = {
  title: '래미안 분양 투자 전략',
  topic: '선크림 바르는 순서',
  transcript:
    '래미안 아파트 분양권과 강남 재건축 투자 타이밍을 보려면 시행사, 청약 경쟁률, 전매 제한을 먼저 확인해야 합니다.',
  structure_analysis: '문제 제기 후 실수 원인을 짚고, 작은 행동 변화로 결론을 낸다.',
  hook_analysis: '첫 문장에서 손해 가능성을 짧게 제시한다.',
  psychology_analysis: '내가 놓친 작은 차이가 결과를 바꾼다는 긴장감을 만든다.',
  frame_notes: [
    {
      timestamp: 1,
      observation: '초반 자막이 짧게 들어감',
      hookReason: '처음 2초 안에 손해 프레임 제시',
    },
  ],
  ai_feedback: 'HOOK과 CTA 연결을 더 압축하면 좋다.',
}

const poisonTerms = ['래미안', '아파트', '분양권', '강남', '재건축', '시행사', '청약', '전매']

test('refine/feedback reference context excludes full transcript content', () => {
  const context = buildReferenceStructureContext(reference)

  assert.match(context, /레퍼런스 전사: 제외됨/)
  assert.doesNotMatch(context, /분양권과 강남 재건축 투자/)
  for (const term of poisonTerms) {
    assert.equal(context.includes(term), false, `context leaked transcript term: ${term}`)
  }
})

test('current draft is the first prompt block and remains source of truth', () => {
  const context = buildReferenceStructureContext(reference)
  const prompt = buildRefineUserPrompt({
    sections: currentDraft,
    request: '조금 더 세련되고 강하게 바꿔줘',
    selectedLabel: 'A',
    referenceContext: context,
    guides: {
      insights: ['초반 손해 프레임을 유지한다.'],
      checkpoints: ['CTA는 행동 이유를 담는다.'],
    },
  })

  assert.equal(prompt.startsWith(buildDraftBlock(currentDraft)), true)
  assert.match(prompt, /source of truth - 이 텍스트만 편집 대상/)
  assert.match(prompt, /사용자 요청: 조금 더 세련되고 강하게 바꿔줘/)
})

test('feedback suggestedSections prompt uses current draft before reference structure', () => {
  const context = buildReferenceStructureContext(reference)
  const prompt = buildFeedbackUserPrompt({
    sections: currentDraft,
    selectedLabel: 'B',
    referenceContext: context,
    guides: {
      insights: ['초반 손해 프레임을 유지한다.'],
      checkpoints: ['CTA는 행동 이유를 담는다.'],
    },
  })

  assert.equal(prompt.startsWith(buildDraftBlock(currentDraft)), true)
  assert.equal(prompt.indexOf('현재 초안'), 0)
  assert.ok(prompt.indexOf('현재 초안') < prompt.indexOf('레퍼런스 구조 참고'))
  assert.match(prompt, /suggestedSections/)
  assert.doesNotMatch(prompt, /분양권과 강남 재건축 투자/)
})

test('five repeated prompt assemblies do not reintroduce reference transcript terms', () => {
  let draft = { ...currentDraft }

  for (let index = 0; index < 5; index += 1) {
    const context = buildReferenceStructureContext(reference)
    const refinePrompt = buildRefineUserPrompt({
      sections: draft,
      request: `반복 수정 ${index + 1}: 더 짧고 선명하게`,
      selectedLabel: 'A',
      referenceContext: context,
      guides: {
        insights: ['손해 프레임을 구조로만 참고한다.'],
        checkpoints: ['현재 초안의 뷰티 주제를 유지한다.'],
      },
    })
    const feedbackPrompt = buildFeedbackUserPrompt({
      sections: draft,
      selectedLabel: 'A',
      referenceContext: context,
      guides: {
        insights: ['손해 프레임을 구조로만 참고한다.'],
        checkpoints: ['현재 초안의 뷰티 주제를 유지한다.'],
      },
    })

    for (const term of poisonTerms) {
      assert.equal(refinePrompt.includes(term), false, `refine prompt leaked ${term}`)
      assert.equal(feedbackPrompt.includes(term), false, `feedback prompt leaked ${term}`)
    }

    draft = {
      hook: `${draft.hook} 조금 더 선명하게.`,
      body: `${draft.body} 핵심은 바르는 순서입니다.`,
      cta: `${draft.cta} 오늘 루틴에서 확인해보세요.`,
    }
  }
})

test('guard and debug metadata encode anti-contamination contract', () => {
  const guard = buildReferenceContaminationGuard()
  const metadata = logPromptAssembly({
    stage: 'script-refine',
    referenceId: 'ref-1',
    currentDraftId: 'script-1',
    currentVersionId: 'version-1',
    memoryIncluded: true,
    includedTranscript: false,
  })

  assert.match(guard, /편집 대상은 오직 현재 초안/)
  assert.match(guard, /레퍼런스 내용을 패러프레이즈하지 않는다/)
  assert.equal(metadata.includedTranscript, false)
  assert.deepEqual(metadata.promptContextOrder, [
    'currentDraft',
    'userRequest',
    'accountCharacterSettings',
    'existingFeedback',
    'referenceStructureInsights',
    'reference',
  ])
  assert.equal(metadata.memoryIncluded, true)
})

test('reference structure signal is compacted to at most 500 characters', () => {
  const compacted = compactReferenceSignal('가'.repeat(800), 500)

  assert.ok(compacted.length <= 503)
  assert.match(compacted, /\.\.\.$/)
})

test('body-only refine request locks hook and cta in prompt and post-processing', () => {
  const editTarget = normalizeEditTarget('body', 'BODY만 더 설득력 있게 수정해줘')
  const targetSections = getTargetSections(editTarget)
  const scoped = applyEditScope(
    currentDraft,
    extractProposedSections(
      {
        section: '흡수 시간을 두고 얇게 두 번 나누면 밀림과 칙칙함을 줄일 수 있습니다.',
        sections: {
          hook: '바뀌면 안 되는 새 훅',
          body: '무시되어야 하는 BODY',
          cta: '바뀌면 안 되는 새 CTA',
        },
      },
      targetSections,
    ),
    targetSections,
  )
  const prompt = buildRefineUserPrompt({
    sections: currentDraft,
    request: 'BODY만 더 설득력 있게 수정해줘',
    selectedLabel: 'A',
    referenceContext: buildReferenceStructureContext(reference),
    guides: {
      insights: [],
      checkpoints: [],
    },
    targetSections,
  })

  assert.deepEqual(targetSections, ['body'])
  assert.equal(scoped.hook, currentDraft.hook)
  assert.equal(scoped.body, '흡수 시간을 두고 얇게 두 번 나누면 밀림과 칙칙함을 줄일 수 있습니다.')
  assert.equal(scoped.cta, currentDraft.cta)
  assert.match(prompt, /수정 범위: BODY/)
  assert.match(prompt, /생성 대상: BODY 하나만 생성한다/)
  assert.match(prompt, /\{"message":"","section":""\}/)
  assert.doesNotMatch(prompt, /\{"message":"","sections":/)
  assert.match(prompt, /잠금 섹션: HOOK, CTA는 원문 그대로 반환한다/)
})

test('locked-section message is rejected for partial edits', () => {
  assert.equal(messageMentionsLockedSections('HOOK은 유지하고 BODY만 바꿨습니다.', ['body']), true)
  assert.equal(messageMentionsLockedSections('BODY는 근거를 더 선명하게 풀었습니다.', ['body']), false)
  assert.match(buildEditScopeInstruction(['hook', 'cta']), /잠금 섹션: BODY/)
})

test('explicit editTarget drives generation shape and fallback still parses Korean', () => {
  assert.equal(normalizeEditTarget('cta', '마무리를 더 강하게'), 'cta')
  assert.equal(normalizeEditTarget('', '본문만 자연스럽게'), 'body')
  assert.equal(normalizeEditTarget('all', '본문만 자연스럽게'), 'body')
  assert.equal(normalizeEditTarget('all', '전체적으로 더 좋게'), 'all')
  assert.match(buildEditOutputInstruction(['cta']), /CTA 하나만 생성/)
  assert.match(buildEditOutputInstruction(['hook', 'body', 'cta']), /HOOK, BODY, CTA 전체/)
})

test('partial edit diff and flow validation remain stable across repeated body edits', () => {
  let draft = { ...currentDraft }

  for (let index = 0; index < 5; index += 1) {
    const targetSections = getTargetSections(normalizeEditTarget('body', 'BODY 수정'))
    const next = applyEditScope(
      draft,
      extractProposedSections(
        {
          section: `${draft.body} 반복 ${index + 1}회차에서 근거를 더 선명하게 정리했습니다.`,
        },
        targetSections,
      ),
      targetSections,
    )
    const diff = createSectionDiff(draft, next)
    const flow = validateScriptFlow(next)

    assert.deepEqual(Object.keys(diff), ['body'])
    assert.equal(next.hook, draft.hook)
    assert.equal(next.cta, draft.cta)
    assert.equal(flow.ok, true)
    draft = next
  }
})
