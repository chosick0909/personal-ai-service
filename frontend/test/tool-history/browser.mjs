// Controlled APIs, actual ToolPage, Sidebar, history hook and API client. No external requests.
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
const require = createRequire('/Users/seojiyeong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')
const { chromium } = require('playwright')
const root = process.cwd() + '/frontend'
const harness = readFileSync(root + '/test/tool-history/harness.jsx', 'utf8')
const server = await createServer({ root, configFile: false, envDir: false, plugins: [tailwind(), {
  name: 'tool-history-qa', enforce: 'pre',
  configureServer(server) { server.middlewares.use('/__history-test', async (req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.end(await server.transformIndexHtml('/__history-test', '<div id="root"></div><script type="module" src="/test/tool-history/entry.jsx"></script>'))
  }) },
  transform(code, id) {
    if (id.endsWith('/src/store/AppState.jsx')) return harness
    if (id.endsWith('/src/App.jsx')) return code + '\nexport { MainPanel }'
  },
}, react()], server: { host: '127.0.0.1', port: 8471, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const rows = []
let generationCalls = 0, failSave = false, slowGeneration = false, finishGeneration
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path.startsWith('/api/')) {
      const account = req.headers()['x-account-id'] || 'a'
      if (path === '/api/account/profile') return reply({ profile: { category: '살림', settings: { category: '살림' } } })
      if (path.includes('/category-rule')) return reply({ rule: null })
      if (path === '/api/tools/caption') {
        generationCalls++
        if (slowGeneration) await new Promise(resolve => { finishGeneration = resolve })
        return reply({ caption: '자동 생성 캡션입니다.', hashtags: ['살림'], rationale: '두 레퍼런스 반영' })
      }
      if (path === '/api/tools/thumbnail/analyze') return reply({ analysis: { summary: '밝은 이미지', keyElements: ['주방'] } })
      if (path === '/api/tools/thumbnail/titles') { generationCalls++; return reply({ recommendations: [{ title: '주방 정리 세 가지', reason: '구체적인 제목' }] }) }
      if (path.startsWith('/api/tool-history')) {
        const id = path.split('/')[3]
        if (req.method() === 'GET') return reply({ items: rows.filter(x => x.account_id === account) })
        if (req.method() === 'POST') {
          if (failSave) return reply({ error: { message: '저장 연결 실패' } }, 503)
          const body = req.postDataJSON()
          let item = rows.find(x => x.id === body.id)
          if (!item) { item = { ...body, title: body.input.topic, project_id: body.projectId, account_id: account, edited_caption: body.kind === 'caption' ? body.result.caption : null, version: 1, updated_at: new Date().toISOString() }; rows.push(item) }
          return reply({ item }, 201)
        }
        const item = rows.find(x => x.id === id && x.account_id === account)
        if (req.method() === 'PATCH') {
          const body = req.postDataJSON()
          if (!item || item.version !== body.version) return reply({ error: { message: '내역이 변경되었습니다.' } }, 409)
          if (body.editedCaption !== undefined) item.edited_caption = body.editedCaption
          if (body.title) item.title = body.title
          item.version++; return reply({ item })
        }
        if (req.method() === 'DELETE') { if (item) rows.splice(rows.indexOf(item), 1); return reply({ deleted: true }) }
      }
      return reply({})
    }
    if (url.hostname !== '127.0.0.1') return route.abort()
    return route.continue()
  })
  await page.goto('http://127.0.0.1:8471/__history-test')
  await page.getByRole('heading', { name: '캡션 생성기', exact: true }).waitFor()
  await page.getByPlaceholder('첫 번째 캡션을 붙여넣으세요.').fill('레퍼런스 A')
  await page.getByPlaceholder('두 번째 캡션을 붙여넣으세요.').fill('레퍼런스 B')
  await page.getByPlaceholder('예: 헬스 초보 루틴 PDF 소개').fill('살림 팁')
  await page.getByRole('button', { name: '초안 생성', exact: true }).click()
  await page.getByText('최근 내역에 저장했습니다.', { exact: true }).waitFor()
  assert.equal(rows.length, 1)
  // The fixture emulates server-generated title.
  await page.locator('textarea').last().fill('사용자가 고친 캡션')
  await page.getByRole('button', { name: '수정한 캡션 저장', exact: true }).click()
  await page.getByText('수정한 캡션을 저장했습니다.', { exact: true }).waitFor()
  assert.equal(rows[0].edited_caption, '사용자가 고친 캡션')
  await page.reload()
  await page.getByRole('button', { name: /살림 팁/ }).first().click()
  await page.getByRole('button', { name: '수정한 캡션 저장', exact: true }).waitFor()
  assert.equal(await page.locator('textarea').last().inputValue(), '사용자가 고친 캡션')
  assert.equal(await page.getByPlaceholder('첫 번째 캡션을 붙여넣으세요.').inputValue(), '레퍼런스 A')
  assert.equal(generationCalls, 1)
  console.log('PASS caption generation, server history, edited caption, reload and reopen without regeneration')
  await page.getByRole('button', { name: '썸네일 제목 생성기', exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: await page.locator('h1').screenshot() })
  await page.getByPlaceholder('예: 운동해도 몸이 안 바뀌는 이유').fill('주방 정리')
  await page.getByRole('button', { name: '제목 추천 생성' }).click()
  await page.getByText('최근 내역에 저장했습니다.', { exact: true }).waitFor()
  assert.equal(rows.length, 2)
  assert.ok(rows[1].input.imagePreview.startsWith('data:image/jpeg'))
  await page.reload()
  await page.getByRole('button', { name: /주방 정리/ }).first().click()
  await page.getByText('주방 정리 세 가지', { exact: true }).waitFor()
  assert.ok(await page.getByAltText('업로드한 썸네일 미리보기').getAttribute('src'))
  assert.equal(generationCalls, 2)
  console.log('PASS thumbnail input/preview/analysis/results persist and reopen without generation')
  await page.getByRole('button', { name: '캡션 생성기', exact: true }).click()
  await page.getByPlaceholder('첫 번째 캡션을 붙여넣으세요.').fill('A')
  await page.getByPlaceholder('두 번째 캡션을 붙여넣으세요.').fill('B')
  await page.getByPlaceholder('예: 헬스 초보 루틴 PDF 소개').fill('저장 재시도')
  failSave = true
  await page.getByRole('button', { name: '초안 생성', exact: true }).click()
  await page.getByRole('button', { name: '생성 결과 다시 저장' }).waitFor()
  const calls = generationCalls
  failSave = false
  await page.getByRole('button', { name: '생성 결과 다시 저장' }).click()
  await page.getByText('최근 내역에 저장했습니다.', { exact: true }).waitFor()
  assert.equal(generationCalls, calls)
  console.log('PASS failed save retries same result without another paid generation')
  await page.getByRole('button', { name: '캡션 생성기', exact: true }).click()
  await page.getByPlaceholder('첫 번째 캡션을 붙여넣으세요.').fill('A')
  await page.getByPlaceholder('두 번째 캡션을 붙여넣으세요.').fill('B')
  await page.getByPlaceholder('예: 헬스 초보 루틴 PDF 소개').fill('전환 중 결과')
  slowGeneration = true
  await page.getByRole('button', { name: '초안 생성', exact: true }).click()
  await page.waitForFunction(() => document.body.textContent.includes('생성 중...'))
  await page.getByRole('button', { name: '검증 계정 전환' }).click()
  finishGeneration()
  await page.waitForTimeout(500)
  assert.equal(rows.at(-1).account_id, 'a')
  assert.equal(await page.getByText('전환 중 결과', { exact: true }).count(), 0)
  assert.equal(await page.locator('textarea').last().inputValue(), '')
  assert.deepEqual(errors, [])
  mkdirSync('tmp/tool-history', { recursive: true })
  await page.getByRole('button', { name: '검증 계정 전환' }).click()
  await page.getByRole('button', { name: /주방 정리/ }).first().click()
  await page.screenshot({ path: 'tmp/tool-history/history-thumbnail.png', fullPage: true })
  console.log('PASS late generation saves to captured account; switched account remains empty. No browser errors.')
} catch(error) { console.log(await browser.contexts()[0]?.pages()[0]?.locator('body').innerText()); throw error } finally { await browser.close(); await server.close() }
