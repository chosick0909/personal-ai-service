import test from 'node:test'
import assert from 'node:assert/strict'
import { STORY_TEMPLATES } from '../src/creator-tools/studio/story-templates.js'
import { STRUCTURE_LIBRARY } from '../src/creator-tools/studio/library.js'

test('the 30 storytelling templates are 전개 공식 with fill-in lines and their example reels', () => {
  assert.equal(STORY_TEMPLATES.length, 30)
  assert.equal(new Set(STRUCTURE_LIBRARY.map(s => s.id)).size, STRUCTURE_LIBRARY.length)
  for (const t of STORY_TEMPLATES) {
    assert.ok(STRUCTURE_LIBRARY.includes(t))
    assert.ok(t.title && t.when && t.lines.length >= 4 && t.lines.every(l => l.name && l.purpose && l.template))
    assert.deepEqual(t.segments, t.lines.map(l => [l.name, l.purpose]))
    assert.ok(t.examples.every(code => /^[A-Za-z0-9_-]{5,40}$/.test(code)))
  }
  assert.equal(STORY_TEMPLATES.flatMap(t => t.examples).length, 30)
})
