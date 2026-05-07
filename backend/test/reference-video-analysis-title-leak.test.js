import assert from 'node:assert/strict'
import test from 'node:test'
import { __referenceVideoAnalysisTest } from '../src/lib/reference-video-analysis.js'

const {
  buildTopicFocusPrompt,
  extractReferenceSurfaceTerms,
  findReferenceSurfaceLeakage,
  normalizeGenerationTopic,
  normalizeReferenceTitle,
} = __referenceVideoAnalysisTest

test('empty reel topic never falls back to reference video title', () => {
  const referenceTitle = normalizeReferenceTitle({
    title: '레레퍼퍼',
    originalFilename: 'ScreenRecording_2026-05-07.mov',
  })
  const topic = normalizeGenerationTopic('', referenceTitle)

  assert.equal(referenceTitle, '레레퍼퍼')
  assert.equal(topic, '일반')
  assert.equal(buildTopicFocusPrompt(topic, referenceTitle), '')
})

test('reference video title is always treated as forbidden surface text', () => {
  const terms = extractReferenceSurfaceTerms({
    title: '레레퍼퍼',
    topic: '일반',
    transcript: '운동 루틴은 처음부터 너무 세게 잡으면 오래 못 갑니다.',
  })

  assert.ok(terms.includes('레레퍼퍼'))
  assert.equal(findReferenceSurfaceLeakage('레레퍼퍼 때문에 운동 4주를 날려요.', terms), '레레퍼퍼')
  assert.equal(findReferenceSurfaceLeakage('레 레퍼퍼 때문에 운동 4주를 날려요.', terms), '레레퍼퍼')
})
