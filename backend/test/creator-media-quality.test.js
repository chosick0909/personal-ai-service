import test from 'node:test'
import assert from 'node:assert/strict'
import {operationModel,parseJsonCompletion} from '../src/creator-tools/operation-model.js'
import {validateMediaHook,diagnoseMediaHook} from '../src/creator-tools/media-hook.js'
import {subtractSourceRanges,preservesRetainedSpeech} from '../../frontend/src/lib/sourceCuts.js'
import {validateManifest} from '../src/creator-tools/domain.js'
test('model override scope keeps translation, feedback and fallback unchanged',()=>{
 const env={CREATOR_TEXT_MODEL:'old',CREATOR_WRITING_MODEL:'writer',CREATOR_MODEL_MEDIA_HOOK_DIAGNOSIS:'override'}
 assert.equal(operationModel('media-hook-diagnosis','fallback',env),'override');assert.equal(operationModel('reference-analysis','fallback',env),'writer')
 for(const op of ['content-feedback','translate-reference','verify-reference-numbers','account-search'])assert.equal(operationModel(op,'fallback',env),'old')
 assert.equal(operationModel('reference-analysis','fallback',{}),'fallback')
})
test('refusal, truncation and empty response fail before JSON downstream use',()=>{
 for(const choice of [{finish_reason:'length',message:{content:'{}'}},{finish_reason:'stop',message:{content:''}},{finish_reason:'stop',message:{refusal:'no',content:'{}'}}])assert.throws(()=>parseJsonCompletion({choices:[choice]}))
 assert.deepEqual(parseJsonCompletion({choices:[{finish_reason:'stop',message:{content:'{}'}}]}),{})
})
const transcript={subtitles:[{id:'cue-0',start:0,end:2,text:'중요한 설명입니다.'},{id:'cue-1',start:2,end:4,text:'다시 설명합니다.'}]}
const diagnosis={items:[{area:'hook',action:'revise',cueIds:['cue-0'],quote:'중요한 설명',reason:'구체적으로 시작하세요'}]}
test('hook advice time comes from exact contiguous transcript cues; invalid items fail closed',()=>{
 assert.equal(validateMediaHook(diagnosis,transcript,4).items[0].start,0)
 assert.equal(validateMediaHook(diagnosis,transcript,1),null)
 assert.equal(validateMediaHook({items:[{...diagnosis.items[0],quote:'not said'}]},transcript,4),null)
 assert.equal(validateMediaHook({items:[{...diagnosis.items[0],cueIds:['cue-1','cue-0']}]},transcript,4),null)
 assert.deepEqual(validateMediaHook({items:[]},transcript,4),{status:'ready',items:[]})
})
test('hook failure and deadline leave base media usable',async()=>{
 const ctx={job:{},checkpoint:async(_,f)=>f(),providers:{json:async()=>{throw Error('failed')}}}
 assert.equal((await diagnoseMediaHook(ctx,transcript,4,Date.now())).status,'unavailable')
 ctx.providers.json=()=>assert.fail('no time');assert.equal((await diagnoseMediaHook(ctx,transcript,4,Date.now()-900000)).status,'unavailable')
})
test('recommendation removal never resurrects previous edits; union handles repeats/reorder',()=>{
 const clips=[{id:'a',start:7,end:10},{id:'b',start:0,end:3},{id:'c',start:0,end:3}];let i=0
 const output=subtractSourceRanges(clips,[{start:1,end:2},{start:1.5,end:2.5}],()=>`new${++i}`)
 assert.deepEqual(output.map(c=>[c.start,c.end]),[[7,10],[0,1],[2.5,3],[0,1],[2.5,3]])
 assert.deepEqual(clips.map(c=>[c.start,c.end]),[[7,10],[0,3],[0,3]])
})
test('explicit spoken cut clips save valid while original safe-cut protection remains',()=>{
 const original={cuts:[],subtitles:transcript.subtitles,words:[{start:0,end:2,word:'설명'}],hookDiagnosis:validateMediaHook(diagnosis,transcript,4)}
 const manifest={...original,clips:[{id:'keep',start:2,end:4}],hookDiagnosis:{status:'forged'}}
 const saved=validateManifest(manifest,original,4);assert.deepEqual(saved.hookDiagnosis,original.hookDiagnosis);assert.deepEqual(saved.clips,manifest.clips)
 assert.throws(()=>validateManifest({...manifest,cuts:[{id:'unknown',start:0,end:2,enabled:true}]},original,4))
})

test('deletion evidence must expose the complete spoken content being removed',()=>{
 const item={...diagnosis.items[0],action:'remove'}
 assert.equal(validateMediaHook({items:[item]},transcript,4),null)
 assert.equal(validateMediaHook({items:[{...item,quote:transcript.subtitles[0].text}]},transcript,4).items[0].action,'inspect')
})


test('remove cannot delete both repetitions in one ASR cue or mutually delete retained evidence',()=>{
 const transcript={subtitles:[{id:'a',start:0,end:2,text:'물건을 골라보세요.'},{id:'b',start:2,end:4,text:'물건을 골라보세요.'},{id:'c',start:4,end:7,text:'중요한 조건입니다. 중요한 조건입니다.'}]}
 const item={area:'flow',action:'remove',cueIds:['b'],keepCueIds:['a'],quote:'물건을 골라보세요.',reason:'중복 발화'}
 assert.equal(validateMediaHook({items:[item]},transcript,7).items[0].action,'remove')
 assert.equal(validateMediaHook({items:[{...item,cueIds:['c'],keepCueIds:[],quote:transcript.subtitles[2].text}]},transcript,7).items[0].action,'inspect')
 const both=validateMediaHook({items:[item,{...item,cueIds:['a'],keepCueIds:['b']}]},transcript,7)
 assert.ok(both.items.every(i=>i.action==='inspect'))
})


test('one invalid noncontiguous advice is discarded without hiding valid grounded advice',()=>{
 const valid={...diagnosis.items[0],keepCueIds:[]}
 const result=validateMediaHook({items:[valid,{...valid,cueIds:['cue-1','cue-0']}]},transcript,4)
 assert.equal(result.status,'ready');assert.equal(result.items.length,1);assert.equal(result.discardedCount,1)
 assert.equal(validateMediaHook({items:[{...valid,cueIds:['missing']}]},transcript,4),null)
})


test('prior manual edits and combined cuts cannot remove the retained copy of speech',()=>{
 const advice={action:'remove',start:2,end:4,retainedRanges:[{start:0,end:2}]}
 const candidate=subtractSourceRanges([{id:'full',start:0,end:6}],[advice],()=> 'id')
 assert.equal(preservesRetainedSpeech(candidate,[advice]),true)
 const alreadyEdited=subtractSourceRanges([{id:'full',start:2,end:6}],[advice],()=> 'id')
 assert.equal(preservesRetainedSpeech(alreadyEdited,[advice]),false)
 assert.equal(preservesRetainedSpeech(candidate,[{...advice,retainedRanges:undefined}]),false)
 assert.equal(preservesRetainedSpeech([{start:0,end:1},{start:1,end:2}],[advice]),false)
})

