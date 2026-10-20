import test from 'node:test'
import assert from 'node:assert/strict'
import {numericClaims} from '../src/lib/numeric-claims.js'
test('native counts, digits, ranges and equivalent units compare as quantities',()=>{
 assert.deepEqual(numericClaims('세 개를 두 번 확인해요.'),numericClaims('3개를 2번 확인해요.'))
 assert.deepEqual(numericClaims('1m, 1kg, 1만원, 1분'),numericClaims('100cm, 1000g, 10,000원, 60초'))
 assert.deepEqual(numericClaims('1~2cm'),new Set(['metres:0.01','metres:0.02']))
})
test('formatting indices and compound nouns are not monetary or result claims',()=>{
 assert.equal(numericClaims('1. 준비 2) 확인 3단계 3원칙 3가지 조합').size,0)
 assert.ok(numericClaims('3원으로 구매하세요.').has('KRW:3'))
 assert.ok(numericClaims('매출이 30% 늘고 고객이 1000명입니다.').has('percent:30'))
 assert.ok(numericClaims('매출이 30% 늘고 고객이 1000명입니다.').has('people:1000'))
})

test('signed changes are distinct factual quantities',()=>{assert.notDeepEqual(numericClaims('-20%'),numericClaims('20%'));assert.deepEqual(numericClaims('+20%'),numericClaims('20%'))})
