import test from 'node:test'
import assert from 'node:assert/strict'
import { diagnoseTempo } from '../../frontend/src/lib/tempoDiagnosis.js'
const cue = (start,end,text='가나다라마') => ({ start,end,text })
test('invalid input and unsupported durations return unavailable without throwing',()=>{
  for(const duration of [0,-1,NaN,Infinity,'5',1e99])assert.equal(diagnoseTempo([cue(0,1)],duration).available,false)
  for(const input of [null,{},[],[null,{},cue(NaN,1),cue(0,Infinity),cue(1,1),cue(2,1),cue(0,1,' ') ]])assert.equal(diagnoseTempo(input,10).available,false)
})
test('first subtitle boundary is 0.8 seconds',()=>{
  assert.equal(diagnoseTempo([cue(.799,2)],5).delayedStart,false)
  assert.equal(diagnoseTempo([cue(.8,2)],5).delayedStart,true)
  assert.equal(diagnoseTempo([cue(2,3)],5).firstStart,2)
})
test('first three seconds uses overlap ratio and Unicode characters excluding spaces',()=>{
  const result=diagnoseTempo([cue(2,4,'가 나 😀 다')],5)
  assert.equal(result.firstThreeChars,2)
  assert.equal(result.averageCharsPerSecond,2)
})
test('clamps timestamps while preserving proportional text density',()=>{
  const result=diagnoseTempo([cue(-1,1,'가나다라'),cue(4,6,'가나다라')],5)
  assert.equal(result.firstStart,0)
  assert.equal(result.firstThreeChars,2)
  assert.equal(result.averageCharsPerSecond,2)
  assert.deepEqual(result.gaps,[{start:1,end:4}])
})
test('unsorted and overlapping captions merge for gap and spoken duration without mutating input',()=>{
  const input=[cue(6,7),cue(1,3),cue(2,4),cue(2.5,3)]
  const before=structuredClone(input); input.forEach(Object.freeze);Object.freeze(input)
  const result=diagnoseTempo(input,8)
  assert.deepEqual(input,before)
  assert.equal(result.averageCharsPerSecond,20/4)
  assert.deepEqual(result.gaps,[{start:4,end:6}])
})
test('gaps include 0.7 boundary and keep at most five longest gaps',()=>{
  assert.equal(diagnoseTempo([cue(0,1),cue(1.7,2)],3).gaps.length,1)
  assert.equal(diagnoseTempo([cue(0,3.4),cue(4.1,5)],6).gaps.length,1)
  assert.equal(diagnoseTempo([cue(0,1),cue(1.699,2)],3).gaps.length,0)
  const result=diagnoseTempo(Array.from({length:8},(_,i)=>cue(i*3,i*3+1)),25)
  assert.equal(result.gaps.length,5)
  assert.equal(result.gaps[0].start,1)
})
test('slow windows use half of median, sorted lowest first, with cap three',()=>{
  const input=Array.from({length:10},(_,i)=>cue(i*5,i*5+5,i<4?'가':'가나다라마바사아자차'))
  const result=diagnoseTempo(input,50)
  assert.equal(result.slow.length,3)
  assert.deepEqual(result.slow.map(x=>x.start),[0,5,10])
  assert.equal(result.slow[0].charsPerSecond,.2)
})
test('median zero and videos shorter than five seconds do not invent comparisons',()=>{
  assert.deepEqual(diagnoseTempo([cue(0,1)],30).slow,[])
  const result=diagnoseTempo([cue(0,2,'가나다라')],2)
  assert.deepEqual(result.slow,[])
  assert.equal(result.firstThreeChars,4)
  assert.equal(result.averageCharsPerSecond,2)
})
