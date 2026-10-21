import { test, mock, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
if (typeof mock.module !== 'function') {
 test('actual copilot HTTP route in isolated process',()=>{
  const r=spawnSync(process.execPath,['--experimental-test-module-mocks','--test',fileURLToPath(import.meta.url)],{encoding:'utf8'})
  assert.equal(r.status,0,r.stdout+r.stderr)
 })
} else {
 const express=(await import('express')).default
 let server, responses=[], calls=[], usage=[], memory=[]
 const client={chat:{completions:{async create(request,options){calls.push({request,options});assert.ok(responses.length,'unexpected model call');const data=responses.shift();if(data instanceof Error)throw data;return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}]}}}}}
 const {topicFlowHarness}=await import('./fixtures/topic-flow-harness.mjs');await topicFlowHarness(client)
 const path=name=>new URL('../src/'+name,import.meta.url).href
 const noop=async()=>({})
 mock.module('express',{defaultExport:Object.assign(()=>{const app=express();const listen=app.listen.bind(app);app.listen=()=>{server=listen(0,'127.0.0.1');return server};return app},express)})
 mock.module(path('lib/reference-video-analysis.js'),{namedExports:Object.fromEntries(['analyzeReferenceVideo','createReferenceUploadSession','deleteReferenceVideo','getReferenceUploadSessionByClientUploadId','getReferenceVideo','listReferenceVideos','updateReferenceUploadSessionState','updateReferenceVideo'].map(name=>[name,noop]))})
 mock.module('dotenv',{defaultExport:{config(){}}})
 mock.module(path('lib/env-validation.js'),{namedExports:{assertBackendEnv(){}}})
 mock.module(path('lib/auth.js'),{namedExports:{requireAuth(req,res,next){req.auth={userId:'synthetic-user'};next()},requireAdmin(req,res,next){next()}}})
 mock.module(path('lib/accounts.js'),{namedExports:{createAccount:noop,deleteAccount:noop,listAccounts:noop,updateAccount:noop,resolveRequestAccount:async()=>({id:'synthetic-account'})}})
 mock.module(path('lib/account-character.js'),{namedExports:{getAccountCharacterContext:async()=>({characterId:'synthetic-character',systemPrompt:''})}})
 mock.module(path('lib/personalization-memory.js'),{namedExports:{buildPersonalizationContext:async()=>({sessionId:'synthetic-session',context:'',snapshot:{}}),updatePersonalizationMemory:async x=>{memory.push(x);return {persisted:true}}}})
 mock.module(path('lib/entitlements.js'),{namedExports:{applyCouponToUser:noop,assertEntitlementAccess:noop,getUserEntitlementStatus:noop,assertUsageAllowed:async()=>({entitlement:{id:'synthetic-entitlement'}}),recordUsageEvent:async event=>{usage.push(event)}}})
 mock.module(path('lib/analytics-logger.js'),{namedExports:{recordCopilotQualityEventSafe(){}}})
 mock.module(path('creator-tools/routes.js'),{namedExports:{createCreatorRouter:()=>express.Router()}})
 mock.module(path('lib/tool-history.js'),{namedExports:{createToolHistoryRouter:()=>express.Router()}})
 mock.module(path('lib/sentry.js'),{namedExports:{initBackendSentry(){},attachSentryRequestContext(req,res,next){next()},captureExceptionWithRequest(err,req,res,next){next(err)}}})
 process.env.PORT='0';process.env.HOST='127.0.0.1'
 await import('../src/index.js');if(!server.listening)await new Promise(resolve=>server.once('listening',resolve))
 after(()=>new Promise(resolve=>server.close(resolve)))
 const original={hook:'청소를 어디부터 시작할지 막막하죠.',body:'높은 선반부터 먼지를 털고 바닥은 마지막에 닦아보세요.',cta:'청소 전에 이 순서를 확인해보세요.'}
 const changed={...original,body:'높은 선반의 먼지를 먼저 털어보세요. 아래로 떨어진 먼지까지 모을 수 있도록 바닥은 마지막에 닦으면 돼요.'}
 const intent={intent:'edit_request',shouldModifyScript:true,editTarget:'all',operationType:'edit_partial',resolvedRequest:'기존 청소 순서를 더 쉽게 설명해줘'}
 async function request(sections=original,message='청소 순서를 더 쉽게 설명해줘'){return fetch(`http://127.0.0.1:${server.address().port}/api/scripts/copilot`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,sections})})}
 test('topic HTTP preflight and generation accept a pasted draft longer than 500 characters',async()=>{
  const topic='책상 위 물건을 쓰는 자리별로 정리하는 대본입니다.\n'.repeat(40)+'끝에 있는 조건도 남겨주세요.'
  const body={topic,clarifications:{targetAudience:'직장인',specificProblem:'물건을 찾기 어려움',desiredOutcome:'찾기 쉽게 정리'}}
  for(const route of ['topic-preflight','generate-topic']){
   calls=[];responses=[new Error('intentional stop after accepted topic task')]
   const response=await fetch(`http://127.0.0.1:${server.address().port}/api/reference-videos/${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
   const payload=await response.json()
   assert.equal(response.status,route==='topic-preflight'?200:202,JSON.stringify(payload))
   if(route==='generate-topic') {assert.equal(payload.analysis.source_mode,'topic_only');assert.equal(payload.analysis.topic,topic)}
  }
 })
 test('authenticated attachment endpoint reads a general text document without consuming analysis usage',async()=>{
  usage=[]
  const form=new FormData();form.append('files',new Blob(['일정: 11월 3일 오후 2시\n준비물: 필기구'],{type:'text/plain'}),'안내.txt')
  form.append('readingContext','온라인 워크숍 소개')
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/reference-videos/supporting-materials`,{method:'POST',body:form})
  const payload=await response.json()
  assert.equal(response.status,200,JSON.stringify(payload))
  assert.equal(payload.items[0].status,'ready')
  assert.equal(payload.items[0].content,'일정: 11월 3일 오후 2시\n준비물: 필기구')
  assert.equal(usage.length,0)
  const invalid=new FormData();invalid.append('files',new Blob(['bad']),'실행.exe')
  const rejected=await fetch(`http://127.0.0.1:${server.address().port}/api/reference-videos/supporting-materials`,{method:'POST',body:invalid})
  assert.equal(rejected.status,400)
 })
 test('unchanged initial answer is rewritten through the actual route and charged once only after a changed proposal',async()=>{
  usage=[];memory=[];calls=[];responses=[intent,{message:'기존 내용을 유지했어요.',sections:original},{issues:[]},{message:'닦는 순서와 이유를 풀어 썼어요.',sections:changed},{issues:[]}]
  const response=await request(),payload=await response.json()
  assert.equal(response.status,200,JSON.stringify(payload))
  assert.deepEqual(payload.proposedSections,changed)
  assert.equal(payload.autoApplied,false)
  assert.equal(payload.qualityGate.passed,true)
  assert.equal(payload.qualityGate.repaired,true)
  assert.doesNotMatch(payload.message,/나아지지|원문은 그대로|유지했/)
  assert.equal(usage.length,1);assert.equal(memory.length,1)
  assert.ok(calls.every(call=>call.options?.maxRetries===0&&call.options.timeout<=100000))
  assert.equal(responses.length,0)
 })
 test('persistent provider no-op is never returned as successful editing or charged, and does not loop',async()=>{
  usage=[];memory=[];calls=[];responses=[intent,{sections:original},{issues:[]},...Array.from({length:3},()=>({sections:original}))]
  const response=await request(),payload=await response.json()
  assert.equal(response.status,503,JSON.stringify(payload))
  assert.equal(payload.code||payload.error?.code,'COPILOT_GENERATION_INCOMPLETE')
  assert.equal(usage.length,0);assert.equal(memory.length,0)
  assert.equal(calls.length,6)
  assert.equal(responses.length,0)
 })
 test('duration adjustment preserves an identified current topic through the actual HTTP route',async()=>{
  usage=[];memory=[];calls=[]
  responses=[{...intent,operationType:'duration_expand',targetDurationSeconds:60,
    resolvedRequest:'현재 청소 대본을 주제를 유지하면서 60초로 늘려줘',
    semanticInstruction:{intent:'edit_script',confidence:0.95,
      topicChange:{requested:false,oldSubjects:['청소'],newSubject:null,confidence:0.95,evidence:'현재 주제'},
      operations:[{type:'duration_expand',target:'all',goal:'기존 설명 보강',styleTarget:'',evidence:'60초로 조절',confidence:0.95}],
      locks:[],metadata:{targetDurationSeconds:60,explicitRemove:[]}}},
    {sections:changed,message:'닦는 순서와 이유를 풀어 썼어요.'},{issues:[]}]
  const response=await request(original,'현재 대본을 60초 분량으로 조절해줘'),payload=await response.json()
  assert.equal(response.status,200,JSON.stringify(payload))
  assert.deepEqual(payload.proposedSections,changed)
  assert.equal(payload.qualityGate.passed,true)
  assert.equal(payload.qualityGate.repaired,false)
  assert.equal(calls.length,3,'keeping the topic must not start futile repair cycles')
  assert.equal(usage.length,1);assert.equal(memory.length,1)
  assert.equal(responses.length,0)
 })
 test('a later first-sentence edit targets actual text in body-only saved history',async()=>{
  usage=[];memory=[];calls=[]
  const source={hook:'',body:'출장 전에 신분증을 확인하세요. 예약 서류도 함께 모아두세요. 마지막으로 충전기를 챙겨요.',cta:''}
  const next='출발하기 전에 신분증부터 눈으로 확인해보세요.'
  responses=[{...intent,editTarget:'hook',resolvedRequest:'첫 문장만 더 구체적으로 바꿔줘'}, {section:next,message:'첫 문장을 구체적인 행동으로 제안했어요.'}]
  const response=await request(source,'첫 문장만 더 구체적으로 바꿔줘'),payload=await response.json()
  assert.equal(response.status,200,JSON.stringify(payload))
  assert.equal(payload.proposedSections.hook,next)
  assert.equal(payload.proposedSections.body,'예약 서류도 함께 모아두세요.')
  assert.equal(payload.proposedSections.cta,'마지막으로 충전기를 챙겨요.')
  assert.equal(usage.length,1)
  assert.equal(source.hook,'')
 })
 test('first/last sentence requests edit the existing single sentence instead of appending to an empty slot',async()=>{
  usage=[];memory=[];calls=[]
  const source={hook:'',body:'출발 전에 신분증을 확인해요.',cta:''}
  const next='가방을 닫기 전에 신분증부터 확인해보세요.'
  responses=[{...intent,editTarget:'hook',resolvedRequest:'첫 문장만 더 구체적으로 바꿔줘'}, {section:next,message:'확인하는 시점을 분명하게 제안했어요.'},{issues:[]}]
  const response=await request(source,'첫 문장만 더 구체적으로 바꿔줘'),payload=await response.json()
  assert.equal(response.status,200,JSON.stringify(payload))
  assert.equal(payload.proposedSections.body,next)
  assert.equal(payload.proposedSections.hook,'')
  assert.equal(payload.proposedSections.cta,'')
  assert.equal(usage.length,1)
 })

 test('a missing critical review does not fabricate approval or consume usage',async()=>{
  usage=[];memory=[];calls=[];responses=[intent,{sections:changed},new Error('synthetic critical reviewer unavailable')]
  const response=await request(),payload=await response.json()
  assert.equal(response.status,503,JSON.stringify(payload))
  assert.equal(usage.length,0)
  assert.equal(memory.length,0)
  assert.equal(calls.length,3,'unavailable review is not a reason to rewrite a good candidate repeatedly')
 })

}
