import { durationCharacterRange } from '../../shared/script-duration.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { formatScriptText, formatScriptSections, reconcileScriptSections } from '../../frontend/src/lib/scriptText.js'
import { estimateScriptSeconds } from '../../shared/script-duration.mjs'
const compact = (text) => text.replace(/\s/g, '')
const old = { hook: '먼지가 다시 쌓이나요?', body: '위에서 아래로 닦으세요. 마른 먼지부터 털어보세요.', cta: '이 순서를 저장하세요.' }
const plain = formatScriptSections(old)
test('continuous display breaks sentences without changing decimal, URL or wording', () => {
  const text = '물 1.5L를 준비하세요. https://example.com/a 링크도 확인하세요! 다음에 사용하세요.'
  const displayed = formatScriptText(text)
  assert.equal(compact(displayed), compact(text))
  assert.ok(displayed.includes('1.5L'))
  assert.ok(displayed.includes('https://example.com/a'))
  assert.ok(displayed.includes('\n\n'))
})
test('whole-script paste, cross-boundary deletion and one-sentence replacement lose no words', () => {
  for (const next of [plain.replace('닦으세요.', '천천히 닦으세요.'), plain.slice(10), '새 대본 한 문장만 남깁니다.', '', plain+'\n\n추가 설명입니다.', '시작입니다. 본문입니다. 마무리입니다.']) {
    const sections = reconcileScriptSections(old, plain, next)
    assert.equal(compact(formatScriptSections(sections)), compact(next))
    for (const value of Object.values(sections)) assert.doesNotMatch(value, /\n\s*\n/)
    const stored = [sections.hook, sections.body, sections.cta].join('\n\n')
    const [hook, body, ...cta] = stored.split('\n\n')
    assert.deepEqual({hook,body,cta:cta.join('\n\n')}, sections)
  }
})
test('consecutive edits with custom newlines preserve all content and section changes', () => {
  let sections=old, before=plain
  for (const next of [plain.replace(/\n\n/g,'\n'), plain.replace(/\n\n/g,'\n').replace('마른 먼지','선반 먼지'), '새 첫 문장입니다.\n본문을 새로 적었어요.\n한 번 더 확인하세요.']) {
    sections=reconcileScriptSections(sections,before,next)
    assert.equal(compact(formatScriptSections(sections)),compact(next))
    before=next
  }
})
test('UI and duration contract ignore visual blank lines', () => {
  assert.equal(estimateScriptSeconds(old), estimateScriptSeconds(formatScriptSections(old)))
})

import { scriptEditingView } from '../../shared/script-edit-scope.mjs'
test('whole-script history exposes the actual first and last sentences for later scoped edits',()=>{
 const original={hook:'',body:'출장 전에 신분증을 확인하세요. 예약 서류도 함께 모아두세요. 마지막으로 충전기를 챙겨요.',cta:''}
 const view=scriptEditingView(original)
 assert.equal(view.hook,'출장 전에 신분증을 확인하세요.')
 assert.equal(view.body,'예약 서류도 함께 모아두세요.')
 assert.equal(view.cta,'마지막으로 충전기를 챙겨요.')
 assert.equal([view.hook,view.body,view.cta].join(' '),original.body)
 assert.equal(original.hook,'','read-only editing view cannot modify the stored original')
 assert.deepEqual(scriptEditingView({hook:'이미 있는 도입',body:'본문.',cta:''}),{hook:'이미 있는 도입',body:'본문.',cta:''})
 assert.deepEqual(scriptEditingView({hook:'',body:'한 문장만 있어요.',cta:''}),{hook:'',body:'한 문장만 있어요.',cta:''})
})
test('duration writing ranges stay ordered across every supported target',()=>{
 for(let seconds=10;seconds<=999;seconds++){
  const {min,max}=durationCharacterRange(seconds)
  assert.ok(min>0&&min<=max,`${seconds}: ${min}~${max}`)
 }
})
