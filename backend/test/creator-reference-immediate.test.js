import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {normalizeReviewedCatalog} from '../src/creator-tools/reference-catalog.js'
import {discoverAccounts} from '../src/creator-tools/discovery.js'
import {completeReviewedReferenceJob} from '../src/creator-tools/reference-immediate.js'
const fixture=JSON.parse(await readFile(new URL('../catalog/home-2026-09-20.reviewed.json',import.meta.url)))
const approved=normalizeReviewedCatalog(fixture)
const input={category:'살림/인테리어',accountSize:'50k_100k',faceVisibility:'mixed',contentLanguage:'ko',excludeAccounts:[]}
function database(rows, error=null) {
 let job={id:'test',user_id:'user',kind:'reference-accounts',status:'queued',input}, completions=0
 return {get job(){return job}, get completions(){return completions},from(table){const q={};for(const k of ['select','eq','gte','order','limit'])q[k]=()=>q;q.maybeSingle=async()=>({data:job});q.then=(resolve)=>Promise.resolve({data:table==='creator_account_preferences'?[]:rows,error:table==='creator_reference_catalog'?error:null}).then(resolve);return q},async rpc(name,args){assert.equal(name,'creator_complete_job');assert.equal(args.p_id,job.id);completions++;job={...job,status:'completed',result:args.p_result};return {data:null}}}
}
const discover=(db,selection=input)=>discoverAccounts({db,job:{user_id:'user',input:selection},stage:async()=>{}},{catalogOnly:true})
test('catalog responds without Redis, worker or providers, including fewer than five matches',async()=>{
 const db=database(approved.filter(r=>r.profile.followers>=50000&&r.profile.followers<100000).slice(0,3));const r=await discover(db);assert.equal(r.accounts.length,3);assert.ok(r.accounts.every(a=>a.followers>=50000&&a.followers<100000))
})
test('missing/empty pool returns promptly and never launches live search',async()=>{assert.deepEqual((await discover(database([]),{...input,category:'육아/가족'})).accounts,[])})
test('catalog errors surface instead of falling back to paid discovery',async()=>{await assert.rejects(discover(database([],new Error('DB unavailable'))),/DB unavailable/)})
test('provisional publication needs explicit dated authorization and retains pending review',async()=>{
 const row=structuredClone(fixture[0]);row.reviewedByOperator=false;row.reviewedBy='';row.reviewedAt=null;assert.throws(()=>normalizeReviewedCatalog([row]));row.profile.candidatePublication={authorized:true,authorizedBy:'operator',authorizedAt:new Date().toISOString(),instruction:'검수 대기 후보 공개 승인'};
 const n=normalizeReviewedCatalog([row]);assert.equal(n[0].profile.reviewedByOperator,false);assert.equal((await discover(database(n),{...input,accountSize:'any'})).accounts[0].reviewStatus,undefined);
 row.profile.accountInsights['살림/인테리어'].ordinaryCreator=null;assert.throws(()=>normalizeReviewedCatalog([row]))
})
test('stale evidence and missing review remain rejected',async()=>{const bad=structuredClone(approved);bad.forEach(r=>r.verified_at='2020-01-01');assert.equal((await discover(database(bad))).accounts.length,0)})
test('immediate completion persists through existing RPC and is idempotent',async()=>{const db=database(approved);const r=await completeReviewedReferenceJob(db,db.job);assert.equal(r.status,'completed');assert.ok(r.result.accounts.length);await completeReviewedReferenceJob(db,r);assert.equal(db.completions,1)})
test('unrelated jobs do not enter catalog lookup',async()=>{const row={kind:'import-link',status:'queued'};assert.equal(await completeReviewedReferenceJob(null,row),row)})
