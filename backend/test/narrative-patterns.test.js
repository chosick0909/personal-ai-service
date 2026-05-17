import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildNarrativePatternEmbeddingText,
  buildNarrativePatternQueryText,
  formatNarrativePatternsForPrompt,
} from '../src/lib/narrative-patterns.js'

const pattern = {
  narrative_code: 'NARRATIVE_06',
  title: '큰 손실 후 실행 전환형',
  narrative_family: 'loss_to_action',
  reference_formats: ['narrative', 'vlog', 'case_study'],
  emotional_arc: '큰 손실 위기 → 망가진 현실 → 실패 인정 → 작은 실행',
  use_when: ['창업 도전기', '리모델링', '사업 위기'],
  avoid_when: ['정보형 튜토리얼', '혜택 안내'],
  body_flow_rule: '큰 손실을 먼저 보여주고, 망한 현실을 인정한 뒤 작은 실행으로 분위기를 전환한다.',
  rewrite_rule: '위기를 과장하기보다 실제 행동으로 전환되는 지점을 선명하게 만든다.',
  risk_note: '실제 없는 손실 금액, 계약 실패, 사기 피해를 만들지 않는다.',
  use_intensity: 'medium',
  search_text: '손실 실패 망가진 현실 실행 시작 창업 리모델링 도전기',
  structure_steps: [{ step: 1, role: 'raw step details should not be prompt material' }],
}

test('narrative pattern embedding text uses structure metadata, not raw examples', () => {
  const text = buildNarrativePatternEmbeddingText(pattern)

  assert.match(text, /큰 손실 후 실행 전환형/)
  assert.match(text, /loss_to_action/)
  assert.match(text, /큰 손실 위기/)
  assert.match(text, /실제 없는 손실 금액/)
  assert.match(text, /창업 리모델링 도전기/)
  assert.doesNotMatch(text, /raw step details/)
  assert.doesNotMatch(text, /instagram\.com/)
})

test('narrative pattern prompt format is safe and compact', () => {
  const prompt = formatNarrativePatternsForPrompt([pattern], 1)

  assert.match(prompt, /큰 손실 후 실행 전환형/)
  assert.match(prompt, /narrative_family: loss_to_action/)
  assert.match(prompt, /emotional_arc:/)
  assert.match(prompt, /body_flow_rule:/)
  assert.match(prompt, /risk_note: 실제 없는 손실 금액/)
  assert.match(prompt, /avoid_when: 정보형 튜토리얼, 혜택 안내/)
  assert.doesNotMatch(prompt, /structure_steps/)
  assert.doesNotMatch(prompt, /raw step details/)
})

test('narrative query includes current draft and request context', () => {
  const text = buildNarrativePatternQueryText({
    request: '감정선 넣어서 바디를 도전기처럼 바꿔줘',
    sections: {
      hook: '처음에는 단순한 문제인 줄 알았어요.',
      body: '근데 반복되니까 원인을 다시 보게 됐습니다.',
      cta: '오늘 체크해보세요.',
    },
    reference: {
      topic: '피부 루틴',
      structure_analysis: '문제에서 전환으로 넘어가는 구조',
      hook_analysis: '첫 문장에 문제를 둔다',
      psychology_analysis: '반복된 문제를 해결하고 싶게 만든다',
    },
    selectedLabel: 'C',
  })

  assert.match(text, /사용자 요청: 감정선/)
  assert.match(text, /현재 HOOK:/)
  assert.match(text, /현재 BODY 요약:/)
  assert.match(text, /레퍼런스 구조 분석:/)
  assert.match(text, /선택한 안: C/)
})
