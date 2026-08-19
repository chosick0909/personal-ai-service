import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TOPIC_VARIATION_CONFIGS,
  validateTopicVariation,
  validateTopicVariationSet,
} from '../src/lib/topic-script-validation.js'

test('topic variation rejects greetings and internal metadata', () => {
  const result = validateTopicVariation({
    hook: '안녕하세요, writing_playbook 규칙으로 알려드릴게요.',
    body: '먼저 기준을 확인하고, 다음으로 순서를 바꿔 적용하세요.',
    cta: '저장해두세요.',
  }, 0)

  assert.equal(result.ok, false)
  assert.ok(result.issues.some((item) => item.includes('내부 규칙명')))
})

test('topic variation requires two concrete action signals', () => {
  const result = validateTopicVariation({
    hook: '청소를 열심히 해도 시간이 계속 새고 있어요.',
    body: '잘 해보면 됩니다.',
    cta: '저장해두세요.',
  }, 0)

  assert.equal(result.ok, false)
  assert.ok(result.issues.some((item) => item.includes('실행 정보')))
})

test('topic-only generation keeps three distinct concepts', () => {
  assert.deepEqual(TOPIC_VARIATION_CONFIGS.map((item) => item.label), [
    '손실 회피형',
    '통념 반박형',
    '공감 스토리형',
  ])
})

test('topic variation set rejects hooks that all use the same question grammar', () => {
  const result = validateTopicVariationSet([
    {
      hook: '사진을 찍을 때 얼굴이 더 커 보이나요?',
      body: '먼저 각도를 확인하고, 다음으로 거리를 바꿔 적용하세요.',
      cta: '저장해두세요.',
    },
    {
      hook: '앞머리를 내려도 얼굴이 커 보이나요?',
      body: '먼저 기준을 확인하고, 다음으로 방향을 비교하세요.',
      cta: '공유해보세요.',
    },
    {
      hook: '회의 화면에서 얼굴이 꽉 차 보이나요?',
      body: '먼저 화면 거리를 확인하고, 다음으로 높이를 바꿔 적용하세요. 마지막으로 결과를 비교하세요.',
      cta: '저장해두세요.',
    },
  ])

  assert.equal(result.ok, false)
  assert.ok(result.issuesByIndex.flat().some((item) => item.includes('질문형 문법')))
})

test('topic variation set accepts clearly separated hook entry points', () => {
  const result = validateTopicVariationSet([
    {
      hook: '카메라를 얼굴 가까이 그대로 두면 윤곽이 퍼져 실제보다 더 크게 보입니다.',
      body: '먼저 카메라 거리를 확인하고, 다음으로 눈높이에 맞춰 적용하세요.',
      cta: '촬영 전에 보도록 저장해두세요.',
    },
    {
      hook: '문제는 앞머리 양이 아니라, 얼굴 밖으로 시선을 빼는 윤곽선의 방향입니다.',
      body: '먼저 옆선을 확인하고, 다음으로 볼륨 위치를 비교해 바꾸세요.',
      cta: '기존 방식과 비교해보세요.',
    },
    {
      hook: '회의 화면을 켜는 순간, 거울에서는 괜찮던 얼굴이 유독 꽉 차 보입니다.',
      body: '화면은 가까운 렌즈 때문에 윤곽이 퍼집니다. 먼저 카메라를 팔 길이만큼 두고, 다음으로 렌즈를 눈높이에 맞춰 적용하세요. 마지막으로 미리보기 화면에서 좌우 여백을 비교하세요.',
      cta: '다음 회의 전에 확인하도록 저장해두세요.',
    },
  ])

  assert.equal(result.ok, true)
})
