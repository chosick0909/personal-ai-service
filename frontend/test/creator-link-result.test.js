import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

test('actual link result rendering: transcript first, progress, final result, failure and legacy history', async t => {
  const server = await createServer({ configFile:false, envDir:false, root:fileURLToPath(new URL('../',import.meta.url)), plugins:[react()], server:{middlewareMode:true}, appType:'custom' })
  try {
    const { default:Result } = await server.ssrLoadModule('/src/components/CreatorLinkResult.jsx')
    const base={kind:'import-link',status:'running',result:{sourceLanguage:'en',originalTranscript:'Original reference',translatedTranscript:'검증된 한국어 해석',analysisStatus:'pending'}}
    const render=job=>renderToStaticMarkup(createElement(Result,{job,onCopy:()=>{}}))
    await t.test('pending translation is readable and copyable above the accessible loading message',()=>{
      const html=render(base)
      assert.ok(html.indexOf('Original reference')<html.indexOf('훅AI가 대본의 후킹 포인트를 분석 중이에요'))
      assert.match(html,/한국어 해석/); assert.match(html,/aria-label="원문 복사"/);assert.match(html,/aria-label="한국어 해석 복사"/)
      assert.match(html,/role="status"/);assert.match(html,/ct-analysis-spinner/)
    })
    await t.test('Korean source does not duplicate a translation panel',()=>{
      const html=render({...base,result:{...base.result,sourceLanguage:'ko'}})
      assert.doesNotMatch(html,/aria-label="한국어 해석 복사"/)
    })
    await t.test('completed analysis follows transcript and removes the spinner',()=>{
      const html=render({...base,status:'completed',result:{...base.result,analysisStatus:'ready',analysis:{summary:'분석 요약',hook:{quote:'Original reference',type:'question',why:'질문으로 시작합니다.'},structure:[],reasons:[],apply:[]}}})
      assert.ok(html.indexOf('Original reference')<html.indexOf('분석 요약'))
      assert.doesNotMatch(html,/ct-analysis-spinner/)
    })
    await t.test('failed or cancelled job retains transcript without endless loading',()=>{
      for(const status of ['failed','cancelled']) {
        const html=render({...base,status})
        assert.match(html,/Original reference/);assert.doesNotMatch(html,/ct-analysis-spinner/)
        assert.match(html,/계속 확인하고 복사/)
      }
    })
    await t.test('unavailable analysis and historical jobs still show the transcript',()=>{
      for(const analysisStatus of ['unavailable',undefined]) {
        const html=render({...base,status:'completed',result:{...base.result,analysisStatus}})
        assert.match(html,/Original reference/); assert.doesNotMatch(html,/ct-analysis-spinner/)
      }
      assert.equal(render({...base,result:null}),'')
      assert.equal(render({...base,kind:'media-analyze'}),'')
    })
  } finally { await server.close() }
})
