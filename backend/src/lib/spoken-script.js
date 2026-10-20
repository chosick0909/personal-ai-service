// A meaning-first speaking contract, shared by initial writing and later edits.
// There is deliberately no list of banned words, products or user phrasings.
export const SPOKEN_SCRIPT_WRITING_RULES = [
  '[의미를 먼저 정하고 말로 옮기는 순서]',
  '정보의 출처를 구분한다. 사용자 제공 사실과 확인한 외부 근거가 사실의 기준이다. 모델이 만든 정보팩·기획 메모·구성안은 설명 제안이며, 그 안에 적혔다는 이유만으로 검증된 사실이나 화자의 경험이 되지 않는다.',
  '행동 팁은 제안으로, 예시는 가정한 상황으로, 확인한 사실은 사실로 전달한다. 구체적으로 들리게 하려고 발생 빈도·소요 시간·사람들의 행동 원인·성과를 임의로 단정하지 않는다. 주어진 정보만으로 이유를 확정할 수 없다면 실제로 확인할 점과 해볼 행동을 직접 설명한다.',
  '기획안의 역할명·전략·추상 개념은 작가용 메모다. 메모 문장을 대본에 옮기지 말고, 먼저 이 주제에서 실제로 무엇이 어떤 상태이고 무엇을 하라는 뜻인지 평이한 말로 정리한 뒤 발화 문장을 쓴다.',
  '주제와 청자가 실제로 쓰는 단위로 말한다. 사물·행동·보이는 상태·이유 사이 관계가 들으면 바로 이해되어야 한다. 분야 용어는 대상 독자가 아는 경우 쓰되, 익숙하지 않은 용어는 그 뜻을 문장 안에서 풀어준다.',
  '비유나 새로운 명칭은 뜻을 더 빨리 이해시키는 경우에만 쓴다. 비유를 이해하기 위해 독자가 다시 해석해야 한다면 확인된 현상을 직접 설명한다. 구체적으로 보이려고 원인·제품 기능·화자 경험·효과를 만들지 않는다.',
  '한 사람에게 실제로 말하듯 문장 앞뒤의 이유와 대상을 연결한다. 말끝만 바꾸거나 모든 문장을 같은 종결형으로 맞추는 것을 구어체 개선으로 보지 않는다.',
  '명시한 화자 말투와 청자 관계를 우선한다. 주제·타깃에 맞는 어휘와 호흡을 선택하고 한 초안의 높임 수준을 유지한다. 별도 요청이 없으면 편안한 해요체로 말한다.',
  '출력 전 소리 내어 말하는 상황을 가정한다. 처음 듣는 사람이 문장의 뜻을 자기 말로 설명할 수 있는지, 앞 문장의 말뜻이 다음 문장으로 이어지는지 확인하고, 막히는 부분만 의미를 유지해 다시 쓴다.',
  '정상적인 한국어 띄어쓰기와 문장부호를 유지한다. 공백을 없애거나 단어를 붙이는 것은 짧게 쓰는 방법이 아니다. 분량은 전달할 정보와 설명의 양으로 조절한다.',
].join('\n')

export function groundedSpeechIssues(items, sections = {}) {
  const kinds = new Set(['unclear_meaning','topic_mismatch','unnatural_collocation','register_mismatch'])
  return (Array.isArray(items) ? items : []).filter(item => item && ['hook','body','cta'].includes(item.section)
    && typeof item.quote === 'string' && item.quote.trim().length >= 4
    && String(sections[item.section] || '').includes(item.quote.trim())
    && typeof item.reason === 'string' && item.reason.trim()
    && typeof item.plainMeaning === 'string' && item.plainMeaning.trim()
    && ['major','minor'].includes(item.severity) && kinds.has(item.kind))
    .slice(0,8).map(item=>({section:item.section,quote:item.quote.trim().slice(0,700),reason:item.reason.trim().slice(0,700),plainMeaning:item.plainMeaning.trim().slice(0,700),severity:item.severity,kind:item.kind}))
}
