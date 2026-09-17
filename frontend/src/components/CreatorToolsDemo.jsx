import { createElement, useEffect, useRef, useState } from 'react'
import { Search, TrendingUp, Link, Scissors, MessageSquare, ArrowRight, ArrowLeft, Bookmark, RotateCcw, Check, Upload, Send, X, LayoutDashboard, Target, Plus, CalendarDays, ListChecks, FileText, ChevronRight, Sun, Moon, Copy } from 'lucide-react'
import logo from '../Logo_1.webp'
import DemoVideoEditor from './DemoVideoEditor'
import './CreatorTools.css'
import './CreatorToolsDemo.css'

const tabs = [
  ['accounts', '계정 인사이트', Search], ['keywords', '트렌드 키워드', TrendingUp], ['link', '링크 분석', Link],
  ['video', '컷편집·자막', Scissors], ['feedback', '콘텐츠 피드백', MessageSquare],
]
const titles = { accounts: '내 주제에 맞는 계정 인사이트', keywords: '다음 콘텐츠의 키워드 찾기', link: '릴스 원문 대본 추출', video: '영상은 간결하게, 자막은 정확하게', feedback: '게시 전, 한 번 더 완성도 높이기' }
const keywords = [['책상정리','수납 전후 비교',18200,32],['공간활용','작은 공간의 변화',24600,24],['자취꿀팁','오늘 바로 쓰는 팁',58400,18],['미니멀라이프','비우는 기준',32700,12]]
const accounts = [['공간을 바꾸는 하루','정리·수납','전후 비교로 변화가 명확한 구성',96],['작은 집의 기록','자취·라이프','작은 공간이라는 타깃 고민에 집중',92],['오늘의 살림 노트','살림·정보','짧은 실행 팁과 저장 유도 구성',89]]
const scriptFor = kind => ({
  hook: kind === 'A' ? '책상 정리, 수납함부터 사면 돈도 공간도 낭비할 수 있어요.' : kind === 'B' ? '정리의 시작은 수납함을 늘리는 게 아니라, 물건이 돌아갈 자리를 정하는 거예요.' : '퇴근하고 책상 앞에 앉았는데, 노트북 놓을 자리부터 치우고 있나요?',
  body: '먼저 매일 쓰는 물건과 가끔 쓰는 물건을 나눠보세요. 자주 쓰는 물건은 손이 닿는 곳에, 가끔 쓰는 물건은 서랍 안에 둡니다. 다음은 충전선이에요. 사용하는 기기 옆에 고정하면 바닥에서 다시 찾지 않아도 됩니다. 마지막으로 책상 위에 작은 빈 공간을 남겨두세요. 새로운 물건이 들어올 때 어디에 둘지 정하기가 쉬워집니다.',
  cta: '오늘은 책상 위 물건 세 개만 제자리로 돌려놓아 보세요. 다시 볼 수 있게 저장해두세요.',
})
const initialCues = ['책상 정리, 수납함부터 사기 전에', '매일 쓰는 물건부터 나눠보세요.', '충전선은 사용하는 기기 옆에 고정해요.', '책상 위에는 작은 빈 공간을 남겨두세요.']
const ideas = [
  ['문제 해결', '수납함 사기 전 확인할 3가지', '저장 유도', '정보 → 신뢰'],
  ['제품 비교', '같은 책상, 다른 수납 도구', '제품 관심', '비교 → 구매 검토'],
  ['경험 공유', '퇴근 후 5분 책상 리셋 루틴', '댓글 유도', '공감 → 관계'],
  ['통념 반박', '책상이 좁아서 정리가 안 될까?', '신규 유입', '호기심 → 팔로우'],
  ['체크리스트', '작은 방을 넓게 쓰는 배치 기준', '프로필 방문', '정보 → 상담'],
]
const toolNotes = ['주제·타깃별 공개 계정 분석', '넓은 키워드에서 기획까지', '원문 추출·한국어 해석', '삭제 구간과 자막 직접 편집', '영상·캡션의 개선점 확인']
const themeStorageKey = 'hookai-tools-demo-theme'

export default function CreatorToolsDemo() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(themeStorageKey) === 'light' ? 'light' : 'dark' }
    catch { return 'dark' }
  })
  useEffect(() => {
    try { localStorage.setItem(themeStorageKey, theme) }
    catch { /* Theme switching remains available when storage is blocked. */ }
  }, [theme])
  const [mode, setMode] = useState('accounts')
  const [videoDetailed, setVideoDetailed] = useState(false)
  const [step, setStep] = useState('input')
  const [topic, setTopic] = useState('작은 자취방 책상 정리')
  const [target, setTarget] = useState('첫 자취를 시작한 20~30대 직장인')
  const [url, setUrl] = useState('https://www.instagram.com/reel/demo-example/')
  const [saved, setSaved] = useState([])
  const [selected, setSelected] = useState(null)
  const [minCount, setMinCount] = useState(true)
  const [sort, setSort] = useState('growth')
  const [video, setVideo] = useState(null)
  const [cues] = useState(initialCues)
  const [draft, setDraft] = useState(scriptFor('A'))
  const [request, setRequest] = useState('말투를 반말로 바꿔줘')
  const [proposal, setProposal] = useState(null)
  const [caption, setCaption] = useState('작은 책상도 넓게 쓰는 정리 습관. 여러분의 책상은 어떤가요?')
  const [toast, setToast] = useState('')
  const [goal, setGoal] = useState('브랜드 협업')
  const [ideaFilter, setIdeaFilter] = useState('전체')
  const [board, setBoard] = useState([{ title: '책상 정리 전후 비교', status: '기획' }, { title: '자취방 수납 루틴', status: '촬영' }])
  const [activeView, setActiveView] = useState('tools')
  const [checks, setChecks] = useState([false, false, false, false])
  const timer = useRef(null)
  const toastTimer = useRef(null)
  const objectUrl = useRef(null)
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(toastTimer.current); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current) }, [])
  useEffect(() => {
    if (selected === null) return
    const previous = document.activeElement
    const dialog = document.querySelector('.demo-modal')
    const buttons = [...dialog.querySelectorAll('button')]
    buttons[0]?.focus()
    function onKey(event) {
      if (event.key === 'Escape') setSelected(null)
      if (event.key === 'Tab') {
        const first = buttons[0], last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus() }
  }, [selected])
  function notify(text) { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 2500) }
  function navigate(next) { clearTimeout(timer.current); setVideoDetailed(false); setActiveView('tools'); setMode(next); setStep('input'); setSelected(null); setProposal(null) }
  function addIdea(title) { setBoard(items=>items.some(item=>item.title===title)?items:[...items,{title,status:'기획'}]); notify('제작 보드에 담았습니다.') }
  function run(next = 'results') { clearTimeout(timer.current); setStep('loading'); timer.current = setTimeout(() => setStep(next), 1000) }
  function selectVideo(file) { if (!file) return; if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = URL.createObjectURL(file); setVideo({ name: file.name, url: objectUrl.current }) }
  function download() { const text = cues.map((cue, i) => `${i+1}\n00:00:${String(i*5).padStart(2,'0')},000 --> 00:00:${String(i*5+4).padStart(2,'0')},000\n${cue}\n`).join('\n'); const blobUrl=URL.createObjectURL(new Blob([text], {type:'text/plain;charset=utf-8'})); const a=document.createElement('a'); a.href=blobUrl;a.download='HookAI-demo-subtitles.srt';a.click();setTimeout(()=>URL.revokeObjectURL(blobUrl),1000) }
  const field = (label, value, setter, multiline=false) => <label className="ct-field"><span>{label}</span>{multiline ? <textarea value={value} onChange={e=>setter(e.target.value)} required /> : <input value={value} onChange={e=>setter(e.target.value)} required />}</label>
  const upload = <label className="ct-upload"><Upload size={30}/><strong>{video?.name || '영상 파일 선택'}</strong><span>파일 없이도 예시로 시연할 수 있습니다</span><input aria-label="영상 선택" type="file" accept="video/*" onChange={e=>selectVideo(e.target.files[0])}/></label>
  return <main className={`creator-tools demo-tools${activeView==='tools'&&mode==='video'&&step==='results'&&videoDetailed?' demo-video-editing':''}${mode==='video'&&step==='results'?' demo-video-workspace':''}`} data-theme={theme}>
    <div className="ct-topbar"><a className="ct-brand" href="/tools/demo"><img src={logo} alt=""/>HookAI <span>CREATOR WORKSPACE</span></a><div className="ct-row demo-top-actions"><span className="ct-badge">PREVIEW · 예시 데이터</span><span className="demo-user">크리에이터 L</span><button type="button" className="ct-icon demo-theme-toggle" role="switch" aria-checked={theme === 'light'} aria-label="라이트 모드" title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'} onClick={()=>setTheme(current=>current==='dark'?'light':'dark')}>{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button></div></div>
    <aside className="demo-sidebar"><p className="demo-nav-label">WORKSPACE</p><button aria-current={activeView==='tools'?'page':undefined} onClick={()=>setActiveView('tools')}><LayoutDashboard size={18}/>크리에이터 스튜디오</button><button aria-current={activeView==='board'?'page':undefined} onClick={()=>{clearTimeout(timer.current);setActiveView('board')}}><CalendarDays size={18}/>제작 보드<span>{board.length}</span></button><div className="demo-nav-divider"/><p className="demo-nav-label">CREATOR TOOLS</p>{tabs.map(([id,label,ToolIcon])=><button key={id} aria-current={activeView==='tools'&&mode===id?'page':undefined} onClick={()=>navigate(id)}>{createElement(ToolIcon,{size:17})}{label}</button>)}<div className="demo-sidebar-bottom"><Target size={18}/><strong>나의 수익화 목표</strong><select aria-label="수익화 목표" value={goal} onChange={e=>setGoal(e.target.value)}><option>브랜드 협업</option><option>상품 판매</option><option>강의·상담 전환</option><option>팔로워 성장</option></select><small>이번 콘텐츠의 방향을 정해보세요</small></div></aside>
    <div className="ct-workspace">
      <div className="demo-banner">미팅용 미리보기 · 계정과 통계는 예시입니다. 실제 분석·전송·영상 렌더링은 실행되지 않으며 입력은 새로고침 시 초기화됩니다.</div>
      <header className="ct-header"><div><div className="ct-eyebrow">WORKSPACE / CREATOR STUDIO</div><h1>{activeView==='board'?'제작 보드':'크리에이터 스튜디오'}</h1><p>콘텐츠 인사이트부터 영상 편집과 게시 전 점검까지.</p></div><button className="ct-primary" onClick={()=>navigate('link')}><Plus size={17}/>새 작업</button></header>
      <div className="demo-metrics"><div><span>이번 작업 목표</span><strong>{goal}</strong><small>콘텐츠 → 신뢰 → 전환</small></div><div><span>저장한 계정 인사이트</span><strong>{saved.length}<small>개</small></strong><small>분석한 계정 모아보기</small></div><div><span>제작할 콘텐츠</span><strong>{board.length}<small>개</small></strong><button onClick={()=>setActiveView('board')}>제작 보드 열기<ChevronRight size={13}/></button></div><div><span>현재 작업 주제</span><strong className="demo-metric-topic">{topic}</strong><small>예시 소재 · 정리 / 라이프스타일</small></div></div>
      {activeView==='board' ? <section className="demo-board"><div className="ct-section-heading"><h2>콘텐츠 제작 현황</h2><button onClick={()=>addIdea(topic)}><Plus size={16}/>현재 주제 추가</button></div><div className="ct-table-scroll"><table className="ct-table"><thead><tr><th>콘텐츠</th><th>목표</th><th>진행 상태</th><th>다음 작업</th></tr></thead><tbody>{board.map((item,i)=><tr key={item.title}><th>{item.title}</th><td>{goal}</td><td><select aria-label={`${item.title} 진행 상태`} value={item.status} onChange={e=>setBoard(items=>items.map((v,n)=>n===i?{...v,status:e.target.value}:v))}><option>기획</option><option>촬영</option><option>편집</option><option>게시 준비</option></select></td><td><button onClick={()=>{setTopic(item.title);navigate('link');setStep('drafts')}}>대본 열기<ArrowRight size={15}/></button></td></tr>)}</tbody></table></div></section> : <>
      <nav className="ct-tabs demo-tabs" aria-label="신기능">{tabs.map(([id,label,ToolIcon],i)=><button key={id} aria-current={mode===id?'page':undefined} onClick={()=>navigate(id)}>{createElement(ToolIcon,{size:21})}<strong>{label}</strong><small>{toolNotes[i]}</small></button>)}</nav>
      <div className="demo-work-heading"><div><span className="ct-badge">{tabs.find(t=>t[0]===mode)[1]}</span><h2>{titles[mode]}</h2></div><span className="ct-muted">{goal} · Instagram Reels</span></div>
      <div className="demo-work-layout"><div className="demo-main-flow">
      <div className="ct-section-heading"><h2>{step==='editor' ? '대본 수정' : step==='input' ? '콘텐츠 조건' : step==='loading' ? '처리 흐름' : '결과 확인'}</h2><button className="ct-icon" title="현재 시연 처음으로" aria-label="현재 시연 처음으로" onClick={()=>navigate(mode)}><RotateCcw size={16}/></button></div>
      {step==='input' && <form className="ct-form" onSubmit={e=>{e.preventDefault();run()}}>
        {mode!=='video' && field('이번 콘텐츠 주제',topic,setTopic,true)}
        {['accounts','keywords'].includes(mode) && <div className="ct-fields">{field('핵심 타깃',target,setTarget)}<label className="ct-field"><span>목적</span><select><option>정보 전달</option><option>제품 판매</option><option>브랜딩</option></select></label><label className="ct-field"><span>지역</span><select><option>대한민국</option><option>일본</option><option>미국</option></select></label></div>}
        {mode==='link' && field('인스타그램 영상 링크',url,setUrl)}
        {['video','feedback'].includes(mode) && upload}
        {mode==='feedback' && field('캡션',caption,setCaption,true)}
        <div className="ct-form-footer"><span className="ct-muted">입력은 이 화면에서만 사용됩니다 · 예시 결과</span><button className="ct-primary" type="submit">{mode==='video'?'편집 시작':mode==='feedback'?'피드백 보기':'결과 보기'}<ArrowRight size={17}/></button></div>
      </form>}
      {step==='loading' && <div className="demo-loading" role="status"><RefreshIcon/><h2>시연 결과를 준비하고 있습니다</h2><p className="ct-muted">입력 확인 → 예시 결과 구성 → 작업 화면</p></div>}
      {step==='results' && <>
        {mode==='accounts' && <><p className="ct-muted">{topic} · {target} / 가상 계정 3개</p><div className="demo-grid">{accounts.map(([name,cat,reason,score],i)=><article className="demo-card" key={name}><div className={`demo-avatar tone-${i}`}>{i+1}</div><span className="ct-badge">{cat}</span><h2>{name}</h2><p>{reason}</p><div className="demo-score"><span>예시 적합도</span><strong>{score}%</strong></div><progress max="100" value={score}/><div className="ct-row"><button onClick={()=>setSelected(i)}>분석 근거<ArrowRight size={15}/></button><button className="ct-icon" title="인사이트 계정 저장" aria-label={`인사이트 계정 ${i+1} 저장`} aria-pressed={saved.includes(i)} onClick={()=>setSaved(s=>s.includes(i)?s.filter(v=>v!==i):[...s,i])}><Bookmark size={17}/></button></div></article>)}</div></>}
        {mode==='keywords' && <><div className="demo-filter"><label><input type="checkbox" checked={minCount} onChange={e=>setMinCount(e.target.checked)}/>게시물 5,000개 이상</label><select aria-label="키워드 정렬" value={sort} onChange={e=>setSort(e.target.value)}><option value="growth">증가율 순</option><option value="count">게시물 수 순</option></select><span className="ct-badge">모든 수치는 예시</span></div><div className="ct-table-scroll"><table className="ct-table"><thead><tr><th>키워드</th><th>콘텐츠 방향</th><th>예시 게시물 수</th><th>예시 증가율</th><th>다음 작업</th></tr></thead><tbody>{[...keywords,...(!minCount?[['데스크루틴','정리 습관',3200,8]]:[])].sort((a,b)=>b[sort==='count'?2:3]-a[sort==='count'?2:3]).map(([word,angle,count,growth])=><tr key={word}><th>#{word}</th><td>{angle}</td><td>{count.toLocaleString()}</td><td className="demo-positive">+{growth}%</td><td><button onClick={()=>{setTopic(word);setMode('link');run('drafts')}}>내 주제로 기획하기<ArrowRight size={15}/></button></td></tr>)}</tbody></table></div></>}
        {mode==='link' && <><div className="ct-section-heading"><h2>원문과 한국어 해석</h2><span className="ct-badge">영어 → 한국어 · 예시</span></div><div className="demo-grid two"><article className="demo-card"><div className="ct-section-heading"><h3>원문 대본</h3><button aria-label="예시 원문 복사" onClick={()=>{void navigator.clipboard?.writeText('Before buying more storage boxes, give each item a home. Keep everyday items close, fix your charging cable in place, and leave a little empty space on your desk.');notify('원문을 복사했습니다.')}}><Copy size={15}/>복사</button></div><p>Before buying more storage boxes, give each item a home. Keep everyday items close, fix your charging cable in place, and leave a little empty space on your desk.</p></article><article className="demo-card"><div className="ct-section-heading"><h3>한국어 해석</h3><button aria-label="예시 한국어 해석 복사" onClick={()=>{void navigator.clipboard?.writeText('수납함을 더 사기 전에 물건마다 자리를 정해보세요. 매일 쓰는 물건은 가까이 두고, 충전선을 고정하고, 책상 위에 작은 빈 공간을 남겨두세요.');notify('한국어 해석을 복사했습니다.')}}><Copy size={15}/>복사</button></div><p>수납함을 더 사기 전에 물건마다 자리를 정해보세요. 매일 쓰는 물건은 가까이 두고, 충전선을 고정하고, 책상 위에 작은 빈 공간을 남겨두세요.</p></article></div><div className="ct-form-footer"><span className="ct-muted">입력한 링크를 실제 수집하지 않은 예시입니다.</span><button onClick={()=>navigate('link')}><RotateCcw size={16}/>다른 링크 추출</button></div></>}
        {mode==='video' && <DemoVideoEditor initialVideo={video} onDetailChange={setVideoDetailed}/>}
        {mode==='feedback' && <><div className="demo-summary"><MessageSquare size={25}/><div><h2>실행 정보를 앞쪽으로 당겨보세요</h2><p>영상·캡션 분석 결과의 예시입니다. 실제 파일은 분석하지 않았습니다.</p></div></div>{[['00:00–00:03','후킹','도입 설명보다 시청자가 겪는 상황을 먼저 제시합니다.','노트북을 놓기 전에 책상부터 치우고 있나요?'],['00:05–00:10','정보 연결','정리 방법과 그 이유를 한 문장으로 연결합니다.','매일 쓰는 물건은 가까이 두세요. 꺼내고 되돌려 놓기가 쉬워집니다.'],['캡션','행동 유도','영상에서 소개한 행동을 댓글 질문과 연결합니다.','여러분의 책상에서 가장 자주 사라지는 물건은 무엇인가요?']].map(([time,kind,reason,example])=><article className="demo-feedback" key={kind}><span className="ct-badge">{time}</span><h3>{kind}</h3><p>{reason}</p><blockquote>{example}</blockquote><button onClick={()=>{setDraft({...scriptFor('C'),hook:example});setStep('editor')}}>수정 예시로 대본 열기<ArrowRight size={15}/></button></article>)}</>}
      </>}
      {step==='drafts' && <><p className="ct-muted">{topic} / 책상 정리 소재로 구성한 예시 A/B/C입니다.</p><div className="demo-grid">{['A','B','C'].map((k,i)=><article className="demo-card" key={k}><span className="ct-badge">{k}안</span><h2>{['손실 회피형','통념 반박형','공감 스토리형'][i]}</h2><p>{scriptFor(k).hook}</p><details><summary>전체 대본</summary><p>{scriptFor(k).body}</p><p>{scriptFor(k).cta}</p></details><button className="ct-primary" onClick={()=>{setDraft(scriptFor(k));setStep('editor')}}>{k}안 사용하기<ArrowRight size={15}/></button></article>)}</div></>}
      {step==='editor' && <div className="demo-grid two"><section className="demo-card"><h2>대본 에디터</h2>{Object.entries(draft).map(([key,value])=><label className="ct-field" key={key}><span>{key.toUpperCase()}</span><textarea aria-label={key.toUpperCase()} value={value} onChange={e=>{setDraft(d=>({...d,[key]:e.target.value}));setProposal(null)}}/></label>)}<button onClick={()=>notify('시연 화면에 수정 내용이 유지됩니다.')}><Check size={16}/>수정 확인</button></section><section className="demo-card"><h2>코파일럿 수정 흐름</h2><p className="ct-muted">아래 예시 요청을 선택하거나 직접 입력해 미리보기와 적용 과정을 시연하세요. 응답은 준비된 예시입니다.</p><div className="ct-row">{['말투를 반말로 바꿔줘','마지막 문장만 바꿔줘'].map(v=><button key={v} onClick={()=>setRequest(v)}>{v}</button>)}</div>{field('수정 요청',request,setRequest,true)}<button className="ct-primary" onClick={()=>setProposal({...draft,cta:request.includes('반말')?'오늘은 책상 위 물건 세 개만 제자리에 놓아봐. 다시 보고 싶으면 저장해둬.':'오늘 정리할 물건 하나를 댓글로 남겨주세요.'})}>수정 미리보기<Send size={16}/></button>{proposal && <div className="demo-proposal"><span className="ct-badge">적용 전 · 예시 CTA 수정</span><p>{proposal.cta}</p><button onClick={()=>{setDraft(proposal);setProposal(null);notify('미리보기의 문장이 에디터에 적용됐습니다.')}}><Check size={16}/>이 수정 적용</button></div>}</section></div>}
      {step==='export' && <div className="demo-card demo-complete"><Check size={38}/><h2>편집 결과 전달 화면</h2><p>MP4 영상 + SRT 자막 + 원본 파일을 전달하는 구성입니다.</p><p className="ct-muted">이 시연에서는 영상을 렌더링하지 않습니다. 편집한 예시 자막은 SRT로 내려받을 수 있습니다.</p><button className="ct-primary" onClick={download}>예시 SRT 다운로드</button><button onClick={()=>setStep('results')}>편집으로 돌아가기</button></div>}
      {step!=='input' && step!=='loading' && <button className="demo-return" onClick={()=>{setStep('input');setProposal(null)}}><ArrowLeft size={16}/>입력으로 돌아가기</button>}
      </div><aside className="demo-insights"><section><div className="ct-section-heading"><h2><TrendingUp size={17}/>콘텐츠 아이디어</h2><span className="ct-badge">예시</span></div><div className="demo-idea-tabs" role="group" aria-label="아이디어 필터">{['전체','저장 유도','제품 관심'].map(v=><button key={v} aria-pressed={ideaFilter===v} onClick={()=>setIdeaFilter(v)}>{v}</button>)}</div>{ideas.filter(item=>ideaFilter==='전체'||item[2]===ideaFilter).map(([kind,title,cta,path])=><div className="demo-idea" key={title}><div><span className="demo-idea-kind">{kind}</span><small>{cta}</small></div><button className="demo-idea-title" onClick={()=>{setTopic(title);navigate('link');setStep('drafts')}}>{title}<ArrowRight size={14}/></button><footer><span>{path}</span><button className="ct-icon" title="제작 보드에 담기" aria-label={`${title} 보드에 담기`} onClick={()=>addIdea(title)}><Plus size={15}/></button></footer></div>)}</section><section><div className="ct-section-heading"><h2><ListChecks size={17}/>게시 전 체크</h2><span className="ct-muted">{checks.filter(Boolean).length}/4</span></div>{['첫 3초에 타깃의 고민이 드러나나요?','제품·방법의 장점을 구체적으로 보여주나요?','영상과 캡션의 메시지가 일치하나요?','저장·프로필 방문 등 다음 행동이 있나요?'].map((label,i)=><label className="demo-check" key={label}><input type="checkbox" checked={checks[i]} onChange={e=>setChecks(items=>items.map((v,n)=>i===n?e.target.checked:v))}/>{label}</label>)}<button className="demo-wide" onClick={()=>navigate('feedback')}>영상·캡션 피드백 받기<ArrowRight size={15}/></button></section><section className="demo-next"><FileText size={20}/><h3>이번 콘텐츠의 전환 목표</h3><p>{goal==='브랜드 협업'?'제품의 특징과 실제 사용 장면이 자연스럽게 이어지는 콘텐츠를 기획해보세요.':goal==='상품 판매'?'시청자의 구매 전 고민을 먼저 풀고, 제품을 확인할 경로를 연결하세요.':goal==='강의·상담 전환'?'실행 가능한 팁으로 신뢰를 만든 뒤, 더 구체적인 상담으로 연결하세요.':'반복해서 보고 싶은 주제를 시리즈로 기획하고 팔로우할 이유를 남겨보세요.'}</p><button onClick={()=>{navigate('link');setStep('drafts')}}>새 대본 작성하기<ArrowRight size={15}/></button></section></aside></div></>}
      {selected!==null && <div className="demo-modal-backdrop" onClick={()=>setSelected(null)}><section className="demo-card demo-modal" role="dialog" aria-modal="true" aria-label="계정 인사이트 설명" onClick={e=>e.stopPropagation()}><button className="ct-icon" aria-label="닫기" onClick={()=>setSelected(null)}><X size={18}/></button><span className="ct-badge">가상 계정 · 예시 분석</span><h2>{accounts[selected][0]}</h2><p>{accounts[selected][2]}</p><h3>기획 포인트 살펴보기</h3><p>도입부의 정보 제시 방식, 본문의 전달 순서, 시청자에게 제안하는 행동을 구분해 살펴봅니다.</p><button onClick={()=>{setSelected(null);setMode('link');setStep('drafts')}}>내 주제로 기획안 만들기<ArrowRight size={16}/></button></section></div>}
    </div>{toast && <div className="demo-toast" role="status">{toast}</div>}
  </main>
}
function RefreshIcon() { return <RotateCcw className="demo-spin" size={32}/> }
