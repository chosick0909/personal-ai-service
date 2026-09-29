import {test,mock} from 'node:test'
import assert from 'node:assert/strict'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
if (typeof mock.module !== 'function') {
 test('media API contract in module-isolated process',()=>{const result=spawnSync(process.execPath,['--experimental-test-module-mocks','--test',fileURLToPath(import.meta.url)],{encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr)})
} else {
const root=fileURLToPath(new URL('../',import.meta.url))
const id='11111111-1111-4111-8111-111111111111'
const owner='22222222-2222-4222-8222-222222222222'
const diagnosis={status:'ready',items:[{id:'hook-0',area:'hook',action:'revise',start:0,end:2,quote:'Hello',reason:'State the topic first.'}]}
const initial=()=>({id,user_id:owner,status:'ready',revision:0,duration_seconds:5,original_expires_at:new Date(Date.now()+3600000).toISOString(),manifest:{cuts:[],subtitles:[{id:'cue-0',start:0,end:2,text:'Hello'}],words:[],hookDiagnosis:structuredClone(diagnosis)}})
let row=initial()
const db={from(table){assert.equal(table,'creator_media_projects'); const filters=[];let patch;const q={select(){return q},eq(k,v){filters.push([k,v]);return q},update(v){patch=v;return q},async maybeSingle(){if(!filters.every(([k,v])=>row[k]===v))return {data:null};if(patch)row={...row,...structuredClone(patch)};return {data:structuredClone(row)}}};return q}}
mock.module(pathToFileURL(root+'src/lib/supabase.js').href,{namedExports:{getSupabaseAdmin:()=>db,hasSupabaseAdminConfig:()=>true}})
process.env.CREATOR_TOOLS_ENABLED='true';process.env.CREATOR_TOOLS_FEATURES='media-analyze';process.env.CREATOR_TOOLS_ROLLOUT_PERCENT='100'
const {createCreatorRouter}=await import(pathToFileURL(root+'src/creator-tools/routes.js'))
const router=createCreatorRouter()
async function invoke(method,path,body={},userId=owner){const route=router.stack.find(x=>x.route?.path===path&&x.route.methods[method]);assert.ok(route);let output,error;await route.route.stack[0].handle({params:{id},auth:{userId},body},{json(v){output=structuredClone(v)}},e=>{error=e});if(error)throw error;return output}
test('actual GET media route forwards worker diagnosis',async()=>{row=initial();assert.deepEqual((await invoke('get','/media-projects/:id')).manifest.hookDiagnosis,diagnosis)})
test('actual save and reopen preserve server diagnosis, reject client replacement',async()=>{row=initial();const manifest={...structuredClone(row.manifest),hookDiagnosis:{status:'ready',items:[{quote:'forged'}]},clips:[{id:'clip-0',start:0,end:4}]};const saved=await invoke('patch','/media-projects/:id/edit-manifest',{revision:0,manifest});assert.deepEqual(saved.manifest.hookDiagnosis,diagnosis);assert.deepEqual(row.manifest.hookDiagnosis,diagnosis);assert.deepEqual((await invoke('get','/media-projects/:id')).manifest.hookDiagnosis,diagnosis)})
test('owner isolation remains enforced',async()=>{row=initial();await assert.rejects(()=>invoke('get','/media-projects/:id',{},'33333333-3333-4333-8333-333333333333'),e=>e.code==='MEDIA_NOT_FOUND')})
test('stale save remains rejected',async()=>{row=initial();await assert.rejects(()=>invoke('patch','/media-projects/:id/edit-manifest',{revision:1,manifest:row.manifest}),e=>e.code==='EDIT_CONFLICT')})

}
