// Cover-copy principles 훅ai picks from when it writes thumbnail titles.
// Distilled from 『꽂히는 글쓰기』 and the client's 인캠 course materials, written as working principles
// (no sample sentences: the model copies examples). `hint` is what the student sees next to the option.
export const COVER_PRINCIPLES = [
  { name: '결과 약속', hint: '끝까지 보면 얻는 결과를 제목에 먼저 내걸었어요',
    how: '이 영상을 본 사람이 얻는 결과·변화를 판매자 시점이 아니라 시청자 시점으로 약속합니다. 결과는 brief에 근거가 있는 것만.' },
  { name: '궁금증 열기', hint: '답이 영상 안에 있어서 눌러봐야 알 수 있게 열어뒀어요',
    how: '답을 알려면 영상을 봐야 하는 열린 질문이나 끝나지 않은 말로 엽니다. 예/아니오로 끝나는 질문은 쓰지 않습니다. 영상이 실제로 그 답을 줘야 합니다.' },
  { name: '내 얘기 장면', hint: '시청자가 실제로 겪는 순간을 꺼내서 "내 얘기네" 하게 만들었어요',
    how: '이 소재를 쓰거나 살 사람이 그 문제를 느끼는 구체적인 생활 순간 하나를 그대로 꺼냅니다. 조언·교훈이 아니라 장면.' },
  { name: '손해 짚기', hint: '모르면 손해 보는 지점을 짚어서 그냥 넘기기 어렵게 했어요',
    how: '시청자가 지금 하고 있을 법한 행동이나 선택에서 생기는 손해·실수를 짚습니다. 겁주기·과장 없이, brief의 사실로 설명되는 손해만.' },
  { name: '대상 콕 집기', hint: '누구를 위한 영상인지 불러 세워서 해당되는 사람이 멈추게 했어요',
    how: '이 영상이 꼭 필요한 사람의 상황이나 조건을 콕 집어 부릅니다. 넓은 집단보다 좁고 구체적인 상황일수록 좋습니다.' },
  { name: '전후 대비', hint: '바뀌기 전과 후를 나란히 놓아 차이가 한눈에 보이게 했어요',
    how: '이전 상태와 이후 상태를 대비시켜 변화를 보여줍니다. 두 상태 모두 brief에 근거가 있어야 합니다.' },
  { name: '통념 뒤집기', hint: '다들 당연하게 믿는 것을 뒤집어서 이유가 궁금해지게 했어요',
    how: '시청자가 흔히 믿는 생각과 다른 사실을 제시합니다. 뒤집는 내용이 brief로 뒷받침될 때만 씁니다.' },
  { name: '핵심 한 줄', hint: "'꾸미는 말 + 핵심 단어 + 끝맺는 말'을 한 문장으로 이어 한눈에 읽히게 했어요",
    how: '시청자가 얻는 이득을 꾸미는 말로, 영상의 핵심 단어(시청자가 실제로 검색할 말)를 가운데, 무엇을 주는지(방법·정리·N가지 등)로 끝맺습니다. 세 부분은 쉼표로 나열하지 않고 자연스러운 한 구절로 잇습니다. 숫자는 영상이 실제로 다루는 개수일 때만.' },
]
export const COVER_PRINCIPLE_NAMES = COVER_PRINCIPLES.map(p => p.name)
export const coverHint = name => COVER_PRINCIPLES.find(p => p.name === name)?.hint || ''
