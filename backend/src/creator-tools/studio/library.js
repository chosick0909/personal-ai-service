import { STORY_TEMPLATES } from './story-templates.js'

// 공식 사전: the built-in hook and story-structure formulas. Live examples come from
// analyzed success reels whose analysis uses the same categories (HOOK_TYPES / STORY_FORMATS).

export const HOOK_LIBRARY = [
  { id: 'question', type: '질문형', title: '질문으로 시작', formula: '[타깃]이라면 [고민] 해본 적 있죠?', when: '시청자가 바로 "나 얘기네" 하고 느끼게 할 때', example: '30대 지성 피부라면 오후에 번들거려서 고민한 적 있죠?' },
  { id: 'loss', type: '손실 회피', title: '손해 경고', formula: '[흔한 행동] 하고 있으면 지금 멈추세요', when: '지금 하는 습관이 손해라는 걸 알릴 때', example: '선크림을 손바닥에 비벼 바르고 있으면 지금 멈추세요' },
  { id: 'myth', type: '통념 반박', title: '다들 틀렸어요', formula: '[다들 믿는 것], 사실은 [반대]예요', when: '상식과 다른 사실로 궁금증을 만들 때', example: '비싼 선크림이 좋다? 사실은 성분표가 전부예요' },
  { id: 'result', type: '결과 먼저', title: '결론부터', formula: '[기간] 해봤더니 [결과]', when: '증거가 확실해서 결과로 끌어당길 때', example: '3주 써봤더니 하나만 남았어요' },
  { id: 'empathy', type: '공감', title: '내 얘기 같은 공감', formula: '[상황]일 때 진짜 [감정]하죠', when: '감정으로 먼저 붙잡을 때', example: '화장 다 했는데 선크림 때문에 밀릴 때 진짜 허무하죠' },
  { id: 'curiosity', type: '호기심', title: '궁금하게', formula: '[의외의 것]이 [결과]를 바꿨어요', when: '예상 밖 원인·방법을 보여줄 때', example: '선크림 바르는 순서 하나가 피부를 바꿨어요' },
  { id: 'verdict', type: '순위·평가', title: '판정', formula: '[주제] [전문가]가 안 사요/사요로 판정', when: '여러 대상을 빠르게 평가할 때', example: '선크림 3개, 피부과 실장이 안 사요/사요' },
  { id: 'survive', type: '순위·평가', title: '생존 or 사망', formula: '[제품군] 생존 or 사망', when: '여러 개를 직접 써보고 남길 것과 버릴 것을 가를 때', example: '립펜슬 생존 or 사망' },
  { id: 'compare', type: '비교', title: 'A vs B', formula: '[A] vs [B], 뭐가 나을까요?', when: '두 선택지 사이 고민을 겨냥할 때', example: '무기자차 vs 유기자차, 지성은 뭐가 나을까요?' },
  { id: 'warning', type: '경고', title: '경고', formula: '[대상]은 [행동] 절대 하지 마세요', when: '실수를 막는 정보일 때', example: '여드름 피부는 이 선크림 절대 바르지 마세요' },
  { id: 'number', type: '숫자·리스트', title: 'N가지', formula: '[타깃]을 위한 [주제] [N]가지', when: '정보를 깔끔하게 약속할 때', example: '지성 피부를 위한 선크림 고르는 기준 3가지' },
]

const BASE_STRUCTURES = [
  { id: 'problem-solution', format: '문제-해결', title: '문제 → 해결', summary: '이게 문제예요 → 이렇게 하세요', when: '시청자의 고민 하나를 콕 집어 해결할 때',
    segments: [['문제 제기', '시청자가 겪는 상황을 한 문장으로'], ['왜 그런지', '원인 한 줄'], ['해결 방법', '바로 따라 할 수 있는 행동'], ['마무리 멘트', '저장·팔로우 이유']] },
  { id: 'verdict', format: '비교·평가', title: '비교·판정', summary: '사요/안 사요, 생존/사망, A vs B, 순위', when: '제품·방법을 여러 개 빠르게 평가할 때',
    segments: [['판정 선언', '무엇을 어떤 기준으로 판정하는지(사요/안 사요, 생존/사망)'], ['판정 반복', '대상마다 판정 + 한 줄 이유'], ['기준 정리', '시청자가 스스로 고를 기준'], ['마무리 멘트', '다음 편·팔로우']] },
  { id: 'list', format: '리스트', title: 'N가지 정리', summary: '숫자가 약속이 되는 정보 정리', when: '팁·기준·실수를 여러 개 전달할 때',
    segments: [['숫자 약속', 'N가지를 알려준다고 선언'], ['항목 반복', '번호 + 핵심 + 짧은 이유'], ['가장 중요한 하나', '마지막에 강조'], ['마무리 멘트', '저장 유도']] },
  { id: 'before-after', format: '비포·애프터', title: '비포 → 애프터', summary: '변화를 먼저 보여주고 과정을 설명', when: '눈에 보이는 결과가 있을 때',
    segments: [['애프터 먼저', '결과 장면으로 시작'], ['비포 상황', '전에는 어땠는지'], ['무엇을 바꿨나', '핵심 행동 1~3개'], ['마무리 멘트', '따라 하기 권유']] },
  { id: 'myth', format: '통념 깨기', title: '통념 깨기', summary: '다들 이렇게 하는데, 틀렸어요', when: '잘못 알려진 상식을 바로잡을 때',
    segments: [['통념 제시', '다들 믿는 것'], ['반전', '사실은 다르다'], ['근거', '왜 그런지 증거 1~2개'], ['올바른 방법', '대신 이렇게'], ['마무리 멘트', '공유 유도']] },
  { id: 'story', format: '스토리텔링', title: '경험담', summary: '상황 → 위기 → 깨달음 → 조언', when: '내 경험으로 설득할 때',
    segments: [['상황', '언제 어디서 무슨 일'], ['위기', '문제가 터진 순간'], ['전환점', '무엇을 깨달았나'], ['조언', '시청자에게 남기는 한 가지'], ['마무리 멘트', '공감 댓글 유도']] },
  { id: 'tutorial', format: '튜토리얼', title: '따라 하기', summary: '단계별로 보여주는 방법', when: '과정을 그대로 보여줄 수 있을 때',
    segments: [['결과 미리보기', '완성된 모습'], ['준비', '필요한 것'], ['단계 반복', '1단계, 2단계… 짧게'], ['실수 포인트', '여기서 많이 틀려요'], ['마무리 멘트', '저장 유도']] },
  { id: 'test', format: '리뷰·후기', title: '직접 해봤습니다', summary: '실험·검증 → 결과 공개', when: '궁금한 걸 대신 해봐 줄 때',
    segments: [['실험 선언', '무엇을 왜 해보는지'], ['조건', '기간·방법'], ['과정', '중간 장면 1~2개'], ['결과', '솔직한 판정'], ['마무리 멘트', '다음 실험 예고']] },
]

// The course's 30 storytelling script templates are 전개 공식 too, each with its fill-in lines and example reels.
export const STRUCTURE_LIBRARY = [...BASE_STRUCTURES, ...STORY_TEMPLATES]

export function libraryStructure(format) {
  return STRUCTURE_LIBRARY.find(item => item.format === format) || null
}
