import {test,mock} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {inflateRawSync} from 'node:zlib'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
if(typeof mock.module!=='function') {
 test('actual subtitle renderer in module-isolated process',()=>{const r=spawnSync(process.execPath,['--experimental-test-module-mocks','--test',fileURLToPath(import.meta.url)],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr)})
} else {
function zipFiles(bytes) {
 const files={};let p=bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));assert.ok(p>=0)
 const count=bytes.readUInt16LE(p+10);p=bytes.readUInt32LE(p+16)
 for(let i=0;i<count;i++){
  assert.equal(bytes.readUInt32LE(p),0x02014b50);const method=bytes.readUInt16LE(p+10),size=bytes.readUInt32LE(p+20),n=bytes.readUInt16LE(p+28),extra=bytes.readUInt16LE(p+30),comment=bytes.readUInt16LE(p+32),local=bytes.readUInt32LE(p+42)
  const name=bytes.subarray(p+46,p+46+n).toString();const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);const data=bytes.subarray(start,start+size)
  files[name]=method===8?inflateRawSync(data):data;p+=46+n+extra+comment
 }
 return files
}
let media,url,archive,dbUpdates=[],transcript
const chain={upsert(v){dbUpdates.push(v);return{data:v}},update(v){dbUpdates.push(v);return this},eq(){return this},select(){return this},maybeSingle(){return{data:{id:'fixture'}}}}
const db={from(){return chain},storage:{from(){return{async upload(path,stream){const chunks=[];for await(const c of stream)chunks.push(c);archive=Buffer.concat(chunks);return{data:{path}}},remove(){return{data:[]}}}}}}
mock.module(new URL('../src/creator-tools/store.js',import.meta.url).href,{namedExports:{BUCKET:'input',OUTPUT_BUCKET:'output',query:async q=>q.data,ownedMedia:async()=>media,signedDownload:async()=>url}})
mock.module(new URL('../src/lib/openai.js',import.meta.url).href,{namedExports:{getOpenAIClient:()=>({audio:{transcriptions:{create:async()=>transcript}}}),getOpenAIModels:()=>({})}})
const {renderMedia,analyzeMedia}=await import('../src/creator-tools/media.js')
test('real renderer burns all presets, retimes SRT after cuts, preserves original ZIP and supports clean export',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hookai-subtitle-test-'));let server
 const run=args=>{const r=spawnSync(ffmpeg.path,['-nostdin','-y',...args],{maxBuffer:5e6});assert.equal(r.status,0,r.stderr?.toString());return r.stdout}
 try {
 const input=join(dir,'source.mp4');run(['-f','lavfi','-i','color=c=0x244758:s=360x640:r=24:d=4','-f','lavfi','-i','sine=frequency=330:duration=4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',input]);const source=await readFile(input)
 server=createServer((req,res)=>res.end(source));await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`
 media={id:'fixture',user_id:'synthetic',revision:1,mime_type:'video/mp4',duration_seconds:4,original_expires_at:new Date(Date.now()+3600000).toISOString(),original_path:'source',manifest:{cuts:[],words:[],clips:[{id:'a',start:0,end:1},{id:'b',start:2,end:4}],subtitles:[{id:'a',start:0,end:2,text:'오늘은 주방 정리'},{id:'b',start:2,end:4,text:'함께 시작해 보세요'}]}}
 const variations=[]
 for(const preset of ['outline','compact','box','off']){
 media.manifest.subtitleStyle={preset:preset==='off'?'outline':preset,burnIn:preset!=='off'}
 const stages=[];const result=await renderMedia({db,job:{input:{projectId:'fixture',revision:1,manifest:media.manifest},user_id:'synthetic'},stage:async s=>stages.push(s),signal:new AbortController().signal})
 assert.equal(result.revision,1);assert.deepEqual(stages,['reading_video','rendering','packaging']);const files=zipFiles(archive)
 assert.deepEqual(files['original.mp4'],source);assert.match(files['subtitles.srt'].toString(),/00:00:01,000 --> 00:00:03,000/)
 const output=join(dir,`${preset}.mp4`);await writeFile(output,files['edited.mp4'])
 const rgb=run(['-ss','2','-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'])
 const whitePixels=Array.from({length:rgb.length/3},(_,i)=>rgb[i*3]>220&&rgb[i*3+1]>220&&rgb[i*3+2]>220).filter(Boolean).length
 variations.push(whitePixels)
 }
 assert.ok(variations.slice(0,3).every(n=>n>100));assert.equal(variations[3],0)
 assert.ok(dbUpdates.some(x=>x.status==='completed'))
 // Exercise actual upload analysis with real audio extraction/preview, mocked ASR.
 transcript={text:'오늘은 주방 정리 방법을 함께 알아봅니다.',language:'korean',segments:[{start:0,end:4,text:'오늘은 주방 정리 방법을 함께 알아봅니다.'}],words:['오늘은','주방','정리','방법을','함께','알아봅니다.'].map((word,i)=>({word,start:i*.6,end:i*.6+.5}))}
 media.revision=0
 await analyzeMedia({db,job:{id:'job',input:{projectId:'fixture'},user_id:'synthetic'},stage:async()=>{},checkpoint:async(_,fn)=>fn(),providers:{call:async(_,__,fn)=>fn(),json:async()=>({items:[]})},signal:new AbortController().signal})
 const analyzed=dbUpdates.find(x=>x.status==='ready');assert.ok(analyzed)
 assert.equal(analyzed.manifest.subtitles.map(c=>c.text).join(' '),transcript.text)
 assert.ok(analyzed.manifest.subtitles.length>1);assert.deepEqual(analyzed.manifest.subtitleStyle,{preset:'outline',burnIn:true})
 assert.equal(analyzed.manifest.hookDiagnosis.status,'ready')
 } finally {if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})}
})
}
