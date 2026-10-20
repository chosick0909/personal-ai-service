import test from 'node:test'
import assert from 'node:assert/strict'
import { groundedSpeechIssues } from '../src/lib/spoken-script.js'
const sections={hook:'옆머리를 정리해보세요.',body:'얼굴 주변 프레임이 가로로 잠긴 경우가 많아요.',cta:'거울로 비교해보세요.'}
const issue={section:'body',quote:sections.body,reason:'옆머리가 어떤 모양인지 일상적인 말로 알기 어렵다.',plainMeaning:'양옆을 덮은 머리 때문에 얼굴이 답답하게 보인다는 뜻.',severity:'major',kind:'unclear_meaning'}
test('semantic speech diagnostics must quote the actual section, not fabricated words',()=>{
 assert.deepEqual(groundedSpeechIssues([issue],sections),[issue])
 assert.equal(groundedSpeechIssues([{...issue,quote:'없는 문장'}],sections).length,0)
 assert.equal(groundedSpeechIssues([{...issue,section:'cta'}],sections).length,0)
 assert.equal(groundedSpeechIssues([{...issue,plainMeaning:''}],sections).length,0)
})
test('minor stylistic feedback remains distinct from an unclear meaning',()=>{
 assert.equal(groundedSpeechIssues([{...issue,severity:'minor'}],sections)[0].severity,'minor')
 assert.equal(groundedSpeechIssues([{...issue,kind:'word_blacklist'}],sections).length,0)
})
