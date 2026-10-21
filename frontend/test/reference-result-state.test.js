import test from 'node:test'
import assert from 'node:assert/strict'
import {getReferenceResultState, resolveReferenceSourceMode} from '../src/lib/referenceResultState.js'

test('topic and pasted text never receive transcription failures, including empty and failed results', () => {
  for (const sourceMode of ['topic_only', 'script_text', undefined]) {
    for (const status of ['processing', 'failed', 'completed']) {
      const result = getReferenceResultState({sourceMode,status,transcriptQuality:{level:'low'}})
      assert.equal(result.transcriptionFailed,false)
      assert.doesNotMatch(result.message,/전사|음성|영상에서/)
      assert.equal(result.unavailable,status!=='processing')
    }
  }
})
test('old topic records with missing or defaulted mode are restored as topics from their metadata', () => {
  assert.equal(resolveReferenceSourceMode({sourceMode:'video',fileName:'주제만으로 기획'}),'topic_only')
  assert.equal(resolveReferenceSourceMode({topic_brief:{inputBrief:{topic:'기존 대본'},contentBrief:{}}}),'topic_only')
  assert.equal(resolveReferenceSourceMode({source_mode:'video',topic_brief:{supportingMaterials:[{}]}}),'video')
  assert.equal(resolveReferenceSourceMode({}),'unknown')
})
test('real generation errors survive and only terminal video failures receive transcription guidance', () => {
  assert.equal(getReferenceResultState({sourceMode:'topic_only',status:'failed',errorMessage:'모델 응답을 완료하지 못했습니다.'}).message,'모델 응답을 완료하지 못했습니다.')
  assert.equal(getReferenceResultState({sourceMode:'video',status:'processing'}).transcriptionFailed,false)
  assert.equal(getReferenceResultState({sourceMode:'video',status:'completed'}).transcriptionFailed,true)
  assert.equal(getReferenceResultState({sourceMode:'video',status:'completed'},[{}]).unavailable,false)
})
