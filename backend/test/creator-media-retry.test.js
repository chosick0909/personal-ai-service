import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const source = process.env.CREATOR_RETRY_TEST_SOURCE
  ? pathToFileURL(process.env.CREATOR_RETRY_TEST_SOURCE.replace(/\/$/,'')+'/')
  : new URL('../src/creator-tools/',import.meta.url)
const {parseJsonCompletion}=await import(new URL('operation-model.js',source))
const {diagnoseMediaHook}=await import(new URL('media-hook.js',source))
const transcript={subtitles:[{id:'c1',start:0,end:2,text:'중요한 조건입니다.'}]}
const hook={items:[{area:'hook',action:'revise',cueIds:['c1'],quote:'중요한 조건',reason:'주제를 먼저 말하세요'}]}
function context(provider,signal) {
 const saved={}, calls=[]
 return {saved,calls,ctx:{job:{},signal,checkpoint:async(name,fn)=>{
  if(Object.hasOwn(saved,name))return structuredClone(saved[name])
  const value=await fn();saved[name]=structuredClone(value);return value
 },providers:{json:async(...args)=>{calls.push(args[0]);return provider(...args)}}}}
}
const media=c=>diagnoseMediaHook(c.ctx,transcript,2,Date.now())
const retryable=error=>{const status=Number(error.statusCode||error.status);return !status||status>=500||status===429}
for(const [name,message,finish_reason] of [
 ['truncation',{content:'{}'},'length'],['refusal',{content:'{}',refusal:'no'},'stop'],
 ['empty',{content:''},'stop'],['malformed JSON',{content:'{'},'stop']]) {
 test(`F1 ${name}: queue classification is terminal after one provider attempt`,async()=>{
  let calls=0, failure
  // Exercise the existing job-process retry predicate and queue's three-attempt budget.
  for(let i=0;i<3;i++)try{calls++;parseJsonCompletion({choices:[{message,finish_reason}]});break}
  catch(error){failure=error;if(!retryable(error))break}
  assert.equal(calls,1);assert.equal(failure.statusCode,422);assert.equal(failure.exposeMessage,true)
 })
}
test('F2 hook transient error is not checkpointed and resumes successfully',async()=>{
 let fail=true;const c=context(async()=>{if(fail)throw Object.assign(Error('rate limit'),{status:429});return hook})
 assert.equal((await media(c)).status,'unavailable');assert.deepEqual(c.saved,{})
 fail=false;assert.equal((await media(c)).status,'ready');assert.equal(c.calls.length,2)
 await media(c);assert.equal(c.calls.length,2)
})
test('F2 invalid hook is a terminal fallback once, never a success checkpoint',async()=>{
 const c=context(async()=>({items:[{...hook.items[0],quote:'not in transcript'}]}))
 assert.equal((await media(c)).status,'unavailable');assert.deepEqual(c.saved,{});assert.equal(c.calls.length,1)
})
for(const mode of ['before','during','resolved'])test(`F2 ${mode} abort is never checkpointed`,async()=>{
 const controller=new AbortController();if(mode==='before')controller.abort()
 const c=context(async()=>{controller.abort();if(mode==='during')throw Object.assign(Error('aborted'),{name:'AbortError'});return hook},controller.signal)
 await assert.rejects(()=>media(c));assert.deepEqual(c.saved,{})
 if(mode==='before')assert.equal(c.calls.length,0)
})
