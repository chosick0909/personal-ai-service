import test from 'node:test'
import assert from 'node:assert/strict'
const { translateSegments, validateTranslation, importLink, collectImportTranscript } = await import(process.env.LINK_IMPORT_TEST_MODULE || '../src/creator-tools/link-import.js')

const approve = input => ({verdict:'equivalent',meaningVerdict:'equivalent',sourceQuotes:[input.source.slice(0,200)],translatedQuotes:[input.translation.slice(0,200)],reason:'원문 의미와 수량 보존'})
const tokens = text => text.match(/__HOOKAINUM[A-Z]+__/g) || []
const source = [
  {id:'a',start:0,end:1,text:'Stop buying more boxes.'},
  {id:'b',start:1,end:2,text:'Sort what you already own'},
  {id:'c',start:2,end:3,text:'before choosing a shelf.'},
]
const korean = '상자를 더 사지 말고, 이미 가진 물건을 정리한 뒤 선반을 고르세요.'
const provider = (translate, review=approve) => ({json:async(op,_p,input,_f,schema)=>op==='verify-reference-numbers'?review(input):translate(input,op,schema)})

test('multiple transcription cues may become one natural Korean sentence', async()=>{
  const calls=[]
  const result=await translateSegments({json:async(op,_p,input,_f,schema)=>{
    calls.push(op)
    if(op==='verify-reference-numbers')return approve(input)
    // Reproduce the original real shape of failure on the baseline too.
    if(schema.properties.segments)return {segments:[{id:input.segments[0].id,text:korean}]}
    assert.equal(input.source,source.map(s=>s.text).join('\n'))
    return {text:korean}
  }},'en',source)
  assert.equal(result.map(s=>s.text).join('\n'),korean)
  assert.deepEqual(calls,['translate-reference','verify-reference-numbers'])
})
test('one cue may become several Korean sentences without a correction',async()=>{
  const result=await translateSegments(provider((_input,op,schema)=>{
    assert.equal(op,'translate-reference');assert.deepEqual(schema.required,['text']);assert.equal(schema.additionalProperties,false)
    return {text:'상자를 더 사지 마세요. 가진 물건부터 정리하세요. 그다음 선반을 고르세요.'}
  }),'en',[{text:'Stop buying boxes; sort your things, then choose a shelf.'}])
  assert.equal(result[0].text.split('.').filter(s=>s.trim()).length,3)
})
test('different cue identities and timing do not constrain document translation',async()=>{
  const result=await translateSegments(provider(()=>({text:korean})),'en',source.map(s=>({...s,id:'duplicate'})))
  assert.equal(result[0].text,korean)
})
test('Hindi spoken quantities become Korean digits while written percentages and prices stay exact',async()=>{
  const original=[{text:'फाइव एन वन क्लिनर, हाफ बॉटल, एक फुल बॉटल'}, {text:'99.9% बैक्टेरिया, एवरी टूमन्स, 254 रुपीज'}]
  const result=await translateSegments(provider(input=>({text:`5-in-1 클리너. 0.5병 또는 1병. 세균 ${tokens(input.source)[0]}%. 2개월마다, ${tokens(input.source)[1]}루피.`})),'hi',original)
  assert.match(result[0].text,/99\.9%/);assert.match(result[0].text,/254루피/)
})
test('spoken quantities work across languages without a numeral dictionary',async()=>{
  for(const [language,text,translation] of [['en','Use one bottle every two months.','2개월마다 1병'],['hi','दो बोतल','2병'],['es','cada dos meses','2개월마다'],['ar','زجاجة واحدة','1병'],['ja','二か月ごと','2개월마다']]){
    assert.equal((await translateSegments(provider(()=>({text:translation})),language,[{text}]))[0].text,translation)
  }
})
test('actual numeric changes still fail after exactly one correction',async()=>{
  let calls=0
  await assert.rejects(translateSegments(provider(()=>{calls++;return{text:'255루피'}}),'hi',[{text:'254 rupees'}]),{code:'TRANSLATION_NUMBER_CHANGED'})
  assert.equal(calls,2)
})
test('written numbers cannot be deleted, changed, duplicated or added',()=>{
  for(const text of ['99%에 254루피','99.9%에 250루피','254루피','99.9%에 254루피 254루피']){
    assert.throws(()=>validateTranslation([{id:'a',text:'99.9% for 254 rupees'}],[{id:'a',text}]),{code:'TRANSLATION_NUMBER_CHANGED'})
  }
})
test('a written placeholder cannot be omitted, duplicated or exchanged for an unknown placeholder',async()=>{
  for(const mutate of [()=>'',t=>t+t,()=> '__HOOKAINUMZZZ__']){
    await assert.rejects(translateSegments(provider(input=>({text:`가격 ${mutate(tokens(input.source)[0])}`})),'en',[{text:'Price 254'}]),{code:'TRANSLATION_NUMBER_CHANGED'})
  }
})
test('numeric meaning review still rejects changed units, word-only quantities and added frequency',async()=>{
  for(const [text,translation] of [['every two months','세 달마다'],['Use one bottle','한 리터를 사용'],['Use one bottle','1병을 3회 사용']]){
    let calls=0
    await assert.rejects(translateSegments(provider(()=>{calls++;return{text:translation}},input=>({...approve(input),verdict:'changed'})),'en',[{text}]),{code:'TRANSLATION_NUMBER_CHANGED'})
    assert.equal(calls,2)
  }
})
test('lost negation, omitted condition or invented advice triggers semantic correction',async()=>{
  for(const bad of ['상자를 더 사세요.','선반을 고르세요.','상자를 사고 매일 운동하세요.']){
    const calls=[]
    const result=await translateSegments({json:async(op,_p,input)=>{
      calls.push(op)
      if(op==='verify-reference-numbers')return{...approve(input),meaningVerdict:input.translation===bad?'changed':'equivalent'}
      return{text:op.endsWith('correction')?korean:bad}
    }},'en',source)
    assert.equal(result[0].text,korean)
    assert.deepEqual(calls,['translate-reference','verify-reference-numbers','translate-reference-correction','verify-reference-numbers'])
  }
})
test('semantic uncertainty and fabricated evidence remain blocked after one repair',async()=>{
  for(const mutate of [r=>{r.meaningVerdict='uncertain'},r=>{r.meaningVerdict='changed'},r=>{r.sourceQuotes=['invented']},r=>{r.translatedQuotes=[]},r=>{delete r.meaningVerdict}]){
    await assert.rejects(translateSegments(provider(()=>({text:korean}),input=>{const r=approve(input);mutate(r);return r}),'en',source),{code:'TRANSLATION_CONTENT_CHANGED'})
  }
})
test('empty and malformed responses get only one repair; no empty translation is returned',async()=>{
  for(const response of [null,{}, {text:null},{text:''},{text:'   '},{text:'가'.repeat(12001)}]){
    let calls=0
    await assert.rejects(translateSegments(provider(()=>{calls++;return response}),'en',source),{code:'TRANSLATION_CONTENT_CHANGED'})
    assert.equal(calls,2)
  }
})
test('non-Latin decimal digits are protected verbatim',async()=>{
  const result=await translateSegments(provider(input=>({text:`${tokens(input.source)[0]}% 보존`})),'ar',[{text:'٩٩٫٩%'}])
  assert.equal(result[0].text,'٩٩٫٩% 보존')
})
test('provider budget, transport, cancellation and truncated responses do not cause translation retries',async()=>{
  for(const code of ['PROVIDER_BUDGET','ECONNRESET','ABORT_ERR','CREATOR_INCOMPLETE_RESPONSE']){
    for(const stage of ['translation','review']){
      let calls=0
      await assert.rejects(translateSegments({json:async(op)=>{
        calls++
        if(stage==='translation'||op==='verify-reference-numbers')throw Object.assign(new Error(code),{code})
        return{text:korean}
      }},'en',source),{code})
      assert.equal(calls,stage==='translation'?1:2)
    }
  }
})
test('long transcripts are bounded by text size and reassembled without losing source coverage',async()=>{
  for(const text of ['A useful sentence. '.repeat(420),'字'.repeat(7000),'😀'.repeat(3500),'x'.repeat(3000)+' '+ 'y'.repeat(1000)]){
    const inputs=[]
    const result=await translateSegments(provider(input=>{
      inputs.push(input);assert.ok(input.source.length<=3000)
      assert.ok(!/[\uD800-\uDBFF]$/.test(input.source));assert.ok(input.context.before.length<=500);assert.ok(input.context.after.length<=500)
      return{text:'번역된 문맥 단락'}
    }),'en',[{text}])
    assert.equal(inputs.map(i=>i.source).join(''),text.trim());assert.equal(result.length,inputs.length)
    assert.ok(inputs.length>1)
  }
})
test('long translation is not constrained by the old per-subtitle 2000-character limit',async()=>{
  const text='자연스러운 번역. '.repeat(220)
  assert.ok(text.length>2000)
  assert.equal((await translateSegments(provider(()=>({text})),'en',source))[0].text,text.trim())
})
test('invalid or oversized source fails before spending on a provider',async()=>{
  for(const input of [[],null,[null],[{text:''}],[{text:'x'.repeat(20001)}]]){
    await assert.rejects(translateSegments({json:()=>assert.fail('no provider call')},'en',input))
  }
})
test('a later passage repair does not regenerate earlier successful passages',async()=>{
  const calls=[]
  await translateSegments({json:async(op,_p,input)=>{
    calls.push(op)
    if(op==='verify-reference-numbers')return approve(input)
    if(input.context.before&&!op.endsWith('correction'))return{text:''}
    return{text:'검증된 번역'}
  }},'en',[{text:'x'.repeat(4000)}])
  assert.deepEqual(calls,['translate-reference','verify-reference-numbers','translate-reference','translate-reference-correction','verify-reference-numbers'])
})
test('link and file imports use saved transcripts, expose different-count translation then analyze that exact text',async()=>{
  for(const input of [{url:'https://www.instagram.com/reel/Dc4D3TLTBpB/'},{projectId:'synthetic-project'}]){
    const saved={transcript:{language:'en',subtitles:source,text:source.map(s=>s.text).join(' '),duration:3}}
    const stages=[],calls=[]
    const ctx={job:{input},stage:async s=>stages.push(s),checkpoint:async(name,fn)=>{
      if(Object.hasOwn(saved,name))return saved[name]
      const r=await fn();saved[name]=structuredClone(r);return r
    },providers:{json:async(op,_p,data)=>{
      calls.push(op)
      if(op==='reference-analysis'){
        assert.equal(saved.referenceTranscriptV1.translatedTranscript,korean)
        assert.equal(data.script,korean)
        return {summary:'구매 전 정리 순서를 제시합니다.',
          hook:{quote:'상자를 더 사지 말고',type:'myth_busting',why:'추가 구매보다 정리를 우선합니다.'},
          structure:[{role:'hook',quote:'상자를 더 사지 말고',purpose:'추가 구매에 의문을 제기합니다.'},
            {role:'method',quote:'이미 가진 물건을 정리한 뒤',purpose:'정리부터 시작합니다.'},
            {role:'cta',quote:'선반을 고르세요.',purpose:'필요에 맞는 선택을 권합니다.'}],
          reasons:[{quote:'이미 가진 물건을 정리한 뒤',point:'정리와 구매 순서를 연결합니다.'}]}

      }
      return op==='verify-reference-numbers'?approve(data):{text:korean}
    }}}
    const result=await importLink(ctx)
    assert.equal(result.originalTranscript,source.map(s=>s.text).join('\n'));assert.equal(result.translatedTranscript,korean)
    assert.equal(stages.at(-1),'saving_transcript')
    assert.equal(result.analysisStatus,'ready');assert.equal(result.analysis.structure.length,3)
    assert.equal(result.analysis.hook.quote,'상자를 더 사지 말고')
    const before=calls.length;await importLink(ctx);assert.equal(calls.length,before,'saved successful translation reused')
  }
})
test('Korean transcripts bypass translation and semantic review',async()=>{
  const calls=[]
  const result=await importLink({job:{input:{}},stage:async()=>{},checkpoint:async(name,fn)=>name==='transcript'?{language:'ko',text:korean,subtitles:[{text:korean}]}:fn(),providers:{json:async(op)=>{calls.push(op);return{}}}})
  assert.equal(result.translatedTranscript,korean);assert.deepEqual(calls,['reference-analysis'])
})

test('uploaded videos bypass link collection and enter the shared transcription pipeline', async () => {
  const stages = [], calls = []
  const result = await collectImportTranscript({
    db:{ name:'database' }, job:{ user_id:'member', input:{ projectId:'project-1' } },
    providers:{ brightData:async()=>assert.fail('uploaded files must not call the link provider') },
    stage:async value=>stages.push(value), signal:{ aborted:false },
  }, {
    workspace:async callback=>callback('/private/workspace'),
    ownedMedia:async (db,id,userId)=>{
      calls.push(['ownedMedia',db.name,id,userId])
      return { original_path:'member/project-1/original', original_expires_at:'2099-01-01T00:00:00Z' }
    },
    downloadStored:async (_db,path,target)=>calls.push(['downloadStored',path,target]),
    probeVideo:async path=>{ calls.push(['probeVideo',path]); return { duration:12 } },
    transcribeFile:async (_ctx,path,duration)=>{
      calls.push(['transcribeFile',path,duration])
      return { language:'en', text:'Use one bottle.', subtitles:[{id:'a',start:0,end:2,text:'Use one bottle.'}] }
    },
  })
  assert.equal(result.language,'en')
  assert.equal(result.duration,12)
  assert.deepEqual(stages,['reading_video','transcribing'])
  assert.deepEqual(calls,[
    ['ownedMedia','database','project-1','member'],
    ['downloadStored','member/project-1/original','/private/workspace/source-video'],
    ['probeVideo','/private/workspace/source-video'],
    ['transcribeFile','/private/workspace/source-video',12],
  ])
})

test('expired uploaded originals stop before download or transcription', async () => {
  await assert.rejects(collectImportTranscript({
    db:{}, job:{ user_id:'member', input:{ projectId:'expired' } }, stage:async()=>{}, signal:{}, providers:{},
  }, {
    workspace:async callback=>callback('/private/workspace'),
    ownedMedia:async()=>({ original_path:'expired', original_expires_at:'2000-01-01T00:00:00Z' }),
    downloadStored:async()=>assert.fail('expired file must not download'),
    probeVideo:async()=>assert.fail('expired file must not be probed'),
    transcribeFile:async()=>assert.fail('expired file must not be transcribed'),
  }), { code:'MEDIA_EXPIRED' })
})
