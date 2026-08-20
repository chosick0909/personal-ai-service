import test from 'node:test'
import assert from 'node:assert/strict'
import { assessTopicReadiness } from '../src/lib/topic-script-preflight.js'
import {
  TOPIC_VARIATION_CONFIGS,
  countConcreteActionMethods,
  estimateTopicSpeechSeconds,
  validateTopicVariation,
  validateTopicVariationSet,
} from '../src/lib/topic-script-validation.js'

const validVariations = [
  {
    hook: '청소 순서를 매번 바꾸면 같은 공간을 다시 닦느라 저녁 시간이 계속 새고 있습니다.',
    body: '이 청소 시간 낭비는 손이 느려서가 아니라 이미 끝낸 구역으로 되돌아가기 때문에 생깁니다. 먼저 현관에서 방 안쪽으로 이동 방향을 고정하면 지나간 바닥을 다시 밟지 않아 두 번 닦는 일을 피할 수 있습니다. 그다음 마른 먼지를 위에서 아래로 털어야 마지막에 바닥 한 번으로 떨어진 먼지를 모두 정리할 수 있습니다. 물건은 방마다 치우지 말고 빈 바구니 하나에 먼저 모아두면 닦는 흐름이 중간에 끊기지 않습니다. 세제는 시작 전에 필요한 양만 꺼내 같은 자리에 두면 도구를 찾으러 이동하는 시간을 줄일 수 있습니다. 오염이 심한 곳은 세제를 먼저 뿌려두고 다른 구역을 닦는 동안 기다리면 힘을 덜 들이고 제거할 수 있습니다. 마지막에는 사용한 도구를 현관 쪽에서 한 번에 씻어두면 다음 청소도 같은 순서로 바로 시작할 수 있습니다.',
    cta: '다음 청소 전에 이 순서를 바로 확인할 수 있도록 저장해두세요.',
  },
  {
    hook: '청소는 오래 할수록 깨끗해진다고 믿지만, 문제는 시간이 아니라 먼지가 다시 쌓이지 않는 순서입니다.',
    body: '이 청소 순서가 없으면 이미 닦은 곳에 먼지가 다시 내려앉아 같은 일을 반복하게 됩니다. 먼저 선반과 가구 윗면을 마른 천으로 닦으면 떨어지는 먼지를 마지막 바닥 청소에서 한꺼번에 모을 수 있습니다. 그다음 창가에서 문 쪽으로 한 방향만 정해 이동하면 끝낸 구역을 다시 밟지 않아 재작업을 줄일 수 있습니다. 자주 쓰는 물건은 제자리 기준을 손이 닿는 위치로 정해 사용 직후 바로 돌려놓을 수 있게 합니다. 당장 자리를 정하기 어려운 물건은 임시 바구니에 모으고 청소가 끝난 뒤 종류별로 나눠 흐름을 유지합니다. 물걸레는 먼지를 먼저 제거한 뒤 사용해야 바닥에 먼지가 번지지 않고 한 번에 닦입니다. 결국 깨끗함을 오래 유지하는 기준은 오래 닦는 시간이 아니라 위에서 아래로 이어지는 고정된 동선입니다.',
    cta: '평소 청소 방식과 비교해보고 필요한 사람에게 공유해보세요.',
  },
  {
    hook: '퇴근 후 현관에서 문을 여는 순간, 바닥의 먼지와 흩어진 물건부터 보여 어디서 시작할지 막힙니다.',
    body: '현관에서 느끼는 막막함은 청소할 곳이 많아서라기보다 시작 위치와 종료 기준이 없어서 커집니다. 먼저 신발을 정리하고 현관 바닥의 큰 먼지만 제거하면 집 안으로 먼지가 더 퍼지는 것을 막을 수 있습니다. 이어서 빈 바구니를 들고 거실까지 이동하며 제자리를 잃은 물건만 담으면 닦을 공간이 빠르게 확보됩니다. 거실에서는 높은 가구부터 낮은 가구 순서로 먼지를 털어야 떨어진 먼지를 바닥에서 한 번에 모을 수 있습니다. 바닥은 가장 안쪽에서 현관 방향으로 닦으면 청소한 구역을 다시 밟지 않고 그대로 끝낼 수 있습니다. 시간이 부족한 날에는 현관과 거실까지만 종료 범위로 정하면 중간에 포기하지 않고 눈에 보이는 변화를 만들 수 있습니다. 사용한 천과 바구니를 현관 가까운 자리에 돌려두면 다음에도 같은 장면에서 바로 청소를 시작할 수 있습니다.',
    cta: '퇴근 후 막막할 때 다시 볼 수 있도록 이 동선을 저장해두세요.',
  },
]

test('broad topic asks for missing context before creating a job', () => {
  const result = assessTopicReadiness({ topic: '살림' })
  assert.equal(result.ready, false)
  assert.deepEqual(result.questions.map((item) => item.id), ['targetAudience', 'specificProblem', 'desiredOutcome'])
  assert.ok(result.questions.every((item) => item.question && item.placeholder))
})

test('clarifications make a broad topic ready without changing the topic', () => {
  const result = assessTopicReadiness({
    topic: '살림',
    clarifications: {
      targetAudience: '퇴근 후 집안일이 버거운 직장인',
      specificProblem: '청소 순서가 자꾸 바뀌어 같은 곳을 다시 닦음',
      desiredOutcome: '짧은 동선으로 집안을 끝까지 정리함',
    },
  })
  assert.equal(result.ready, true)
  assert.equal(result.inferredContext.targetAudience, '퇴근 후 집안일이 버거운 직장인')
})

test('topic variation rejects greetings and internal metadata', () => {
  const result = validateTopicVariation({
    hook: '안녕하세요, writing_playbook 규칙으로 알려드릴게요.',
    body: '먼저 기준을 확인하고, 다음으로 순서를 바꿔 적용하세요.',
    cta: '저장해두세요.',
  }, 0)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((item) => item.includes('내부 규칙명')))
})

test('topic variation rejects generic advice posing as action information', () => {
  const result = validateTopicVariation({
    hook: '청소를 열심히 해도 시간이 계속 새고 있습니다.',
    body: '기준을 정하고 순서를 나누세요. 상황에 맞게 적절히 활용하세요.',
    cta: '저장해두세요.',
  }, 0)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((item) => item.includes('실행 방법')))
})

test('topic-only generation keeps three distinct concepts', () => {
  assert.deepEqual(TOPIC_VARIATION_CONFIGS.map((item) => item.label), ['손실 회피형', '통념 반박형', '공감 스토리형'])
})

test('duration and concrete action metrics follow the 60 to 90 second contract', () => {
  const duration = estimateTopicSpeechSeconds(validVariations[0])
  assert.ok(duration >= 60 && duration <= 90, `duration=${duration}`)
  assert.ok(countConcreteActionMethods(validVariations[0].body) >= 3)
})

test('topic variation set rejects hooks that all use the same question grammar', () => {
  const result = validateTopicVariationSet(validVariations.map((variation, index) => ({
    ...variation,
    hook: ['청소 시간이 계속 새고 있나요?', '청소는 오래 해야 한다고 믿고 있나요?', '퇴근 후 현관에서 막히나요?'][index],
  })))
  assert.equal(result.ok, false)
  assert.ok(result.issuesByIndex.flat().some((item) => item.includes('질문형 문법')))
})

test('topic variation set accepts long scripts with distinct causal entry points', () => {
  const result = validateTopicVariationSet(validVariations)
  assert.equal(result.ok, true, JSON.stringify(result.issuesByIndex))
  assert.ok(result.metricsByIndex.every((item) => item.estimatedSeconds >= 60 && item.estimatedSeconds <= 90))
  assert.ok(result.metricsByIndex.every((item) => item.concreteMethodCount >= 3))
})
