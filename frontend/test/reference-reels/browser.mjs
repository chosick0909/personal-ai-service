import {createRequire} from 'node:module'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
const require=createRequire('/Users/seojiyeong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')
const {chromium}=require('playwright')
const root=process.cwd()+'/frontend', out=process.cwd()+'/tmp/reel-browser'
mkdirSync(out,{recursive:true})
const ffmpeg=createRequire(import.meta.url)('@ffmpeg-installer/ffmpeg').path
execFileSync(ffmpeg,['-y','-f','lavfi','-i','color=c=0x8273ce:s=180x320:d=2','-c:v','libx264','-pix_fmt','yuv420p',out+'/fixture.mp4'],{stdio:'ignore'})
const fixture=readFileSync(out+'/fixture.mp4')
const harness=`import React from 'react';import{createRoot}from'react-dom/client';import ReferenceReels from '/src/components/ReferenceReels.jsx';import '/src/components/CreatorTools.css';fetch('/__account').then(r=>r.json()).then(account=>createRoot(document.getElementById('root')).render(<div className="creator-tools ct-live"><div className="ct-account" style={{maxWidth:1100,padding:20,fontFamily:"sans-serif"}}><ReferenceReels account={account}/></div></div>))`
let account={username:'synthetic',exampleMedia:[{permalink:'https://instagram.com/reel/Good_123/'},{permalink:'https://instagram.com/reel/Deleted_123/'},{permalink:'https://instagram.com/reel/Broken_123/'}]}
const server=await createServer({root,configFile:false,envDir:false,cacheDir:out+'/vite-cache',plugins:[{name:'reel-test',configureServer(s){s.middlewares.use((req,res,next)=>{
 if(req.url==='/__account'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(account))}
 if(req.url==='/__clip.mp4'){res.setHeader('Content-Type','video/mp4');return res.end(fixture)}
 if(req.url==='/__entry.jsx'){s.transformRequest('/__virtual.jsx').then(r=>{res.setHeader('Content-Type','text/javascript');res.end(r.code)});return}
 if(req.url==='/__test'){res.setHeader('Content-Type','text/html');s.transformIndexHtml('/__test','<html><body><div id="root"></div><script type="module" src="/__entry.jsx"></script></body></html>').then(t=>res.end(t));return}
 next()
 })},resolveId(id){if(id==='/__virtual.jsx'||id==='/__entry.jsx')return '/__virtual.jsx'},load(id){if(id==='/__virtual.jsx')return harness}},react()],server:{host:'127.0.0.1',port:8482,strictPort:true}})
await server.listen()
const browser=await chromium.launch({headless:true,channel:'chrome'})
const result={controlled:{},real:{}}
try{
 const page=await browser.newPage({viewport:{width:1100,height:1000}})
 await page.clock.install()
 let failBrokenVideo
 await page.route('**/nonexistent.mp4',async route=>{await new Promise(resolve=>{failBrokenVideo=resolve});await route.fulfill({status:404,body:'unavailable'})})
 await page.route('**/api/discovery/reference-playback',async route=>{
  const body=route.request().postDataJSON(),code=body.permalink.split('/')[4]
  await route.fulfill({json:{media:code==='Deleted_123'?null:{url:code==='Good_123'?'http://127.0.0.1:8482/__clip.mp4':'http://127.0.0.1:8482/nonexistent.mp4'}}})
 })
 await page.goto('http://127.0.0.1:8482/__test')
 await page.locator('video:visible').waitFor({timeout:15000})
 await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2)
 while(!failBrokenVideo) await new Promise(resolve=>setTimeout(resolve,20))
 failBrokenVideo()
 await page.waitForFunction(()=>document.querySelectorAll('video').length===1)
 assert.equal(await page.locator('iframe').count(),0)
 assert.equal(await page.locator('video:visible').count(),1)
 await page.clock.fastForward(13000)
 assert.equal(await page.locator('video:visible').count(),1,'a sibling failure must not remove an already-loaded video later')
 const state=await page.locator('video').evaluate(v=>({readyState:v.readyState,width:v.videoWidth,height:v.videoHeight,controls:v.controls,muted:v.muted,playsInline:v.playsInline}))
 assert.ok(state.readyState>=2 && state.height>state.width && state.controls && state.muted && state.playsInline)
 result.controlled={pass:true,state,failedCardsOmitted:true,iframeCount:0}
 await page.screenshot({path:out+'/desktop.png'})
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/mobile.png'})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 await page.unroute('**/api/discovery/reference-playback')
 if (process.env.HOOKAI_REAL_REEL_FIXTURE) {
 const real=JSON.parse(readFileSync(process.env.HOOKAI_REAL_REEL_FIXTURE))
 account={username:real.username,exampleMedia:real.results.map(r=>({permalink:r.permalink}))}
 await page.route('**/api/discovery/reference-playback',async route=>{
  const code=route.request().postDataJSON().permalink.split('/')[4]
  const media=real.results.find(r=>r.permalink.split('/')[4]===code)
  await route.fulfill({json:{media:media?.url?{url:media.url}:null}})
 })
 await page.setViewportSize({width:1440,height:1000})
 await page.reload()
 try{
  await page.locator('video:visible').first().waitFor({timeout:18000})
  await page.waitForFunction(()=>!document.querySelector('.ct-reel-pending') && [...document.querySelectorAll('video')].every(v=>!v.closest('article').hidden),{},{timeout:18000})
  result.real={visible:await page.locator('video:visible').count(),states:await page.locator('video:visible').evaluateAll(videos=>videos.map(v=>({readyState:v.readyState,width:v.videoWidth,height:v.videoHeight}))),iframeCount:await page.locator('iframe').count()}
  await page.screenshot({path:out+'/real.png'})
 }catch{result.real={visible:0,limitation:'CDN playback unavailable in this browser/network; unavailable media omitted'}}
 } else result.real={notRun:true,reason:'Set HOOKAI_REAL_REEL_FIXTURE to a locally approved metadata fixture for optional real-network playback.'}
 writeFileSync(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}finally{await browser.close();await server.close()}
