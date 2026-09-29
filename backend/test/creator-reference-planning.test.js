import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { publicJob } from '../src/creator-tools/store.js'
import { discoverAccounts } from '../src/creator-tools/discovery.js'
import { normalizeReviewedCatalog } from '../src/creator-tools/reference-catalog.js'
import { generatedPlanningTopics, referencePlanningPoints, REFERENCE_PLANNING_VERSION } from '../src/creator-tools/reference-planning.js'
const source = JSON.parse(readFileSync(new URL('../catalog/home-2026-09-20.reviewed.json', import.meta.url)))
const edits = JSON.parse(readFileSync(new URL('../catalog/reference-student-topics-20260930.json', import.meta.url)))
const category = '살림/인테리어'
const savedAccount = row => ({username:row.username, referencePoints:row.profile.accountInsights[category].referencePoints.slice(0,3), matchScore:72, followers:row.profile.followers})

test('all 44 saved catalog outputs and historical job reads receive the same three reviewed topics without mutating evidence', () => {
  assert.equal(source.length,44)
  assert.deepEqual(edits.accounts.map(a=>a.username).sort(),source.map(a=>a.username).sort())
  const row={id:'history',kind:'reference-accounts',status:'completed',input:{category},result:{accounts:source.map(savedAccount)}}
  const original=structuredClone(row)
  const shown=publicJob(row).result.accounts
  for(const [i,account] of shown.entries()) {
    const correction=edits.accounts.find(a=>a.username===account.username)
    assert.deepEqual(account.referencePoints,correction.topics)
    assert.equal(account.referencePoints.length,3)
    assert.equal(new Set(account.referencePoints).size,3)
    assert.equal(account.referencePointsVersion,REFERENCE_PLANNING_VERSION)
    assert.equal(account.followers,original.result.accounts[i].followers)
    assert.equal(account.matchScore,72)
    assert.deepEqual(correction.sourceObservations,source[i].profile.accountInsights[category].reasons)
  }
  assert.deepEqual(row,original)
  assert.deepEqual(publicJob({...row,result:{accounts:shown}}).result.accounts,shown)
})

test('reported account retains a personal-use topic but replaces business/interview dependencies with filmable comparisons',()=>{
 const shown=referencePlanningPoints(savedAccount(source.find(r=>r.username==='salimemohouse')),category)
 assert.deepEqual(shown.referencePoints,[
  '내가 실제로 자주 쓰는 살림도구 TOP3와 쓰는 이유',
  '비슷한 살림도구를 가격·세척·보관 공간으로 비교하기',
  '집에서 반복되는 불편 한 가지를 도구 사용 전후로 보여주기',
 ])
})

test('source matching avoids assigning home topics to another category or overwriting changed records',()=>{
 const row=savedAccount(source[0])
 for(const account of [{...row,username:'different'},{...row,referencePoints:['Changed editorial text']}]) {
  assert.equal(referencePlanningPoints(account,category).referencePointsStatus,'needs_review')
 }
 assert.deepEqual(referencePlanningPoints(row,'운동/건강').referencePoints,[])
 const approved={...row,referencePointsVersion:REFERENCE_PLANNING_VERSION,referencePoints:['새로 검토한 콘텐츠 주제']}
 assert.deepEqual(referencePlanningPoints(approved,category).referencePoints,approved.referencePoints)
})

test('new generation requires a viewer problem, filming plan and an actual supplied source, across categories',()=>{
 const profile={exampleMedia:[{permalink:'https://www.instagram.com/reel/KNOWN/'}]}
 for (const title of ['러닝화 끈 묶는 방법을 착화감으로 비교','양념 보관 위치를 조리 순서에 맞춰 바꾸기']) {
  const topic={title,viewerProblem:'선택 기준을 알고 싶음',filmingPlan:'동일한 조건에서 직접 비교',sourcePostUrl:profile.exampleMedia[0].permalink}
  assert.equal(generatedPlanningTopics({contentTopics:[topic]},profile)[0].title,title)
  for (const bad of [{...topic,filmingPlan:''},{...topic,viewerProblem:''},{...topic,sourcePostUrl:'https://example.com/invented'}]) {
   assert.equal(generatedPlanningTopics({contentTopics:[bad]},profile),null)
  }
  assert.equal(generatedPlanningTopics({contentTopics:[topic,topic]},profile),null)
 }
 assert.equal(generatedPlanningTopics({referencePoints:['가장 인상 깊었던 구매자 후기는?']},profile),null)
})

test('catalog-only production function corrects planning without providers and retains account selection and metadata',async()=>{
 const rows=normalizeReviewedCatalog(source)
 const original=structuredClone(rows)
 const db={from(table){const q={};for(const name of ['select','eq','gte','order','limit'])q[name]=()=>q;q.then=resolve=>Promise.resolve({data:table==='creator_account_preferences'?[]:rows}).then(resolve);return q}}
 const result=await discoverAccounts({db,job:{user_id:'user',input:{category,accountSize:'any',faceVisibility:'any',contentLanguage:'ko'}},stage:async()=>{}},{catalogOnly:true})
 assert.equal(result.accounts.length,12)
 for(const account of result.accounts) {
  const correction=edits.accounts.find(a=>a.username===account.username)
  assert.deepEqual(account.referencePoints,correction.topics)
  assert.equal(account.referencePointsStatus,'ready')
 }
 assert.deepEqual(rows,original)
})

test('other job kinds are returned unchanged and no internal source observations leak through projection',()=>{
 const result={accounts:source.map(savedAccount)}
 assert.equal(publicJob({kind:'import-link',result}).result,result)
 const data=publicJob({kind:'reference-accounts',input:{category},result}).result
 assert.equal(JSON.stringify(data).includes('sourceObservations'),false)
})
