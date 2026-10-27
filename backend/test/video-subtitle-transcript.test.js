import test from 'node:test'
import assert from 'node:assert/strict'
import { referenceTranscript, correctSpeechWithScreen, usableSpeech, validateSubtitleFrames, assembleSubtitleTranscript, extractScreenSubtitles, uniformFrameIds } from '../src/lib/video-subtitle-transcript.js'

const visual = { text:'서랍 하나부터 비워보세요.', source:'screen_subtitles' }
test('silent references use screen subtitles without invoking speech', async () => {
  const result = await referenceTranscript({ hasAudio:false, duration:10,
    transcribe:()=>assert.fail('no audio'),readSubtitles:async()=>visual })
  assert.equal(result,visual)
})
test('normal narration retains the original result and incurs no visual calls', async () => {
  const speech={text:'옷을 고르기 전에 오늘 사용할 두 가지 색을 먼저 정해보세요.'}
  assert.equal(await referenceTranscript({hasAudio:true,duration:10,transcribe:async()=>speech,
    readSubtitles:()=>assert.fail('normal speech')}),speech)
})
test('music-only, empty, low-confidence and sparse recognition fall back to subtitles',async()=>{
  for(const speech of [{text:''},{text:'감사합니다.',segments:[{no_speech_prob:.95}]},
    {text:'아무 말',speechReliable:false},{text:'감사합니다.'},{text:'wrong',segments:[{avg_logprob:-2}]}]){
    assert.equal(await referenceTranscript({hasAudio:true,duration:60,transcribe:async()=>speech,readSubtitles:async()=>visual}),visual)
  }
})
test('transcription failure may recover, but budget, cancellation and auth errors do not spawn new calls',async()=>{
  assert.equal(await referenceTranscript({hasAudio:true,duration:5,transcribe:async()=>{throw Object.assign(new Error(),{code:'TRANSCRIPTION_FAILED'})},readSubtitles:async()=>visual}),visual)
  for(const error of [Object.assign(new Error(),{code:'PROVIDER_BUDGET'}),Object.assign(new Error(),{status:429}),Object.assign(new Error(),{code:'TRANSCRIPTION_FAILED',cause:{status:401}})]){
    await assert.rejects(referenceTranscript({hasAudio:true,duration:5,transcribe:async()=>{throw error},readSubtitles:()=>assert.fail('no extra calls')}),e=>e===error)
  }
  await assert.rejects(referenceTranscript({hasAudio:false,signal:AbortSignal.abort(),readSubtitles:()=>assert.fail('aborted')}),{name:'AbortError'})
})
test('only adjacent identical subtitles merge; blanks and later repeats preserve order',()=>{
  const result=assembleSubtitleTranscript([
    {timestamp:0,text:'한 칸부터 비워요',language:'ko'}, {timestamp:.5,text:'한 칸부터  비워요',language:'ko'},
    {timestamp:1,text:'',language:'unknown'}, {timestamp:1.5,text:'한 칸부터 비워요',language:'ko'},
    {timestamp:2,text:'가격은 12,900원',language:'ko'},
  ],2.2)
  assert.equal(result.subtitles.length,3)
  assert.equal(result.subtitles[0].end,1)
  assert.equal(result.subtitles[2].end,2.2)
  assert.match(result.text,/12,900원/)
  assert.equal(result.quality.source,'screen_subtitles')
  assert.equal(result.quality.reliable,true)
  assert.deepEqual(result.words,[],'screen observations must not invent speech word timings')
})
test('no visible captions fails without fabricating narration',()=>{
  assert.throws(()=>assembleSubtitleTranscript([{timestamp:0,text:'',language:'unknown'}],1),{code:'REFERENCE_TEXT_NOT_FOUND',exposeMessage:true})
})
test('all input frames must be accounted for, including empty ones',()=>{
  const frames=[{id:10,timestamp:5},{id:11,timestamp:5.5}]
  assert.deepEqual(validateSubtitleFrames({frames:[{id:11,text:'',language:'unknown'},{id:10,text:'화면 자막',language:'ko'}]},frames).map(x=>x.text),['화면 자막',''])
  for(const items of [[],[{id:10,text:'x',language:'en'}],[{id:10,text:'x',language:'en'},{id:10,text:'x',language:'en'}],[{id:10,text:'x',language:'en'},{id:12,text:'x',language:'en'}]]){
    assert.throws(()=>validateSubtitleFrames({frames:items},frames))
  }
})
test('unsupported video lengths are rejected before extraction, never silently truncated',async()=>{
  for(const duration of [0,301,NaN])await assert.rejects(extractScreenSubtitles('/missing','/missing',duration),{code:'SUBTITLE_DURATION_LIMIT'})
})
test('speech confidence accounts for background music probabilities',()=>{
  assert.equal(usableSpeech({text:'hello there',segments:[{no_speech_prob:.8}]},5),false)
  assert.equal(usableSpeech({text:'hello there',segments:[{no_speech_prob:.1,avg_logprob:-.3}]},5),true)
})

test('word-by-word buildup keeps the full visible phrase without duplicating its prefix',()=>{
 const result=assembleSubtitleTranscript([
  {timestamp:0,text:'물건을',language:'ko'},
  {timestamp:.5,text:'물건을 한곳에',language:'ko'},
  {timestamp:1,text:'물건을 한곳에 모아요',language:'ko'},
  {timestamp:1.5,text:'물건을 분류해요',language:'ko'},
 ],2)
 assert.deepEqual(result.subtitles.map(x=>x.text),['물건을 한곳에 모아요','물건을 분류해요'])
 assert.equal(result.subtitles[0].end,1.5)
})

test('uniform detection requires every luminance/chroma range; chromatic text and incomplete metadata are retained',()=>{
 const frame=(id,y,u,v)=>`frame:${id} pts:0\n`+Object.entries({Y:y,U:u,V:v}).flatMap(([channel,range])=>range===null?[]:[`lavfi.signalstats.${channel}MIN=50`,`lavfi.signalstats.${channel}MAX=${50+range}`]).join('\n')+'\n'
 assert.deepEqual([...uniformFrameIds(frame(0,0,0,0)+frame(1,1,2,0)+frame(2,80,0,0)+frame(3,0,30,0)+frame(4,0,0,null))],[0,1])
})
test('a song under an on-screen text card gives way to the screen, as the judge decides by meaning', async () => {
  const lyrics={text:'망가져'}
  const card=['건드리면 큰일나는 조합 1. 여자 2. 장녀 3. 첫째 4. 남동생 있음 5. 경상도 출신']
  let asked=null
  const judgeScript=async(spoken,shown)=>{asked={spoken,shown};return true}
  assert.equal(await referenceTranscript({hasAudio:true,duration:8,transcribe:async()=>lyrics,probeSubtitles:async()=>[...card,...card],judgeScript,readSubtitles:async()=>visual}),visual)
  assert.deepEqual(asked,{spoken:'망가져',shown:card},'the same card read on many frames is asked once')
  // Without an answer, more unheard words on screen than heard in the audio decide.
  assert.equal(await referenceTranscript({hasAudio:true,duration:8,transcribe:async()=>lyrics,probeSubtitles:async()=>card,judgeScript:async()=>{throw new Error('down')},readSubtitles:async()=>visual}),visual)
  // A failed full read keeps the speech rather than failing the job.
  assert.equal(await referenceTranscript({hasAudio:true,duration:8,transcribe:async()=>lyrics,probeSubtitles:async()=>card,judgeScript,
    readSubtitles:async()=>{throw Object.assign(new Error(),{code:'REFERENCE_TEXT_NOT_FOUND'})}}),lyrics)
})
test('narration keeps the speech: captions that repeat it, a title the judge calls emphasis, or an unreadable probe', async () => {
  const speech={text:'옷을 고르기 전에 오늘 사용할 두 가지 색을 먼저 정해보세요. 그러면 아침이 훨씬 빨라져요.'}
  const cases=[[async()=>['옷을 고르기 전에','오늘 사용할 두 가지 색을 먼저 정해보세요','아침이 훨씬 빨라져요'],()=>assert.fail('nothing unheard to judge')],
    [async()=>['출근룩 코디 꿀팁','출근룩 코디 꿀팁'],async()=>false],[async()=>[],()=>assert.fail('no screen text')],
    [async()=>{throw new Error('provider down')},()=>assert.fail('no screen text')]]
  for(const [probeSubtitles,judgeScript] of cases){
    assert.equal(await referenceTranscript({hasAudio:true,duration:10,transcribe:async()=>speech,probeSubtitles,judgeScript,readSubtitles:()=>assert.fail('speech is the script')}),speech)
  }
})

test('on-screen captions are handed to the transcriber as hints and fix words it misheard', async () => {
  const speech = { text: '고령에서 이거 좋다고 생각한 사람? 정상가 만육천원이에요', subtitles: [{ id: 'cue-0', text: '고령에서 이거 좋다고 생각한 사람?' }, { id: 'cue-1', text: '정상가 만육천원이에요' }] }
  const shown = ['올영에서 이거 좋다고 생각한 사람?']
  let hints = null
  const result = await referenceTranscript({ hasAudio: true, duration: 10, probeSubtitles: async () => shown,
    transcribe: async h => { hints = h; return speech }, judgeScript: () => assert.fail('captions repeat the speech'),
    correctSpeech: (sp, sh) => correctSpeechWithScreen(sp, sh, { invoke: async () => ({ choices: [{ message: { content: JSON.stringify({ segments: [
      { id: 'cue-0', text: '올영에서 이거 좋다고 생각한 사람?' }, { id: 'cue-1', text: '오늘만 특가로 엄청 싸게 파는 제품이에요' }] }) } }] }) }),
    readSubtitles: () => assert.fail('speech is the script') })
  assert.deepEqual(hints, shown)
  assert.equal(result.subtitles[0].text, '올영에서 이거 좋다고 생각한 사람?')
  assert.equal(result.subtitles[1].text, '정상가 만육천원이에요', 'a rewritten line is not a correction and stays as heard')
  assert.equal(result.corrected, true)
  // A failed correction keeps the speech as heard.
  const kept = await referenceTranscript({ hasAudio: true, duration: 10, probeSubtitles: async () => shown, transcribe: async () => speech,
    correctSpeech: async () => { throw new Error('down') }, readSubtitles: () => assert.fail('speech is the script') })
  assert.equal(kept, speech)
})
