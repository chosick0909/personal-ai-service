import {test,mock} from 'node:test'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
if(typeof mock.module!=='function'){
 test('copilot duration repair production flow in isolated process',()=>{const r=spawnSync(process.execPath,['--experimental-test-module-mocks','--test',fileURLToPath(import.meta.url)],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr)})
}else{
 const {topicFlowHarness}=await import('./fixtures/topic-flow-harness.mjs')
 const {shortDrafts}=await import('./fixtures/topic-short.mjs')
 let outputs=[],calls=[]
 await topicFlowHarness({chat:{completions:{async create(request){calls.push(request);const next=outputs.shift();if(next instanceof Error)throw next;return {choices:[{message:{content:JSON.stringify(next)},finish_reason:'stop'}]}}}}})
 const {repairRefinedScriptWithQaIssues,buildEditPlan,validateRefinedScriptQuality}=await import('../src/lib/script-assistant.js')
 const {estimateScriptSeconds}=await import('../../shared/script-duration.mjs')
 const original=shortDrafts[0],long={...original,body:original.body.repeat(4)}
 const plan=buildEditPlan({currentSections:long,userRequest:'40초 분량으로 조절해줘',targetDurationSeconds:40})
 const args={accountId:'local-only',referenceId:'local-only',originalSections:long,proposedSections:long,request:'40초 분량으로 조절해줘',editTarget:'all',targetDurationSeconds:40,editPlan:plan,qaMode:plan.qaMode,qaIssues:[{type:'duration_range_miss',severity:'medium',section:'all',reason:'too long'}]}
 test('duration-only repair remeasures the actual candidate before retry',async()=>{
  calls=[];outputs=[{sections:long},{issues:[{type:'requested_material_missing',severity:'high',section:'all',reason:'필수 정보 누락'}]},{sections:original},{ok:true,shouldRepair:false,issues:[]}]
  const result=await repairRefinedScriptWithQaIssues(args)
  assert.equal(result.success,true,JSON.stringify(result.postCheck))
  assert.equal(result.durationRetried,true)
  assert.equal(calls.length,4)
  assert.deepEqual(result.sections,original)
  assert.ok(calls[2].messages.some(m=>m.content.includes(`${estimateScriptSeconds(long)}초`)))
 })
 test('persistent critical request failure is bounded to three repairs, never loops indefinitely',async()=>{
  calls=[];outputs=Array.from({length:3},()=>({sections:long}))
  const result=await repairRefinedScriptWithQaIssues(args)
  assert.equal(result.success,false)
  assert.equal(result.durationRetried,true)
  assert.equal(calls.length,3)
 })
 test('semantic problems introduced by duration repair are checked and repaired within the same bound',async()=>{
  const revised={...original,body:original.body.replace('청소는 높은 곳부터 시작하세요.','청소는 높은 선반부터 시작하세요.')}
  calls=[];outputs=[{sections:original},{issues:[{type:'requested_material_missing',severity:'medium',section:'body',reason:'동작 대상 보완'}]},{sections:revised},{issues:[]}]
  const result=await repairRefinedScriptWithQaIssues(args)
  assert.equal(result.success,true)
  assert.equal(result.durationRetried,true)
  assert.equal(result.postCheck.semanticReviewed,true)
  assert.equal(calls.length,4)
  assert.deepEqual(result.sections,revised)
 })
 test('unavailable semantic review after duration repair is not reported as verified success',async()=>{
  calls=[];outputs=[{sections:original},new Error('synthetic reviewer unavailable')]
  const result=await repairRefinedScriptWithQaIssues(args)
  assert.equal(result.success,false)
  assert.ok(result.postCheck.issueTypes.includes('quality_review_unavailable'))
  assert.equal(calls.length,2)
 })
 test('exact locks are decided by text equality, not a model claim that evidence is missing',async()=>{
  const lockedPlan=buildEditPlan({currentSections:original,userRequest:'훅은 그대로 두고 60초로 늘려줘',targetDurationSeconds:60})
  calls=[];outputs=[{issues:[{type:'section_instruction_violation',severity:'high',section:'hook',reason:'cannot verify original'}]}]
  const same=await validateRefinedScriptQuality({accountId:'local-only',referenceId:'local-only',originalSections:original,proposedSections:{...original,body:original.body+' 순서대로 닦아보세요.'},request:'말투를 다듬어줘',editPlan:lockedPlan,preserveSections:['hook']})
  assert.equal(same.ok,true)
  calls=[];outputs=[{issues:[]}]
  const changed=await validateRefinedScriptQuality({accountId:'local-only',referenceId:'local-only',originalSections:original,proposedSections:{...original,hook:'변경하면 안 되는 도입을 변경했습니다.'},request:'본문만 다듬어줘',editTarget:'body',editPlan:lockedPlan,preserveSections:['hook']})
  assert.equal(changed.ok,false)
  assert.ok(changed.issueTypes.includes('section_instruction_violation'))
 })
 test('copilot reviewer gets measured seconds and only its own output contract',async()=>{
  calls=[];outputs=[{ok:false,shouldRepair:true,issues:[{type:'duration_out_of_range',severity:'high',section:'all',reason:'model guessed incorrectly'}]}]
  const qa=await validateRefinedScriptQuality({...args,proposedSections:original})
  assert.equal(qa.ok,true,'model timing guesses must not override a passing code measurement')
  const prompt=calls[0].messages.map(m=>m.content).join('\n')
  assert.ok(prompt.includes('시간·글자 수는 생성 지침이고 실패 조건이 아니다'))
  assert.equal(prompt.includes('목표 글자 범위(공백 제외)'),false)
  assert.equal(prompt.includes('speechIssues는'),false)
 })
 test('whole-script storage permits explicit empty slots but missing output cannot erase text', async()=>{
  const {__scriptAssistantTest:t,runFeedbackFallbackRuleCheck,validateScriptFlow}=await import('../src/lib/script-assistant.js')
  const source={hook:'원래 도입이에요.',body:'원래 내용이에요.',cta:'원래 마무리예요.'}
  const whole={hook:'',body:'작업을 마치면 파일 이름부터 정리해보세요. 찾을 때 쓸 기준으로 이름을 붙이면 돼요.',cta:''}
  const parsed=t.extractProposedSections({sections:whole},['hook','body','cta'])
  assert.deepEqual(t.applyEditScope(source,parsed),whole)
  assert.equal(validateScriptFlow(whole,{continuous:true}).ok,true)
  assert.equal(validateScriptFlow({hook:'',body:'',cta:''},{continuous:true}).ok,false)
  assert.deepEqual(t.applyEditScope(source,t.extractProposedSections({},['hook','body','cta'])),source)
  assert.deepEqual(t.applyEditScope(source,t.extractProposedSections({},['cta']),['cta']),source)
  assert.deepEqual(t.applyEditScope(source,whole,['body']),{...source,body:whole.body})
  assert.equal(runFeedbackFallbackRuleCheck({originalSections:source,candidateSections:whole}).ok,true)
 })
 test('unchanged editing answers are regenerated and style-only criticisms never trigger a retry', async()=>{
  const changed={...original,body:original.body+' 닦을 순서를 먼저 정해보세요.'}
  const editPlan=buildEditPlan({currentSections:original,userRequest:'청소 순서를 더 쉽게 설명해줘'})
  calls=[];outputs=[{issues:[]},{sections:changed},{issues:[{type:'unnatural_korean',severity:'high',section:'body',reason:'말투 취향'}]}]
  const qa=await validateRefinedScriptQuality({accountId:'local-only',referenceId:'local-only',originalSections:original,proposedSections:original,request:'청소 순서를 더 쉽게 설명해줘',editPlan})
  assert.ok(qa.issueTypes.includes('requested_change_missing'))
  // The first response above belongs to QA, then a changed writing and review response.
  const repaired=await repairRefinedScriptWithQaIssues({accountId:'local-only',referenceId:'local-only',originalSections:original,proposedSections:original,request:'청소 순서를 더 쉽게 설명해줘',editPlan,qaIssues:qa.issues})
  assert.equal(repaired.success,true,JSON.stringify(repaired.postCheck))
  assert.notDeepEqual(repaired.sections,original)
  assert.equal(repaired.postCheck.semanticReviewed,true)
  assert.equal(calls.length,3,'speaking style must not cause another repair')
 })

}
