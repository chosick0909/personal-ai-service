import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { getStoredAccountId, setStoredAccountId } from '../lib/api'
import { createAccount, deleteAccountById, listAccounts } from '../lib/accountApi'
import { supabase } from '../lib/supabase'
import {
  analyzeReferenceVideo,
  deleteReferenceVideo as deleteReferenceVideoRecord,
  fetchReferenceVideoDetail,
  generateChatReply,
  generateScriptFeedback,
  listReferenceVideoHistory,
} from '../lib/referenceApi'
import {
  createScriptSelection,
  downloadScriptPdf,
  loadScriptVersions,
  restoreScriptVersionRecord,
  saveVersionRecord,
} from '../lib/scriptApi'

const AppStateContext = createContext(null)
const PROJECTS_KEY = 'personal-ai-service:projects'
const ACCOUNT_SETUP_KEY = 'personal-ai-service:account-setup-map'
const OAUTH_NOISE_KEYS = new Set([
  'error',
  'error_code',
  'error_description',
  'access_token',
  'refresh_token',
  'provider_token',
  'expires_at',
  'expires_in',
  'token_type',
  'sb',
])

function sanitizeOAuthUrlParams({ includeTokenParams = false } = {}) {
  if (typeof window === 'undefined') {
    return
  }

  const currentUrl = new URL(window.location.href)
  let changed = false

  const cleanupKeys = includeTokenParams
    ? OAUTH_NOISE_KEYS
    : new Set(['error', 'error_code', 'error_description'])

  for (const key of Array.from(currentUrl.searchParams.keys())) {
    if (cleanupKeys.has(key)) {
      currentUrl.searchParams.delete(key)
      changed = true
    }
  }

  const rawHash = currentUrl.hash.startsWith('#') ? currentUrl.hash.slice(1) : currentUrl.hash
  if (rawHash) {
    const hashParams = new URLSearchParams(rawHash)
    let hashChanged = false

    for (const key of Array.from(hashParams.keys())) {
      if (cleanupKeys.has(key)) {
        hashParams.delete(key)
        hashChanged = true
      }
    }

    if (hashChanged) {
      const nextHash = hashParams.toString()
      currentUrl.hash = nextHash ? `#${nextHash}` : ''
      changed = true
    }
  }

  if (!changed) {
    return
  }

  const nextUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`
  window.history.replaceState({}, '', nextUrl)
}

function getStoredProjects() {
  if (typeof window === 'undefined') {
    return []
  }

  const raw = window.localStorage.getItem(PROJECTS_KEY)
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function setStoredProjects(projects) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects))
}

function getStoredAccountSetupMap() {
  if (typeof window === 'undefined') {
    return {}
  }

  const raw = window.localStorage.getItem(ACCOUNT_SETUP_KEY)
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function setStoredAccountSetupMap(map) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(ACCOUNT_SETUP_KEY, JSON.stringify(map))
}

function createEditorSections(input = {}) {
  return {
    hook: input.hook || '',
    body: input.body || '',
    cta: input.cta || '',
  }
}

function serializeEditorSections(sections = {}) {
  return [sections.hook || '', '', sections.body || '', '', sections.cta || ''].join('\n')
}

function deserializeEditorContent(content = '') {
  const parts = content.split(/\n\s*\n/)
  return createEditorSections({
    hook: parts[0] || '',
    body: parts[1] || '',
    cta: parts.slice(2).join('\n\n') || '',
  })
}

function createVersionEntry({
  source,
  title,
  content,
  score = null,
  versionNumber,
}) {
  return {
    id: `${source.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source,
    title,
    content,
    score,
    versionNumber,
    createdAt: new Date().toISOString(),
  }
}

const initialState = {
  isLoggedIn: false,
  currentStep: 'upload',
  referenceData: null,
  generatedScripts: [],
  selectedScript: null,
  chatMessages: [
    {
      id: 'welcome',
      role: 'assistant',
      content:
        '우측 패널에서는 수정 요청과 피드백을 다룹니다. A/B/C 안 중 하나를 고른 뒤 “톤을 더 날카롭게 바꿔줘” 같은 요청을 넣을 수 있습니다.',
    },
  ],
  versions: [],
  referenceHistory: [],
  feedback: null,
  editorSections: createEditorSections(),
  isVersionModalOpen: false,
  draftMessage: '',
  pendingSuggestion: null,
  accounts: [],
  currentAccount: null,
  projects: [],
  currentProjectId: null,
}

export function AppStateProvider({ children }) {
  const [isLoggedIn, setIsLoggedIn] = useState(initialState.isLoggedIn)
  const [isAuthReady, setIsAuthReady] = useState(false)
  const [currentStep, setCurrentStep] = useState(initialState.currentStep)
  const [referenceData, setReferenceData] = useState(initialState.referenceData)
  const [generatedScripts, setGeneratedScripts] = useState(initialState.generatedScripts)
  const [selectedScript, setSelectedScript] = useState(initialState.selectedScript)
  const [chatMessages, setChatMessages] = useState(initialState.chatMessages)
  const [versions, setVersions] = useState(initialState.versions)
  const [referenceHistory, setReferenceHistory] = useState([])
  const [feedback, setFeedback] = useState(initialState.feedback)
  const [editorSections, setEditorSections] = useState(initialState.editorSections)
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false)
  const [draftMessage, setDraftMessage] = useState('')
  const [pendingSuggestion, setPendingSuggestion] = useState(null)
  const [accounts, setAccounts] = useState(initialState.accounts)
  const [currentAccount, setCurrentAccount] = useState(initialState.currentAccount)
  const [accountSetupMap, setAccountSetupMap] = useState(() => getStoredAccountSetupMap())
  const [projects, setProjects] = useState(initialState.projects)
  const [currentProjectId, setCurrentProjectId] = useState(initialState.currentProjectId)
  const [activeScriptId, setActiveScriptId] = useState(null)
  const [uploadTopic, setUploadTopic] = useState('')
  const [uploadTitle, setUploadTitle] = useState('')
  const [analyzeError, setAnalyzeError] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false)
  const [viewTransition, setViewTransition] = useState('idle')
  const [isEditorEntering, setIsEditorEntering] = useState(false)
  const [isResultEntering, setIsResultEntering] = useState(false)
  const [toast, setToast] = useState(null)
  const [currentUser, setCurrentUser] = useState(null)
  const activeReferenceIdRef = useRef(null)
  const toastTimerRef = useRef(null)

  useEffect(() => {
    sanitizeOAuthUrlParams({ includeTokenParams: false })

    let mounted = true

    const syncSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!mounted) {
        return
      }

      setCurrentUser(session?.user || null)
      setIsLoggedIn(Boolean(session?.user))
      setIsAuthReady(true)
      sanitizeOAuthUrlParams({ includeTokenParams: Boolean(session?.user) })

      if (!session?.user) {
        setStoredAccountId('')
        setAccounts([])
        setCurrentAccount(null)
      }
    }

    syncSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user || null)
      setIsLoggedIn(Boolean(session?.user))
      setIsAuthReady(true)
      sanitizeOAuthUrlParams({ includeTokenParams: Boolean(session?.user) })

      if (!session?.user) {
        setStoredAccountId('')
        setAccounts([])
        setCurrentAccount(null)
        resetStudioForAccount()
      }
    })

    return () => {
      mounted = false
      subscription?.unsubscribe()
    }
  }, [])

  const showToast = (message, tone = 'success') => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current)
    }

    setToast({
      id: `toast-${Date.now()}`,
      message,
      tone,
    })

    toastTimerRef.current = window.setTimeout(() => {
      setToast(null)
      toastTimerRef.current = null
    }, 2200)
  }

  const syncHistory = (referenceId, patch) => {
    if (!referenceId) {
      return
    }

    setReferenceHistory((current) =>
      current.map((item) =>
        item.id === referenceId
          ? {
              ...item,
              ...patch,
            }
          : item,
      ),
    )
  }

  const resetStudioForAccount = () => {
    activeReferenceIdRef.current = null
    setCurrentStep('upload')
    setReferenceData(null)
    setGeneratedScripts([])
    setSelectedScript(null)
    setChatMessages(initialState.chatMessages)
    setVersions([])
    setReferenceHistory([])
    setFeedback(null)
    setEditorSections(createEditorSections())
    setIsVersionModalOpen(false)
    setDraftMessage('')
    setPendingSuggestion(null)
    setActiveScriptId(null)
    setUploadTopic('')
    setUploadTitle('')
    setAnalyzeError('')
    setIsAnalyzing(false)
    setIsChatLoading(false)
    setIsFeedbackLoading(false)
    setViewTransition('idle')
    setIsEditorEntering(false)
    setIsResultEntering(false)
  }

  const login = async ({ loginId, password }) => {
    const normalizedLoginId = loginId.trim()
    const normalizedPassword = password.trim()

    if (!normalizedLoginId || !normalizedPassword) {
      throw new Error('이메일과 비밀번호를 입력하세요.')
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedLoginId,
      password: normalizedPassword,
    })

    if (error) {
      throw new Error(error.message || '로그인에 실패했습니다.')
    }

    setCurrentUser(data?.user || null)
    setIsLoggedIn(true)
    setCurrentStep('upload')
    return data?.user || null
  }

  const signup = async ({ loginId, password, accountName }) => {
    const normalizedLoginId = loginId.trim()
    const normalizedPassword = password.trim()
    const normalizedAccountName = accountName.trim() || normalizedLoginId

    if (!normalizedLoginId || !normalizedPassword) {
      throw new Error('이메일과 비밀번호를 입력하세요.')
    }

    const { data, error } = await supabase.auth.signUp({
      email: normalizedLoginId,
      password: normalizedPassword,
    })

    if (error) {
      throw new Error(error.message || '회원가입에 실패했습니다.')
    }

    if (!data?.session || !data?.user) {
      throw new Error('이메일 인증 후 로그인해주세요.')
    }

    const created = await createAccount({
      name: normalizedAccountName,
    })
    setAccounts((current) => {
      if (current.some((item) => item.id === created.id)) {
        return current
      }

      return [...current, created]
    })
    setStoredAccountId(created.id)
    setCurrentAccount(created)
    setCurrentUser(data.user)
    setIsLoggedIn(true)
    setCurrentStep('upload')

    return data.user
  }

  const logout = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) {
      throw new Error(error.message || '로그아웃에 실패했습니다.')
    }

    setStoredAccountId('')
    setIsLoggedIn(false)
    setCurrentUser(null)
    setAccounts([])
    setCurrentAccount(null)
    setProjects([])
    setCurrentProjectId(null)
    resetStudioForAccount()
  }

  useEffect(() => {
    if (!isLoggedIn) {
      setAccounts([])
      setCurrentAccount(null)
      return
    }

    const run = async () => {
      try {
        let nextAccounts = await listAccounts()

        if (!nextAccounts.length) {
          const emailPrefix =
            currentUser?.email?.split('@')[0]?.trim() || '내 계정'
          const created = await createAccount({
            name: emailPrefix,
          })
          nextAccounts = [created]
        }

        setAccounts(nextAccounts)

        const storedAccountId = getStoredAccountId()
        const nextCurrentAccount =
          nextAccounts.find((item) => item.id === storedAccountId) || nextAccounts[0] || null

        if (nextCurrentAccount) {
          setStoredAccountId(nextCurrentAccount.id)
        }

        setCurrentAccount(nextCurrentAccount)
      } catch (_error) {
        setAccounts([])
        setCurrentAccount(null)
      }
    }

    run()
  }, [isLoggedIn, currentUser?.email])

  useEffect(() => {
    if (!isLoggedIn || !currentAccount?.id) {
      return
    }

    loadReferenceHistory()
  }, [isLoggedIn, currentAccount?.id])

  useEffect(() => {
    if (!isLoggedIn || !currentAccount?.id) {
      setProjects([])
      setCurrentProjectId(null)
      return
    }

    const allProjects = getStoredProjects()
    const scoped = allProjects.filter((item) => item.accountId === currentAccount.id)
    setProjects(scoped)
    setCurrentProjectId((current) => {
      if (current && scoped.some((item) => item.id === current)) {
        return current
      }
      return scoped[0]?.id || null
    })
  }, [isLoggedIn, currentAccount?.id])

  const loadReferenceHistory = async () => {
    try {
      const items = await listReferenceVideoHistory()
      setReferenceHistory(items)
    } catch (_error) {
      // keep sidebar empty if history fetch fails in mock/dev startup
    }
  }

  const selectAccount = (accountId) => {
    const nextAccount = accounts.find((item) => item.id === accountId)

    if (!nextAccount || nextAccount.id === currentAccount?.id) {
      return
    }

    setStoredAccountId(nextAccount.id)
    setCurrentAccount(nextAccount)
    resetStudioForAccount()
  }

  const addAccount = async (accountName) => {
    const normalizedName = accountName.trim()

    if (!normalizedName) {
      throw new Error('계정 이름을 입력하세요.')
    }

    const created = await createAccount({
      name: normalizedName,
    })

    const nextAccounts = [...accounts, created]
    setAccounts(nextAccounts)
    setAccountSetupMap((current) => {
      const next = {
        ...current,
        [created.id]: false,
      }
      setStoredAccountSetupMap(next)
      return next
    })
    setStoredAccountId(created.id)
    setCurrentAccount(created)
    resetStudioForAccount()

    return created
  }

  const deleteAccount = async (accountId) => {
    const normalizedAccountId = accountId?.trim()
    if (!normalizedAccountId) {
      return false
    }

    if (accounts.length <= 1) {
      showToast('마지막 계정은 삭제할 수 없습니다.', 'error')
      return false
    }

    try {
      await deleteAccountById(normalizedAccountId)
    } catch (error) {
      showToast(error.message || '계정 삭제에 실패했습니다.', 'error')
      return false
    }

    const remainingAccounts = accounts.filter((item) => item.id !== normalizedAccountId)
    setAccounts(remainingAccounts)

    setAccountSetupMap((current) => {
      const next = { ...current }
      delete next[normalizedAccountId]
      setStoredAccountSetupMap(next)
      return next
    })

    const nextAllProjects = getStoredProjects().filter((item) => item.accountId !== normalizedAccountId)
    setStoredProjects(nextAllProjects)
    if (currentAccount?.id === normalizedAccountId) {
      const nextCurrentAccount = remainingAccounts[0] || null
      setCurrentAccount(nextCurrentAccount)
      setStoredAccountId(nextCurrentAccount?.id || '')
      resetStudioForAccount()
    }

    showToast('계정을 삭제했습니다.')
    return true
  }

  const startNewProject = () => {
    activeReferenceIdRef.current = null
    setCurrentStep('upload')
    setReferenceData(null)
    setGeneratedScripts([])
    setSelectedScript(null)
    setActiveScriptId(null)
    setVersions([])
    setFeedback(null)
    setEditorSections(createEditorSections())
    setDraftMessage('')
    setPendingSuggestion(null)
    setAnalyzeError('')
    setIsAnalyzing(false)
    setChatMessages(initialState.chatMessages)
    setViewTransition('idle')
    setIsEditorEntering(false)
    setIsResultEntering(false)
  }

  const createProject = (name = '') => {
    if (!currentAccount?.id) {
      return
    }

    const normalizedName = name.trim()
    const baseName = normalizedName || '새 프로젝트'
    const nextProject = {
      id: `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      accountId: currentAccount.id,
      name: baseName,
      createdAt: new Date().toISOString(),
    }

    const allProjects = getStoredProjects()
    const nextAllProjects = [...allProjects, nextProject]
    setStoredProjects(nextAllProjects)
    setProjects((current) => [...current, nextProject])
    setCurrentProjectId(nextProject.id)
    startNewProject()
  }

  const selectProject = (projectId) => {
    if (!projectId || projectId === currentProjectId) {
      return
    }

    const exists = projects.some((item) => item.id === projectId)
    if (!exists) {
      return
    }

    setCurrentProjectId(projectId)
    startNewProject()
  }

  const markAccountConfigured = (accountId, configured = true) => {
    if (!accountId) {
      return
    }

    setAccountSetupMap((current) => {
      const next = {
        ...current,
        [accountId]: Boolean(configured),
      }
      setStoredAccountSetupMap(next)
      return next
    })
  }

  const isAccountConfigured = (accountId) => Boolean(accountId && accountSetupMap[accountId])

  const deleteProject = (projectId) => {
    if (!projectId) {
      return
    }

    const nextProjects = projects.filter((item) => item.id !== projectId)
    setProjects(nextProjects)

    const nextAllProjects = getStoredProjects().filter((item) => item.id !== projectId)
    setStoredProjects(nextAllProjects)

    if (currentProjectId === projectId) {
      setCurrentProjectId(nextProjects[0]?.id || null)
      startNewProject()
    }
  }

  const deleteReferenceHistoryItem = async (referenceId) => {
    if (!referenceId) {
      return false
    }

    try {
      await deleteReferenceVideoRecord(referenceId)
    } catch (error) {
      showToast(error.message || '대화내역 삭제에 실패했습니다.', 'error')
      return false
    }

    setReferenceHistory((current) => current.filter((item) => item.id !== referenceId))

    if (activeReferenceIdRef.current === referenceId || referenceData?.id === referenceId) {
      startNewProject()
    }

    showToast('대화내역을 삭제했습니다.')
    return true
  }

  const analyzeReference = async (file) => {
    const normalizedTopic = uploadTopic.trim()
    const fallbackTopic = uploadTitle.trim() || file.name.replace(/\.[^.]+$/, '') || '일반'
    const effectiveTopic = normalizedTopic || fallbackTopic

    const createdAt = new Date().toISOString()
    const localReference = {
      id: `reference-${Date.now()}`,
      title: uploadTitle.trim() || file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      topic: effectiveTopic,
      createdAt,
      status: 'processing',
    }

    activeReferenceIdRef.current = localReference.id
    setReferenceData(localReference)
    setGeneratedScripts([])
    setSelectedScript(null)
    setActiveScriptId(null)
    setVersions([])
    setFeedback(null)
    setEditorSections(createEditorSections())
    setPendingSuggestion(null)
    setAnalyzeError('')
    setChatMessages([
      {
        id: 'analysis-start',
        role: 'assistant',
        content:
          '레퍼런스가 업로드되었습니다. 분석이 끝나면 구조/후킹 포인트와 A/B/C 초안이 준비됩니다.',
      },
    ])
    setReferenceHistory((current) => [localReference, ...current])
    setCurrentStep('analyzing')
    setIsAnalyzing(true)
    setViewTransition('idle')
    setIsEditorEntering(false)
    setIsResultEntering(false)

    try {
      const analysis = await analyzeReferenceVideo({
        file,
        topic: effectiveTopic,
        title: uploadTitle,
      })

      const completedReference = {
        ...localReference,
        ...analysis.reference,
        status: 'ready',
      }

      setReferenceData(completedReference)
      setGeneratedScripts(analysis.generatedScripts)
      setCurrentStep('result')
      setIsResultEntering(true)
      setUploadTitle('')
      setReferenceHistory((current) =>
        current.map((item) =>
          item.id === localReference.id
            ? {
                ...completedReference,
                generatedScripts: analysis.generatedScripts,
              }
            : item,
        ),
      )
      setChatMessages((current) => [
        ...current,
        {
          id: `analysis-complete-${Date.now()}`,
          role: 'assistant',
          content:
            '실제 Whisper/Vision 분석이 완료되었습니다. 중앙에서 A/B/C 안을 비교하고, 마음에 드는 안을 선택해 에디터로 넘어가세요.',
        },
      ])
      setTimeout(() => {
        setIsResultEntering(false)
      }, 420)
    } catch (error) {
      console.groupCollapsed('[reference-analysis] analyze failed')
      console.error('message:', error.message)
      console.error('code:', error.code || null)
      console.error('details:', error.details || null)
      console.error('requestId:', error.requestId || null)
      console.error(error)
      console.groupEnd()
      setCurrentStep('upload')
      setAnalyzeError(error.message)
      setReferenceHistory((current) => current.filter((item) => item.id !== localReference.id))
    } finally {
      setIsAnalyzing(false)
    }
  }

  const selectScript = async (scriptId) => {
    const nextScript = generatedScripts.find((item) => item.id === scriptId)

    if (!nextScript) {
      return
    }

    setSelectedScript(nextScript)
    setEditorSections(createEditorSections(nextScript.sections))
    setFeedback(null)
    setPendingSuggestion(null)
    setViewTransition('to-editor')
    setIsEditorEntering(false)

    try {
      const created = await createScriptSelection({
        referenceId: referenceData?.id,
        selectedLabel: nextScript.label,
        title: `${referenceData?.title || '레퍼런스'} · ${nextScript.label}`,
        sections: nextScript.sections,
        score: nextScript.score,
      })
      const initialVersions = created.versions || []

      setActiveScriptId(created.script?.id || null)
      setVersions(initialVersions)
      syncHistory(activeReferenceIdRef.current, {
        selectedScriptId: nextScript.id,
        activeScriptId: created.script?.id || null,
        editorContent: serializeEditorSections(nextScript.sections),
        versions: initialVersions,
      })
      setTimeout(() => {
        setCurrentStep('editor')
        setViewTransition('idle')
        setIsEditorEntering(true)
        setTimeout(() => {
          setIsEditorEntering(false)
        }, 420)
      }, 320)
    } catch (error) {
      setChatMessages((current) => [
        ...current,
        {
          id: `script-create-error-${Date.now()}`,
          role: 'assistant',
          content: error.message || '에디터용 스크립트 생성에 실패했습니다.',
        },
      ])
      setViewTransition('idle')
    }
  }

  const goBackToResults = () => {
    if (!generatedScripts.length) {
      return
    }

    setViewTransition('to-result')
    setIsResultEntering(false)
    setTimeout(() => {
      setCurrentStep('result')
      setViewTransition('idle')
      setIsResultEntering(true)
      setTimeout(() => {
        setIsResultEntering(false)
      }, 420)
    }, 320)
  }

  const openReference = (referenceId) => {
    const item = referenceHistory.find((entry) => entry.id === referenceId)

    if (!item) {
      return
    }

    const open = async () => {
      let detail
      try {
        detail = await fetchReferenceVideoDetail(referenceId)
      } catch (error) {
        if (!item.generatedScripts) {
          throw error
        }

        detail = {
          reference: item,
          generatedScripts: item.generatedScripts,
        }
      }

      activeReferenceIdRef.current = item.id
      setReferenceData(detail.reference)
      setGeneratedScripts(detail.generatedScripts || [])
      setSelectedScript(
        detail.generatedScripts?.find((script) => script.id === item.selectedScriptId) || null,
      )
      setActiveScriptId(item.activeScriptId || null)
      setVersions(
        item.activeScriptId ? await loadScriptVersions(item.activeScriptId) : item.versions || [],
      )
      setEditorSections(deserializeEditorContent(item.editorContent || ''))
      setFeedback(item.feedback || null)
      setPendingSuggestion(null)
      setChatMessages(
        item.chatMessages || [
          {
            id: `history-${item.id}`,
            role: 'assistant',
            content: `${item.title} 작업을 불러왔습니다.`,
          },
        ],
      )
      setCurrentStep(item.selectedScriptId ? 'editor' : 'result')
      setViewTransition('idle')
      setIsEditorEntering(false)
      setIsResultEntering(false)
      setReferenceHistory((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                ...detail.reference,
                generatedScripts: detail.generatedScripts,
              }
            : entry,
        ),
      )
    }

    open().catch((error) => {
      setAnalyzeError(error.message)
    })
  }

  const saveVersion = async (source = 'USER') => {
    if (!activeScriptId) {
      return
    }

    try {
      const serializedContent = serializeEditorSections(editorSections)
      const versionType = source === 'AI' ? 'ai_generation' : 'manual_save'
      const nextVersion = await saveVersionRecord({
        scriptId: activeScriptId,
        title: source === 'AI' ? 'AI 제안 반영본' : '사용자 저장본',
        sections: editorSections,
        versionType,
        score: feedback?.score ?? selectedScript?.score ?? null,
        metadata: {
          referenceId: referenceData?.id,
          selectedLabel: selectedScript?.label,
        },
      })

      setVersions((current) => {
        const next = [nextVersion, ...current]
        syncHistory(activeReferenceIdRef.current, {
          activeScriptId,
          versions: next,
          editorContent: serializedContent,
        })
        return next
      })
      showToast('버전 저장 완료')
    } catch (error) {
      setChatMessages((current) => [
        ...current,
        {
          id: `version-save-error-${Date.now()}`,
          role: 'assistant',
          content: error.message || '버전 저장에 실패했습니다.',
        },
      ])
    }
  }

  const requestFeedback = async () => {
    setIsFeedbackLoading(true)
    try {
      const result = await generateScriptFeedback({
        referenceId: referenceData?.id,
        scriptId: activeScriptId,
        selectedLabel: selectedScript?.label,
        sections: editorSections,
      })
      setFeedback(result)
      setChatMessages((current) => [
        ...current,
        {
          id: `feedback-${Date.now()}`,
          role: 'assistant',
          content: `현재 초안은 ${result.score}점입니다. ${result.summary}`,
        },
      ])
      syncHistory(activeReferenceIdRef.current, {
        feedback: result,
        chatMessages: [
          ...chatMessages,
          {
            id: `feedback-${Date.now()}`,
            role: 'assistant',
            content: `현재 초안은 ${result.score}점입니다. ${result.summary}`,
          },
        ],
      })
    } catch (error) {
      setChatMessages((current) => [
        ...current,
        {
          id: `feedback-error-${Date.now()}`,
          role: 'assistant',
          content: error.message || '피드백 생성에 실패했습니다.',
        },
      ])
    } finally {
      setIsFeedbackLoading(false)
    }
  }

  const applyFeedback = () => {
    if (!feedback?.suggestedSections) {
      return
    }

    const serializedContent = serializeEditorSections(feedback.suggestedSections)
    setEditorSections(createEditorSections(feedback.suggestedSections))
    setPendingSuggestion(null)
    if (!activeScriptId) {
      return
    }

    saveVersionRecord({
      scriptId: activeScriptId,
      title: '피드백 반영본',
      sections: feedback.suggestedSections,
      versionType: 'feedback_apply',
      score: feedback.score,
      metadata: {
        referenceId: referenceData?.id,
        selectedLabel: selectedScript?.label,
        feedbackSummary: feedback.summary,
      },
    })
      .then((nextVersion) => {
        setVersions((current) => {
          const next = [nextVersion, ...current]
          syncHistory(activeReferenceIdRef.current, {
            activeScriptId,
            editorContent: serializedContent,
            versions: next,
            feedback,
          })
          return next
        })
        showToast('피드백 반영 저장 완료')
      })
      .catch((error) => {
        setChatMessages((current) => [
          ...current,
          {
            id: `feedback-apply-error-${Date.now()}`,
            role: 'assistant',
            content: error.message || '피드백 반영 저장에 실패했습니다.',
          },
        ])
      })
  }

  const sendChatMessage = async () => {
    const normalized = draftMessage.trim()

    if (!normalized) {
      return
    }

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: normalized,
    }

    setDraftMessage('')
    setIsChatLoading(true)
    setChatMessages((current) => [...current, userMessage])

    try {
      const response = await generateChatReply({
        referenceId: referenceData?.id,
        selectedLabel: selectedScript?.label,
        editorSections,
        message: normalized,
      })

      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.message,
        proposedSections: response.proposedSections,
      }

      setPendingSuggestion(response.proposedSections)
      setChatMessages((current) => {
        const next = [...current, assistantMessage]
        syncHistory(activeReferenceIdRef.current, {
          chatMessages: next,
        })
        return next
      })
    } catch (error) {
      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content: error.message || '수정 요청 처리에 실패했습니다.',
        },
      ])
    } finally {
      setIsChatLoading(false)
    }
  }

  const applySuggestion = (sections) => {
    const serializedContent = serializeEditorSections(sections)
    setEditorSections(createEditorSections(sections))
    setPendingSuggestion(sections)
    if (!activeScriptId) {
      return
    }

    saveVersionRecord({
      scriptId: activeScriptId,
      title: 'AI 수정안 적용',
      sections,
      versionType: 'ai_generation',
      score: feedback?.score ?? selectedScript?.score ?? null,
      metadata: {
        referenceId: referenceData?.id,
        selectedLabel: selectedScript?.label,
      },
    })
      .then((nextVersion) => {
        setVersions((current) => {
          const next = [nextVersion, ...current]
          syncHistory(activeReferenceIdRef.current, {
            activeScriptId,
            editorContent: serializedContent,
            versions: next,
          })
          return next
        })
        showToast('AI 수정안 저장 완료')
      })
      .catch((error) => {
        setChatMessages((current) => [
          ...current,
          {
            id: `suggestion-apply-error-${Date.now()}`,
            role: 'assistant',
            content: error.message || 'AI 수정안 저장에 실패했습니다.',
          },
        ])
      })
  }

  const restoreVersion = async (versionId) => {
    const version = versions.find((item) => item.id === versionId)

    if (!version || !activeScriptId) {
      return
    }

    try {
      await restoreScriptVersionRecord({
        scriptId: activeScriptId,
        versionId,
      })

      setEditorSections(deserializeEditorContent(version.content))
      setIsVersionModalOpen(false)
      syncHistory(activeReferenceIdRef.current, {
        activeScriptId,
        editorContent: version.content,
      })
      showToast('버전 복원 완료')
    } catch (error) {
      setChatMessages((current) => [
        ...current,
        {
          id: `restore-version-error-${Date.now()}`,
          role: 'assistant',
          content: error.message || '버전 복원에 실패했습니다.',
        },
      ])
    }
  }

  const exportCurrentScriptPdf = () => {
    downloadScriptPdf({
      title: `${referenceData?.title || '스크립트'} · ${selectedScript?.label || 'Export'}`,
      sections: editorSections,
    })
  }

  const updateEditorSection = (section, value) => {
    setEditorSections((current) => {
      const next = {
        ...current,
        [section]: value,
      }

      syncHistory(activeReferenceIdRef.current, {
        editorContent: serializeEditorSections(next),
      })

      return next
    })
  }

  const value = useMemo(
    () => ({
      isLoggedIn,
      isAuthReady,
      currentUser,
      currentStep,
      referenceData,
      generatedScripts,
      selectedScript,
      chatMessages,
      versions,
      referenceHistory,
      accounts,
      currentAccount,
      accountSetupMap,
      projects,
      currentProjectId,
      isCurrentAccountConfigured: isAccountConfigured(currentAccount?.id),
      feedback,
      editorSections,
      draftMessage,
      uploadTopic,
      uploadTitle,
      analyzeError,
      pendingSuggestion,
      activeScriptId,
      toast,
      isVersionModalOpen,
      isAnalyzing,
      isChatLoading,
      isFeedbackLoading,
      viewTransition,
      isEditorEntering,
      isResultEntering,
      goBackToResults,
      loadReferenceHistory,
      selectAccount,
      addAccount,
      deleteAccount,
      isAccountConfigured,
      markAccountConfigured,
      createProject,
      selectProject,
      deleteProject,
      deleteReferenceHistoryItem,
      startNewProject,
      login,
      signup,
      logout,
      analyzeReference,
      selectScript,
      openReference,
      saveVersion,
      requestFeedback,
      applyFeedback,
      sendChatMessage,
      applySuggestion,
      restoreVersion,
      exportCurrentScriptPdf,
      updateEditorSection,
      setDraftMessage,
      setUploadTopic,
      setUploadTitle,
      setIsVersionModalOpen,
      setToast,
      serializeEditorSections,
    }),
    [
      chatMessages,
      currentStep,
      draftMessage,
      analyzeError,
      accounts,
      currentAccount,
      accountSetupMap,
      projects,
      currentProjectId,
      deleteAccount,
      currentUser,
      isAuthReady,
      editorSections,
      feedback,
      generatedScripts,
      isAnalyzing,
      isChatLoading,
      isFeedbackLoading,
      isEditorEntering,
      isLoggedIn,
      isResultEntering,
      isVersionModalOpen,
      pendingSuggestion,
      activeScriptId,
      toast,
      referenceData,
      referenceHistory,
      selectedScript,
      uploadTitle,
      uploadTopic,
      viewTransition,
      versions,
      createProject,
      selectProject,
      deleteProject,
      deleteReferenceHistoryItem,
      startNewProject,
      logout,
    ],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState() {
  const context = useContext(AppStateContext)

  if (!context) {
    throw new Error('useAppState must be used inside AppStateProvider')
  }

  return context
}
