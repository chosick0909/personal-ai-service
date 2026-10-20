import { spokenCharacterCount, estimateScriptSeconds, scriptText, durationCharacterRange } from '../../../shared/script-duration.mjs'
export function durationWritingGuidance(seconds, sections = {}, candidate = null) {
 if (!seconds) return ''
 const range=durationCharacterRange(seconds)
 const original=estimateScriptSeconds(sections)
 const count=candidate ? spokenCharacterCount(scriptText(candidate)) : 0
 const delta=count < range.min ? `지금보다 최소 ${range.min-count}자 정도의 설명을 더 보강해야 한다.`
   : count > range.max ? `지금보다 최소 ${count-range.max}자 정도를 줄여야 한다.` : '글자 가이드 안이므로 실제 시간과 필수 정보 보존을 함께 확인한다.'
 const measured=candidate ? `직전 결과의 실제 측정: ${count}자, 약 ${estimateScriptSeconds(candidate)}초. ${delta} 목표보다 길면 정보를 합치고, 짧으면 주어진 정보의 설명을 보강한다. 띄어쓰기나 문장부호를 지워도 발화 시간은 줄어들지 않는다.` : ''
 return `[분량 계약 — 다른 길이 보존 지시보다 우선]\n목표 약 ${seconds}초. ${original ? `현재 약 ${original}초에서 ${seconds>original?'늘리는':'줄이는'} 작업이다.` : '새 초안의 목표 분량이다.'}\n공백·문장부호를 뺀 전체 목표 ${range.min}~${range.max}자. 도입·본문·마무리를 모두 합한 수다.\n하나의 완결된 대본 기준이다. 내부 저장 구간별 필수 길이·비중은 없다. 중요한 사실과 사용자가 필수로 지정한 항목을 남기고 부연과 반복은 합치거나 덜어낸다.\n기존 문장 수·저장 구간·구간별 행동 유도를 보존하는 작업이 아니다. 짧게 요청할수록 핵심 전달에 직접 필요한 내용만 남기고, 사용자가 필수로 지정하지 않은 도입·부연·독립 CTA는 합치거나 덜어낸다. 길게 요청하면 기존 정보의 이유·방법·조건을 구체화한다. 설명과 이유를 한 문장으로 묶어도 된다. 같은 주장을 반복해 늘리지 않는다.\n${measured}\n반환 전 전체 발화문만 다시 읽고 분량을 맞춘다. JSON·설명 메시지 글자는 대본 분량에 포함하지 않는다.`
}
