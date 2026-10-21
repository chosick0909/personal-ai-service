import { test, mock } from 'node:test'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
if(typeof mock.module!=='function') {
 test('topic duration production flow in isolated process',()=>{const r=spawnSync(process.execPath,['--experimental-test-module-mocks','--test',fileURLToPath(import.meta.url)],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr)})
} else {
 const {topicFlowHarness}=await import('./fixtures/topic-flow-harness.mjs')
 const {shortDrafts,planningFixture}=await import('./fixtures/topic-short.mjs')
 let mode='short';let calls=[]
 const client={chat:{completions:{async create(request){calls.push(request);let data
  const system=request.messages[0].content
  if(system.includes('콘텐츠 전략가')) {data=planningFixture();if(request.messages[1].content.includes('MATERIAL_CONTEXT_SENTINEL'))data.referenceKnowledge={understanding:'행사 안내 참고자료를 이해했다.',selectedFacts:['SELECTED_CONTEXT_SENTINEL: 행사 일시는 11월 3일 오후 2시.'],narrativeFocus:'일정을 자연스럽게 설명한다.'}}
  else if(system.includes('품질 심사자'))data={evaluations:['A','B','C'].map(key=>({key,criticalIssues:mode==='critical'?[{type:'unsupported_fact',quote:'없는 사실',reason:'합성 허위 경험'}]:[],conceptMatches:true,scores:{relevance:5,coherence:5,specificity:5,factualSafety:mode==='critical'?1:5,naturalness:mode==='style'?1:5},issues:[]}))}
  else {const i=['A','B','C'].findIndex(key=>request.messages[1].content.includes(key+'안 '+({A:'손실 회피형',B:'통념 반박형',C:'공감 스토리형'}[key])));data=structuredClone(shortDrafts[Math.max(i,0)]);if(mode==='long'||(mode==='repair'&&!system.includes('재작성')))data.body=data.body.repeat(3)}
  return {choices:[{message:{content:JSON.stringify(data)},finish_reason:mode==='cut'?'length':'stop'}]}
 }}}}
 const flow=await topicFlowHarness(client)
 const input={accountId:'synthetic-only',topic:'청소 순서',clarifications:{targetAudience:'퇴근 후 청소하는 직장인',specificProblem:'청소 순서가 없어 같은 곳을 다시 닦음',desiredOutcome:'동선을 정리해 청소를 끝냄'}}
 test('production generator publishes 30–50 second drafts without lengthening repair',async()=>{mode='short';calls=[];flow.reset();const result=await flow.generateTopicOnlyScripts(input);assert.equal(result.analysis.processing_status,'completed');assert.ok(result.analysis.topic_brief.estimatedDurationSeconds.every(n=>n>=30&&n<=50));assert.equal(calls.length,5);assert.equal(result.analysis.topic_brief.repaired,false)})
 test('writer uses understood reference knowledge while planner, review and history keep original evidence',async()=>{
  mode='short';calls=[];flow.reset()
  const supportingMaterials=[{name:'행사 안내.pdf',mimeType:'application/pdf',content:'MATERIAL_CONTEXT_SENTINEL: 행사 일시는 11월 3일 오후 2시. 준비물은 필기구.',warnings:[]}]
  const result=await flow.generateTopicOnlyScripts({...input,supportingMaterials})
  assert.equal(result.analysis.processing_status,'completed')
  assert.equal(calls.length,5)
  const planner=calls.find(call=>call.messages[0].content.includes('콘텐츠 전략가'))
  const reviewer=calls.find(call=>call.messages[0].content.includes('품질 심사자'))
  const writers=calls.filter(call=>!call.messages[0].content.includes('콘텐츠 전략가')&&!call.messages[0].content.includes('품질 심사자'))
  assert.ok(JSON.stringify(planner.messages).includes('MATERIAL_CONTEXT_SENTINEL'))
  assert.ok(JSON.stringify(reviewer.messages).includes('MATERIAL_CONTEXT_SENTINEL'))
  assert.ok(writers.every(call=>!JSON.stringify(call.messages).includes('MATERIAL_CONTEXT_SENTINEL')&&JSON.stringify(call.messages).includes('SELECTED_CONTEXT_SENTINEL')))
  assert.deepEqual(result.analysis.topic_brief.supportingMaterials,supportingMaterials)
  assert.ok(flow.writes.some(w=>w.payload.topic_brief?.supportingMaterials?.[0]?.content.includes('MATERIAL_CONTEXT_SENTINEL')))
 })
 test('reference-backed explanations need factual substance but do not require an invented action checklist',async()=>{
  const {__topicScriptGenerationTest:helpers}=await import('../src/lib/topic-script-generation.js')
  const fixture=planningFixture();fixture.factPack.actionableMethods=[]
  const args={topic:input.topic,readiness:{inputQuality:'explicit',inferredContext:input.clarifications,clarifications:input.clarifications},evidence:{evidenceNotes:[]},riskLevel:'low',supportingMaterials:[{name:'정보.txt',content:'사용자가 제공한 설명 자료'}]}
  const planning=helpers.normalizePlanningResult(fixture,args)
  assert.equal(planning.factPack.actionableMethods.length,0)
  fixture.factPack.coreFacts=[]
  assert.throws(()=>helpers.normalizePlanningResult(fixture,args),{code:'TOPIC_FACT_PACK_INCOMPLETE'})
 })
 test('timing alone never adds a regeneration call or rejects the generated script',async()=>{mode='long';calls=[];flow.reset();const result=await flow.generateTopicOnlyScripts(input);assert.equal(result.analysis.processing_status,'completed');assert.ok(result.analysis.topic_brief.estimatedDurationSeconds.every(n=>n>60));assert.equal(result.analysis.topic_brief.repaired,false);assert.equal(calls.length,5);assert.ok(calls.filter(c=>!c.messages[0].content.includes('심사자')).some(c=>JSON.stringify(c.messages).includes('30~50초')))})
 test('planner cannot replace user context and evaluator is independent of planning language',async()=>{
  const {__topicScriptGenerationTest:helpers}=await import('../src/lib/topic-script-generation.js')
  const fixture=planningFixture()
  fixture.contentBrief.targetAudience='기획자가 임의로 바꾼 타깃'
  fixture.outlines[0].beats[0].goal='PLANNER_ONLY_PRIVATE_SENTINEL'
  const planning=helpers.normalizePlanningResult(fixture,{topic:input.topic,readiness:{inputQuality:'explicit',inferredContext:input.clarifications,clarifications:input.clarifications},evidence:{evidenceNotes:['확인한 근거']},riskLevel:'low'})
  assert.equal(planning.contentBrief.targetAudience,input.clarifications.targetAudience)
  assert.equal(planning.contentBrief.specificProblem,input.clarifications.specificProblem)
  calls=[]
  await helpers.evaluateVariations({openai:client,model:'synthetic',planning,variations:shortDrafts,hardValidation:{issuesByIndex:[[],[],[]]}})
  const prompt=JSON.stringify(calls[0].messages)
  assert.ok(prompt.includes(input.clarifications.targetAudience))
  assert.ok(prompt.includes('확인한 근거'))
  assert.equal(prompt.includes('PLANNER_ONLY_PRIVATE_SENTINEL'),false)
 })
 test('compact planning shares factual flow instead of repeating three long outlines',async()=>{
  const {__topicScriptGenerationTest:t}=await import('../src/lib/topic-script-generation.js')
  const old=planningFixture(),ready={inputQuality:'explicit',inferredContext:input.clarifications,clarifications:input.clarifications}
  const compact={contentBrief:{corePromise:'먼지를 위에서 아래로 모은다'},factPack:old.factPack,sharedFlow:[{goal:'선반 먼지를 먼저 턴다',factIds:['fact-1']},{goal:'바닥을 마지막에 닦는다',methodIds:['method-1']}],openings:{A:'같은 곳을 두 번 닦는 상황',B:'닦는 시간보다 순서가 중요한 이유',C:'퇴근 후 청소를 시작하는 상황'}}
  const planning=t.normalizePlanningResult(compact,{topic:input.topic,readiness:ready,evidence:{evidenceNotes:[]},riskLevel:'general'})
  assert.equal(planning.outlines.length,3)
  assert.equal(planning.outlines[0].beats.length,3)
  assert.ok(planning.outlines.every(outline=>outline.beats[1].goal==='선반 먼지를 먼저 턴다'))
  assert.equal(planning.outlines[1].beats[0].goal,compact.openings.B)
 })
 test('style scores never add a repair call, while critical factual errors still block completion',async()=>{
  mode='style';calls=[];flow.reset();const good=await flow.generateTopicOnlyScripts(input);assert.equal(good.analysis.processing_status,'completed');assert.equal(calls.length,5)
  mode='critical';calls=[];flow.reset();await assert.rejects(()=>flow.generateTopicOnlyScripts(input),{code:'TOPIC_CRITICAL_VALIDATION_FAILED'});assert.equal(calls.length,9);assert.equal(flow.writes.some(w=>w.payload.processing_status==='completed'),false)
 })
 test('cut-off provider responses are never accepted as completed scripts',async()=>{
  mode='cut';calls=[];flow.reset();await assert.rejects(()=>flow.generateTopicOnlyScripts(input),{code:'INCOMPLETE_MODEL_RESPONSE'});assert.equal(calls.length,1);assert.equal(flow.writes.some(w=>w.payload.processing_status==='completed'),false)
 })

 test('high scores cannot pardon a reported fabricated experience',async()=>{
  const {__topicScriptGenerationTest:t}=await import('../src/lib/topic-script-generation.js')
  const fakeClient={chat:{completions:{async create(){return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({evaluations:['A','B','C'].map(key=>({key,criticalIssues:key==='C'?[{type:'copied_experience',quote:'직접 써봤어요.',reason:'사용자에게 없는 경험'}]:[],scores:{relevance:5,factualSafety:5},issues:[]}))})}}]}}}}}
  const planning={inputBrief:{topic:'수납 바구니 소개'},grounding:{evidenceNotes:[]}}
  const result=await t.evaluateVariations({openai:fakeClient,model:'synthetic',planning,variations:shortDrafts,hardValidation:{issuesByIndex:[[],[],[]]}})
  assert.equal(result[0].pass,true)
  assert.equal(result[2].pass,false)
  assert.equal(result[2].scores.factualSafety,5)
  assert.equal(result[2].criticalIssues[0].type,'copied_experience')
 })

}
