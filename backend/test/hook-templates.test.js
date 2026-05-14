import assert from 'node:assert/strict'
import test from 'node:test'

import { buildHookTemplateEmbeddingText, formatHookTemplatesForPrompt } from '../src/lib/hook-templates.js'
import { __referenceVideoAnalysisTest } from '../src/lib/reference-video-analysis.js'
import { __scriptAssistantTest } from '../src/lib/script-assistant.js'

const template = {
  hook_code: 'HOOK_06',
  title: '생돈 방지 혜택형 훅',
  hook_family: 'saving_benefit',
  template: '요즘 누가 [타겟이 돈/시간 쓰는 일]에 생돈 다 써요?',
  best_for: ['지원금', '쿠폰'],
  emotions: ['손해 보기 싫음', '절약 욕구'],
  rewrite_rule: '제값을 내는 행동을 손해처럼 보이게 만들고, 바로 혜택 정보를 제시한다.',
  search_text: '제값 생돈 혜택 지원금 캐시백 쿠폰 할인 무료 돈 아끼기',
  risk_note: '혜택/지원금은 반드시 최신 사실 확인 필요',
}

test('hook template embedding text includes searchable source fields', () => {
  const text = buildHookTemplateEmbeddingText(template)

  assert.match(text, /생돈 방지 혜택형 훅/)
  assert.match(text, /saving_benefit/)
  assert.match(text, /요즘 누가/)
  assert.match(text, /제값 생돈 혜택/)
})

test('hook template prompt context excludes raw template text', () => {
  const context = formatHookTemplatesForPrompt([template])

  assert.match(context, /생돈 방지 혜택형 훅/)
  assert.match(context, /saving_benefit/)
  assert.match(context, /rewrite_rule/)
  assert.match(context, /risk_note/)
  assert.doesNotMatch(context, /요즘 누가/)
  assert.doesNotMatch(context, /\[타겟이 돈\/시간 쓰는 일\]/)
})

test('ABC hook template prompt block states priority and anti-copy rules', () => {
  const block = __referenceVideoAnalysisTest.buildHookTemplatePromptBlock([template])

  assert.match(block, /첫 문장을 복사하기 위한 자료가 아니다/)
  assert.match(block, /레퍼런스 문장 단위 구조 설계도/)
  assert.match(block, /A\/B\/C 전략을 hook_family 선택으로 대체하지 않는다/)
  assert.doesNotMatch(block, /요즘 누가/)
})

test('ABC strategy instructions keep hook templates subordinate to variation strategy', () => {
  assert.match(
    __referenceVideoAnalysisTest.getHookTemplateStrategyInstruction({ label: 'A안' }),
    /약한 보조 신호/,
  )
  assert.match(
    __referenceVideoAnalysisTest.getHookTemplateStrategyInstruction({ label: 'B안' }),
    /말투만 더 자연스럽게/,
  )
  assert.match(
    __referenceVideoAnalysisTest.getHookTemplateStrategyInstruction({ label: 'C안' }),
    /문장 수, CTA 위치, 전개 순서는 바꾸지 않는다/,
  )
})

test('account metadata labels are not treated as script surface cues', () => {
  const guard = __referenceVideoAnalysisTest.buildCategoryGuard({
    accountSettings: {
      instagramId: '@labdotory',
      accountGoal: 'personal-influencer',
      strategyPreferences: ['정보형 콘텐츠'],
      voiceTone: 'friendly',
      persona: {
        job: '체형 보정 코디 전문가',
        painPoints: '상체가 커 보여서 고민',
      },
    },
  })
  const summary = __referenceVideoAnalysisTest.buildPromptGuardSummary(guard)

  assert.equal(summary.settingCues.includes('@labdotory'), false)
  assert.equal(summary.settingCues.includes('labdotory'), false)
  assert.equal(summary.settingCues.includes('퍼스널 인플루언싱'), false)
  assert.equal(summary.settingCues.includes('정보형 콘텐츠'), false)
  assert.equal(summary.settingCues.includes('친근한 언니형'), false)
  assert.ok(summary.settingCues.some((item) => item.includes('체형 보정') || item.includes('상체')))
})

test('account metadata leakage is rejected from generated scripts', () => {
  const guard = __referenceVideoAnalysisTest.buildCategoryGuard({
    accountSettings: {
      category: '교육',
      instagramId: '@labdotory',
      accountGoal: 'personal-influencer',
      strategyPreferences: ['정보형 콘텐츠'],
      voiceTone: 'friendly',
    },
  })

  assert.equal(
    __referenceVideoAnalysisTest.findAccountSurfaceLeakage('안녕하세요, @labdotory예요.', guard),
    'account_handle',
  )
  assert.equal(
    __referenceVideoAnalysisTest.findAccountSurfaceLeakage('퍼스널 인플루언싱으로 정보형 콘텐츠를 만들어요.', guard),
    '퍼스널 인플루언싱',
  )
  assert.equal(
    __referenceVideoAnalysisTest.findAccountSurfaceLeakage('체형 보정 교육을 계속 해왔어요.', guard),
    '교육',
  )
})

test('category labels are converted into subject guidance, not script wording', () => {
  const guard = __referenceVideoAnalysisTest.buildCategoryGuard({
    accountSettings: {
      category: '뷰티',
    },
  })
  const guide = __referenceVideoAnalysisTest.buildCategorySubjectGuide(guard)

  assert.match(guide, /카테고리명은 내부 분류 라벨/)
  assert.match(guide, /피부/)
  assert.match(guide, /스킨케어/)
  assert.match(guide, /그대로 쓰지 말고/)
})

test('copilot hook templates are only enabled for hook-capable refine requests', () => {
  assert.equal(__scriptAssistantTest.shouldUseHookTemplatesForRefine('훅 더 강하게 바꿔줘', ['hook']), true)
  assert.equal(__scriptAssistantTest.shouldUseHookTemplatesForRefine('전체적으로 초반 이탈 줄여줘', ['hook', 'body', 'cta']), true)
  assert.equal(__scriptAssistantTest.shouldUseHookTemplatesForRefine('바디만 자연스럽게', ['body']), false)
  assert.equal(__scriptAssistantTest.shouldUseHookTemplatesForRefine('CTA만 짧게', ['cta']), false)
})

test('copilot hook template context excludes raw templates and repeats lock rule', () => {
  const context = __scriptAssistantTest.buildCopilotHookTemplateContext([template])

  assert.match(context, /내부 보조 지식/)
  assert.match(context, /BODY\/CTA만 수정하는 요청이면 HOOK을 바꾸지 않는다/)
  assert.match(context, /rewrite_rule/)
  assert.doesNotMatch(context, /요즘 누가/)
  assert.doesNotMatch(context, /\[타겟이 돈\/시간 쓰는 일\]/)
})
