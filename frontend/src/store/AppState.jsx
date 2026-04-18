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
  updateReferenceVideo as updateReferenceVideoRecord,
} from '../lib/referenceApi'
import {
  createProject as createProjectRecord,
  deleteProjectById,
  listProjects as listProjectRecords,
} from '../lib/projectApi'
import {
  createScriptSelection,
  downloadScriptPdf,
  loadScriptVersions,
  restoreScriptVersionRecord,
  saveVersionRecord,
} from '../lib/scriptApi'

const AppStateContext = createContext(null)
const ACCOUNT_SETUP_KEY = 'personal-ai-service:account-setup-map'
const REFERENCE_HISTORY_CACHE_KEY = 'personal-ai-service:reference-history-cache:v1'
const REFERENCE_HISTORY_CACHE_TTL_MS = 1000 * 60 * 60 * 24
const ACCOUNTS_CACHE_KEY = 'personal-ai-service:accounts-cache:v1'
const ACCOUNTS_CACHE_TTL_MS = 1000 * 60 * 60 * 24
const REFERENCE_DETAIL_CACHE_KEY = 'personal-ai-service:reference-detail-cache:v1'
const REFERENCE_DETAIL_CACHE_TTL_MS = 1000 * 60 * 60 * 24
const SCRIPT_VERSIONS_CACHE_KEY = 'personal-ai-service:script-versions-cache:v1'
const SCRIPT_VERSIONS_CACHE_TTL_MS = 1000 * 60 * 60 * 12
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

function hasOAuthTokenHash() {
  if (typeof window === 'undefined') {
    return false
  }

  const rawHash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash

  if (!rawHash) {
    return false
  }

  const hashParams = new URLSearchParams(rawHash)
  return hashParams.has('access_token') || hashParams.has('refresh_token') || hashParams.has('provider_token')
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

function normalizeHistoryCacheItem(item = {}) {
  if (!item?.id) {
    return null
  }

  const normalizedChatMessages = Array.isArray(item.chatMessages)
    ? item.chatMessages
        .map((message) => {
          if (!message || typeof message !== 'object') {
            return null
          }
          return {
            id: String(message.id || `msg-${Date.now()}`),
            role: message.role === 'user' ? 'user' : 'assistant',
            content: String(message.content || ''),
            feedback:
              message.feedback && typeof message.feedback === 'object' ? message.feedback : undefined,
            proposedSections:
              message.proposedSections && typeof message.proposedSections === 'object'
                ? message.proposedSections
                : undefined,
          }
        })
        .filter(Boolean)
        .slice(-60)
    : []

  return {
    id: String(item.id),
    title: typeof item.title === 'string' ? item.title : '',
    topic: typeof item.topic === 'string' ? item.topic : '',
    fileName: typeof item.fileName === 'string' ? item.fileName : '',
    createdAt: item.createdAt || item.created_at || null,
    updatedAt: item.updatedAt || item.updated_at || null,
    status: item.status || null,
    projectId: item.projectId || item.project_id || null,
    thumbnailUrl: item.thumbnailUrl || item.thumbnail_url || null,
    selectedScriptId: typeof item.selectedScriptId === 'string' ? item.selectedScriptId : null,
    activeScriptId: typeof item.activeScriptId === 'string' ? item.activeScriptId : null,
    editorContent: typeof item.editorContent === 'string' ? item.editorContent : '',
    versions: Array.isArray(item.versions) ? item.versions : [],
    feedback: item.feedback && typeof item.feedback === 'object' ? item.feedback : null,
    generatedScripts: Array.isArray(item.generatedScripts) ? item.generatedScripts : [],
    chatMessages: normalizedChatMessages,
    lastStep:
      item.lastStep === 'editor' || item.lastStep === 'result' || item.lastStep === 'upload'
        ? item.lastStep
        : null,
  }
}

function mergeHistoryItem(serverItem, localItem) {
  const normalizedServer = normalizeHistoryCacheItem(serverItem)
  if (!normalizedServer) {
    return null
  }

  const normalizedLocal = normalizeHistoryCacheItem(localItem || {})
  if (!normalizedLocal) {
    return normalizedServer
  }

  return {
    ...normalizedServer,
    projectId: normalizedServer.projectId || normalizedLocal.projectId || null,
    selectedScriptId: normalizedLocal.selectedScriptId || normalizedServer.selectedScriptId,
    activeScriptId: normalizedLocal.activeScriptId || normalizedServer.activeScriptId,
    editorContent: normalizedLocal.editorContent || normalizedServer.editorContent,
    versions: normalizedLocal.versions?.length ? normalizedLocal.versions : normalizedServer.versions,
    feedback: normalizedLocal.feedback || normalizedServer.feedback,
    generatedScripts:
      normalizedLocal.generatedScripts?.length ? normalizedLocal.generatedScripts : normalizedServer.generatedScripts,
    chatMessages:
      normalizedLocal.chatMessages?.length ? normalizedLocal.chatMessages : normalizedServer.chatMessages,
    lastStep: normalizedLocal.lastStep || normalizedServer.lastStep,
  }
}

function getStoredReferenceHistoryCacheMap() {
  if (typeof window === 'undefined') {
    return {}
  }

  const raw = window.localStorage.getItem(REFERENCE_HISTORY_CACHE_KEY)
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

function setStoredReferenceHistoryCacheMap(next) {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(REFERENCE_HISTORY_CACHE_KEY, JSON.stringify(next))
}

function getCachedReferenceHistory(accountId) {
  if (!accountId) {
    return []
  }

  const map = getStoredReferenceHistoryCacheMap()
  const bucket = map[accountId]
  if (!bucket || typeof bucket !== 'object') {
    return []
  }

  const updatedAt = Number(bucket.updatedAt || 0)
  if (updatedAt > 0 && Date.now() - updatedAt > REFERENCE_HISTORY_CACHE_TTL_MS) {
    return []
  }

  const items = Array.isArray(bucket.items) ? bucket.items : []
  return items.map(normalizeHistoryCacheItem).filter(Boolean)
}

function setCachedReferenceHistory(accountId, items) {
  if (!accountId) {
    return
  }

  const normalized = Array.isArray(items)
    ? items.map(normalizeHistoryCacheItem).filter(Boolean).slice(0, 25)
    : []
  const map = getStoredReferenceHistoryCacheMap()
  map[accountId] = {
    updatedAt: Date.now(),
    items: normalized,
  }
  setStoredReferenceHistoryCacheMap(map)
}

function getStoredMap(key) {
  if (typeof window === 'undefined') {
    return {}
  }

  const raw = window.localStorage.getItem(key)
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

function setStoredMap(key, next) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(key, JSON.stringify(next))
}

function resolveOwnerCacheKey(user) {
  return String(user?.id || user?.email || '').trim()
}

function getCachedAccounts(user) {
  const ownerKey = resolveOwnerCacheKey(user)
  if (!ownerKey) {
    return []
  }

  const map = getStoredMap(ACCOUNTS_CACHE_KEY)
  const bucket = map[ownerKey]
  if (!bucket || typeof bucket !== 'object') {
    return []
  }

  const updatedAt = Number(bucket.updatedAt || 0)
  if (updatedAt > 0 && Date.now() - updatedAt > ACCOUNTS_CACHE_TTL_MS) {
    return []
  }

  const items = Array.isArray(bucket.items) ? bucket.items : []
  return items
    .map((item) => {
      if (!item?.id) {
        return null
      }
      return {
        id: String(item.id),
        name: typeof item.name === 'string' ? item.name : '',
        slug: typeof item.slug === 'string' ? item.slug : '',
        created_at: item.created_at || null,
      }
    })
    .filter(Boolean)
}

function setCachedAccounts(user, accounts) {
  const ownerKey = resolveOwnerCacheKey(user)
  if (!ownerKey) {
    return
  }

  const normalized = Array.isArray(accounts)
    ? accounts
        .map((item) => {
          if (!item?.id) {
            return null
          }
          return {
            id: String(item.id),
            name: typeof item.name === 'string' ? item.name : '',
            slug: typeof item.slug === 'string' ? item.slug : '',
            created_at: item.created_at || null,
          }
        })
        .filter(Boolean)
    : []

  const map = getStoredMap(ACCOUNTS_CACHE_KEY)
  map[ownerKey] = {
    updatedAt: Date.now(),
    items: normalized,
  }
  setStoredMap(ACCOUNTS_CACHE_KEY, map)
}

function referenceDetailCacheKey(accountId, referenceId) {
  return `${String(accountId || '').trim()}::${String(referenceId || '').trim()}`
}

function getCachedReferenceDetail(accountId, referenceId) {
  const key = referenceDetailCacheKey(accountId, referenceId)
  if (!key || key === '::') {
    return null
  }
  const map = getStoredMap(REFERENCE_DETAIL_CACHE_KEY)
  const bucket = map[key]
  if (!bucket || typeof bucket !== 'object') {
    return null
  }
  const updatedAt = Number(bucket.updatedAt || 0)
  if (updatedAt > 0 && Date.now() - updatedAt > REFERENCE_DETAIL_CACHE_TTL_MS) {
    return null
  }
  if (!bucket.reference || !Array.isArray(bucket.generatedScripts)) {
    return null
  }
  return {
    reference: bucket.reference,
    generatedScripts: bucket.generatedScripts,
  }
}

function setCachedReferenceDetail(accountId, referenceId, detail) {
  const key = referenceDetailCacheKey(accountId, referenceId)
  if (!key || key === '::') {
    return
  }
  if (!detail?.reference || !Array.isArray(detail.generatedScripts)) {
    return
  }

  const map = getStoredMap(REFERENCE_DETAIL_CACHE_KEY)
  map[key] = {
    updatedAt: Date.now(),
    reference: detail.reference,
    generatedScripts: detail.generatedScripts,
  }
  setStoredMap(REFERENCE_DETAIL_CACHE_KEY, map)
}

function removeCachedReferenceDetail(accountId, referenceId) {
  const key = referenceDetailCacheKey(accountId, referenceId)
  if (!key || key === '::') {
    return
  }
  const map = getStoredMap(REFERENCE_DETAIL_CACHE_KEY)
  if (!(key in map)) {
    return
  }
  delete map[key]
  setStoredMap(REFERENCE_DETAIL_CACHE_KEY, map)
}

function scriptVersionsCacheKey(accountId, scriptId) {
  return `${String(accountId || '').trim()}::${String(scriptId || '').trim()}`
}

function getCachedScriptVersions(accountId, scriptId) {
  const key = scriptVersionsCacheKey(accountId, scriptId)
  if (!key || key === '::') {
    return []
  }
  const map = getStoredMap(SCRIPT_VERSIONS_CACHE_KEY)
  const bucket = map[key]
  if (!bucket || typeof bucket !== 'object') {
    return []
  }
  const updatedAt = Number(bucket.updatedAt || 0)
  if (updatedAt > 0 && Date.now() - updatedAt > SCRIPT_VERSIONS_CACHE_TTL_MS) {
    return []
  }
  return Array.isArray(bucket.items) ? bucket.items : []
}

function setCachedScriptVersions(accountId, scriptId, versions) {
  const key = scriptVersionsCacheKey(accountId, scriptId)
  if (!key || key === '::') {
    return
  }

  const map = getStoredMap(SCRIPT_VERSIONS_CACHE_KEY)
  map[key] = {
    updatedAt: Date.now(),
    items: Array.isArray(versions) ? versions : [],
  }
  setStoredMap(SCRIPT_VERSIONS_CACHE_KEY, map)
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

function toHistoryStep(currentStep) {
  if (currentStep === 'editor') {
    return 'editor'
  }
  if (currentStep === 'result') {
    return 'result'
  }
  return 'upload'
}

function isAnalyzePage() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.location.pathname === '/analyze'
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
  const historyStepRef = useRef(null)
  const suppressNextHistoryPushRef = useRef(false)
  const activeAccountIdRef = useRef(null)
  const referenceHistoryReadyByAccountRef = useRef({})

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

  const applyHistoryStep = (step) => {
    if (step === 'editor') {
      if (selectedScript) {
        setCurrentStep('editor')
      } else if (referenceData) {
        setCurrentStep('result')
      } else {
        setCurrentStep('upload')
      }
    } else if (step === 'result') {
      if (referenceData) {
        setCurrentStep('result')
      } else {
        setCurrentStep('upload')
      }
    } else {
      setCurrentStep('upload')
    }

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
      const lowerMessage = String(error.message || '').toLowerCase()
      if (lowerMessage.includes('only request this after')) {
        return {
          user: null,
          requiresEmailConfirmation: true,
          rateLimited: true,
        }
      }
      throw new Error(error.message || '회원가입에 실패했습니다.')
    }

    if (!data?.user) {
      throw new Error('회원가입에 실패했습니다. 잠시 후 다시 시도해주세요.')
    }

    // When email confirmation is enabled, Supabase returns a user without a session.
    // Treat this as a successful signup and move the user to login after verification.
    if (!data.session) {
      setIsLoggedIn(false)
      setCurrentUser(null)
      return {
        user: data.user,
        requiresEmailConfirmation: true,
      }
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

    return {
      user: data.user,
      requiresEmailConfirmation: false,
    }
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

    let canceled = false

    const run = async () => {
      const ownerCacheKey = resolveOwnerCacheKey(currentUser)
      const cachedAccounts = getCachedAccounts(currentUser)

      if (cachedAccounts.length) {
        setAccounts(cachedAccounts)
        const storedAccountId = getStoredAccountId()
        const cachedCurrentAccount =
          cachedAccounts.find((item) => item.id === storedAccountId) || cachedAccounts[0] || null
        if (cachedCurrentAccount) {
          setStoredAccountId(cachedCurrentAccount.id)
        }
        setCurrentAccount(cachedCurrentAccount)
      }

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

        if (canceled) {
          return
        }

        setAccounts(nextAccounts)
        if (ownerCacheKey) {
          setCachedAccounts(currentUser, nextAccounts)
        }

        const storedAccountId = getStoredAccountId()
        const nextCurrentAccount =
          nextAccounts.find((item) => item.id === storedAccountId) || nextAccounts[0] || null

        if (nextCurrentAccount) {
          setStoredAccountId(nextCurrentAccount.id)
        }

        setCurrentAccount(nextCurrentAccount)
      } catch (_error) {
        if (!cachedAccounts.length) {
          setAccounts([])
          setCurrentAccount(null)
        }
      }
    }

    run()
    return () => {
      canceled = true
    }
  }, [isLoggedIn, currentUser?.email, currentUser?.id])

  useEffect(() => {
    if (!isAnalyzePage()) {
      return undefined
    }

    const handlePopState = (event) => {
      const nextStepFromState =
        event?.state?.studioStep ||
        (() => {
          const hash = String(window.location.hash || '').replace(/^#/, '').trim()
          if (hash === 'upload' || hash === 'result' || hash === 'editor') {
            return hash
          }
          return null
        })()

      if (!nextStepFromState) {
        return
      }

      suppressNextHistoryPushRef.current = true
      applyHistoryStep(nextStepFromState)
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [referenceData, selectedScript])

  useEffect(() => {
    if (!isAnalyzePage()) {
      return
    }

    if (!isAuthReady || hasOAuthTokenHash()) {
      return
    }

    const nextHistoryStep = toHistoryStep(currentStep)
    const currentState = window.history.state || {}
    const nextUrl = `${window.location.pathname}${window.location.search}#${nextHistoryStep}`

    if (!historyStepRef.current) {
      window.history.replaceState(
        {
          ...currentState,
          studioStep: nextHistoryStep,
        },
        '',
        nextUrl,
      )
      historyStepRef.current = nextHistoryStep
      return
    }

    if (historyStepRef.current === nextHistoryStep) {
      return
    }

    if (suppressNextHistoryPushRef.current) {
      suppressNextHistoryPushRef.current = false
      historyStepRef.current = nextHistoryStep
      return
    }

    window.history.pushState(
      {
        ...currentState,
        studioStep: nextHistoryStep,
      },
      '',
      nextUrl,
    )
    historyStepRef.current = nextHistoryStep
  }, [currentStep, isAuthReady])

  useEffect(() => {
    if (!isLoggedIn || !currentAccount?.id) {
      return
    }

    activeAccountIdRef.current = currentAccount.id
    referenceHistoryReadyByAccountRef.current[currentAccount.id] = false

    const cached = getCachedReferenceHistory(currentAccount.id)
    if (cached.length) {
      setReferenceHistory(cached)
    } else {
      setReferenceHistory([])
    }

    referenceHistoryReadyByAccountRef.current[currentAccount.id] = true
    loadReferenceHistory(currentAccount.id)
  }, [isLoggedIn, currentAccount?.id])

  useEffect(() => {
    if (!isLoggedIn || !currentAccount?.id) {
      setProjects([])
      setCurrentProjectId(null)
      return
    }

    let canceled = false

    const run = async () => {
      try {
        const items = await listProjectRecords()
        if (canceled) {
          return
        }
        setProjects(items)
        setCurrentProjectId((current) => {
          if (current && items.some((item) => item.id === current)) {
            return current
          }
          return null
        })
      } catch (_error) {
        if (!canceled) {
          setProjects([])
          setCurrentProjectId(null)
        }
      }
    }

    run()
    return () => {
      canceled = true
    }
  }, [isLoggedIn, currentAccount?.id])

  useEffect(() => {
    if (!isLoggedIn || !accounts.length) {
      return
    }
    setCachedAccounts(currentUser, accounts)
  }, [accounts, currentUser, isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn || !currentAccount?.id) {
      return
    }
    if (!referenceHistoryReadyByAccountRef.current[currentAccount.id]) {
      return
    }
    setCachedReferenceHistory(currentAccount.id, referenceHistory)
  }, [isLoggedIn, currentAccount?.id, referenceHistory])

  const loadReferenceHistory = async (accountId = currentAccount?.id) => {
    if (!accountId) {
      return
    }
    try {
      const items = await listReferenceVideoHistory()
      if (activeAccountIdRef.current !== accountId) {
        return
      }
      setReferenceHistory((current) => {
        const merged = (Array.isArray(items) ? items : [])
          .map((serverItem) => {
            const matchedLocal = current.find((localItem) => localItem.id === serverItem.id)
            return mergeHistoryItem(serverItem, matchedLocal)
          })
          .filter(Boolean)
        setCachedReferenceHistory(accountId, merged)
        return merged
      })
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

  const createProject = async (name = '') => {
    if (!currentAccount?.id) {
      return null
    }

    const normalizedName = name.trim()
    const baseName = normalizedName || '새 프로젝트'
    const created = await createProjectRecord({
      name: baseName,
      accountId: currentAccount.id,
    })
    if (!created) {
      return null
    }
    setProjects((current) => [...current, created])
    setCurrentProjectId(created.id)
    return created
  }

  const selectProject = (projectId) => {
    if (!projectId) {
      setCurrentProjectId(null)
      return
    }

    if (projectId === currentProjectId) {
      return
    }

    const exists = projects.some((item) => item.id === projectId)
    if (!exists) {
      return
    }

    setCurrentProjectId(projectId)
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

  const updateCurrentAccountName = (accountId, nextName) => {
    const normalizedAccountId = String(accountId || '').trim()
    const normalizedName = String(nextName || '').trim()

    if (!normalizedAccountId || !normalizedName) {
      return
    }

    setAccounts((current) =>
      current.map((item) =>
        item.id === normalizedAccountId
          ? {
              ...item,
              name: normalizedName,
            }
          : item,
      ),
    )

    if (currentAccount?.id === normalizedAccountId) {
      setCurrentAccount((current) =>
        current
          ? {
              ...current,
              name: normalizedName,
            }
          : current,
      )
    }
  }

  const isAccountConfigured = (accountId) => Boolean(accountId && accountSetupMap[accountId])

  const deleteProject = async (projectId) => {
    if (!projectId) {
      return false
    }

    try {
      await deleteProjectById(projectId)
    } catch (error) {
      showToast(error.message || '프로젝트 삭제에 실패했습니다.', 'error')
      return false
    }

    const nextProjects = projects.filter((item) => item.id !== projectId)
    setProjects(nextProjects)
    setReferenceHistory((current) =>
      current.map((item) =>
        item.projectId === projectId
          ? {
              ...item,
              projectId: null,
            }
          : item,
      ),
    )

    if (currentProjectId === projectId) {
      setCurrentProjectId(null)
    }
    return true
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
    removeCachedReferenceDetail(currentAccount?.id, referenceId)

    if (activeReferenceIdRef.current === referenceId || referenceData?.id === referenceId) {
      startNewProject()
    }

    showToast('대화내역을 삭제했습니다.')
    return true
  }

  const renameReferenceHistoryItem = async (referenceId, nextTitle) => {
    const normalizedTitle = String(nextTitle || '').trim()
    if (!normalizedTitle) {
      throw new Error('이름을 입력하세요.')
    }

    const updated = await updateReferenceVideoRecord(referenceId, {
      title: normalizedTitle,
      accountId: currentAccount?.id,
    })

    setReferenceHistory((current) =>
      current.map((item) =>
        item.id === referenceId
          ? {
              ...item,
              title: updated?.title || normalizedTitle,
            }
          : item,
      ),
    )

    if (referenceData?.id === referenceId) {
      setReferenceData((current) =>
        current
          ? {
              ...current,
              title: updated?.title || normalizedTitle,
            }
          : current,
      )
    }

    return updated
  }

  const moveReferenceToProject = async (referenceId, projectId) => {
    const targetProjectId = String(projectId || '').trim() || null
    const updated = await updateReferenceVideoRecord(referenceId, {
      projectId: targetProjectId,
      accountId: currentAccount?.id,
    })

    setReferenceHistory((current) =>
      current.map((item) =>
        item.id === referenceId
          ? {
              ...item,
              projectId: updated?.project_id || targetProjectId,
            }
          : item,
      ),
    )

    return updated
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
      projectId: currentProjectId || null,
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
        accountId: currentAccount?.id,
        topic: effectiveTopic,
        title: uploadTitle,
        projectId: currentProjectId || null,
      })

      const completedReference = {
        ...localReference,
        ...analysis.reference,
        status: 'ready',
      }
      activeReferenceIdRef.current = completedReference.id

      setReferenceData(completedReference)
      setGeneratedScripts(analysis.generatedScripts)
      setCachedReferenceDetail(currentAccount?.id, completedReference.id, {
        reference: completedReference,
        generatedScripts: analysis.generatedScripts,
      })
      setCurrentStep('result')
      setIsResultEntering(true)
      setUploadTitle('')
      setReferenceHistory((current) =>
        current.map((item) =>
          item.id === localReference.id
            ? {
                ...completedReference,
                generatedScripts: analysis.generatedScripts,
                lastStep: 'result',
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
      setCachedScriptVersions(currentAccount?.id, created.script?.id, initialVersions)
      syncHistory(activeReferenceIdRef.current, {
        selectedScriptId: nextScript.id,
        activeScriptId: created.script?.id || null,
        editorContent: serializeEditorSections(nextScript.sections),
        versions: initialVersions,
        lastStep: 'editor',
      })
      setCurrentStep('editor')
      setViewTransition('idle')
      setIsEditorEntering(true)
      setTimeout(() => {
        setIsEditorEntering(false)
      }, 420)
    } catch (error) {
      setChatMessages((current) => [
        ...current,
        {
          id: `script-create-error-${Date.now()}`,
          role: 'assistant',
          content: error.message || '에디터용 스크립트 생성에 실패했습니다.',
        },
      ])
      setCurrentStep('result')
      setViewTransition('idle')
    }
  }

  const goBackToResults = () => {
    if (!generatedScripts.length) {
      return
    }

    syncHistory(activeReferenceIdRef.current, {
      lastStep: 'result',
    })

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

  const goBackToUpload = () => {
    startNewProject()
  }

  const openReference = (referenceId) => {
    const item = referenceHistory.find((entry) => entry.id === referenceId)

    if (!item) {
      return
    }

    const applyOpenedState = ({ detail, baseItem }) => {
      activeReferenceIdRef.current = baseItem.id
      setReferenceData(detail.reference)
      setGeneratedScripts(detail.generatedScripts || [])
      setSelectedScript(
        detail.generatedScripts?.find((script) => script.id === baseItem.selectedScriptId) || null,
      )
      setActiveScriptId(baseItem.activeScriptId || null)

      if (baseItem.activeScriptId) {
        const cachedVersions = getCachedScriptVersions(currentAccount?.id, baseItem.activeScriptId)
        if (cachedVersions.length) {
          setVersions(cachedVersions)
        } else if (Array.isArray(baseItem.versions) && baseItem.versions.length) {
          setVersions(baseItem.versions)
          setCachedScriptVersions(currentAccount?.id, baseItem.activeScriptId, baseItem.versions)
        } else {
          setVersions([])
        }

        loadScriptVersions(baseItem.activeScriptId)
          .then((freshVersions) => {
            setVersions(freshVersions || [])
            setCachedScriptVersions(currentAccount?.id, baseItem.activeScriptId, freshVersions || [])
          })
          .catch(() => {
            // keep cached versions when refresh fails
          })
      } else {
        setVersions(Array.isArray(baseItem.versions) ? baseItem.versions : [])
      }

      setEditorSections(deserializeEditorContent(baseItem.editorContent || ''))
      setFeedback(baseItem.feedback || null)
      setPendingSuggestion(null)
      setChatMessages(
        baseItem.chatMessages || [
          {
            id: `history-${baseItem.id}`,
            role: 'assistant',
            content: `${baseItem.title} 작업을 불러왔습니다.`,
          },
        ],
      )
      const restoredStep =
        baseItem.lastStep === 'editor' &&
        detail.generatedScripts?.some((script) => script.id === baseItem.selectedScriptId)
          ? 'editor'
          : 'result'
      setCurrentStep(restoredStep)
      setViewTransition('idle')
      setIsEditorEntering(false)
      setIsResultEntering(false)
      setReferenceHistory((current) =>
        current.map((entry) =>
          entry.id === baseItem.id
            ? {
                ...entry,
                ...detail.reference,
                generatedScripts: detail.generatedScripts,
                lastStep: restoredStep,
              }
            : entry,
        ),
      )
    }

    const cachedDetail = getCachedReferenceDetail(currentAccount?.id, referenceId)
    if (cachedDetail) {
      applyOpenedState({ detail: cachedDetail, baseItem: item })
    }

    const open = async () => {
      let detail
      try {
        detail = await fetchReferenceVideoDetail(referenceId)
      } catch (error) {
        if (cachedDetail) {
          return
        }

        if (!item.generatedScripts) {
          throw error
        }

        detail = {
          reference: item,
          generatedScripts: item.generatedScripts,
        }
      }
      setCachedReferenceDetail(currentAccount?.id, referenceId, detail)
      applyOpenedState({ detail, baseItem: item })
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
        setCachedScriptVersions(currentAccount?.id, activeScriptId, next)
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
    const userFeedbackRequestMessage = {
      id: `user-feedback-${Date.now()}`,
      role: 'user',
      content: '피드백',
    }

    setIsFeedbackLoading(true)
    setChatMessages((current) => {
      const next = [...current, userFeedbackRequestMessage]
      syncHistory(activeReferenceIdRef.current, {
        chatMessages: next,
      })
      return next
    })

    try {
      const result = await generateScriptFeedback({
        referenceId: referenceData?.id,
        scriptId: activeScriptId,
        selectedLabel: selectedScript?.label,
        sections: editorSections,
      })
      setFeedback(result)
      setChatMessages((current) => {
        const next = [
          ...current,
          {
            id: `feedback-${Date.now()}`,
            role: 'assistant',
            content: result.summary || `현재 초안은 ${result.score}점입니다.`,
            feedback: result,
          },
        ]
        syncHistory(activeReferenceIdRef.current, {
          feedback: result,
          chatMessages: next,
        })
        return next
      })
    } catch (error) {
      setChatMessages((current) => {
        const next = [
          ...current,
          {
            id: `feedback-error-${Date.now()}`,
            role: 'assistant',
            content: error.message || '피드백 생성에 실패했습니다.',
          },
        ]
        syncHistory(activeReferenceIdRef.current, {
          chatMessages: next,
        })
        return next
      })
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
        const appliedMessage = {
          id: `feedback-applied-${Date.now()}`,
          role: 'assistant',
          content: '피드백을 반영해서 대본을 수정했습니다. 새로운 버전으로 저장되었어요!',
        }

        setVersions((current) => {
          const next = [nextVersion, ...current]
          setCachedScriptVersions(currentAccount?.id, activeScriptId, next)
          syncHistory(activeReferenceIdRef.current, {
            activeScriptId,
            editorContent: serializedContent,
            versions: next,
            feedback,
          })
          return next
        })
        setChatMessages((current) => {
          const next = [...current, appliedMessage]
          syncHistory(activeReferenceIdRef.current, {
            chatMessages: next,
          })
          return next
        })
        showToast('피드백 반영 저장 완료')
      })
      .catch((error) => {
        setChatMessages((current) => {
          const next = [
            ...current,
            {
              id: `feedback-apply-error-${Date.now()}`,
              role: 'assistant',
              content: error.message || '피드백 반영 저장에 실패했습니다.',
            },
          ]
          syncHistory(activeReferenceIdRef.current, {
            chatMessages: next,
          })
          return next
        })
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
    setChatMessages((current) => {
      const next = [...current, userMessage]
      syncHistory(activeReferenceIdRef.current, {
        chatMessages: next,
      })
      return next
    })

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
      setChatMessages((current) => {
        const next = [
          ...current,
          {
            id: `assistant-error-${Date.now()}`,
            role: 'assistant',
            content: error.message || '수정 요청 처리에 실패했습니다.',
          },
        ]
        syncHistory(activeReferenceIdRef.current, {
          chatMessages: next,
        })
        return next
      })
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
          setCachedScriptVersions(currentAccount?.id, activeScriptId, next)
          syncHistory(activeReferenceIdRef.current, {
            activeScriptId,
            editorContent: serializedContent,
            versions: next,
            lastStep: 'editor',
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
        lastStep: 'editor',
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
        lastStep: currentStep === 'editor' ? 'editor' : 'result',
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
      goBackToUpload,
      goBackToResults,
      loadReferenceHistory,
      selectAccount,
      addAccount,
      deleteAccount,
      isAccountConfigured,
      markAccountConfigured,
      updateCurrentAccountName,
      createProject,
      selectProject,
      deleteProject,
      renameReferenceHistoryItem,
      moveReferenceToProject,
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
      updateCurrentAccountName,
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
      renameReferenceHistoryItem,
      moveReferenceToProject,
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
