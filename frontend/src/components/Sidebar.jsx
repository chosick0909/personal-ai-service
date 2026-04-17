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

const PROJECT_EMOJIS = ['📱', '✈️', '📖', '🎵', '🍳']

export default function Sidebar() {
  const [query, setQuery] = useState('')
  const [isAccountSwitchOpen, setIsAccountSwitchOpen] = useState(false)
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false)
  const [projectNameDraft, setProjectNameDraft] = useState('')
  const accountSheetRef = useRef(null)
  const projectInputRef = useRef(null)
  const {
    referenceHistory,
    referenceData,
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
    deleteReferenceHistoryItem,
  } = useAppState()

  const normalizedQuery = query.trim().toLowerCase()

  const projectRows = useMemo(() => {
    const dynamic = projects.slice(0, 12).map((project, idx) => ({
      id: project.id,
      emoji: PROJECT_EMOJIS[idx % PROJECT_EMOJIS.length],
      title: project.name,
      active: currentProjectId === project.id,
      onClick: () => selectProject(project.id),
    }))

    if (!normalizedQuery) {
      return dynamic
    }

    return dynamic.filter((item) => item.title.toLowerCase().includes(normalizedQuery))
  }, [projects, currentProjectId, normalizedQuery, selectProject])

  const recentRows = useMemo(() => {
    const dynamic = referenceHistory.slice(0, 6).map((item) => ({
      id: item.id,
      title: item.title,
      active: referenceData?.id === item.id,
      onClick: () => openReference(item.id),
      onDelete: async () => {
        const ok = window.confirm(`"${item.title}" 대화내역을 삭제할까요?`)
        if (!ok) {
          return
        }
        await deleteReferenceHistoryItem(item.id)
      },
    }))

    if (!normalizedQuery) {
      return dynamic
    }

    return dynamic.filter((item) => item.title.toLowerCase().includes(normalizedQuery))
  }, [deleteReferenceHistoryItem, normalizedQuery, openReference, referenceData?.id, referenceHistory])

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

  const openCreateProjectModal = () => {
    setProjectNameDraft('')
    setIsCreateProjectOpen(true)
  }

  const submitCreateProject = () => {
    createProject(projectNameDraft)
    setIsCreateProjectOpen(false)
    setProjectNameDraft('')
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
          <label className="flex h-[38px] items-center gap-2 rounded-[10px] border border-[#2F3543] bg-[#1B202A] px-3">
            <IconSearch />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="채팅 검색"
              className="w-full bg-transparent text-sm text-[#E5E7EB] outline-none placeholder:text-[#6B7280]"
            />
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-6 pt-4 text-xs font-semibold uppercase tracking-[0.05em] text-[#8E97A6]">프로젝트</div>
        <div className="px-3 pt-2">
          <Row onClick={openCreateProjectModal}>
            <IconFolder />
            새 프로젝트
          </Row>

          {projectRows.map((item) => (
            <div key={item.id} className="group flex h-10 w-full items-center gap-2 rounded-[10px] px-3 text-left text-sm transition hover:bg-[#232833]">
              <button
                type="button"
                onClick={item.onClick}
                className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
                  item.active ? 'text-[#F3F4F6]' : 'text-[#E5E7EB]'
                }`}
              >
                <span className="w-4 text-center text-base leading-none">{item.emoji}</span>
                <span className="truncate">{item.title}</span>
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  deleteProject(item.id)
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
            <div key={item.id} className="group flex h-10 w-full items-center gap-2 rounded-[10px] px-3 text-left text-sm transition hover:bg-[#232833]">
              <button
                type="button"
                onClick={item.onClick}
                className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
                  item.active ? 'text-[#F3F4F6]' : 'text-[#E5E7EB]'
                }`}
              >
                <IconFile />
                <span className="truncate">{item.title}</span>
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  item.onDelete()
                }}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#8E97A6] opacity-0 transition hover:bg-[#2B313D] hover:text-[#D1D5DB] group-hover:opacity-100"
                aria-label={`${item.title} 삭제`}
                title="대화내역 삭제"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
                  <path d="M4.2 4.2 8 8m0 0 3.8 3.8M8 8l3.8-3.8M8 8 4.2 11.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
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
                      <div className="truncate text-[11px] leading-4 text-[#A5ACB8]">@{account.slug}</div>
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
            <div className="truncate text-xs text-[#8E97A6]">
              {currentAccount?.slug ? `@${currentAccount.slug}` : currentUser?.email || '@account'}
            </div>
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
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded text-[#E5E7EB] transition hover:bg-white/10"
                      aria-label="설정"
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-5 w-5">
                        <path
                          d="M6.26.94h3.48l.38 1.86a5.4 5.4 0 0 1 1.25.72l1.77-.74 1.74 3.01-1.38 1.22c.07.4.1.8.1 1.2 0 .4-.03.8-.1 1.2l1.38 1.22-1.74 3.01-1.77-.74c-.39.3-.8.54-1.25.72l-.38 1.86H6.26l-.38-1.86a5.4 5.4 0 0 1-1.25-.72l-1.77.74L1.12 11.6 2.5 10.38a6.3 6.3 0 0 1 0-2.4L1.12 6.76 2.86 3.75l1.77.74c.39-.3.8-.54 1.25-.72L6.26.94Zm1.74 4.11A3.15 3.15 0 1 0 8 11.35 3.15 3.15 0 0 0 8 5.05Z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
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
                </div>

                <div className="px-4 pb-4 pt-2">
                  <p className="mb-2 text-[12px] font-medium text-[#D1D5DB]">프로젝트 이름</p>
                  <label className="flex h-[54px] items-center gap-3 rounded-2xl border border-[#3F3F46] bg-[#202227] px-3">
                    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-6 w-6 text-[#A1A1AA]">
                      <path
                        d="M8 8.2a2.6 2.6 0 1 0 0-5.2a2.6 2.6 0 0 0 0 5.2Zm0 1.4c-2.6 0-4.8 1.6-4.8 3.5 0 .5.3.9.8.9h8c.5 0 .8-.4.8-.9 0-1.9-2.2-3.5-4.8-3.5Zm4.7-8.1h1.1v1.6h1.6v1.1h-1.6v1.6h-1.1V4.2H11V3.1h1.7V1.5Z"
                        fill="currentColor"
                      />
                    </svg>
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
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
