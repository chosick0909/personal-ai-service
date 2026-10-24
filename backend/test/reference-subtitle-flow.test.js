import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
test('silent workshop upload preserves extracted captions through analysis, persistence and draft entry',()=>{
 const out=execFileSync(process.execPath,['--experimental-test-module-mocks',fileURLToPath(new URL('./fixtures/reference-subtitle-flow.mjs',import.meta.url))],{encoding:'utf8',timeout:30000})
 assert.match(out,/REFERENCE_SUBTITLE_FLOW_OK/)
})
