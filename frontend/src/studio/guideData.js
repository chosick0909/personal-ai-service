import { safeGetStorageItem, safeSetStorageItem } from '../lib/safeStorage'

// ---------- 업그레이드 안내 팝업 ----------
// Left: a looping recording of the real screen. Right: what the feature does, in a student's words.
export const WHATS_NEW = [
  // First page for students who knew the old studio: they are in the right place, and nothing they used is gone.
  { welcome: true, seconds: 15, badge: '먼저 안심하세요', title: '잘못 들어오신 거 아니에요! 😊', body: '화면이 확 달라져서 깜짝 놀라셨죠? 여기는 늘 쓰시던 그 훅ai가 맞아요. 쓰시던 기능은 하나도 사라지지 않았고, 더 쉽고 더 똑똑하게 업그레이드됐어요.',
    moves: [['대본작업실', '내 기획안 · 훅ai와 대화하며 대본부터 캡션까지'], ['링크 분석', '내 레퍼런스 · 링크를 넣으면 바로 분석'], ['계정 추천', '영감 찾기 · 요즘 터진 영상을 매일 모아 보기'], ['영상 편집', '영상 편집 · 컷 편집과 자막이 더 편해졌어요']] },
  { media: '/studio-guide/slide-reels.mp4', badge: '영감 찾기', title: '터진 영상이\n매일 쌓여요', body: '최근 3개월 안에 50만 이상 나온 영상을 매일 모아요. 강사진이 고른 영상에는 ‘추천’이 붙어요. 분야·정렬·얼굴 노출로 골라 보세요.' },
  { media: '/studio-guide/slide-analysis.mp4', badge: '레퍼런스 분석', title: '왜 터졌는지\n한눈에 보여줘요', body: '분석하기 한 번이면 첫 문장·전개·촬영/편집·캡션까지 나눠서 정리해요. 마음에 드는 건 ‘내 공식’으로 저장해 두세요.' },
  { media: '/studio-guide/slide-plan.mp4', badge: '내 기획안', title: '훅ai와 함께\n기획안을 완성해요', body: '하고 싶은 말만 적으면 썸네일 카피 → 첫 문장 → 대본 → 촬영·편집 → 캡션까지 단계별로 같이 만들어요. 완성본은 PDF로 받아요.' },
  { media: '/studio-guide/slide-script.mp4', badge: '대본 편집', title: '고치면 바로\n저장되고 길이도 계산돼요', body: '문장을 눌러 바로 고치면 예상 길이가 다시 계산돼요. “더 짧게”처럼 훅ai에게 말로 부탁해도 되고, 예전 버전은 저장 내역에서 불러올 수 있어요.' },
  { media: '/studio-guide/slide-tools.mp4', badge: '내 공식 · 내 말투', title: '내 방식대로\n쌓아 가세요', body: '저장한 공식은 다음 기획안에 바로 쓰고, 공식 사전에서 터진 영상의 공식을 배워요. 내 말투를 알려주면 훅ai가 그 말투로 써요.' },
]
// The popup comes back on every visit; '24시간 동안 보지 않기' stores until when it stays away.
export const POPUP_KEY = 'hookai-studio-whatsnew-until'
export const popupHidden = () => Number(safeGetStorageItem(POPUP_KEY)) > Date.now()

// ---------- 처음 오면 순서대로 짚어주는 둘러보기 ----------
// Each step points at a real element (data-tour) and says what it is for; steps whose element is not on screen are skipped.
export const TOUR_STEPS = [
  { target: 'reels', title: '① 영감 찾기', body: '매일 모으는 터진 영상이에요. 여기서 마음에 드는 영상을 찾는 것부터 시작해요.' },
  { target: 'reel-card', title: '② 영상 카드', body: '카드에 마우스를 올리면 영상이 재생되고 ‘분석하기’ 버튼이 나와요. 누르면 크게 볼 수 있어요.' },
  { target: 'ideas', title: '③ 주제 찾기', body: '훅ai와 편하게 대화하며 찍을 수 있을 만큼 구체적인 주제를 찾아요. 마음에 드는 주제는 보관함에 저장해 두고, 기획안을 만들 때 꺼내 쓰세요.' },
  { target: 'references', title: '④ 내 레퍼런스', body: '분석한 영상이 자동으로 모여요. 인스타 링크·영상·대본을 직접 추가할 수도 있어요.' },
  { target: 'new', title: '⑤ 내 기획안 만들기', body: '레퍼런스를 고르고 하고 싶은 말을 적으면, 훅ai와 함께 썸네일부터 캡션까지 만들어요.' },
  { target: 'plans', title: '⑥ 내 기획안', body: '만들던 기획안이 여기 저장돼요. 중간에 나가도 그 자리에서 이어서 할 수 있어요.' },
  { target: 'formulas', title: '⑦ 내 공식', body: '분석 결과에서 저장한 첫 문장·전개·캡션 공식이 모여요. 다음 기획안에 바로 써요.' },
  { target: 'library', title: '⑧ 공식 사전', body: '터진 영상이 쓰는 공식을 유형별로 모아 뒀어요. 예시와 함께 배울 수 있어요.' },
  { target: 'edit', title: '⑨ 영상 편집', body: '찍은 영상을 올리면 훅ai가 고칠 점을 알려주고, 말한 문장 단위로 잘라 자막까지 넣은 완성 영상을 만들어요.' },
  { target: 'style', title: '⑩ 내 말투', body: '평소 말투를 알려주면 훅ai가 그 말투로 대본을 써요. 비워두면 훅ai가 알아서 해요.' },
  { target: 'manual', title: '⑪ 사용 설명서', body: '둘러보기는 여기까지예요! 🎉 쓰다가 헷갈리면 언제든 이 ‘사용 설명서’를 누르세요. 화면 사진과 번호로 하나씩 따라 할 수 있어요. 바로 아래 ‘1:1 문의’로 물어보셔도 돼요.' },
]
export const TOUR_KEY = 'hookai-studio-tour-v1'
export const tourDone = () => safeGetStorageItem(TOUR_KEY) === 'done'

export const hidePopupForADay = () => safeSetStorageItem(POPUP_KEY, String(Date.now() + 24 * 3600000))
export const markTourDone = () => safeSetStorageItem(TOUR_KEY, 'done')
