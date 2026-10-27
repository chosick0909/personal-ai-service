import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile as execFileCallback} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import {probeVideo} from '../src/creator-tools/media.js'
import {extractScreenSubtitles,probeScreenText} from '../src/lib/video-subtitle-transcript.js'
const execFile=promisify(execFileCallback)
async function fixture(seconds,fn,source='testsrc'){
 const dir=await mkdtemp(join(tmpdir(),'hookai-subtitle-test-')),path=join(dir,'silent.mp4')
 try{
  await execFile(ffmpeg.path,['-nostdin','-y','-f','lavfi','-i',`${source}=s=64x64:r=2:d=${seconds}`,'-c:v','libx264',path])
  return await fn(path,dir)
 }finally{await rm(dir,{recursive:true,force:true})}
}
test('actual silent MP4 is accepted for reference import but existing cut editing still requires audio',async()=>fixture(1,async path=>{
 const info=await probeVideo(path,undefined,{allowSilent:true})
 assert.equal(info.hasAudio,false)
 await assert.rejects(probeVideo(path),{code:'VIDEO_AUDIO_REQUIRED'})
}))
test('all five minutes reach the reader, bounded to two concurrent calls, and adjacent captions merge across batches',async()=>fixture(300,async(path,dir)=>{
 let calls=0,active=0,peak=0
 const result=await extractScreenSubtitles(path,dir,300,{invoke:async(_fn,{frameIds})=>{
  calls++
  peak=Math.max(peak,++active)
  await new Promise(resolve=>setTimeout(resolve,1));active--
  return{choices:[{finish_reason:'stop',message:{content:JSON.stringify({frames:frameIds.map(id=>({id,text:id<598?'처음부터 유지되는 자막':'마지막 자막도 보존',language:'ko'}))})}}]}
 }})
 assert.equal(calls,38);assert.equal(peak,2)
 assert.equal(result.quality.stats.sampledFrames,600)
 assert.equal(result.subtitles.length,2)
 assert.equal(result.subtitles[0].end,299)
 assert.equal(result.subtitles[1].text,'마지막 자막도 보존')
 assert.equal(result.subtitles[1].end,300)
 assert.deepEqual(await readdir(dir),['silent.mp4'],'temporary frames cleaned')
}))
test('truncated vision responses are rejected without publishing partial captions and frames are cleaned',async()=>fixture(9,async(path,dir)=>{
 await assert.rejects(extractScreenSubtitles(path,dir,9,{invoke:async()=>({choices:[{finish_reason:'length',message:{content:'{}'}}]})}),{code:'SUBTITLE_RESPONSE_INCOMPLETE'})
 assert.deepEqual(await readdir(dir),['silent.mp4'])
}))

test('uniform empty video never reaches generative reader or fabricates subtitles',async()=>fixture(3,async(path,dir)=>{
 let calls=0
 await assert.rejects(extractScreenSubtitles(path,dir,3,{invoke:async()=>{calls++;throw new Error('must not ask model to read blank pixels')}}),{code:'REFERENCE_TEXT_NOT_FOUND'})
 assert.equal(calls,0)
 assert.deepEqual(await readdir(dir),['silent.mp4'])
},'color'))

test('the screen probe reads eight spread frames in a single request and cleans up',async()=>fixture(15,async(path,dir)=>{
 let calls=0,seen=[]
 const texts=await probeScreenText(path,dir,15,{invoke:async(_fn,{frameIds})=>{
  calls++;seen=frameIds
  return{choices:[{finish_reason:'stop',message:{content:JSON.stringify({frames:frameIds.map(id=>({id,text:id%2?`자막 ${id}`:'',language:'ko'}))})}}]}
 }})
 assert.equal(calls,1);assert.equal(seen.length,8)
 assert.deepEqual(texts,['자막 1','자막 3','자막 5','자막 7'])
 assert.deepEqual(await readdir(dir),['silent.mp4'])
}))
