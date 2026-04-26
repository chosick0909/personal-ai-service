import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { getStoredAccountId, setStoredAccountId } from '../lib/api'
import { createAccount, deleteAccountById, listAccounts, loadAccountProfile } from '../lib/accountApi'
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
import { applyCouponCode, loadMyEntitlement } from '../lib/entitlementApi'

const AppStateContext = createContext(null)
const REFERENCE_HISTORY_CACHE_KEY = 'personal-ai-service:reference-history-cache:v1'
const REFERENCE_HISTORY_CACHE_TTL_MS = 1000 * 60 * 60 * 24
const ACCOUNTS_CACHE_KEY = 'personal-ai-service:accounts-cache:v1'
const ACCOUNTS_CACHE_TTL_MS = 1000 * 60 * 60 * 24
const REFERENCE_DETAIL_CACHE_KEY = 'personal-ai-service:reference-detail-cache:v1'
const REFERENCE_DETAIL_CACHE_TTL_MS = 1000 * 60 * 60 * 24
const REFERENCE_DETAIL_PREFETCH_LIMIT = 8
const SCRIPT_VERSIONS_CACHE_KEY = 'personal-ai-service:script-versions-cache:v1'
const SCRIPT_VERSIONS_CACHE_TTL_MS = 1000 * 60 * 60 * 12
const PROCESSING_POLL_FAST_MS = 3000
const PROCESSING_POLL_NORMAL_MS = 5000
const PROCESSING_POLL_SLOW_MS = 10000
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
const COPILOT_CHAT_LIMIT_PER_DRAFT = 5
const COPILOT_FEEDBACK_LIMIT_PER_DRAFT = 2

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

function hasNonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasConfiguredProducts(products) {
  if (!Array.isArray(products)) {
    return false
  }

  return products.some((product) =>
    hasNonEmptyText(product?.name) ||
    hasNonEmptyText(product?.price) ||
    hasNonEmptyText(product?.description),
  )
}

function hasMeaningfulAccountSettings(profile) {
  const settings = profile?.settings && typeof profile.settings === 'object' ? profile.settings : {}
  const persona = settings.persona && typeof settings.persona === 'object' ? settings.persona : {}
  const strategyPreferences = Array.isArray(settings.strategyPreferences)
    ? settings.strategyPreferences.filter((item) => hasNonEmptyText(String(item || '')))
    : []

  return (
    hasNonEmptyText(settings.category) ||
    hasNonEmptyText(settings.accountGoal) ||
    hasNonEmptyText(settings.voiceTone) ||
    hasNonEmptyText(settings.characterPrompt) ||
    hasNonEmptyText(settings.aiAdditionalInfo) ||
    hasConfiguredProducts(settings.products) ||
    strategyPreferences.length > 0 ||
    hasNonEmptyText(persona.age) ||
    (hasNonEmptyText(persona.gender) && String(persona.gender).trim() !== '선택') ||
    hasNonEmptyText(persona.job) ||
    hasNonEmptyText(persona.interests) ||
    hasNonEmptyText(persona.painPoints) ||
    hasNonEmptyText(persona.desiredChange)
  )
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
    transcript: typeof item.transcript === 'string' ? item.transcript : '',
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
    transcript: normalizedLocal.transcript || normalizedServer.transcript || '',
    versions: normalizedLocal.versions?.length ? normalizedLocal.versions : normalizedServer.versions,
    feedback: normalizedLocal.feedback || normalizedServer.feedback,
    generatedScripts:
      normalizedLocal.generatedScripts?.length ? normalizedLocal.generatedScripts : normalizedServer.generatedScripts,
    chatMessages:
      normalizedLocal.chatMessages?.length ? normalizedLocal.chatMessages : normalizedServer.chatMessages,
    lastStep: normalizedLocal.lastStep || normalizedServer.lastStep,
  }
}

function pickPreferredAccount(accounts = [], {
  preferredAccountId = '',
  currentAccountId = '',
  configuredMap = {},
} = {}) {
  if (!Array.isArray(accounts) || !accounts.length) {
    return null
  }

  const normalizedPreferred = String(preferredAccountId || '').trim()
  const normalizedCurrent = String(currentAccountId || '').trim()
  const configuredAccount = accounts.find((account) => Boolean(configuredMap?.[account.id]))

  return (
    accounts.find((account) => account.id === normalizedPreferred) ||
    accounts.find((account) => account.id === normalizedCurrent) ||
    configuredAccount ||
    accounts[0]
  )
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

function removeCachedReferenceDetailsForAccount(accountId) {
  const normalizedAccountId = String(accountId || '').trim()
  if (!normalizedAccountId) {
    return
  }

  const map = getStoredMap(REFERENCE_DETAIL_CACHE_KEY)
  const prefix = `${normalizedAccountId}::`
  let changed = false

  Object.keys(map).forEach((key) => {
    if (key.startsWith(prefix)) {
      delete map[key]
      changed = true
    }
  })

  if (changed) {
    setStoredMap(REFERENCE_DETAIL_CACHE_KEY, map)
  }
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

function createInitialCopilotUsage() {
  return {
    chatUsed: 0,
    feedbackUsed: 0,
  }
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

function classifyAnalyzeFailure(error) {
  const code = String(error?.code || '').trim().toUpperCase()
  const name = String(error?.name || '').trim()
  const message = String(error?.message || '')

  if (name === 'AbortError' || /timeout|failed to fetch|networkerror|network request failed/i.test(message)) {
    return {
      type: 'recovering',
      message:
        '브라우저 연결이 끊겼습니다. 서버에 등록된 분석 작업이 있으면 최근 분석에서 이어서 확인합니다.',
    }
  }

  if (code === 'FILE_TOO_LARGE' || code === 'LIMIT_FILE_SIZE') {
    return {
      type: 'file-too-large',
      message: '용량 초과: 영상은 최대 300MB까지 업로드할 수 있습니다. 파일 용량을 줄여 다시 시도해주세요.',
    }
  }

  return {
    type: 'general',
    message: message || '영상 분석에 실패했습니다. 잠시 후 다시 시도해주세요.',
  }
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
  const [accountSetupMap, setAccountSetupMap] = useState({})
  const [projects, setProjects] = useState(initialState.projects)
  const [currentProjectId, setCurrentProjectId] = useState(initialState.currentProjectId)
  const [activeScriptId, setActiveScriptId] = useState(null)
  const [uploadTopic, setUploadTopic] = useState('')
  const [uploadTitle, setUploadTitle] = useState('')
  const [analyzeError, setAnalyzeError] = useState('')
  const [analyzeErrorType, setAnalyzeErrorType] = useState('')
  const [uploadPhase, setUploadPhase] = useState('idle')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false)
  const [isApplyingFeedback, setIsApplyingFeedback] = useState(false)
  const [viewTransition, setViewTransition] = useState('idle')
  const [isEditorEntering, setIsEditorEntering] = useState(false)
  const [isResultEntering, setIsResultEntering] = useState(false)
  const [toast, setToast] = useState(null)
  const [copilotUsage, setCopilotUsage] = useState(createInitialCopilotUsage())
  const [currentUser, setCurrentUser] = useState(null)
  const [entitlementStatus, setEntitlementStatus] = useState(null)
  const [isEntitlementReady, setIsEntitlementReady] = useState(true)
  const activeReferenceIdRef = useRef(null)
  const toastTimerRef = useRef(null)
  const historyStepRef = useRef(null)
  const suppressNextHistoryPushRef = useRef(false)
  const activeAccountIdRef = useRef(null)
  const referenceHistoryReadyByAccountRef = useRef({})
  const processingPollInFlightRef = useRef(new Set())
  const referencePrefetchInFlightRef = useRef(new Set())
  const analysisRunTokenRef = useRef(0)
  const analysisAbortControllerRef = useRef(null)
  const canceledAnalysisTokensRef = useRef(new Set())
  const isCurrentAccountRequest = (accountId) =>
    Boolean(accountId) && activeAccountIdRef.current === accountId

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
        setEntitlementStatus(null)
        setIsEntitlementReady(true)
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
        setEntitlementStatus(null)
        setIsEntitlementReady(true)
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

  const refreshEntitlement = async ({ referenceId } = {}) => {
    if (!isLoggedIn) {
      setEntitlementStatus(null)
      setIsEntitlementReady(true)
      return null
    }

    setIsEntitlementReady(false)
    try {
      const status = await loadMyEntitlement({ referenceId })
      setEntitlementStatus(status)
      return status
    } catch (error) {
      setEntitlementStatus({
        hasAccess: false,
        entitlement: null,
        usage: null,
        error: error.message || '이용권 정보를 불러오지 못했습니다.',
      })
      return null
    } finally {
      setIsEntitlementReady(true)
    }
  }

  const applyCoupon = async (couponCode) => {
    const status = await applyCouponCode(couponCode)
    setEntitlementStatus(status)
    setIsEntitlementReady(true)
    return status
  }

  const getEffectiveCopilotLimit = (kind) => {
    const limits = entitlementStatus?.usage?.limits || entitlementStatus?.entitlement?.limits || {}
    const planLimit =
      kind === 'feedback'
        ? limits.perReferenceFeedbackLimit
        : limits.perReferenceCopilotLimit

    if (entitlementStatus?.hasAccess && planLimit === null) {
      return Infinity
    }

    if (Number.isFinite(Number(planLimit))) {
      return Number(planLimit)
    }

    return kind === 'feedback' ? COPILOT_FEEDBACK_LIMIT_PER_DRAFT : COPILOT_CHAT_LIMIT_PER_DRAFT
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
    setUploadPhase('idle')
    setIsAnalyzing(false)
    setIsChatLoading(false)
    setIsFeedbackLoading(false)
    setViewTransition('idle')
    setIsEditorEntering(false)
    setIsResultEntering(false)
    setCopilotUsage(createInitialCopilotUsage())
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

  const normalizeAuthErrorMessage = (error, mode) => {
    const message = String(error?.message || '').trim()
    const lowerMessage = message.toLowerCase()

    if (lowerMessage.includes('invalid login credentials')) {
      return (
        '이메일 또는 비밀번호가 맞지 않습니다. ' +
        'Google로 가입한 계정이라면 아래 “Google로 계속하기”로 로그인해주세요.'
      )
    }

    if (lowerMessage.includes('email not confirmed') || lowerMessage.includes('email_not_confirmed')) {
      return '이메일 인증이 아직 완료되지 않았습니다. 받은 메일함에서 인증 후 다시 로그인해주세요.'
    }

    if (
      lowerMessage.includes('already registered') ||
      lowerMessage.includes('already exists') ||
      lowerMessage.includes('user already')
    ) {
      return '이미 가입된 계정입니다. 회원가입이 아니라 로그인으로 이동해서 진행해주세요.'
    }

    if (lowerMessage.includes('only request this after')) {
      return '인증 메일은 잠시 후 다시 요청할 수 있습니다. 받은 메일함을 먼저 확인한 뒤 로그인해주세요.'
    }

    if (lowerMessage.includes('signup disabled')) {
      return '현재 회원가입이 일시적으로 제한되어 있습니다. 잠시 후 다시 시도해주세요.'
    }

    return message || (mode === 'signup' ? '회원가입에 실패했습니다.' : '로그인에 실패했습니다.')
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
      throw new Error(normalizeAuthErrorMessage(error, 'login'))
    }

    setCurrentUser(data?.user || null)
    setIsLoggedIn(true)
    setEntitlementStatus(null)
    setIsEntitlementReady(true)
    setCurrentStep('upload')
    return {
      user: data?.user || null,
      nextPath: '/analyze',
    }
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
      throw new Error(normalizeAuthErrorMessage(error, 'signup'))
    }

    if (!data?.user) {
      throw new Error('회원가입에 실패했습니다. 잠시 후 다시 시도해주세요.')
    }

    if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return {
        user: null,
        alreadyRegistered: true,
      }
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
    setEntitlementStatus(null)
    setIsEntitlementReady(true)
    setCurrentStep('upload')

    return {
      user: data.user,
      requiresEmailConfirmation: false,
      nextPath: '/analyze',
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
        const cachedCurrentAccount = pickPreferredAccount(cachedAccounts, {
          preferredAccountId: storedAccountId,
          currentAccountId: currentAccount?.id,
          configuredMap: accountSetupMap,
        })
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

        const setupEntries = await Promise.allSettled(
          nextAccounts.map(async (account) => {
            const payload = await loadAccountProfile({ accountId: account.id })
            return [account.id, hasMeaningfulAccountSettings(payload?.profile)]
          }),
        )

        if (canceled) {
          return
        }

        const nextSetupMap = {}
        setupEntries.forEach((entry) => {
          if (entry.status !== 'fulfilled') {
            return
          }

          const [accountId, configured] = entry.value
          nextSetupMap[accountId] = Boolean(configured)
        })

        setAccounts(nextAccounts)
        if (ownerCacheKey) {
          setCachedAccounts(currentUser, nextAccounts)
        }

        const storedAccountId = getStoredAccountId()
        const nextCurrentAccount = pickPreferredAccount(nextAccounts, {
          preferredAccountId: storedAccountId,
          currentAccountId: currentAccount?.id,
          configuredMap: nextSetupMap,
        })

        if (nextCurrentAccount) {
          setStoredAccountId(nextCurrentAccount.id)
        }

        setCurrentAccount(nextCurrentAccount)
        setAccountSetupMap(nextSetupMap)
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
        const items = await listProjectRecords(currentAccount.id)
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
      const items = await listReferenceVideoHistory(accountId)
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
        prefetchReferenceDetails(merged, accountId)
        return merged
      })
    } catch (_error) {
      // keep sidebar empty if history fetch fails in mock/dev startup
    }
  }

  const prefetchReferenceDetails = (items, accountId = currentAccount?.id) => {
    const normalizedAccountId = String(accountId || '').trim()
    if (!normalizedAccountId || !Array.isArray(items) || !items.length) {
      return
    }

    items
      .filter((item) => {
        const normalizedReferenceId = String(item?.id || '').trim()
        return (
          normalizedReferenceId &&
          item.status !== 'processing' &&
          item.status !== 'failed' &&
          !normalizedReferenceId.startsWith('reference-') &&
          !getCachedReferenceDetail(normalizedAccountId, normalizedReferenceId)
        )
      })
      .slice(0, REFERENCE_DETAIL_PREFETCH_LIMIT)
      .forEach((item) => {
        const normalizedReferenceId = String(item.id).trim()
        const prefetchKey = referenceDetailCacheKey(normalizedAccountId, normalizedReferenceId)
        if (referencePrefetchInFlightRef.current.has(prefetchKey)) {
          return
        }

        referencePrefetchInFlightRef.current.add(prefetchKey)
        fetchReferenceVideoDetail(normalizedReferenceId, normalizedAccountId)
          .then((detail) => {
            if (!isCurrentAccountRequest(normalizedAccountId)) {
              return
            }
            setCachedReferenceDetail(normalizedAccountId, normalizedReferenceId, detail)
            setReferenceHistory((current) =>
              current.map((historyItem) =>
                historyItem.id === normalizedReferenceId
                  ? {
                      ...historyItem,
                      ...detail.reference,
                      generatedScripts: detail.generatedScripts,
                    }
                  : historyItem,
              ),
            )
          })
          .catch(() => {
            // Prefetch is best-effort; clicking the item will still fetch on demand.
          })
          .finally(() => {
            referencePrefetchInFlightRef.current.delete(prefetchKey)
          })
      })
  }

  const selectAccount = (accountId) => {
    const nextAccount = accounts.find((item) => item.id === accountId)

    if (!nextAccount || nextAccount.id === currentAccount?.id) {
      return
    }

    setStoredAccountId(nextAccount.id)
    activeAccountIdRef.current = nextAccount.id
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
      return {
        ...current,
        [created.id]: false,
      }
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
      return next
    })

    if (currentAccount?.id === normalizedAccountId) {
      const nextConfiguredMap = { ...accountSetupMap }
      delete nextConfiguredMap[normalizedAccountId]
      const nextCurrentAccount = pickPreferredAccount(remainingAccounts, {
        configuredMap: nextConfiguredMap,
      })
      setCurrentAccount(nextCurrentAccount)
      setStoredAccountId(nextCurrentAccount?.id || '')
      resetStudioForAccount()
    }

    showToast('계정을 삭제했습니다.')
    return true
  }

  const startNewProject = () => {
    const cancelToken = analysisRunTokenRef.current
    if (cancelToken) {
      canceledAnalysisTokensRef.current.add(cancelToken)
    }
    analysisRunTokenRef.current += 1
    analysisAbortControllerRef.current?.abort()
    analysisAbortControllerRef.current = null
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
    setUploadPhase('idle')
    setIsAnalyzing(false)
    setChatMessages(initialState.chatMessages)
    setViewTransition('idle')
    setIsEditorEntering(false)
    setIsResultEntering(false)
    setCopilotUsage(createInitialCopilotUsage())
  }

  const cancelCurrentAnalysis = async () => {
    const requestAccountId = currentAccount?.id
    const normalizedReferenceId = String(referenceData?.id || activeReferenceIdRef.current || '').trim()

    const cancelToken = analysisRunTokenRef.current
    if (cancelToken) {
      canceledAnalysisTokensRef.current.add(cancelToken)
    }
    analysisRunTokenRef.current += 1
    analysisAbortControllerRef.current?.abort()
    analysisAbortControllerRef.current = null

    if (!normalizedReferenceId) {
      startNewProject()
      showToast('분석을 중단했습니다.')
      return true
    }

    const shouldDeleteServerRecord = !normalizedReferenceId.startsWith('reference-')

    setReferenceHistory((current) => current.filter((item) => item.id !== normalizedReferenceId))
    removeCachedReferenceDetail(requestAccountId, normalizedReferenceId)
    startNewProject()

    if (shouldDeleteServerRecord) {
      try {
        await deleteReferenceVideoRecord(normalizedReferenceId, requestAccountId)
      } catch (error) {
        showToast(error.message || '분석 중단 처리에 실패했습니다.', 'error')
        return false
      }
    }

    showToast('분석을 중단하고 삭제했습니다.')
    return true
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

    removeCachedReferenceDetailsForAccount(accountId)

    setAccountSetupMap((current) => {
      return {
        ...current,
        [accountId]: Boolean(configured),
      }
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
      await deleteProjectById(projectId, currentAccount?.id)
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
      await deleteReferenceVideoRecord(referenceId, currentAccount?.id)
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

  const applyReferenceAnalysisResult = ({
    accountId = currentAccount?.id,
    baseReference = {},
    analysis,
    activate = true,
  }) => {
    const rawStatus = String(analysis?.reference?.status || '').trim()
    const completed = rawStatus === 'completed' || rawStatus === 'ready'
    const nextReference = {
      ...baseReference,
      ...analysis.reference,
      status: completed ? 'ready' : rawStatus || baseReference.status || 'ready',
    }

    if (activate) {
      activeReferenceIdRef.current = nextReference.id
      setReferenceData(nextReference)
      setGeneratedScripts(analysis.generatedScripts || [])
    }
    setCachedReferenceDetail(accountId, nextReference.id, {
      reference: nextReference,
      generatedScripts: analysis.generatedScripts || [],
    })
    setReferenceHistory((current) =>
      current.map((item) =>
        item.id === baseReference.id || item.id === nextReference.id
          ? {
              ...item,
              ...nextReference,
              generatedScripts: analysis.generatedScripts || [],
              lastStep: completed ? 'result' : item.lastStep,
            }
          : item,
      ),
    )

    if (completed && activate) {
      setCurrentStep('result')
      setIsAnalyzing(false)
      setUploadPhase('completed')
      setAnalyzeError('')
      setAnalyzeErrorType('')
      setIsResultEntering(true)
      window.setTimeout(() => {
        if (isCurrentAccountRequest(accountId)) {
          setIsResultEntering(false)
        }
      }, 420)
    }
  }

  const refreshProcessingReference = async (referenceId) => {
    const requestAccountId = currentAccount?.id
    const normalizedReferenceId = String(referenceId || '').trim()
    if (!requestAccountId || !normalizedReferenceId || normalizedReferenceId.startsWith('reference-')) {
      return
    }
    if (processingPollInFlightRef.current.has(normalizedReferenceId)) {
      return
    }

    processingPollInFlightRef.current.add(normalizedReferenceId)
    try {
      const detail = await fetchReferenceVideoDetail(normalizedReferenceId, requestAccountId)
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }
      const rawStatus = String(detail?.reference?.status || '').trim()
      const baseReference =
        referenceHistory.find((item) => item.id === normalizedReferenceId) || detail.reference

      if (rawStatus === 'processing') {
        const nextReference = {
          ...baseReference,
          ...detail.reference,
          status: 'processing',
        }
        setReferenceHistory((current) =>
          current.map((item) => (item.id === normalizedReferenceId ? { ...item, ...nextReference } : item)),
        )
        if (activeReferenceIdRef.current === normalizedReferenceId || referenceData?.id === normalizedReferenceId) {
          setReferenceData(nextReference)
          setCurrentStep('analyzing')
          setIsAnalyzing(true)
          setUploadPhase('analyzing')
        }
        return
      }

      if (rawStatus === 'failed') {
        const nextReference = {
          ...baseReference,
          ...detail.reference,
          status: 'failed',
        }
        setReferenceHistory((current) =>
          current.map((item) => (item.id === normalizedReferenceId ? { ...item, ...nextReference } : item)),
        )
        if (activeReferenceIdRef.current === normalizedReferenceId || referenceData?.id === normalizedReferenceId) {
          setReferenceData(nextReference)
          setCurrentStep('upload')
          setIsAnalyzing(false)
          setUploadPhase('failed')
          setAnalyzeError(detail.reference?.errorMessage || '분석 작업이 실패했습니다. 다시 업로드해주세요.')
          setAnalyzeErrorType('general')
        }
        return
      }

      applyReferenceAnalysisResult({
        accountId: requestAccountId,
        baseReference,
        analysis: detail,
        activate:
          activeReferenceIdRef.current === normalizedReferenceId ||
          referenceData?.id === normalizedReferenceId,
      })
      void refreshEntitlement({ referenceId: normalizedReferenceId })
    } catch {
      // Mobile browsers often suspend polling while backgrounded. The next tick/reload will retry.
    } finally {
      processingPollInFlightRef.current.delete(normalizedReferenceId)
    }
  }

  useEffect(() => {
    if (!isLoggedIn || !currentAccount?.id || !isAnalyzePage()) {
      return undefined
    }

    const processingItems = referenceHistory.filter(
      (item) => item?.id && item.status === 'processing' && !String(item.id).startsWith('reference-'),
    )
    if (!processingItems.length) {
      return undefined
    }

    const getNextDelay = () => {
      const startedAt = processingItems
        .map((item) => new Date(item.createdAt || item.created_at || Date.now()).getTime())
        .filter((time) => Number.isFinite(time))
        .sort((a, b) => a - b)[0] || Date.now()
      const elapsedMs = Date.now() - startedAt
      const baseDelay =
        elapsedMs < 30_000
          ? PROCESSING_POLL_FAST_MS
          : elapsedMs < 120_000
            ? PROCESSING_POLL_NORMAL_MS
            : PROCESSING_POLL_SLOW_MS

      return typeof document !== 'undefined' && document.hidden
        ? Math.max(baseDelay, PROCESSING_POLL_SLOW_MS)
        : baseDelay
    }

    let canceled = false
    let timer = null
    const tick = () => {
      if (canceled) {
        return
      }
      processingItems.forEach((item) => {
        void refreshProcessingReference(item.id)
      })
      timer = window.setTimeout(tick, getNextDelay())
    }

    tick()
    return () => {
      canceled = true
      if (timer) {
        window.clearTimeout(timer)
      }
    }
  }, [isLoggedIn, currentAccount?.id, referenceHistory, referenceData])

  const analyzeReference = async (file, options = {}) => {
    const requestAccountId = currentAccount?.id
    if (!requestAccountId) {
      throw new Error('계정을 먼저 선택하세요.')
    }
    const requestToken = analysisRunTokenRef.current + 1
    analysisRunTokenRef.current = requestToken
    canceledAnalysisTokensRef.current.delete(requestToken)
    analysisAbortControllerRef.current?.abort()
    const requestAbortController = new AbortController()
    analysisAbortControllerRef.current = requestAbortController
    const isCurrentAnalysisRequest = () =>
      isCurrentAccountRequest(requestAccountId) && analysisRunTokenRef.current === requestToken

    const normalizedTopic = typeof options.topic === 'string'
      ? options.topic.trim()
      : uploadTopic.trim()
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
    setAnalyzeErrorType('')
    setUploadPhase('uploading')
    setChatMessages([])
    setCopilotUsage(createInitialCopilotUsage())
    setReferenceHistory((current) => [localReference, ...current])
    setCurrentStep('analyzing')
    setIsAnalyzing(true)
    setViewTransition('idle')
    setIsEditorEntering(false)
    setIsResultEntering(false)

    let keepAnalyzingAfterError = false
    try {
      const analysis = await analyzeReferenceVideo({
        file,
        accountId: requestAccountId,
        topic: effectiveTopic,
        title: uploadTitle,
        projectId: currentProjectId || null,
        signal: requestAbortController.signal,
      })
      if (!isCurrentAnalysisRequest()) {
        if (canceledAnalysisTokensRef.current.has(requestToken)) {
          const staleReferenceId = String(analysis?.reference?.id || '').trim()
          if (staleReferenceId && !staleReferenceId.startsWith('reference-')) {
            try {
              await deleteReferenceVideoRecord(staleReferenceId, requestAccountId)
            } catch {
              // The user already left the flow; best-effort cleanup avoids resurrecting canceled jobs.
            }
          }
          canceledAnalysisTokensRef.current.delete(requestToken)
        }
        return
      }

      const completedReference = {
        ...localReference,
        ...analysis.reference,
        status: analysis.reference?.status === 'processing' ? 'processing' : 'ready',
      }
      if (completedReference.status !== 'processing') {
        void refreshEntitlement({ referenceId: completedReference.id })
      }
      setUploadTitle('')
      if (completedReference.status === 'processing') {
        keepAnalyzingAfterError = true
        activeReferenceIdRef.current = completedReference.id
        setReferenceData(completedReference)
        setGeneratedScripts([])
        setUploadPhase('server-accepted')
        setCurrentStep('analyzing')
        setIsAnalyzing(true)
        setReferenceHistory((current) =>
          current.map((item) =>
            item.id === localReference.id
              ? {
                  ...completedReference,
                  generatedScripts: [],
                }
              : item,
          ),
        )
      } else {
        applyReferenceAnalysisResult({
          accountId: requestAccountId,
          baseReference: localReference,
          analysis: {
            ...analysis,
            reference: completedReference,
          },
        })
      }
    } catch (error) {
      if (!isCurrentAnalysisRequest()) {
        canceledAnalysisTokensRef.current.delete(requestToken)
        return
      }
      if (error?.name === 'AbortError') {
        canceledAnalysisTokensRef.current.delete(requestToken)
        return
      }
      console.groupCollapsed('[reference-analysis] analyze failed')
      console.error('message:', error.message)
      console.error('code:', error.code || null)
      console.error('details:', error.details || null)
      console.error('requestId:', error.requestId || null)
      console.error(error)
      console.groupEnd()
      const analyzedFailure = classifyAnalyzeFailure(error)
      setAnalyzeError(analyzedFailure.message)
      setAnalyzeErrorType(analyzedFailure.type)
      if (analyzedFailure.type === 'recovering') {
        keepAnalyzingAfterError = true
        setCurrentStep('analyzing')
        setIsAnalyzing(true)
        setUploadPhase('server-accepted')
        window.setTimeout(() => {
          void loadReferenceHistory(requestAccountId)
        }, 1200)
      } else {
        setCurrentStep('upload')
        setUploadPhase('failed')
        setReferenceHistory((current) => current.filter((item) => item.id !== localReference.id))
      }
    } finally {
      if (analysisAbortControllerRef.current === requestAbortController) {
        analysisAbortControllerRef.current = null
      }
      if (isCurrentAnalysisRequest() && !keepAnalyzingAfterError) {
        setIsAnalyzing(false)
      }
    }
  }

  const selectScript = async (scriptId) => {
    const requestAccountId = currentAccount?.id
    const nextScript = generatedScripts.find((item) => item.id === scriptId)

    if (!requestAccountId || !nextScript) {
      return
    }

    setSelectedScript(nextScript)
    setEditorSections(createEditorSections(nextScript.sections))
    setFeedback(null)
    setPendingSuggestion(null)
    setCopilotUsage(createInitialCopilotUsage())
    setViewTransition('to-editor')
    setIsEditorEntering(false)

    try {
      const created = await createScriptSelection({
        accountId: requestAccountId,
        referenceId: referenceData?.id,
        selectedLabel: nextScript.label,
        title: `${referenceData?.title || '레퍼런스'} · ${nextScript.label}`,
        sections: nextScript.sections,
        score: nextScript.score,
      })
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }
      const initialVersions = created.versions || []

      setActiveScriptId(created.script?.id || null)
      setVersions(initialVersions)
      setCachedScriptVersions(requestAccountId, created.script?.id, initialVersions)
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
        if (isCurrentAccountRequest(requestAccountId)) {
          setIsEditorEntering(false)
        }
      }, 420)
    } catch (error) {
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }
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
    const requestAccountId = currentAccount?.id
    if (!generatedScripts.length) {
      return
    }

    syncHistory(activeReferenceIdRef.current, {
      lastStep: 'result',
    })

    setViewTransition('to-result')
    setIsResultEntering(false)
    setTimeout(() => {
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }
      setCurrentStep('result')
      setViewTransition('idle')
      setIsResultEntering(true)
      setTimeout(() => {
        if (isCurrentAccountRequest(requestAccountId)) {
          setIsResultEntering(false)
        }
      }, 420)
    }, 320)
  }

  const clearScriptSelection = () => {
    setSelectedScript(null)
    setCurrentStep('result')
    setViewTransition('idle')
    setIsEditorEntering(false)
    setIsResultEntering(false)

    syncHistory(activeReferenceIdRef.current, {
      selectedScriptId: null,
      lastStep: 'result',
    })
  }

  const goBackToUpload = () => {
    startNewProject()
  }

  const openReference = (referenceId) => {
    const requestAccountId = currentAccount?.id
    const item = referenceHistory.find((entry) => entry.id === referenceId)

    if (!requestAccountId || !item) {
      return
    }

    const applyOpenedState = ({ detail, baseItem }) => {
      const isProcessingReference = detail.reference?.status === 'processing'
      const isFailedReference = detail.reference?.status === 'failed'
      activeReferenceIdRef.current = baseItem.id
      setReferenceData(detail.reference)
      setGeneratedScripts(detail.generatedScripts || [])
      setSelectedScript(
        detail.generatedScripts?.find((script) => script.id === baseItem.selectedScriptId) || null,
      )
      setActiveScriptId(baseItem.activeScriptId || null)

      if (baseItem.activeScriptId) {
        const cachedVersions = getCachedScriptVersions(requestAccountId, baseItem.activeScriptId)
        if (cachedVersions.length) {
          setVersions(cachedVersions)
        } else if (Array.isArray(baseItem.versions) && baseItem.versions.length) {
          setVersions(baseItem.versions)
          setCachedScriptVersions(requestAccountId, baseItem.activeScriptId, baseItem.versions)
        } else {
          setVersions([])
        }

        loadScriptVersions(baseItem.activeScriptId, requestAccountId)
          .then((freshVersions) => {
            if (!isCurrentAccountRequest(requestAccountId)) {
              return
            }
            setVersions(freshVersions || [])
            setCachedScriptVersions(requestAccountId, baseItem.activeScriptId, freshVersions || [])
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
      setCopilotUsage(createInitialCopilotUsage())
      let restoredStep = 'result'
      if (isProcessingReference) {
        restoredStep = 'analyzing'
      } else if (isFailedReference) {
        restoredStep = 'upload'
      } else if (
        baseItem.lastStep === 'editor' &&
        detail.generatedScripts?.some((script) => script.id === baseItem.selectedScriptId)
      ) {
        restoredStep = 'editor'
      }
      setCurrentStep(restoredStep)
      setIsAnalyzing(isProcessingReference)
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

    const cachedDetail = getCachedReferenceDetail(requestAccountId, referenceId)
    const historyDetail = Array.isArray(item.generatedScripts)
      ? {
          reference: item,
          generatedScripts: item.generatedScripts,
        }
      : null
    const immediateDetail = cachedDetail || historyDetail
    if (immediateDetail) {
      applyOpenedState({ detail: immediateDetail, baseItem: item })
    }

    const open = async () => {
      let detail
      try {
        detail = await fetchReferenceVideoDetail(referenceId, requestAccountId)
      } catch (error) {
        if (immediateDetail) {
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
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }
      setCachedReferenceDetail(requestAccountId, referenceId, detail)
      applyOpenedState({ detail, baseItem: item })
    }

    open().catch((error) => {
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }
      setAnalyzeError(error.message)
    })
  }

  const saveVersion = async (source = 'USER') => {
    const requestAccountId = currentAccount?.id
    if (!requestAccountId || !activeScriptId) {
      return
    }

    try {
      const serializedContent = serializeEditorSections(editorSections)
      const versionType = source === 'AI' ? 'ai_generation' : 'manual_save'
      const nextVersion = await saveVersionRecord({
        accountId: requestAccountId,
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
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }

      setVersions((current) => {
        const next = [nextVersion, ...current]
        setCachedScriptVersions(requestAccountId, activeScriptId, next)
        syncHistory(activeReferenceIdRef.current, {
          activeScriptId,
          versions: next,
          editorContent: serializedContent,
        })
        return next
      })
      showToast('버전 저장 완료')
    } catch (error) {
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }
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
    const requestAccountId = currentAccount?.id
    if (!requestAccountId) {
      return
    }
    const feedbackLimit = getEffectiveCopilotLimit('feedback')
    if (Number.isFinite(feedbackLimit) && copilotUsage.feedbackUsed >= feedbackLimit) {
      setChatMessages((current) => {
        const next = [
          ...current,
          {
            id: `feedback-limit-${Date.now()}`,
            role: 'assistant',
            content:
              `이번 레퍼런스에서는 피드백 요청을 최대 ${feedbackLimit}회로 제한했습니다. ` +
              '현재 에디터 수정 후 코파일럿 채팅으로 세부 조정해 주세요.',
          },
        ]
        syncHistory(activeReferenceIdRef.current, {
          chatMessages: next,
        })
        return next
      })
      return
    }

    const userFeedbackRequestMessage = {
      id: `user-feedback-${Date.now()}`,
      role: 'user',
      content: '피드백',
    }

    setIsFeedbackLoading(true)
    setCopilotUsage((current) => ({
      ...current,
      feedbackUsed: current.feedbackUsed + 1,
    }))
    setChatMessages((current) => {
      const next = [...current, userFeedbackRequestMessage]
      syncHistory(activeReferenceIdRef.current, {
        chatMessages: next,
      })
      return next
    })

    try {
      const result = await generateScriptFeedback({
        accountId: requestAccountId,
        referenceId: referenceData?.id,
        scriptId: activeScriptId,
        selectedLabel: selectedScript?.label,
        sections: editorSections,
      })
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }
      const normalizedFeedback = { ...result, applied: false }
      setFeedback(normalizedFeedback)
      void refreshEntitlement({ referenceId: referenceData?.id })
      setChatMessages((current) => {
        const next = [
          ...current,
          {
            id: `feedback-${Date.now()}`,
            role: 'assistant',
            content: result.summary || `현재 초안은 ${result.score}점입니다.`,
            feedback: normalizedFeedback,
          },
        ]
        syncHistory(activeReferenceIdRef.current, {
          feedback: normalizedFeedback,
          chatMessages: next,
        })
        return next
      })
    } catch (error) {
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }
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
      if (isCurrentAccountRequest(requestAccountId)) {
        setIsFeedbackLoading(false)
      }
    }
  }

  const applyFeedback = async () => {
    if (isApplyingFeedback || feedback?.applied || !feedback?.suggestedSections) {
      return
    }

    const requestAccountId = currentAccount?.id
    if (!requestAccountId) {
      return
    }
    setIsApplyingFeedback(true)
    const serializedContent = serializeEditorSections(feedback.suggestedSections)
    setEditorSections(createEditorSections(feedback.suggestedSections))
    setPendingSuggestion(null)
    if (!activeScriptId) {
      setIsApplyingFeedback(false)
      return
    }

    try {
      const nextVersion = await saveVersionRecord({
        accountId: requestAccountId,
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
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }

      const appliedMessage = {
        id: `feedback-applied-${Date.now()}`,
        role: 'assistant',
        content: '피드백을 반영해서 대본을 수정했습니다. 새로운 버전으로 저장되었어요!',
      }

      const appliedFeedback = {
        ...feedback,
        applied: true,
      }

      setFeedback(appliedFeedback)

      setVersions((current) => {
        const next = [nextVersion, ...current]
        setCachedScriptVersions(requestAccountId, activeScriptId, next)
        syncHistory(activeReferenceIdRef.current, {
          activeScriptId,
          editorContent: serializedContent,
          versions: next,
          feedback: appliedFeedback,
        })
        return next
      })

      setChatMessages((current) => {
        const marked = current.map((message) =>
          message.feedback
            ? { ...message, feedback: { ...message.feedback, applied: true } }
            : message,
        )
        const next = [...marked, appliedMessage]
        syncHistory(activeReferenceIdRef.current, {
          chatMessages: next,
          feedback: appliedFeedback,
        })
        return next
      })

      showToast('피드백 반영 저장 완료')
    } catch (error) {
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }
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
    } finally {
      if (isCurrentAccountRequest(requestAccountId)) {
        setIsApplyingFeedback(false)
      }
    }
  }

  const sendChatMessage = async () => {
    const requestAccountId = currentAccount?.id
    const normalized = draftMessage.trim()

    if (!requestAccountId || !normalized) {
      return
    }

    const chatLimit = getEffectiveCopilotLimit('chat')
    if (Number.isFinite(chatLimit) && copilotUsage.chatUsed >= chatLimit) {
      setChatMessages((current) => {
        const next = [
          ...current,
          {
            id: `chat-limit-${Date.now()}`,
            role: 'assistant',
            content:
              `이번 레퍼런스에서는 코파일럿 수정 요청을 최대 ${chatLimit}회로 제한했습니다. ` +
              '핵심 수정은 에디터에서 직접 정리한 뒤 피드백 기능을 사용해 주세요.',
          },
        ]
        syncHistory(activeReferenceIdRef.current, {
          chatMessages: next,
        })
        return next
      })
      return
    }

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: normalized,
    }

    setDraftMessage('')
    setIsChatLoading(true)
    setCopilotUsage((current) => ({
      ...current,
      chatUsed: current.chatUsed + 1,
    }))
    setChatMessages((current) => {
      const next = [...current, userMessage]
      syncHistory(activeReferenceIdRef.current, {
        chatMessages: next,
      })
      return next
    })

    try {
      const response = await generateChatReply({
        accountId: requestAccountId,
        referenceId: referenceData?.id,
        selectedLabel: selectedScript?.label,
        editorSections,
        message: normalized,
      })
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }

      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.message,
        proposedSections: response.proposedSections,
      }

      setPendingSuggestion(response.proposedSections)
      void refreshEntitlement({ referenceId: referenceData?.id })
      setChatMessages((current) => {
        const next = [...current, assistantMessage]
        syncHistory(activeReferenceIdRef.current, {
          chatMessages: next,
        })
        return next
      })
    } catch (error) {
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }
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
      if (isCurrentAccountRequest(requestAccountId)) {
        setIsChatLoading(false)
      }
    }
  }

  const applySuggestion = (sections) => {
    const requestAccountId = currentAccount?.id
    if (!requestAccountId) {
      return
    }
    const serializedContent = serializeEditorSections(sections)
    setEditorSections(createEditorSections(sections))
    setPendingSuggestion(sections)
    if (!activeScriptId) {
      return
    }

    saveVersionRecord({
      accountId: requestAccountId,
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
        if (!isCurrentAccountRequest(requestAccountId)) {
          return
        }
        setVersions((current) => {
          const next = [nextVersion, ...current]
          setCachedScriptVersions(requestAccountId, activeScriptId, next)
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
    const requestAccountId = currentAccount?.id
    const version = versions.find((item) => item.id === versionId)

    if (!requestAccountId || !version || !activeScriptId) {
      return
    }

    try {
      await restoreScriptVersionRecord({
        accountId: requestAccountId,
        scriptId: activeScriptId,
        versionId,
      })
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }

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
      entitlementStatus,
      isEntitlementReady,
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
      uploadPhase,
      analyzeError,
      analyzeErrorType,
      pendingSuggestion,
      activeScriptId,
      toast,
      copilotUsage,
      copilotLimits: {
        chat: getEffectiveCopilotLimit('chat'),
        feedback: getEffectiveCopilotLimit('feedback'),
      },
      copilotRemaining: {
        chat: Number.isFinite(getEffectiveCopilotLimit('chat'))
          ? Math.max(0, getEffectiveCopilotLimit('chat') - copilotUsage.chatUsed)
          : Infinity,
        feedback: Number.isFinite(getEffectiveCopilotLimit('feedback'))
          ? Math.max(0, getEffectiveCopilotLimit('feedback') - copilotUsage.feedbackUsed)
          : Infinity,
      },
      isVersionModalOpen,
      isAnalyzing,
      isChatLoading,
      isFeedbackLoading,
      isApplyingFeedback,
      viewTransition,
      isEditorEntering,
      isResultEntering,
      goBackToUpload,
      goBackToResults,
      clearScriptSelection,
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
      cancelCurrentAnalysis,
      login,
      signup,
      logout,
      refreshEntitlement,
      applyCoupon,
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
      analyzeErrorType,
      accounts,
      currentAccount,
      accountSetupMap,
      projects,
      currentProjectId,
      deleteAccount,
      updateCurrentAccountName,
      currentUser,
      entitlementStatus,
      isEntitlementReady,
      isAuthReady,
      editorSections,
      feedback,
      generatedScripts,
      isAnalyzing,
      isChatLoading,
      isFeedbackLoading,
      isApplyingFeedback,
      isEditorEntering,
      isLoggedIn,
      isResultEntering,
      isVersionModalOpen,
      pendingSuggestion,
      activeScriptId,
      toast,
      copilotUsage,
      referenceData,
      referenceHistory,
      selectedScript,
      uploadTitle,
      uploadTopic,
      uploadPhase,
      viewTransition,
      versions,
      createProject,
      clearScriptSelection,
      selectProject,
      deleteProject,
      renameReferenceHistoryItem,
      moveReferenceToProject,
      deleteReferenceHistoryItem,
      startNewProject,
      cancelCurrentAnalysis,
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
