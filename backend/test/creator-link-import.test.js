import test from 'node:test'
import assert from 'node:assert/strict'
import { translateSegments, validateTranslation, importLink } from '../src/creator-tools/link-import.js'

// Numeric patterns observed in the failing Hindi transcript; no provider calls or credentials.
const source = [
  { id:'product', start:0, end:2, text:'डेटॉल वाशिंग मशीन फाइव एन वन क्लिनर' },
  { id:'dose', start:2, end:4, text:'हाफ बॉटल, टॉप लोड में एक फुल बॉटल' },
  { id:'effect', start:4, end:6, text:'99.9% बैक्टेरिया को किल करता है' },
  { id:'interval', start:6, end:8, text:'बस एवरी टूमन्स इसको यूज करो' },
  { id:'price', start:8, end:10, text:'सिब 254 रुपीज में आपकी मशीन' },
]
const approve = input => ({segments:input.segments.map(s => ({id:s.id,verdict:'equivalent',sourceQuotes:[s.source],translatedQuotes:[s.translation],reason:'수량 의미 동일'}))})
const tokens = text => text.match(/__HOOKAINUM[A-Z]+__/g) || []
const translated = input => input.segments.map(s => ({id:s.id, text:{
  product:'세탁기 5-in-1 클리너', dose:'0.5병, 통돌이 세탁기에는 1병',
  effect:`세균 ${tokens(s.text)[0]}% 제거`, interval:'2개월마다 사용', price:`가격은 ${tokens(s.text)[0]}루피`,
}[s.id]}))

test('Hindi spoken quantities can become Korean digits while original percentages and prices stay exact', async () => {
  let calls = 0
  const result = await translateSegments({json:async (_operation,_prompt,input,_frames,schema) => {
    calls++; assert.equal(schema.additionalProperties,false)
    if (_operation === 'verify-reference-numbers') return approve(input)
    return {segments:translated(input)}
  }},'hindi',source)
  assert.equal(calls,2)
  assert.deepEqual(result.map(s => s.text), ['세탁기 5-in-1 클리너','0.5병, 통돌이 세탁기에는 1병','세균 99.9% 제거','2개월마다 사용','가격은 254루피'])
  assert.deepEqual(result.map(({id,start,end}) => ({id,start,end})),source.map(({id,start,end})=>({id,start,end})))
})
test('spoken-number translations use independent semantic review for any language, without a numeral dictionary', async () => {
  for (const [language,text,translation] of [
    ['en','Use one bottle every two months.','2개월마다 1병'],
    ['hi','दो बोतल','2병'], ['es','cada dos meses','2개월마다'],
    ['ar','زجاجة واحدة','1병'], ['ja','二か月ごと','2개월마다'],
  ]) {
    const calls=[]
    const result=await translateSegments({json:async(op,_p,input)=>{
      calls.push(op)
      return op==='verify-reference-numbers'?approve(input):{segments:[{id:'a',text:translation}]}
    }},language,[{id:'a',text}])
    assert.equal(result[0].text,translation)
    assert.deepEqual(calls,['translate-reference','verify-reference-numbers'])
  }
})
test('actual numeric changes still fail after exactly one correction', async () => {
  let calls=0
  await assert.rejects(translateSegments({json:async (_op,_prompt,input)=> {
    calls++; const result=translated(input);result.find(s=>s.id==='price').text='가격은 255루피';return {segments:result}
  }},'hi',source),{code:'TRANSLATION_NUMBER_CHANGED'})
  assert.equal(calls,2)
})
test('percentages and prices cannot be deleted, replaced or duplicated', () => {
  const original=[{id:'a',text:'99.9% for 254 rupees'}]
  for(const text of ['99%에 254루피','99.9%에 250루피','254루피','99.9%에 254루피 254루피']) {
    assert.throws(()=>validateTranslation(original,[{id:'a',text}],'hi'),{code:'TRANSLATION_NUMBER_CHANGED'})
  }
})
test('same-valued placeholders cannot move between segments', async () => {
  const original=[{id:'a',text:'Use 3 bottles'},{id:'b',text:'Wait 3 days'}]
  await assert.rejects(translateSegments({json:async (_op,_p,input)=>({segments:[
    {id:'a',text:`${tokens(input.segments[1].text)[0]}병`},
    {id:'b',text:`${tokens(input.segments[0].text)[0]}일`},
  ]})},'en',original),{code:'TRANSLATION_NUMBER_CHANGED'})
})
test('a new instruction is not silently erased and a semantic rejection stays blocked', async () => {
  const calls=[]
  await assert.rejects(translateSegments({json:async(op,_p,input)=>{
    calls.push(op)
    if(op==='verify-reference-numbers') {
      assert.match(input.segments[0].translation,/3병을 3회/)
      const result=approve(input);result.segments[0].verdict='changed';result.segments[0].reason='원문에 없는 사용 횟수 추가';return result
    }
    return{segments:[{id:'a',text:`${tokens(input.segments[0].text)[0]}병을 3회 사용`}]}
  }},'en',[{id:'a',text:'Use 3 bottles'}]),{code:'TRANSLATION_NUMBER_CHANGED'})
  assert.deepEqual(calls,['translate-reference','verify-reference-numbers','translate-reference-correction','verify-reference-numbers'])
})
test('malformed translations report a controlled shape error without spending on a numeric repair', async () => {
  for (const value of [null,{}, {segments:null},{segments:[null]}]) {
    let calls=0
    await assert.rejects(translateSegments({json:async()=>{calls++;return value}},'en',[{id:'a',text:'Use 3 bottles'}]),{code:'TRANSLATION_INVALID'})
    assert.equal(calls,1)
  }
})
test('link import resumes saved Hindi transcription without repeating collection or transcription', async () => {
  const stages=[], calls=[]
  const result=await importLink({job:{input:{url:'https://www.instagram.com/reel/DW8tMKyiTxO/'}},
    stage:async s=>stages.push(s), checkpoint:async(name,fn)=>name==='transcript'?{language:'hindi',subtitles:source,text:source.map(s=>s.text).join(' '),duration:10}:fn(),
    providers:{brightData:async()=>assert.fail('must reuse transcript'),json:async(op,_p,input)=>{calls.push(op);return op==='verify-reference-numbers'?approve(input):{segments:translated(input)}}},
  })
  assert.equal(result.sourceLanguage,'hindi')
  assert.match(result.translatedTranscript,/99\.9%/)
  assert.match(result.translatedTranscript,/254루피/)
  assert.match(result.translatedTranscript,/2개월/)
  assert.deepEqual(calls,['translate-reference','verify-reference-numbers'])
  assert.equal(stages.at(-1),'saving_transcript')
})

test('unverifiable, incomplete or fabricated numeric review evidence cannot approve a translation', async () => {
  for(const mutate of [
    result=>{result.segments[0].verdict='uncertain'},
    result=>{result.segments=[]},
    result=>{result.segments[0].sourceQuotes=['invented evidence']},
    result=>{result.segments[0].translatedQuotes=[]},
    result=>{result.segments[0].id='wrong'},
  ]) {
    await assert.rejects(translateSegments({json:async(op,_p,input)=>{
      if(op==='verify-reference-numbers'){const result=approve(input);mutate(result);return result}
      return{segments:[{id:'a',text:'1병'}]}
    }},'en',[{id:'a',text:'one bottle'}]),{code:'TRANSLATION_NUMBER_CHANGED'})
  }
})
test('numeric meaning review catches word-only quantity changes and unit changes', async () => {
  for(const [text,translation] of [['every two months','세 달마다'],['Use one bottle','한 리터를 사용']]) {
    await assert.rejects(translateSegments({json:async(op,_p,input)=>{
      if(op==='verify-reference-numbers') {const result=approve(input);result.segments[0].verdict='changed';return result}
      return{segments:[{id:'a',text:translation}]}
    }},'en',[{id:'a',text}]),{code:'TRANSLATION_NUMBER_CHANGED'})
  }
})
test('non-Latin decimal digits are protected verbatim', async () => {
  const result=await translateSegments({json:async(op,_p,input)=>{
    if(op==='verify-reference-numbers')return approve(input)
    return{segments:[{id:'a',text:`${tokens(input.segments[0].text)[0]}% 보존`}]}
  }},'ar',[{id:'a',text:'٩٩٫٩%'}])
  assert.equal(result[0].text,'٩٩٫٩% 보존')
})
test('provider budget and network failures do not trigger an extra paid translation', async () => {
  const calls=[]
  await assert.rejects(translateSegments({json:async(op,_p,input)=>{
    calls.push(op)
    if(op==='verify-reference-numbers')throw Object.assign(new Error('budget'),{code:'PROVIDER_BUDGET'})
    return{segments:[{id:'a',text:'한 병'}]}
  }},'en',[{id:'a',text:'one bottle'}]),{code:'PROVIDER_BUDGET'})
  assert.equal(calls.length,2)
})
