import test from 'node:test'
import assert from 'node:assert/strict'
import {groupSubtitles,wordBoundaries,splitSubtitle,captionLayout} from '../../shared/subtitle-layout.mjs'
import {subtitleAss} from '../src/creator-tools/subtitle-render.js'
import {validateManifest,projectSubtitles,toSrt} from '../src/creator-tools/domain.js'
const cue={id:'s',start:0,end:6,text:'오늘은 주방 정리 방법을 함께 알아볼게요.'}
const tokens=cue.text.split(' ')
const words=tokens.map((word,i)=>({word,start:i,end:i+.8}))
test('automatic captions preserve complete transcript and break only on spaces',()=>{
 for(const text of [cue.text,'Hello, this is a simple caption example.','가격은 12.5달러, 링크는 example.com 입니다.','단어중간은절대로잘리지않습니다','가족 👩‍👩‍👧‍👦 함께 즐겨요!','日本語は単語内を切らない','مرحبا بالعالم كيف حالك']){
 const input={...cue,text};const result=groupSubtitles([input],[])
 assert.equal(result.map(c=>c.text).join(' '),text)
 assert.ok(result.every(c=>c.end>c.start))
 assert.ok(result.every((c,i)=>!i||c.start>=result[i-1].end))
 }
})
test('aligned word timing wins over character proportion, mismatched ASR falls back without replacing words',()=>{
 const [b]=wordBoundaries(cue,words);assert.equal(b.at,.9);assert.equal(b.exact,true)
 const mismatch=wordBoundaries(cue,[{word:'hallucinated',start:0,end:5}]);assert.ok(mismatch.every(b=>!b.exact))
 assert.equal(groupSubtitles([cue],[{word:'hallucinated',start:0,end:5}]).map(c=>c.text).join(' '),cue.text)
})
test('user chooses both text boundary and exact source time; invalid edges cannot erase words',()=>{
 const result=splitSubtitle(cue,2,2.75,'new');assert.deepEqual(result.map(c=>[c.start,c.end,c.text]),[[0,2.75,'오늘은 주방'],[2.75,6,'정리 방법을 함께 알아볼게요.']])
 for(const [after,at] of [[0,2],[6,2],[1,0],[1,6],[1,NaN],[1,-2]])assert.equal(splitSubtitle(cue,after,at,'new'),null)
 assert.equal(splitSubtitle({...cue,text:'한단어'},1,3,'new'),null)
})
test('fast speech, missing word data, and 5min dense input never drop transcript text',()=>{
 const fast={...cue,end:.1};assert.equal(groupSubtitles([fast],[]).map(c=>c.text).join(' '),cue.text)
 const dense=Array.from({length:300},(_,i)=>({id:`s${i}`,start:i,end:i+1,text:'하나 둘 셋 넷 다섯 여섯 일곱 여덟'}))
 const result=groupSubtitles(dense);assert.ok(result.length<=500)
 assert.equal(result.map(c=>c.text).join(' '),dense.map(c=>c.text).join(' '))
})
test('preview and ASS share word-safe layout, position, font size; literal ASS commands cannot execute',()=>{
 for(const preset of ['outline','box','compact']){
 const layout=captionLayout('아주긴한단어입니다절대로중간에서자르면안됩니다',360,preset)
 assert.equal(layout.text,'아주긴한단어입니다절대로중간에서자르면안됩니다');assert.ok(layout.fontSize>0&&layout.fontSize<36)
 const ass=subtitleAss([cue],1080,1920,preset);const s=captionLayout(cue.text,1080,preset)
 assert.ok(ass.includes(`\\pos(540,${Math.round(s.y*1920)})`));assert.ok(ass.includes(`\\fs${s.fontSize.toFixed(2)}`))
 assert.ok(ass.includes('Pretendard'));assert.ok(ass.includes(s.text.replace(/\n/g,'\\N')))
 }
 const escaped=subtitleAss([{...cue,text:'{\\pos(0,0)} hello'}],1080,1920,'outline')
 assert.ok(escaped.includes('｛＼pos(0,0)｝'))
})
test('style persists through validated save, old manifests remain unchanged; untrusted styles rejected',()=>{
 const original={cuts:[],subtitles:[cue],words};const updated={...original,subtitleStyle:{preset:'compact',burnIn:true},subtitles:splitSubtitle(cue,2,2.75,'new')}
 const saved=validateManifest(updated,original,6);assert.deepEqual(saved.subtitleStyle,updated.subtitleStyle)
 assert.equal(validateManifest(original,original,6).subtitleStyle,undefined)
 assert.throws(()=>validateManifest({...updated,subtitleStyle:{preset:'injected',burnIn:true}},original,6))
 const output=projectSubtitles(saved.subtitles,[{start:0,end:1},{start:2,end:6}]);assert.ok(toSrt(output).includes('00:00:01,750'));assert.equal(output.at(-1).end,5)
})
