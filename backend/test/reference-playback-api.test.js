import {test,mock} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import express from 'express'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
if(typeof mock.module!=='function'){
 test('reference playback API in isolated module-mock process',()=>{const r=spawnSync(process.execPath,['--experimental-test-module-mocks','--test',fileURLToPath(import.meta.url)],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr)})
}else{
const fixture=JSON.parse(readFileSync(new URL('../catalog/home-2026-09-20.reviewed.json',import.meta.url)))[0]
const rowBase={username:fixture.username,professional:true,active:true,verified_at:fixture.verifiedAt,last_active_at:fixture.lastActiveAt,profile:{...fixture.profile,reviewedByOperator:true,reviewedBy:fixture.reviewedBy,reviewedAt:fixture.reviewedAt}}
let row=structuredClone(rowBase), calls=0, media={url:'https://video.cdninstagram.com/fixture.mp4'}
const filters=[]
const db={from(table){assert.equal(table,'creator_reference_catalog');const q={select(){filters.length=0;return q},eq(k,v){filters.push([k,v]);return q},async maybeSingle(){return {data:row&&filters.every(([k,v])=>row[k]===v)?row:null}}};return q}}
mock.module(new URL('../src/lib/supabase.js',import.meta.url).href,{namedExports:{getSupabaseAdmin:()=>db,hasSupabaseAdminConfig:()=>true}})
mock.module(new URL('../src/creator-tools/reference-playback.js',import.meta.url).href,{namedExports:{referencePlayback:{resolve:async()=>{calls++;return media}}}})
process.env.CREATOR_TOOLS_ENABLED='true';process.env.CREATOR_TOOLS_FEATURES='reference-accounts';process.env.CREATOR_TOOLS_ROLLOUT_PERCENT='100'
const {createCreatorRouter}=await import('../src/creator-tools/routes.js')
const router=createCreatorRouter(),route=router.stack.find(x=>x.route?.path==='/discovery/reference-playback').route
async function invoke(body){let output,error,cache;await route.stack[0].handle({body,auth:{userId:'test'}},{set(k,v){cache=[k,v];return this},json(v){output=v}},e=>{error=e});if(error)throw error;return {output,cache}}
const body=()=>({username:fixture.username,permalink:rowBase.profile.exampleMedia[0].permalink})
test('approved catalog playback resolves only known records without writes or usage recording',async()=>{
 row=structuredClone(rowBase);calls=0
 const r=await invoke(body());assert.equal(calls,1);assert.deepEqual(r.output,{media});assert.deepEqual(r.cache,['Cache-Control','private, no-store'])
 assert.ok(filters.some(([k,v])=>k==='active'&&v===true));assert.ok(filters.some(([k,v])=>k==='professional'&&v===true))
})
test('arbitrary URL, unknown post/account, inactive and revoked rows never reach extractor',async()=>{
 for(const b of [{...body(),permalink:'https://evil.test/v'},{...body(),permalink:'https://instagram.com/reel/Unknown/'},{...body(),username:'unknown'}]){
  row=structuredClone(rowBase);calls=0;await assert.rejects(invoke(b));assert.equal(calls,0)
 }
 for(const change of [r=>{r.active=false},r=>{r.profile.reviewedByOperator=false},r=>{r.profile.followers=9999}]){
  row=structuredClone(rowBase);change(row);calls=0;await assert.rejects(invoke(body()));assert.equal(calls,0)
 }
})
test('unavailable media returns no player and disabled feature refuses lookup',async()=>{
 row=structuredClone(rowBase);media=null
 assert.deepEqual((await invoke(body())).output,{media:null})
 process.env.CREATOR_TOOLS_FEATURES='import-link';calls=0
 await assert.rejects(invoke(body()),{code:'FEATURE_DISABLED'});assert.equal(calls,0)
 process.env.CREATOR_TOOLS_FEATURES='reference-accounts'
})

test('actual HTTP router requires existing Creator coupon middleware before extraction',async()=>{
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.auth={userId:'test'};if(req.headers['x-synthetic-entitled']==='yes')req.creatorCoupon={ends_at:null};next()});app.use(router);app.use((error,req,res,next)=>res.status(403).json({code:'DENIED'}))
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve))
 const url=`http://127.0.0.1:${server.address().port}/discovery/reference-playback`
 try{
  row=structuredClone(rowBase);calls=0
  const denied=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body())})
  assert.equal(denied.status,403);assert.equal(calls,0)
  const allowed=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-synthetic-entitled':'yes'},body:JSON.stringify(body())})
  assert.equal(allowed.status,200);assert.equal(calls,1)
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})

}
