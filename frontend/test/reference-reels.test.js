import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { referenceReels } from '../src/lib/referenceReels.js'

test('three actual reels, exact post embed URLs, no duplicates or extra suggestions', () => {
  const reels = referenceReels({exampleMedia:[{permalink:'https://www.instagram.com/reel/Abc_123/'},{permalink:'https://www.instagram.com/reels/Abc_123/'},{permalink:'https://www.instagram.com/p/Def456/',contentType:'Video',views:12345},{permalink:'https://www.instagram.com/reel/Ghi789/'},{permalink:'https://www.instagram.com/reel/Jkl012/'}]})
  assert.equal(reels.length,3)
  assert.equal(reels[0].embedUrl,'https://www.instagram.com/p/Abc_123/embed/')
  assert.equal(reels[1].views,12345)
  assert.equal(reels[0].views,null)
})
test('unsafe URLs, photo posts, missing and old payloads fail safely without invented reels', () => {
  assert.deepEqual(referenceReels({}),[])
  assert.deepEqual(referenceReels({exampleMedia:[{permalink:'javascript:alert(1)'},{permalink:'https://instagram.com.evil.test/reel/abc/'},{permalink:'https://instagram.com/p/photo/',contentType:'Image'},null]}),[])
  assert.equal(referenceReels({viralMedia:{permalink:'https://instagram.com/reel/Valid_01/'}}).length,1)
})
test('all 44 preserved catalog accounts already supply three distinct reel players, no new collection needed', () => {
  const catalog=JSON.parse(readFileSync(new URL('../../backend/catalog/home-2026-09-20.reviewed.json',import.meta.url)))
  const rows=Array.isArray(catalog)?catalog:catalog.accounts
  assert.equal(rows.length,44)
  for(const row of rows) assert.equal(referenceReels(row.profile).length,3,row.username)
})
