import {test,mock} from 'node:test'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
if (typeof mock.module !== 'function') {
 test('link progress API in module-isolated process',()=>{const r=spawnSync(process.execPath,['--experimental-test-module-mocks','--test',fileURLToPath(import.meta.url)],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr)})
} else {
const id='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222'
const row={id,user_id:owner,kind:'import-link',status:'running',stage:'analyzing_reference',result:null,input:{entitlementId:'private'},checkpoint:{referenceTranscriptV1:{sourceLanguage:'en',originalTranscript:'Original transcript',translatedTranscript:'검증된 한국어',extractedAt:new Date().toISOString()},brightDataReceipt:{snapshotId:'private'}}}
const db={from(table){assert.equal(table,'creator_jobs');const filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},async maybeSingle(){return {data:filters.every(([k,v])=>row[k]===v)?structuredClone(row):null}}};return q}}
mock.module(new URL('../src/lib/supabase.js',import.meta.url).href,{namedExports:{getSupabaseAdmin:()=>db,hasSupabaseAdminConfig:()=>true}})
process.env.CREATOR_TOOLS_ENABLED='true';process.env.CREATOR_TOOLS_FEATURES='import-link';process.env.CREATOR_TOOLS_ROLLOUT_PERCENT='100'
const {createCreatorRouter}=await import('../src/creator-tools/routes.js')
const route=createCreatorRouter().stack.find(x=>x.route?.path==='/creator-tools/jobs/:id'&&x.route.methods.get)
async function poll(userId){let output,error;await route.route.stack[0].handle({params:{id},auth:{userId}},{json(v){output=v}},e=>{error=e});if(error)throw error;return output}
test('real polling route exposes validated transcript while status remains running',async()=>{const output=await poll(owner);assert.equal(output.status,'running');assert.equal(output.result.analysisStatus,'pending');assert.equal(output.result.originalTranscript,'Original transcript');assert.ok(!JSON.stringify(output).includes('private'))})
test('another user cannot read the intermediate transcript',async()=>{await assert.rejects(()=>poll('33333333-3333-4333-8333-333333333333'),{code:'JOB_NOT_FOUND'})})
}
