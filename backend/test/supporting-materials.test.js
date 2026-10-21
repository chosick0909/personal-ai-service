import test from 'node:test'
import assert from 'node:assert/strict'
import { extractSupportingMaterials } from '../src/lib/supporting-materials.js'
import { validateMaterialSelection, normalizeSupportingMaterials, formatSupportingMaterials } from '../../shared/supporting-materials.mjs'
import { imageReadingRegions, prepareSupportingImage, recognizeSupportingImageText } from '../src/lib/supporting-image-inputs.js'
const file = (name, bytes) => ({ originalname: name, size: bytes.length, buffer: bytes })
const response = { status: 'completed', output_text: JSON.stringify({ readable: true, content: '합성 행사 안내: 11월 3일 오후 2시, 온라인 진행. 준비물은 필기구.', warnings: [] }) }
test('independent OCR preserves glyphs and uses bounded, cancellable native processing', async () => {
  const signal = new AbortController().signal
  const calls=[]
  const text=await recognizeSupportingImageText('/tmp/a file;not-shell.png',signal,async (...args)=>{calls.push(args);return {stdout:'  합성 8중 패턴 · 12.5L\n  '}})
  assert.equal(text,'합성 8중 패턴 · 12.5L')
  assert.equal(calls[0][0],'tesseract')
  assert.equal(calls[0][1][0],'/tmp/a file;not-shell.png')
  assert.equal(calls[0][2].signal,signal)
  assert.ok(calls[0][2].timeout<=20000)
  await assert.rejects(recognizeSupportingImageText('/tmp/x',signal,async()=>{throw new Error('OCR unavailable')}),/OCR unavailable/)
})
function clientReturning(value = response) { const calls = []; return { calls, responses: { async create(body) { calls.push(body); return value } } } }

test('file type, per-file, aggregate size and normalized context limits are enforced', () => {
  assert.equal(validateMaterialSelection([{ name: '발표.pptx', size: 200 }]), '')
  assert.ok(validateMaterialSelection([{ name: '실행.exe', size: 200 }]))
  assert.ok(validateMaterialSelection([{ name: '자료.pdf', size: 11 * 1024 * 1024 }]))
  assert.ok(validateMaterialSelection(Array.from({ length: 3 }, () => ({ name: '자료.pdf', size: 8 * 1024 * 1024 }))))
  assert.throws(() => normalizeSupportingMaterials([{ name: '자료', content: 'x'.repeat(12001) }]))
  assert.throws(() => normalizeSupportingMaterials([{ name: '못 읽은 파일', status: 'error' }]))
  assert.equal(formatSupportingMaterials([]), '')
})

test('UTF-8 text and CSV preserve content and table boundaries without model calls', async () => {
  const client = clientReturning()
  const items = await extractSupportingMaterials([file('기획.md', Buffer.from('주제: 강의 소개\n준비물: 필기구')), file('가격.csv', Buffer.from('상품,가격\nA,39000\nB,51000'))], { client, model: 'stub' })
  assert.equal(items[0].content, '주제: 강의 소개\n준비물: 필기구')
  assert.equal(items[1].content, '상품,가격\nA,39000\nB,51000')
  assert.ok(items.every(x => x.status === 'ready'))
  assert.equal(client.calls.length, 0)
})

test('images use visual inputs and PDF/office files use file inputs without persistent file upload', async () => {
  const client = clientReturning()
  const files = [file('화면.png', Buffer.from([137,80,78,71,13,10,26,10,0])), file('안내.pdf', Buffer.from('%PDF-1.4 synthetic')), file('회의.docx', Buffer.from('PK synthetic'))]
  const items = await extractSupportingMaterials(files, { client, model: 'stub', prepareImage: async () => [{ type: 'input_image', image_url: 'data:image/png;base64,synthetic', detail: 'high' }, { type: 'input_text', text: '같은 이미지 확대' }, { type: 'input_image', image_url: 'data:image/jpeg;base64,crop', detail: 'high' }] })
  assert.ok(items.every(x => x.status === 'ready'))
  assert.equal(client.calls[0].input[0].content[0].type, 'input_image')
  assert.equal(client.calls[0].input[0].content.filter(x => x.type === 'input_image').length, 2)
  assert.equal(client.calls[1].input[0].content[0].type, 'input_image')
  assert.equal(client.calls[2].input[0].content[0].type, 'input_file')
  assert.ok(client.calls[2].input[0].content[0].file_data.startsWith('data:application/pdf;base64,'))
  assert.ok(items[2].warnings.some(x => x.includes('이미지·차트')))
  assert.ok(client.calls.every(x => x.store === false))
})

test('overlapping tiles cover both axes at text resolution while retaining the separate overview', () => {
  for (const [width,height] of [[1200,2750],[2750,1200],[1200,1200]]) {
    const regions=imageReadingRegions(width,height)
    assert.ok(regions.length>1 && regions.length<=16)
    assert.ok(regions.every(r=>r.width<=768 && r.height<=1024))
    for(let y=0;y<height;y+=37)for(let x=0;x<width;x+=31) {
      assert.ok(regions.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height),'no gaps in tile coverage')
    }
    assert.equal(Math.max(...regions.map(r=>r.x+r.width)),width)
    assert.equal(Math.max(...regions.map(r=>r.y+r.height)),height)
  }
  assert.deepEqual(imageReadingRegions(600,800),[])
  assert.throws(()=>imageReadingRegions(100,30000))
  assert.throws(()=>imageReadingRegions(10000,10000))
})

test('damaged images cannot be accepted as readable even if a model would invent content', async () => {
  const client=clientReturning()
  const items=await extractSupportingMaterials([file('broken.png',Buffer.from([137,80,78,71,13,10,26,10,0]))],{client,model:'stub'})
  assert.equal(items[0].status,'error')
  assert.equal(client.calls.length,0)
})

test('image reading can be aborted before native processing begins', async () => {
  const controller=new AbortController();controller.abort()
  await assert.rejects(prepareSupportingImage(file('image.png',Buffer.from('unused')),'image/png',controller.signal),{name:'AbortError'})
})

test('reference information is optional background knowledge, not a required script checklist', () => {
  const context=formatSupportingMaterials([{name:'자료.txt',content:'행사 안내'}])
  assert.ok(context.includes('자료.txt') && context.includes('행사 안내'))
  assert.ok(context.includes('참고 지식') && context.includes('명료한 평서문'))
})

test('visual audit replaces a mistaken transcription and cannot publish an incomplete audit', async () => {
  const prepareImage=async()=>[{type:'input_image',image_url:'data:image/png;base64,synthetic',detail:'high'}]
  const bytes=Buffer.from([137,80,78,71,13,10,26,10,0])
  const responseFor=content=>({status:'completed',output_text:JSON.stringify({readable:true,content,warnings:[]})})
  let queue=[responseFor('수량 8개'),responseFor('수량 3개')]
  const client={responses:{async create(){return queue.shift()}}}
  const corrected=await extractSupportingMaterials([file('비교.png',bytes)],{client,model:'stub',prepareImage})
  assert.equal(corrected[0].content,'수량 3개')
  queue=[responseFor('수량 8개'),{status:'incomplete'}]
  const incomplete=await extractSupportingMaterials([file('비교.png',bytes)],{client,model:'stub',prepareImage})
  assert.equal(incomplete[0].status,'error')
})

test('user topic helps disambiguate names while remaining separate from file facts', async () => {
  const client=clientReturning()
  await extractSupportingMaterials([file('안내.pdf',Buffer.from('%PDF-1.4 synthetic'))],{client,model:'stub',readingContext:'브랜드 이름을 포함한 사용자의 주제'})
  const text=client.calls[0].input[0].content.at(-1).text
  assert.match(text,/브랜드 이름을 포함한 사용자의 주제/)
  assert.match(text,/이미지에서 읽은 사실로 추가하지/)
})

test('misnamed, blank, unreadable and truncated files are reported as errors, never accepted as read', async () => {
  let client = clientReturning()
  const bad = await extractSupportingMaterials([file('가짜.png', Buffer.from('not an image')), file('빈.txt', Buffer.from(' '))], { client, model: 'stub' })
  assert.ok(bad.every(x => x.status === 'error'))
  assert.equal(client.calls.length, 0)
  for (const response of [{ status: 'incomplete', output_text: '' }, { status: 'completed', output_text: '{"readable":false,"content":"","warnings":[]}' }]) {
    client = clientReturning(response)
    const result = await extractSupportingMaterials([file('안내.pdf', Buffer.from('%PDF-1.4 data'))], { client, model: 'stub' })
    assert.equal(result[0].status, 'error')
  }
})

test('saved attachments remain available to copilot as user reference information', async () => {
  const { __scriptAssistantTest: helpers } = await import('../src/lib/script-assistant.js')
  const context = helpers.buildReferenceStructureContext({ topic: '행사 소개', topic_brief: { supportingMaterials: [{ name: '안내.txt', content: '행사 시작 오후 2시, 입장료 12000원.' }] } })
  assert.ok(context.includes('입장료 12000원'))
  assert.ok(context.includes('사용자가 이번 대본을 위해 첨부한 참고자료'))
})

test('multipart Korean names are repaired, and canceled reads cannot make model calls', async () => {
  const client = clientReturning()
  const raw = Buffer.from('강의 안내.txt', 'utf8').toString('latin1')
  const items = await extractSupportingMaterials([file(raw, Buffer.from('강의 준비물은 필기구입니다.'))], { client, model: 'stub' })
  assert.equal(items[0].name, '강의 안내.txt')
  const controller = new AbortController(); controller.abort()
  await assert.rejects(extractSupportingMaterials([file('파일.pdf', Buffer.from('%PDF-1.4'))], { client, model: 'stub', signal: controller.signal }), { code: 'MATERIAL_READING_CANCELED' })
  assert.equal(client.calls.length, 0)
})
