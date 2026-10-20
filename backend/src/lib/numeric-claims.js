// Compare quantities by value/unit, not every digit on the page. List numbers,
// section labels and writing a native Korean count as a digit are not new facts.
const ones={한:1,하나:1,두:2,둘:2,세:3,셋:3,네:4,넷:4,다섯:5,여섯:6,일곱:7,여덟:8,아홉:9}
const tens={열:10,스물:20,스무:20,서른:30,마흔:40,쉰:50,예순:60,일흔:70,여든:80,아흔:90}
function number(value) {
 if(/^[+-]?\d/.test(value))return Number(value.replace(/,/g,''))
 if(ones[value])return ones[value]
 for(const [prefix,n]of Object.entries(tens)){if(value===prefix)return n;if(value.startsWith(prefix)&&ones[value.slice(prefix.length)])return n+ones[value.slice(prefix.length)]}
 return NaN
}
const units={
 '천만원':['KRW',1e7],'백만원':['KRW',1e6],'만원':['KRW',1e4],'억원':['KRW',1e8],'원':['KRW',1],
 '%':['percent',1],'퍼센트':['percent',1],'배':['ratio',1],
 'kg':['grams',1000],'킬로그램':['grams',1000],'g':['grams',1],'그램':['grams',1],
 'mm':['metres',.001],'cm':['metres',.01],'m':['metres',1],
 '시간':['seconds',3600],'분':['seconds',60],'초':['seconds',1],
 '개월':['months',1],'년':['years',1],'일':['days',1],
 '개':['items',1],'명':['people',1],'회':['times',1],'번':['times',1],
}
const numeral='(?:[+-]?\\d[\\d,]*(?:\\.\\d+)?|(?:열|스물|스무|서른|마흔|쉰|예순|일흔|여든|아흔)(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉)?|한|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉)'
const unit=Object.keys(units).sort((a,b)=>b.length-a.length).join('|')
const pattern=new RegExp(`(${numeral})(?:\\s*[~–—-]\\s*(${numeral}))?\\s*(${unit})(?=$|[^\\p{L}\\p{N}]|으로|로|을|를|은|는|이|가|의|에|까지|부터|씩|마다|짜리|입니다)`,'gu')
export function numericClaims(text='') {
 const claims=new Set()
 for(const match of String(text).matchAll(pattern)){
  const [kind,scale]=units[match[3]]
  for(const value of [match[1],match[2]].filter(Boolean)){
   const n=number(value)*scale
   if(Number.isFinite(n))claims.add(`${kind}:${Number(n.toPrecision(12))}`)
  }
 }
 for(const [word,n]of [['하루',1],['이틀',2],['사흘',3],['나흘',4]])if(String(text).includes(word))claims.add(`days:${n}`)
 return claims
}
