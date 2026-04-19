import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppState } from '../store/AppState'

function IconDots() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 text-[#8E97A6]">
      <circle cx="3.2" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12.8" cy="8" r="1.2" fill="currentColor" />
    </svg>
  )
}

function IconPencil() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 text-[#D1D5DB]">
      <path
        d="M10.98 1.8a1.8 1.8 0 0 1 2.55 2.55L6.2 11.67 3 12.3l.63-3.2L10.98 1.8Zm1 1 1.2 1.2M4.45 9.74l1.8 1.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconMove() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 text-[#D1D5DB]">
      <path
        d="M2.2 3.6h4l1 1.3h6.6c.9 0 1.6.7 1.6 1.6v4.6c0 .9-.7 1.6-1.6 1.6H2.2a1.6 1.6 0 0 1-1.6-1.6V5.2c0-.9.7-1.6 1.6-1.6Zm6.4 3.2h4.2m0 0-1.4-1.4m1.4 1.4-1.4 1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 text-[#8E97A6]">
      <path
        d="M7 2.2a4.8 4.8 0 1 0 0 9.6a4.8 4.8 0 0 0 0-9.6Zm0-1.4a6.2 6.2 0 1 1 0 12.4a6.2 6.2 0 0 1 0-12.4Zm7.01 12.02-2.7-2.7 1-1 2.7 2.7-1 1Z"
        fill="currentColor"
      />
    </svg>
  )
}

function IconFolder() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 text-[#AEB6C5]">
      <path
        d="M1.8 3.3h4l1.05 1.4h7.35c.99 0 1.8.8 1.8 1.8v5c0 .99-.81 1.8-1.8 1.8H1.8A1.8 1.8 0 0 1 0 11.5v-6.4c0-1 .81-1.8 1.8-1.8Zm0 1.4a.4.4 0 0 0-.4.4v6.4c0 .22.18.4.4.4h12.4a.4.4 0 0 0 .4-.4v-5a.4.4 0 0 0-.4-.4H6.15l-1.05-1.4H1.8Z"
        fill="currentColor"
      />
    </svg>
  )
}

function IconFile() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 text-[#8E97A6]">
      <path
        d="M3 1.5h6.2l3.3 3.3v9.7H3a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Zm0 1.4a.6.6 0 0 0-.6.6v9a.6.6 0 0 0 .6.6h8.1V5.38L8.62 2.9H3Z"
        fill="currentColor"
      />
    </svg>
  )
}

function IconChatBubble() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 text-[#D1D5DB]">
      <path
        d="M8 2C4.13 2 1 4.63 1 7.86c0 1.48.66 2.83 1.76 3.86L2.1 14l2.6-1.17c.98.32 2.05.5 3.3.5 3.87 0 7-2.63 7-5.87C15 4.63 11.87 2 8 2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Row({ children, onClick, active = false, muted = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-10 w-full items-center gap-2 rounded-[10px] px-3 text-left text-sm transition ${
        active
          ? 'bg-[#2B313D] text-[#F3F4F6]'
          : muted
            ? 'text-[#8E97A6] hover:bg-[#232833]'
            : 'text-[#E5E7EB] hover:bg-[#232833]'
      }`}
    >
      {children}
    </button>
  )
}

function normalizeSearchText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[._-]+/g, '')
    .trim()
}

export default function Sidebar() {
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isAccountSwitchOpen, setIsAccountSwitchOpen] = useState(false)
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false)
  const [projectNameDraft, setProjectNameDraft] = useState('')
  const [activeReferenceMenuId, setActiveReferenceMenuId] = useState(null)
  const [activeMoveMenuId, setActiveMoveMenuId] = useState(null)
  const accountSheetRef = useRef(null)
  const projectInputRef = useRef(null)
  const searchInputRef = useRef(null)
  const {
    referenceHistory,
    referenceData,
    currentStep,
    isAnalyzing,
    openReference,
    projects,
    currentProjectId,
    accounts,
    currentAccount,
    selectAccount,
    deleteAccount,
    addAccount,
    logout,
    currentUser,
    isAccountConfigured,
    createProject,
    selectProject,
    deleteProject,
    renameReferenceHistoryItem,
    moveReferenceToProject,
    deleteReferenceHistoryItem,
    startNewProject,
  } = useAppState()

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const matchesReferenceSearch = (item) => {
    if (!normalizedQuery) {
      return true
    }
    const rawNeedle = String(normalizedQuery || '').toLowerCase()
    const compactNeedle = normalizeSearchText(normalizedQuery)
    const haystacks = [
      String(item.title || '').toLowerCase(),
      String(item.fileName || '').toLowerCase(),
      String(item.topic || '').toLowerCase(),
      String(item.transcript || '').toLowerCase(),
    ]

    return haystacks.some((haystack) => {
      if (haystack.includes(rawNeedle)) {
        return true
      }
      return normalizeSearchText(haystack).includes(compactNeedle)
    })
  }

  const projectRows = useMemo(() => {
    const dynamic = projects.slice(0, 20).map((project) => ({
      id: project.id,
      title: project.name,
      active: currentProjectId === project.id,
      onClick: () => selectProject(project.id),
    }))

    return dynamic
  }, [projects, currentProjectId, normalizedQuery, selectProject])

  const recentRows = useMemo(() => {
    const scopedHistory = currentProjectId
      ? referenceHistory.filter((item) => item.projectId === currentProjectId)
      : referenceHistory

    const dynamic = scopedHistory.slice(0, 30).map((item) => ({
      id: item.id,
      title: item.title,
      fileName: item.fileName || '',
      topic: item.topic || '',
      transcript: item.transcript || '',
      projectId: item.projectId || null,
      active: referenceData?.id === item.id,
      isProcessing:
        item.status === 'processing' ||
        (referenceData?.id === item.id && (currentStep === 'analyzing' || isAnalyzing)),
      isEditing:
        referenceData?.id === item.id &&
        (currentStep === 'editor' || item.lastStep === 'editor'),
      onClick: () => openReference(item.id),
      onDelete: async () => {
        const ok = window.confirm(`"${item.title}" 대화내역을 삭제할까요?`)
        if (!ok) {
          return
        }
        await deleteReferenceHistoryItem(item.id)
      },
    }))

    return dynamic
  }, [
    currentProjectId,
    currentStep,
    deleteReferenceHistoryItem,
    isAnalyzing,
    normalizedQuery,
    openReference,
    referenceData?.id,
    referenceHistory,
  ])

  const searchRows = useMemo(() => {
    return referenceHistory
      .map((item) => ({
        id: item.id,
        title: item.title,
        fileName: item.fileName || '',
        topic: item.topic || '',
        transcript: item.transcript || '',
        createdAt: item.createdAt || item.created_at || null,
        active: referenceData?.id === item.id,
        onClick: () => {
          openReference(item.id)
          setIsSearchOpen(false)
          setSearchQuery('')
        },
      }))
      .filter((item) => matchesReferenceSearch(item))
      .slice(0, 40)
  }, [matchesReferenceSearch, openReference, referenceData?.id, referenceHistory])

  const groupedSearchRows = useMemo(() => {
    const formatter = new Intl.DateTimeFormat('ko-KR', {
      month: 'long',
      day: 'numeric',
    })
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const groups = []
    const map = new Map()

    for (const item of searchRows) {
      const created = item.createdAt ? new Date(item.createdAt) : null
      let label = '이전'
      if (created && !Number.isNaN(created.getTime())) {
        const day = new Date(created)
        day.setHours(0, 0, 0, 0)
        if (day.getTime() === today.getTime()) {
          label = '오늘'
        } else if (day.getTime() === yesterday.getTime()) {
          label = '어제'
        } else {
          label = formatter.format(created)
        }
      }

      if (!map.has(label)) {
        const nextGroup = { label, items: [] }
        map.set(label, nextGroup)
        groups.push(nextGroup)
      }
      map.get(label).items.push(item)
    }

    return groups
  }, [searchRows])

  const accountRows = useMemo(() => accounts.slice(0, 6), [accounts])

  useEffect(() => {
    if (!isAccountSwitchOpen) {
      return undefined
    }

    const handleOutside = (event) => {
      if (accountSheetRef.current && !accountSheetRef.current.contains(event.target)) {
        setIsAccountSwitchOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutside)
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsAccountSwitchOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isAccountSwitchOpen])

  useEffect(() => {
    if (!isSearchOpen) {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsSearchOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus()
    }, 0)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isSearchOpen])

  useEffect(() => {
    if (!isCreateProjectOpen) {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsCreateProjectOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    const timer = window.setTimeout(() => {
      projectInputRef.current?.focus()
    }, 0)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isCreateProjectOpen])

  useEffect(() => {
    if (!activeReferenceMenuId) {
      return undefined
    }

    const handleClickOutside = () => {
      setActiveReferenceMenuId(null)
      setActiveMoveMenuId(null)
    }

    const timer = window.setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 0)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [activeReferenceMenuId])

  const openCreateProjectModal = () => {
    setProjectNameDraft('')
    setIsCreateProjectOpen(true)
  }

  const submitCreateProject = async () => {
    try {
      await createProject(projectNameDraft)
      setIsCreateProjectOpen(false)
      setProjectNameDraft('')
    } catch (error) {
      window.alert(error.message || '프로젝트 생성에 실패했습니다.')
    }
  }

  const handleNewReferenceAnalysis = () => {
    startNewProject()

    if (window.location.pathname === '/analyze') {
      if (window.location.hash !== '#upload') {
        window.history.replaceState(null, '', '/analyze#upload')
      }
      return
    }

    window.location.assign('/analyze#upload')
  }

  const handleAccountSelect = (account) => {
    if (accounts.length) {
      selectAccount(account.id)
    }

    setIsAccountSwitchOpen(false)
  }

  const handleAccountSettings = (account) => {
    if (accounts.length) {
      selectAccount(account.id)
    }
    setIsAccountSwitchOpen(false)
    window.location.assign('/settings')
  }

  const handleAddAccount = async () => {
    const name = window.prompt('새 계정 이름을 입력하세요')
    if (!name) {
      return
    }

    try {
      await addAccount(name)
      setIsAccountSwitchOpen(false)
    } catch (error) {
      window.alert(error.message || '계정 추가에 실패했습니다.')
    }
  }

  return (
    <div className="relative flex h-full flex-col bg-[#12151D] text-[#E5E7EB]">
      <div className="shrink-0">
        <div className="px-3 pb-3 pt-4">
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            className="flex h-[38px] w-full items-center gap-2 rounded-[10px] border border-[#2F3543] bg-[#1B202A] px-3 text-left transition hover:border-[#3A4252] hover:bg-[#202631]"
          >
            <IconSearch />
            <span className="text-sm text-[#6B7280]">채팅 검색</span>
          </button>

          <div className="mt-2">
            <Row onClick={handleNewReferenceAnalysis}>
              <IconPencil />
              새 레퍼런스 분석하기
            </Row>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-6 pt-4 text-xs font-semibold uppercase tracking-[0.05em] text-[#8E97A6]">프로젝트</div>
        <div className="px-3 pt-2">
          <Row onClick={() => selectProject(null)} active={!currentProjectId}>
            <IconFolder />
            전체
          </Row>
          <Row onClick={openCreateProjectModal}>
            <IconFolder />
            새 프로젝트
          </Row>

          {projectRows.map((item) => (
            <div
              key={item.id}
              className={`group relative flex h-10 w-full items-center gap-2 rounded-[10px] px-3 text-left text-sm transition ${
                item.active ? 'border border-[#4B5563] bg-[#2B313D]' : 'hover:bg-[#232833]'
              }`}
            >
              {item.active ? (
                <span
                  aria-hidden="true"
                  className="absolute left-1 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[#93C5FD]"
                />
              ) : null}
              <button
                type="button"
                onClick={item.onClick}
                className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
                  item.active ? 'font-semibold text-[#F3F4F6]' : 'text-[#E5E7EB]'
                }`}
              >
                <span className="truncate">{item.title}</span>
              </button>
              <button
                type="button"
                onClick={async (event) => {
                  event.stopPropagation()
                  const ok = window.confirm(`"${item.title}" 프로젝트를 삭제할까요?`)
                  if (!ok) {
                    return
                  }
                  await deleteProject(item.id)
                }}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#8E97A6] opacity-0 transition hover:bg-[#2B313D] hover:text-[#D1D5DB] group-hover:opacity-100"
                aria-label={`${item.title} 삭제`}
                title="프로젝트 삭제"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
                  <path d="M4.2 4.2 8 8m0 0 3.8 3.8M8 8l3.8-3.8M8 8 4.2 11.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}

          {projectRows.length > 0 ? (
            <Row muted onClick={() => {}}>
              <IconDots />
              더 보기
            </Row>
          ) : null}
        </div>

        <div className="px-6 pt-4 text-xs font-semibold uppercase tracking-[0.05em] text-[#8E97A6]">최근</div>
        <div className="px-3 pb-3 pt-2">
          {recentRows.map((item) => (
            <div
              key={item.id}
              className={`group relative flex h-10 w-full items-center gap-2 rounded-[10px] px-3 text-left text-sm transition ${
                item.active
                  ? 'border border-[#4B5563] bg-[#2B313D]'
                  : 'hover:bg-[#232833]'
              }`}
            >
              <button
                type="button"
                onClick={item.onClick}
                className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
                  item.active ? 'text-[#F3F4F6]' : 'text-[#E5E7EB]'
                }`}
              >
                <IconFile />
                <span className="truncate">{item.title}</span>
                {item.isProcessing ? (
                  <span className="inline-flex shrink-0 whitespace-nowrap items-center gap-1 rounded-full border border-[#6B7280] bg-[#1B202A] px-1.5 py-0.5 text-[9px] font-semibold leading-none text-[#D1D5DB]">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#60A5FA]" />
                    진행중
                  </span>
                ) : null}
                {!item.isProcessing && item.isEditing ? (
                  <span className="inline-flex shrink-0 whitespace-nowrap items-center rounded-full border border-[#4B5563] bg-[#1B202A] px-2 py-0.5 text-[9px] font-semibold leading-none text-[#CBD5E1]">
                    편집중
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  setActiveReferenceMenuId((current) => (current === item.id ? null : item.id))
                  setActiveMoveMenuId(null)
                }}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#8E97A6] opacity-0 transition hover:bg-[#2B313D] hover:text-[#D1D5DB] group-hover:opacity-100"
                aria-label={`${item.title} 메뉴`}
                title="메뉴"
              >
                <IconDots />
              </button>
              {activeReferenceMenuId === item.id ? (
                <div
                  className="absolute right-2 top-[calc(100%+6px)] z-20 w-[220px] overflow-hidden rounded-xl border border-[#3A4252] bg-[#2B2F36] shadow-[0_10px_28px_rgba(0,0,0,0.35)]"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="flex h-11 w-full items-center gap-3 px-3 text-left text-sm text-[#F3F4F6] transition hover:bg-[#343943]"
                    onClick={async () => {
                      const nextName = window.prompt('새 이름을 입력하세요', item.title)
                      if (!nextName || !nextName.trim()) {
                        return
                      }
                      try {
                        await renameReferenceHistoryItem(item.id, nextName.trim())
                        setActiveReferenceMenuId(null)
                      } catch (error) {
                        window.alert(error.message || '이름 바꾸기에 실패했습니다.')
                      }
                    }}
                  >
                    <IconPencil />
                    이름 바꾸기
                  </button>
                  <button
                    type="button"
                    className="flex h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm text-[#F3F4F6] transition hover:bg-[#343943]"
                    onClick={() => setActiveMoveMenuId((current) => (current === item.id ? null : item.id))}
                  >
                    <span className="flex items-center gap-3">
                      <IconMove />
                      프로젝트로 이동
                    </span>
                    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 text-[#AEB6C5]">
                      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {activeMoveMenuId === item.id ? (
                    <div className="border-t border-[#3A4252] bg-[#252932] p-2">
                      <button
                        type="button"
                        className="flex h-9 w-full items-center rounded-lg px-2 text-left text-xs text-[#D1D5DB] transition hover:bg-[#343943]"
                        onClick={async () => {
                          try {
                            await moveReferenceToProject(item.id, null)
                            setActiveMoveMenuId(null)
                            setActiveReferenceMenuId(null)
                          } catch (error) {
                            window.alert(error.message || '프로젝트 이동에 실패했습니다.')
                          }
                        }}
                      >
                        프로젝트 없음
                      </button>
                      {projects.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          className={`flex h-9 w-full items-center rounded-lg px-2 text-left text-xs transition ${
                            item.projectId === project.id
                              ? 'bg-[#3B4252] text-[#F8FAFC]'
                              : 'text-[#D1D5DB] hover:bg-[#343943]'
                          }`}
                          onClick={async () => {
                            try {
                              await moveReferenceToProject(item.id, project.id)
                              setActiveMoveMenuId(null)
                              setActiveReferenceMenuId(null)
                            } catch (error) {
                              window.alert(error.message || '프로젝트 이동에 실패했습니다.')
                            }
                          }}
                        >
                          {project.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="border-t border-[#3A4252] p-2">
                    <button
                      type="button"
                      className="flex h-9 w-full items-center rounded-lg px-2 text-left text-xs text-[#FCA5A5] transition hover:bg-[#3A1E23]"
                      onClick={async () => {
                        await item.onDelete()
                        setActiveReferenceMenuId(null)
                        setActiveMoveMenuId(null)
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="relative mt-auto border-t border-[#2C313C] px-3 py-3" ref={accountSheetRef}>
        {isAccountSwitchOpen ? (
          <div className="absolute bottom-[calc(100%+10px)] left-3 right-3 overflow-hidden rounded-[18px] border border-[#343A45] bg-[#26282D] shadow-[0_12px_24px_rgba(0,0,0,0.35)]">
            <div className="px-4 py-3 text-[13px] font-semibold text-[#E5E7EB]">계정 전환</div>
            <div className="max-h-[320px] overflow-y-auto">
              {accountRows.map((account) => {
                const isActive = currentAccount?.id === account.id
                const needsSetup = !isAccountConfigured(account.id)
                return (
                  <div
                    key={account.id}
                    onClick={() => handleAccountSelect(account)}
                    className={`flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left transition ${
                      isActive
                        ? 'bg-[#30333A]'
                        : 'hover:bg-[#2B2E35]'
                    }`}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#4B5563] text-white">
                      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-6 w-6">
                        <path
                          d="M10 10.2a3.2 3.2 0 1 0 0-6.4a3.2 3.2 0 0 0 0 6.4Zm0 1.8c-3.2 0-5.8 1.9-5.8 4.2 0 .6.4 1 1 1h9.6c.6 0 1-.4 1-1 0-2.3-2.6-4.2-5.8-4.2Z"
                          fill="currentColor"
                        />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-semibold leading-4 text-[#F3F4F6]">
                        {account.name}
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleAccountSettings(account)
                        }}
                        className="mt-1 inline-flex min-h-[14px] items-center gap-0.5 overflow-hidden rounded-full border border-[#4A505C] bg-[#2B2F36] px-1.5 py-0.5 text-[7px] font-semibold leading-none text-[#D1D5DB] no-underline transition hover:bg-[#343943]"
                        aria-label={`${account.name} 계정 설정`}
                        title="계정 설정"
                      >
                        {needsSetup ? (
                          <span
                            className="inline-block h-1 w-1 rounded-full bg-[#EF4444]"
                            aria-hidden="true"
                          />
                        ) : null}
                        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-1.5 w-1.5 shrink-0">
                          <path
                            d="M6.26.94h3.48l.38 1.86a5.4 5.4 0 0 1 1.25.72l1.77-.74 1.74 3.01-1.38 1.22c.07.4.1.8.1 1.2 0 .4-.03.8-.1 1.2l1.38 1.22-1.74 3.01-1.77-.74c-.39.3-.8.54-1.25.72l-.38 1.86H6.26l-.38-1.86a5.4 5.4 0 0 1-1.25-.72l-1.77.74L1.12 11.6 2.5 10.38a6.3 6.3 0 0 1 0-2.4L1.12 6.76 2.86 3.75l1.77.74c.39-.3.8-.54 1.25-.72L6.26.94Zm1.74 4.11A3.15 3.15 0 1 0 8 11.35 3.15 3.15 0 0 0 8 5.05Z"
                            fill="currentColor"
                          />
                        </svg>
                        설정
                      </button>
                    </div>
                    <div className="ml-1.5 flex shrink-0 items-center gap-0.5">
                      {isActive ? (
                        <div className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-[#CBD5E1] text-[#CBD5E1]">
                          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-2.5 w-2.5">
                            <path d="M6.8 10.74 3.92 7.87 2.8 9l4 4 6.4-6.4-1.12-1.13-5.28 5.27Z" fill="currentColor" />
                          </svg>
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={async (event) => {
                          event.stopPropagation()
                          const ok = window.confirm(`"${account.name}" 계정을 삭제할까요?`)
                          if (!ok) {
                            return
                          }
                          await deleteAccount(account.id)
                          setIsAccountSwitchOpen(false)
                        }}
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#F87171] text-[10px] font-semibold transition hover:bg-[#3A1E23]"
                        aria-label={`${account.name} 계정 삭제`}
                        title="계정 삭제"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )
              })}
              {accountRows.length === 0 ? (
                <div className="px-4 py-5 text-[12px] text-[#A5ACB8]">표시할 계정이 없습니다.</div>
              ) : null}
            </div>
            <div className="border-t border-[#3A3F4A] px-3 py-2.5">
              <button
                type="button"
                onClick={handleAddAccount}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-[#4A505C] bg-[#2B2F36] text-[13px] font-semibold text-[#E5E7EB] transition hover:bg-[#343943]"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
                  <path d="M7.25 2.5h1.5v4.75H13.5v1.5H8.75v4.75h-1.5V8.75H2.5v-1.5h4.75V2.5Z" fill="currentColor" />
                </svg>
                계정 추가
              </button>
              <button
                type="button"
                onClick={async () => {
                  const ok = window.confirm('로그아웃할까요?')
                  if (!ok) {
                    return
                  }

                  try {
                    await logout()
                    setIsAccountSwitchOpen(false)
                    window.location.assign('/login')
                  } catch (error) {
                    window.alert(error.message || '로그아웃에 실패했습니다.')
                  }
                }}
                className="mt-1.5 flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-[#4A505C] bg-[#252932] text-[12px] font-semibold text-[#FCA5A5] transition hover:bg-[#343943]"
              >
                로그아웃
              </button>
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setIsAccountSwitchOpen((current) => !current)}
          className="flex h-[52px] w-full items-center gap-3 rounded-[10px] px-3 transition hover:bg-[#232833]"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4B5563] text-xs font-semibold text-white">
            {(currentUser?.email || currentAccount?.name || 'H').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-sm font-semibold text-[#F3F4F6]">
              {currentAccount?.name || currentUser?.email || '계정'}
            </div>
            {currentAccount?.id && !isAccountConfigured(currentAccount.id) ? (
              <div className="mt-1 inline-flex items-center rounded-full border border-[#7F1D1D] bg-[#2A1417] px-2 py-0.5 text-[10px] font-semibold text-[#FCA5A5]">
                계정설정필요
              </div>
            ) : null}
          </div>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 text-[#AEB6C5]">
            <path d="M8 11.5 3.5 6.5h9L8 11.5Z" fill="currentColor" />
          </svg>
        </button>
      </div>

      {isCreateProjectOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] bg-[rgba(10,10,10,0.55)]"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setIsCreateProjectOpen(false)
                }
              }}
            >
              <div className="absolute left-1/2 top-1/2 w-[min(620px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[24px] border border-[#2A2A2A] bg-[#1B1B1F] shadow-[0_14px_30px_rgba(0,0,0,0.35)]">
                <div className="flex items-center justify-between px-4 pb-2 pt-3">
                  <h3 className="text-[20px] font-semibold text-[#F4F4F5]">프로젝트 만들기</h3>
                  <button
                    type="button"
                    onClick={() => setIsCreateProjectOpen(false)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded text-[#E5E7EB] transition hover:bg-white/10"
                    aria-label="닫기"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-5 w-5">
                      <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>

                <div className="px-4 pb-4 pt-2">
                  <p className="mb-2 text-[12px] font-medium text-[#D1D5DB]">프로젝트 이름</p>
                  <label className="flex h-[54px] items-center rounded-2xl border border-[#3F3F46] bg-[#202227] px-3">
                    <input
                      ref={projectInputRef}
                      value={projectNameDraft}
                      onChange={(event) => setProjectNameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          submitCreateProject()
                        }
                      }}
                      placeholder="프로젝트 이름 입력"
                      className="w-full bg-transparent text-[17px] text-[#F4F4F5] outline-none placeholder:text-[#A1A1AA]"
                    />
                  </label>
                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsCreateProjectOpen(false)}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-[#3A3F4A] px-4 text-sm font-semibold text-[#D1D5DB] transition hover:bg-[#252932]"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void submitCreateProject()
                      }}
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-[#E5E7EB] px-4 text-sm font-semibold text-[#111827] transition hover:bg-white"
                    >
                      생성
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {isSearchOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[130] bg-[rgba(6,8,12,0.62)] backdrop-blur-[2px]"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setIsSearchOpen(false)
                }
              }}
            >
              <div className="absolute left-1/2 top-[9vh] w-[min(760px,calc(100vw-40px))] -translate-x-1/2 overflow-hidden rounded-[28px] border border-[#3A3F4A] bg-[#2A2A2A] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                <div className="flex items-center gap-3 border-b border-[#434343] px-5 py-4">
                  <IconSearch />
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="채팅 검색..."
                    className="w-full bg-transparent text-[17px] text-[#F3F4F6] outline-none placeholder:text-[#A3A3A3]"
                  />
                  <button
                    type="button"
                    onClick={() => setIsSearchOpen(false)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#A3A3A3] transition hover:bg-white/5 hover:text-[#F3F4F6]"
                    aria-label="검색 닫기"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-5 w-5">
                      <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>

                <div className="max-h-[70vh] overflow-y-auto px-4 py-4">
                  <button
                    type="button"
                    onClick={() => {
                      setIsSearchOpen(false)
                      setSearchQuery('')
                      handleNewReferenceAnalysis()
                    }}
                    className="flex h-[58px] w-full items-center gap-3 rounded-[18px] bg-[#464646] px-5 text-left text-[16px] font-semibold text-[#F3F4F6] transition hover:bg-[#515151]"
                  >
                    <IconPencil />
                    새 채팅
                  </button>

                  <div className="mt-5 space-y-5">
                    {groupedSearchRows.length ? (
                      groupedSearchRows.map((group) => (
                        <div key={group.label}>
                          <div className="px-2 text-sm font-semibold text-[#A3A3A3]">{group.label}</div>
                          <div className="mt-3 space-y-1">
                            {group.items.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={item.onClick}
                                className={`flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left transition ${
                                  item.active ? 'bg-[#3A3A3A]' : 'hover:bg-[#333333]'
                                }`}
                              >
                                <IconChatBubble />
                                <span className="truncate text-[16px] text-[#F3F4F6]">{item.title}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[20px] border border-dashed border-[#4A4A4A] px-5 py-10 text-center text-sm text-[#A3A3A3]">
                        제목 또는 전사(STT) 내용으로 검색해보세요.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
