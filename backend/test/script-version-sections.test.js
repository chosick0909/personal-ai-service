import {test,mock} from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
if(typeof mock.module!=='function') {
 test('version section roundtrip in isolated process',()=>{const r=spawnSync(process.execPath,['--experimental-test-module-mocks','--test',fileURLToPath(import.meta.url)],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr)})
} else {
 const owner='local-owner',script={id:'local-script',account_id:owner,title:'대본',metadata:{}}
 const rows=[]
 const db={from(table){let patch,insert,filters=[],order=false,limit=null,columns;const q={select(c){columns=c;return q},eq(k,v){filters.push([k,v]);return q},order(){order=true;return q},limit(n){limit=n;return q},insert(value){insert=structuredClone(value);return q},update(value){patch=structuredClone(value);return q},async single(){const r=await run();return {data:r.data?.[0]||null,error:r.error||(!r.data?.length?{code:'PGRST116'}:null)}},then(resolve){return run().then(resolve)}};async function run(){let data=table==='scripts'?[script]:rows;if(insert){data=[{...insert,id:'v'+(rows.length+1),created_at:new Date().toISOString()}];rows.push(data[0])}data=data.filter(r=>filters.every(([k,v])=>r[k]===v));if(patch)data.forEach(r=>Object.assign(r,patch));if(order)data=[...data].sort((a,b)=>b.version_number-a.version_number);if(limit)data=data.slice(0,limit);if(columns)data=data.map(r=>Object.fromEntries(columns.split(',').map(k=>[k.trim(),structuredClone(r[k.trim()])])));return {data,error:null}}return q}}
 mock.module(new URL('../src/lib/supabase.js',import.meta.url).href,{namedExports:{hasSupabaseAdminConfig:()=>true,getSupabaseAdmin:()=>db}})
 const {saveScriptVersion,listScriptVersions,restoreScriptVersion}=await import('../src/lib/script-storage.js')
 test('actual save/list/restore preserve paragraph boundaries and empty sections in metadata',async()=>{
  const sections={hook:'첫 문장입니다.',body:'본문 첫 문장입니다.\n\n본문 둘째 문장입니다.',cta:''}
  const saved=await saveScriptVersion({accountId:owner,scriptId:script.id,title:'통합 대본',sections,versionType:'manual_save'})
  assert.deepEqual(saved.version.sections,sections)
  assert.deepEqual((await listScriptVersions(owner,script.id))[0].sections,sections)
  const restored=await restoreScriptVersion({accountId:owner,scriptId:script.id,versionId:saved.version.id})
  assert.deepEqual(restored.sections,sections)
  assert.equal(restored.content,script.current_content)
 })
 test('another account cannot list or restore the same script',async()=>{
  await assert.rejects(()=>listScriptVersions('other-owner',script.id),{code:'SCRIPT_NOT_FOUND'})
  await assert.rejects(()=>restoreScriptVersion({accountId:'other-owner',scriptId:script.id,versionId:rows[0].id}),{code:'SCRIPT_NOT_FOUND'})
 })
}
