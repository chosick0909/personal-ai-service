import {mock} from 'node:test'
import assert from 'node:assert/strict'
const url=p=>new URL('../../src/lib/'+p,import.meta.url).href
const writes=[], prompts=[], ingested=[]
const db={from(table){let payload=null;const q={select(){return q},eq(){return q},gte(){return q},in(){return q},order(){return q},limit(){return q},update(p){payload=p;writes.push(p);return q},insert(p){payload=p;writes.push(p);return q},single(){return Promise.resolve({data:{id:'synthetic-reference',...payload},error:null})},maybeSingle(){return Promise.resolve({data:null,error:null})},then(resolve){return Promise.resolve({data:payload?{id:'synthetic-reference',...payload}:[],error:null}).then(resolve)}};return q}}
mock.module(url('supabase.js'),{namedExports:{hasSupabaseAdminConfig:()=>true,getSupabaseAdmin:()=>db}})
mock.module(url('cache.js'),{namedExports:{cacheConfig:{enableAnalysisResultReuse:false},buildCacheKey:()=>'',hashText:s=>s,getCacheJson:async()=>null,setCacheJson:async()=>{}}})
mock.module(url('document-ingest.js'),{namedExports:{ingestDocument:async data=>{ingested.push(data);return{document:{id:'synthetic-doc'}}}}})
mock.module(url('ai-error-logger.js'),{namedExports:{logAIError(){}}})
mock.module(url('openai.js'),{namedExports:{hasOpenAIConfig:()=>true,getOpenAIModels:()=>({chatModel:'mock',visionModel:'mock'}),getOpenAIClient:()=>({chat:{completions:{create:async req=>{prompts.push(req);return{choices:[{message:{content:JSON.stringify({structureAnalysis:'화면 자막 순서로 설명',hookAnalysis:'질문으로 시작',psychologyAnalysis:'실천 제안',aiFeedback:'자막 전달'})}}]}}}}})}})
const actual=await import(url('video-subtitle-transcript.js'))
mock.module(url('video-subtitle-transcript.js'),{namedExports:{...actual,extractScreenSubtitles:async()=>actual.assembleSubtitleTranscript([
 {timestamp:0,text:'서랍 정리, 어디서 시작할까요?',language:'ko'},
 {timestamp:.5,text:'작은 상자 하나에 모아보세요.',language:'ko'},
],9)}})
let transcribes=0,cleaned=false
mock.module(url('video-processing.js'),{namedExports:{
 createVideoWorkspace:async()=>({workspace:'/fake',videoPath:'/fake/video'}),cleanupVideoWorkspace:async()=>{cleaned=true},
 getVideoDuration:async()=>9,hasAudioStream:async()=>false,extractAudioTrack:()=>assert.fail('silent upload must not extract audio'),
 transcribeVideoAudio:async()=>{transcribes++;return{text:''}},extractFrames:async()=>[{timestamp:0}],analyzeVideoFrames:async()=>({summary:'정리 안내',frames:[]}),
}})
const {analyzeReferenceVideo}=await import(url('reference-video-analysis.js'))
let preview
try{
 await analyzeReferenceVideo({accountId:'synthetic',file:{buffer:Buffer.from('fake-video'),originalname:'silent.mp4',mimetype:'video/mp4'},
 onAnalysisPreviewReady:async row=>{preview=row;throw new Error('TEST_STOP_AFTER_ANALYSIS_PREVIEW')}})
}catch(error){assert.equal(error.cause?.message || error.message,'TEST_STOP_AFTER_ANALYSIS_PREVIEW')}
assert.ok(preview,'silent video reached analyzed preview')
assert.equal(transcribes,0)
assert.equal(preview.transcript_quality.source,'screen_subtitles')
assert.equal(preview.transcript_quality.reliable,true)
assert.equal(preview.current_stage,'draft-generation')
assert.match(preview.transcript,/작은 상자/)
assert.match(ingested[0].content,/서랍 정리/)
assert.match(prompts[0].messages[1].content,/음성 전사가 아니며/)
assert.ok(cleaned)
console.log('REFERENCE_SUBTITLE_FLOW_OK')
