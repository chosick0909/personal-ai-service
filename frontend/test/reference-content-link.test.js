import test from 'node:test'
import assert from 'node:assert/strict'
import { referenceContentHref } from '../src/lib/referenceContentLink.js'

test('reported reel opens the exact post detail instead of the recommendation viewer', () => {
  assert.equal(referenceContentHref('https://www.instagram.com/reel/C4u94F7vq0l/'), 'https://www.instagram.com/p/C4u94F7vq0l/')
})
test('old saved reel and reels links retain case-sensitive shortcode and discard tracking', () => {
  for (const kind of ['reel', 'reels', 'p']) {
    assert.equal(referenceContentHref(`https://instagram.com/${kind}/AbC_12-z/?igsh=tracking#fragment`), 'https://www.instagram.com/p/AbC_12-z/')
  }
})
test('unsafe hosts, credentials, profiles and malformed content paths are not linkable', () => {
  for (const value of [null, '', 'javascript:alert(1)', 'http://instagram.com/p/abc/', 'https://instagram.com.evil.test/p/abc/', 'https://instagram.com@evil.test/p/abc/', 'https://user@instagram.com/p/abc/', 'https://instagram.com:444/p/abc/', 'https://instagram.com/hello._.mom89/', 'https://instagram.com/reels/', 'https://instagram.com/p/abc/extra', 'https://instagram.com/p/a%2Fb/']) {
    assert.equal(referenceContentHref(value), null, value)
  }
})
