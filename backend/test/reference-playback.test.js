import test from 'node:test'
import assert from 'node:assert/strict'
import {createReferencePlayback,playbackUrl} from '../src/creator-tools/reference-playback.js'
const href='https://www.instagram.com/reel/Valid_123/'
const good={id:'Valid_123',formats:[{url:'https://video.cdninstagram.com/clip.mp4',ext:'mp4',vcodec:'h264',acodec:'aac',height:720}]}
test('only HTTPS Instagram video CDN URLs are permitted',()=>{
 for(const url of ['http://video.cdninstagram.com/v','https://cdninstagram.com.evil.test/v','https://127.0.0.1/v','https://u:p@video.cdninstagram.com/v','https://video.cdninstagram.com:8443/v'])assert.equal(playbackUrl(url),null)
 assert.ok(playbackUrl(good.formats[0].url))
})
test('exact post resolves once for concurrent requests and cache expires without changing evidence',async()=>{
 let calls=0,now=0
 const p=createReferencePlayback({extract:async url=>{calls++;assert.equal(url,href);return good},now:()=>now})
 const values=await Promise.all([p.resolve(href),p.resolve(href)])
 assert.equal(calls,1);assert.deepEqual(values[0],{url:good.formats[0].url});assert.deepEqual(values[0],values[1])
 await p.resolve(href);assert.equal(calls,1)
 now=300001;await p.resolve(href);assert.equal(calls,2)
})
test('deleted, redirected, photo, audio-only or malicious media are omitted',async()=>{
 for(const extract of [async()=>{throw new Error('unavailable')},async()=>({...good,id:'Other'}),async()=>({...good,_type:'playlist'}),async()=>({id:'Valid_123',formats:[]}),async()=>({...good,formats:[{...good.formats[0],vcodec:'none'}]}),async()=>({...good,formats:[{...good.formats[0],url:'https://evil.test/v'}]})]){
  assert.equal(await createReferencePlayback({extract}).resolve(href),null)
 }
 let calls=0;assert.equal(await createReferencePlayback({extract:async()=>{calls++;return good}}).resolve('https://evil.test/reel/Valid_123/'),null);assert.equal(calls,0)
})
test('external lookups are bounded to two subprocesses; overload is not cached as unavailable',async()=>{
 const releases=[];let calls=0
 const p=createReferencePlayback({extract:url=>{calls++;return new Promise(resolve=>releases.push(()=>resolve({...good,id:new URL(url).pathname.split('/')[2]})))}})
 const first=p.resolve(href),second=p.resolve('https://instagram.com/reel/Second/')
 assert.equal(await p.resolve('https://instagram.com/reel/Third/'),null);assert.equal(calls,2)
 releases.splice(0).forEach(fn=>fn());await Promise.all([first,second])
 const third=p.resolve('https://instagram.com/reel/Third/');assert.equal(calls,3);releases[0]();assert.ok(await third)
})
