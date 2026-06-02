/* eslint-disable react-hooks/exhaustive-deps, react-refresh/only-export-components */
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
  analyzeReferenceScriptText,
  analyzeReferenceVideo,
  applyScriptFeedback,
  createReferenceUploadSession,
  deleteReferenceVideo as deleteReferenceVideoRecord,
  fetchReferenceUploadSessionByClientUploadId,
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
import {
  applyCouponCode,
  loadMyEntitlement,
  readCachedEntitlementForUser,
} from '../lib/entitlementApi'
import {
  clearLoginAttempts,
  getLoginAttemptStatus,
  recordLoginFailure,
} from '../lib/authAttemptLimiter'
import {
  COPILOT_CHAT_LIMIT_PER_DRAFT,
  COPILOT_EDIT_TARGETS,
  COPILOT_FEEDBACK_LIMIT_PER_DRAFT,
  PROCESSING_POLL_FAST_MS,
  PROCESSING_POLL_NORMAL_MS,
  PROCESSING_POLL_SLOW_MS,
  REFERENCE_DETAIL_PREFETCH_LIMIT,
  UPLOAD_RECOVERY_TIMEOUT_MS,
} from './appStateConstants'
import {
  createInitialCopilotMemory,
  normalizeCopilotMemory,
  updateCopilotMemoryFromUserMessage,
} from './copilotMemory'
import {
  getCachedAccounts,
  getCachedReferenceDetail,
  getCachedReferenceHistory,
  getCachedScriptVersions,
  mergeHistoryItem,
  pickPreferredAccount,
  referenceDetailCacheKey,
  removeCachedReferenceDetail,
  removeCachedReferenceDetailsForAccount,
  resolveOwnerCacheKey,
  setCachedAccounts,
  setCachedReferenceDetail,
  setCachedReferenceHistory,
  setCachedScriptVersions,
} from './appStateCache'

const AppStateContext = createContext(null)
const EDITOR_SCROLL_EVENT = 'hookai:scroll-editor'
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

function normalizePreviousAdviceForState(value = null) {
  if (!value || typeof value !== 'object') {
    return null
  }
  const instructions = Array.isArray(value.instructions)
    ? value.instructions.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
    : []
  const diagnosis = String(value.diagnosis || '').trim()
  const expectedOutcome = String(value.expectedOutcome || '').trim()
  if (!diagnosis && !expectedOutcome && instructions.length === 0) {
    return null
  }
  const preserveSections = Array.isArray(value.preserveSections)
    ? value.preserveSections.filter((key) => ['hook', 'body', 'cta'].includes(key)).slice(0, 3)
    : []
  const createdAt = value.createdAt || new Date().toISOString()
  return {
    sourceMessageId: String(value.sourceMessageId || '').trim(),
    sourceUserMessage: String(value.sourceUserMessage || '').trim(),
    diagnosis,
    editTarget: String(value.editTarget || 'all').trim() || 'all',
    instructions,
    preserveSections,
    expectedOutcome,
    createdAt,
    messageTurnsSinceCreated: Number.isFinite(Number(value.messageTurnsSinceCreated))
      ? Math.max(0, Number(value.messageTurnsSinceCreated))
      : 0,
  }
}

function agePreviousAdvice(value = null) {
  const normalized = normalizePreviousAdviceForState(value)
  if (!normalized) {
    return null
  }
  return {
    ...normalized,
    messageTurnsSinceCreated: normalized.messageTurnsSinceCreated + 1,
  }
}

function shouldCarryPreviousAdviceForMessage(message = '') {
  const normalized = String(message || '').replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return false
  }
  return /(이대로|그대로|그렇게|그\s*방향|방금\s*말한\s*대로|방금\s*제안|직전\s*조언|피드백대로|조언대로).{0,16}(수정|고쳐|바꿔|반영|적용|해줘|해주세요)/i.test(
    normalized,
  )
}

const initialState = {
  isLoggedIn: false,
  currentStep: 'upload',
  activeToolPage: null,
  referenceData: null,
  generatedScripts: [],
  selectedScript: null,
  chatMessages: [],
  versions: [],
  referenceHistory: [],
  feedback: null,
  editorSections: createEditorSections(),
  isVersionModalOpen: false,
  draftMessage: '',
  editTarget: 'all',
  pendingSuggestion: null,
  previousAdvice: null,
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

function createClientUploadId() {
  const randomPart =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `upload-${randomPart}`
}

function isTemporaryReferenceId(referenceId = '') {
  return String(referenceId || '').startsWith('reference-')
}

function isProcessingLikeReferenceStatus(status = '') {
  return status === 'uploading' || status === 'processing'
}

function classifyAnalyzeFailure(error) {
  const code = String(error?.code || '').trim().toUpperCase()
  const name = String(error?.name || '').trim()
  const message = String(error?.message || '')

  if (code === 'RATE_LIMITED' || code === 'HTTP_429') {
    return {
      type: 'rate-limited',
      message: '짧은 시간 안에 업로드가 많이 시도되어 잠시 제한됐어요. 5~10분 후 다시 시도해주세요.',
    }
  }

  if (code === 'FILE_TOO_LARGE' || code === 'LIMIT_FILE_SIZE' || code === 'HTTP_413') {
    return {
      type: 'file-too-large',
      message: '영상 용량이 너무 커요. 300MB 이하 영상으로 다시 올려주세요.',
    }
  }

  if (code === 'INVALID_FILE_SIGNATURE' || code === 'UNSUPPORTED_FILE_TYPE') {
    return {
      type: 'unsupported-file',
      message: '지원하지 않는 영상 형식이거나 파일이 손상된 것 같아요. mp4 또는 mov로 변환 후 다시 올려주세요.',
    }
  }

  if (name === 'AbortError' || /timeout/i.test(message)) {
    return {
      type: 'timeout',
      message: '업로드 시간이 너무 오래 걸렸어요. 네트워크가 안정적인 상태에서 화면을 닫지 말고 다시 시도해주세요.',
    }
  }

  if (/failed to fetch|networkerror|network request failed/i.test(message)) {
    return {
      type: 'recovering',
      message:
        '업로드 중 연결이 끊겼어요. 서버에 등록된 분석 작업이 있으면 최근 분석에서 이어서 확인합니다. 화면 잠금이나 앱 전환 없이 다시 시도해주세요.',
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
  const [activeToolPage, setActiveToolPage] = useState(initialState.activeToolPage)
  const [referenceData, setReferenceData] = useState(initialState.referenceData)
  const [generatedScripts, setGeneratedScripts] = useState(initialState.generatedScripts)
  const [selectedScript, setSelectedScript] = useState(initialState.selectedScript)
  const [selectedScriptId, setSelectedScriptId] = useState(null)
  const [chatMessages, setChatMessages] = useState(initialState.chatMessages)
  const [versions, setVersions] = useState(initialState.versions)
  const [referenceHistory, setReferenceHistory] = useState([])
  const [feedback, setFeedback] = useState(initialState.feedback)
  const [editorSections, setEditorSections] = useState(initialState.editorSections)
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false)
  const [draftMessage, setDraftMessage] = useState('')
  const [editTarget, setEditTarget] = useState('all')
  const [pendingSuggestion, setPendingSuggestion] = useState(null)
  const [previousAdvice, setPreviousAdvice] = useState(initialState.previousAdvice)
  const [accounts, setAccounts] = useState(initialState.accounts)
  const [currentAccount, setCurrentAccount] = useState(initialState.currentAccount)
  const [accountSetupMap, setAccountSetupMap] = useState({})
  const [projects, setProjects] = useState(initialState.projects)
  const [currentProjectId, setCurrentProjectId] = useState(initialState.currentProjectId)
  const [activeScriptId, setActiveScriptId] = useState(null)
  const [uploadTopic, setUploadTopic] = useState('')
  const [uploadTitle, setUploadTitle] = useState('')
  const [referenceScriptText, setReferenceScriptText] = useState('')
  const [uploadInputModeHint, setUploadInputModeHint] = useState('')
  const [analyzeError, setAnalyzeError] = useState('')
  const [analyzeErrorType, setAnalyzeErrorType] = useState('')
  const [uploadPhase, setUploadPhase] = useState('idle')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false)
  const [isApplyingFeedback, setIsApplyingFeedback] = useState(false)
  const [isApplyingSuggestion, setIsApplyingSuggestion] = useState(false)
  const [isEditorPreparing, setIsEditorPreparing] = useState(false)
  const [isSavingVersion, setIsSavingVersion] = useState(false)
  const [isPdfExporting, setIsPdfExporting] = useState(false)
  const [viewTransition, setViewTransition] = useState('idle')
  const [isEditorEntering, setIsEditorEntering] = useState(false)
  const [isResultEntering, setIsResultEntering] = useState(false)
  const [toast, setToast] = useState(null)
  const [copilotUsage, setCopilotUsage] = useState(createInitialCopilotUsage())
  const [copilotMemory, setCopilotMemory] = useState(createInitialCopilotMemory())
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
  const currentUserIdRef = useRef(null)
  const isSavingVersionRef = useRef(false)
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

      const sessionUserId = session?.user?.id || null
      const previousUserId = currentUserIdRef.current
      currentUserIdRef.current = sessionUserId
      const cachedEntitlement = readCachedEntitlementForUser(sessionUserId)
      if (cachedEntitlement) {
        setEntitlementStatus(cachedEntitlement)
        setIsEntitlementReady(true)
      } else if (previousUserId !== sessionUserId) {
        setEntitlementStatus(null)
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
      const sessionUserId = session?.user?.id || null
      const previousUserId = currentUserIdRef.current
      currentUserIdRef.current = sessionUserId
      const cachedEntitlement = readCachedEntitlementForUser(sessionUserId)
      if (cachedEntitlement) {
        setEntitlementStatus(cachedEntitlement)
        setIsEntitlementReady(true)
      } else if (previousUserId !== sessionUserId) {
        setEntitlementStatus(null)
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

  const refreshEntitlement = async ({ referenceId, silent = false, forceRefresh = false } = {}) => {
    if (!isLoggedIn) {
      setEntitlementStatus(null)
      setIsEntitlementReady(true)
      return null
    }

    if (!silent) {
      setIsEntitlementReady(false)
    }
    try {
      const status = await loadMyEntitlement({ referenceId, forceRefresh })
      setEntitlementStatus(status)
      return status
    } catch (error) {
      const message = error.message || '이용권 정보를 불러오지 못했습니다.'
      setEntitlementStatus((current) => {
        if ((silent || error.isTransient) && current?.hasAccess) {
          return current
        }

        return {
          hasAccess: false,
          entitlement: null,
          usage: null,
          error: message,
          errorCode: error.code || null,
          requestId: error.requestId || null,
          isTransientError: Boolean(error.isTransient),
          isAuthExpired: Boolean(error.isAuthExpired),
        }
      })
      return null
    } finally {
      if (!silent) {
        setIsEntitlementReady(true)
      }
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
    const planType = entitlementStatus?.entitlement?.planType
    const planLimit =
      kind === 'feedback'
        ? limits.perReferenceFeedbackLimit
        : limits.perReferenceCopilotLimit

    if (
      entitlementStatus?.hasAccess &&
      (planType === 'open_beta' || planType === 'paid' || planLimit === null)
    ) {
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

    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(patch || {}, key)
    const sessionScriptId =
      hasOwn('selectedScriptId') && patch.selectedScriptId === null
        ? null
        : String(
            patch.selectedScriptId ||
              selectedScriptId ||
              selectedScript?.id ||
              '',
          ).trim()
    const shouldUpdateVariantSession =
      Boolean(sessionScriptId) &&
      [
        'activeScriptId',
        'editorContent',
        'versions',
        'feedback',
        'pendingSuggestion',
        'previousAdvice',
        'draftMessage',
        'editTarget',
        'copilotMemory',
        'chatMessages',
      ].some(hasOwn)

    setReferenceHistory((current) =>
      current.map((item) => {
        if (item.id !== referenceId) {
          return item
        }

        const nextItem = {
          ...item,
          ...patch,
        }

        if (!shouldUpdateVariantSession) {
          return nextItem
        }

        const previousSession = item.variantSessions?.[sessionScriptId] || {}
        const nextSession = {
          ...previousSession,
          selectedScriptId: sessionScriptId,
          activeScriptId: hasOwn('activeScriptId')
            ? patch.activeScriptId
            : previousSession.activeScriptId || item.activeScriptId || null,
          editorContent: hasOwn('editorContent')
            ? patch.editorContent
            : previousSession.editorContent || item.editorContent || '',
          versions: hasOwn('versions') ? patch.versions : previousSession.versions || item.versions || [],
          feedback: hasOwn('feedback') ? patch.feedback : previousSession.feedback || item.feedback || null,
          pendingSuggestion: hasOwn('pendingSuggestion')
            ? patch.pendingSuggestion
            : previousSession.pendingSuggestion || item.pendingSuggestion || null,
          previousAdvice: hasOwn('previousAdvice')
            ? patch.previousAdvice
            : previousSession.previousAdvice || item.previousAdvice || null,
          draftMessage: hasOwn('draftMessage')
            ? patch.draftMessage
            : previousSession.draftMessage || item.draftMessage || '',
          editTarget: hasOwn('editTarget') ? patch.editTarget : previousSession.editTarget || item.editTarget || 'all',
          copilotMemory: hasOwn('copilotMemory')
            ? patch.copilotMemory
            : previousSession.copilotMemory || item.copilotMemory || createInitialCopilotMemory(),
          chatMessages: hasOwn('chatMessages')
            ? patch.chatMessages
            : previousSession.chatMessages || item.chatMessages || [],
        }

        return {
          ...nextItem,
          variantSessions: {
            ...(item.variantSessions || {}),
            [sessionScriptId]: nextSession,
          },
        }
      }),
    )
  }

  const requestEditorScroll = () => {
    if (typeof window === 'undefined') {
      return
    }

    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(EDITOR_SCROLL_EVENT))
    }, 80)
  }

  const resetStudioForAccount = () => {
    activeReferenceIdRef.current = null
    setCurrentStep('upload')
    setReferenceData(null)
    setGeneratedScripts([])
    setSelectedScript(null)
    setSelectedScriptId(null)
    setChatMessages(initialState.chatMessages)
    setVersions([])
    setReferenceHistory([])
    setFeedback(null)
    setEditorSections(createEditorSections())
    setIsVersionModalOpen(false)
    setDraftMessage('')
    setPendingSuggestion(null)
    setPreviousAdvice(null)
    setActiveScriptId(null)
    setUploadTopic('')
    setUploadTitle('')
    setReferenceScriptText('')
    setAnalyzeError('')
    setUploadPhase('idle')
    setIsAnalyzing(false)
    setIsChatLoading(false)
    setIsFeedbackLoading(false)
    setIsEditorPreparing(false)
    setIsApplyingSuggestion(false)
    setViewTransition('idle')
    setIsEditorEntering(false)
    setIsResultEntering(false)
    setCopilotUsage(createInitialCopilotUsage())
    setCopilotMemory(createInitialCopilotMemory())
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

    const attemptStatus = getLoginAttemptStatus(normalizedLoginId)
    if (!attemptStatus.allowed) {
      throw new Error(attemptStatus.message)
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedLoginId,
      password: normalizedPassword,
    })

    if (error) {
      const nextAttemptStatus = recordLoginFailure(normalizedLoginId)
      if (!nextAttemptStatus.allowed) {
        throw new Error(nextAttemptStatus.message)
      }
      throw new Error(normalizeAuthErrorMessage(error, 'login'))
    }

    clearLoginAttempts(normalizedLoginId)
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

  const logout = async ({ localOnly = false } = {}) => {
    const { error } = await supabase.auth.signOut(localOnly ? { scope: 'local' } : undefined)
    if (error) {
      if (!localOnly) {
        await supabase.auth.signOut({ scope: 'local' })
      } else {
        throw new Error(error.message || '로그아웃에 실패했습니다.')
      }
    }

    setStoredAccountId('')
    setIsLoggedIn(false)
    setCurrentUser(null)
    setAccounts([])
    setCurrentAccount(null)
    setProjects([])
    setCurrentProjectId(null)
    setEntitlementStatus(null)
    setIsEntitlementReady(true)
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
      } catch {
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
      } catch {
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
    } catch {
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
          !isProcessingLikeReferenceStatus(item.status) &&
          item.status !== 'failed' &&
          !isTemporaryReferenceId(normalizedReferenceId) &&
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
    setActiveToolPage(null)
    setCurrentStep('upload')
    setReferenceData(null)
    setGeneratedScripts([])
    setSelectedScript(null)
    setSelectedScriptId(null)
    setActiveScriptId(null)
    setVersions([])
    setFeedback(null)
    setEditorSections(createEditorSections())
    setDraftMessage('')
    setPendingSuggestion(null)
    setPreviousAdvice(null)
    setAnalyzeError('')
    setUploadPhase('idle')
    setIsAnalyzing(false)
    setIsApplyingSuggestion(false)
    setChatMessages(initialState.chatMessages)
    setViewTransition('idle')
    setIsEditorEntering(false)
    setIsResultEntering(false)
    setCopilotUsage(createInitialCopilotUsage())
    setCopilotMemory(createInitialCopilotMemory())
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

    const shouldDeleteServerRecord = !isTemporaryReferenceId(normalizedReferenceId)

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
    const previousProjectId = currentProjectId
    const optimisticId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? `pending-${crypto.randomUUID()}`
        : `pending-${Date.now()}`
    const now = new Date().toISOString()
    const optimisticProject = {
      id: optimisticId,
      account_id: currentAccount.id,
      name: baseName,
      created_at: now,
      updated_at: now,
      isOptimistic: true,
    }

    setProjects((current) => [...current, optimisticProject])
    setCurrentProjectId(optimisticId)

    try {
      const created = await createProjectRecord({
        name: baseName,
        accountId: currentAccount.id,
      })
      if (!created) {
        setProjects((current) => current.filter((item) => item.id !== optimisticId))
        setCurrentProjectId((current) => (current === optimisticId ? previousProjectId : current))
        return null
      }

      setProjects((current) =>
        current.map((item) => (item.id === optimisticId ? created : item)),
      )
      setCurrentProjectId((current) => (current === optimisticId ? created.id : current))
      return created
    } catch (error) {
      setProjects((current) => current.filter((item) => item.id !== optimisticId))
      setCurrentProjectId((current) => (current === optimisticId ? previousProjectId : current))
      throw error
    }
  }

  const getPersistedCurrentProjectId = () => {
    if (!currentProjectId) {
      return null
    }

    const currentProject = projects.find((item) => item.id === currentProjectId)
    if (!currentProject || currentProject.isOptimistic || String(currentProject.id).startsWith('pending-')) {
      return null
    }

    return currentProject.id
  }

  const selectProject = (projectId) => {
    setActiveToolPage(null)
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

    setProjects((current) => current.filter((item) => item.id !== projectId))
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
    if (!requestAccountId || !normalizedReferenceId || isTemporaryReferenceId(normalizedReferenceId)) {
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

      if (isProcessingLikeReferenceStatus(rawStatus)) {
        const nextReference = {
          ...baseReference,
          ...detail.reference,
          status: rawStatus,
        }
        setReferenceHistory((current) =>
          current.map((item) => (item.id === normalizedReferenceId ? { ...item, ...nextReference } : item)),
        )
        if (activeReferenceIdRef.current === normalizedReferenceId || referenceData?.id === normalizedReferenceId) {
          setReferenceData(nextReference)
          setCurrentStep('analyzing')
          setIsAnalyzing(true)
          setUploadPhase(rawStatus === 'uploading' ? 'uploading' : 'analyzing')
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
      void refreshEntitlement({ referenceId: normalizedReferenceId, silent: true })
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
      (item) =>
        item?.id &&
        isProcessingLikeReferenceStatus(item.status) &&
        !isTemporaryReferenceId(item.id),
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
    const displayTopic = normalizedTopic || '일반'
    const persistedProjectId = getPersistedCurrentProjectId()
    const clientUploadId = createClientUploadId()

    const createdAt = new Date().toISOString()
    const localReference = {
      id: `reference-${Date.now()}`,
      title: uploadTitle.trim() || file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      topic: displayTopic,
      projectId: persistedProjectId,
      createdAt,
      status: 'uploading',
    }

    activeReferenceIdRef.current = localReference.id
    setReferenceData(localReference)
    setGeneratedScripts([])
    setSelectedScript(null)
    setSelectedScriptId(null)
    setActiveScriptId(null)
    setVersions([])
    setFeedback(null)
    setEditorSections(createEditorSections())
    setPendingSuggestion(null)
    setPreviousAdvice(null)
    setAnalyzeError('')
    setAnalyzeErrorType('')
    setUploadPhase('creating-session')
    setChatMessages([])
    setCopilotUsage(createInitialCopilotUsage())
    setCopilotMemory(createInitialCopilotMemory())
    setReferenceHistory((current) => [localReference, ...current])
    setCurrentStep('analyzing')
    setIsAnalyzing(true)
    setViewTransition('idle')
    setIsEditorEntering(false)
    setIsResultEntering(false)

    let keepAnalyzingAfterError = false
    let serverReferenceId = ''
    try {
      const uploadSession = await createReferenceUploadSession({
        clientUploadId,
        file,
        accountId: requestAccountId,
        topic: normalizedTopic,
        title: uploadTitle,
        projectId: persistedProjectId,
        signal: requestAbortController.signal,
      })
      if (!isCurrentAnalysisRequest()) {
        return
      }

      const sessionReference = {
        ...localReference,
        ...uploadSession.reference,
        status: uploadSession.reference?.status || 'uploading',
      }
      serverReferenceId = String(sessionReference.id || '').trim()
      activeReferenceIdRef.current = serverReferenceId || localReference.id
      setReferenceData(sessionReference)
      setUploadPhase('uploading')
      setReferenceHistory((current) =>
        current.map((item) =>
          item.id === localReference.id
            ? {
                ...sessionReference,
                generatedScripts: [],
              }
            : item,
        ),
      )

      const analysis = await analyzeReferenceVideo({
        file,
        accountId: requestAccountId,
        topic: normalizedTopic,
        title: uploadTitle,
        projectId: persistedProjectId,
        referenceId: serverReferenceId,
        clientUploadId,
        signal: requestAbortController.signal,
      })
      if (!isCurrentAnalysisRequest()) {
        if (canceledAnalysisTokensRef.current.has(requestToken)) {
          const staleReferenceId = String(analysis?.reference?.id || '').trim()
          if (staleReferenceId && !isTemporaryReferenceId(staleReferenceId)) {
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
        status: isProcessingLikeReferenceStatus(analysis.reference?.status)
          ? analysis.reference.status
          : 'ready',
      }
      if (!isProcessingLikeReferenceStatus(completedReference.status)) {
        void refreshEntitlement({ referenceId: completedReference.id, silent: true })
      }
      setUploadTitle('')
      if (isProcessingLikeReferenceStatus(completedReference.status)) {
        keepAnalyzingAfterError = true
        activeReferenceIdRef.current = completedReference.id
        setReferenceData(completedReference)
        setGeneratedScripts([])
        setUploadPhase(completedReference.status === 'uploading' ? 'uploading' : 'server-accepted')
        setCurrentStep('analyzing')
        setIsAnalyzing(true)
        setReferenceHistory((current) =>
          current.map((item) =>
            item.id === localReference.id || item.id === completedReference.id
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
      if (error?.name === 'AbortError' && !/timeout/i.test(String(error?.message || ''))) {
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
        const recoverableReferenceId = String(serverReferenceId || activeReferenceIdRef.current || '').trim()
        if (recoverableReferenceId && !isTemporaryReferenceId(recoverableReferenceId)) {
          keepAnalyzingAfterError = true
          setCurrentStep('analyzing')
          setIsAnalyzing(true)
          setUploadPhase('server-accepted')
          window.setTimeout(() => {
            void refreshProcessingReference(recoverableReferenceId)
            void loadReferenceHistory(requestAccountId)
          }, 1200)
        } else {
          keepAnalyzingAfterError = true
          setCurrentStep('analyzing')
          setIsAnalyzing(true)
          setUploadPhase('server-accepted')
          window.setTimeout(async () => {
            if (!isCurrentAnalysisRequest()) {
              return
            }
            try {
              const recoveredSession = await fetchReferenceUploadSessionByClientUploadId({
                clientUploadId,
              })
              const recoveredReference = recoveredSession?.reference
              const recoveredReferenceId = String(recoveredReference?.id || '').trim()
              if (recoveredReferenceId && !isTemporaryReferenceId(recoveredReferenceId)) {
                activeReferenceIdRef.current = recoveredReferenceId
                setReferenceData({
                  ...localReference,
                  ...recoveredReference,
                  status: recoveredReference.status || 'uploading',
                })
                setReferenceHistory((current) =>
                  current.map((item) =>
                    item.id === localReference.id
                      ? {
                          ...localReference,
                          ...recoveredReference,
                          generatedScripts: [],
                        }
                      : item,
                  ),
                )
                void refreshProcessingReference(recoveredReferenceId)
                return
              }
            } catch {
              // Fall through to the upload interruption message below.
            }
            setCurrentStep('upload')
            setUploadPhase('failed')
            setIsAnalyzing(false)
            setAnalyzeError('업로드가 완료되기 전에 연결이 끊어진 것 같아요. 네트워크 상태를 확인한 뒤 다시 업로드해주세요.')
            setAnalyzeErrorType('recovering')
            setReferenceHistory((current) => current.filter((item) => item.id !== localReference.id))
            if (activeReferenceIdRef.current === localReference.id) {
              activeReferenceIdRef.current = null
            }
          }, UPLOAD_RECOVERY_TIMEOUT_MS)
        }
      } else {
        setCurrentStep('upload')
        setUploadPhase('failed')
        setReferenceHistory((current) =>
          current.map((item) =>
            serverReferenceId && item.id === serverReferenceId
              ? {
                  ...item,
                  status: 'failed',
                }
              : item,
          ).filter((item) => item.id !== localReference.id),
        )
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

  const analyzeReferenceScript = async (scriptText, options = {}) => {
    const requestAccountId = currentAccount?.id
    const normalizedScriptText = String(scriptText || '').trim()
    if (!requestAccountId) {
      throw new Error('계정을 먼저 선택하세요.')
    }
    if (normalizedScriptText.length < 20) {
      setAnalyzeError('레퍼런스 대본은 최소 20자 이상 입력해주세요.')
      setAnalyzeErrorType('unsupported-file')
      return
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
    const displayTopic = normalizedTopic || '일반'
    const persistedProjectId = getPersistedCurrentProjectId()
    const clientUploadId = createClientUploadId()
    const createdAt = new Date().toISOString()
    const localReference = {
      id: `reference-${Date.now()}`,
      title: uploadTitle.trim() || '대본 레퍼런스',
      fileName: '대본 직접 입력',
      topic: displayTopic,
      projectId: persistedProjectId,
      createdAt,
      status: 'processing',
    }

    activeReferenceIdRef.current = localReference.id
    setReferenceData(localReference)
    setGeneratedScripts([])
    setSelectedScript(null)
    setSelectedScriptId(null)
    setActiveScriptId(null)
    setVersions([])
    setFeedback(null)
    setEditorSections(createEditorSections())
    setPendingSuggestion(null)
    setPreviousAdvice(null)
    setAnalyzeError('')
    setAnalyzeErrorType('')
    setUploadPhase('analyzing')
    setChatMessages([])
    setCopilotUsage(createInitialCopilotUsage())
    setCopilotMemory(createInitialCopilotMemory())
    setReferenceHistory((current) => [localReference, ...current])
    setCurrentStep('analyzing')
    setIsAnalyzing(true)
    setViewTransition('idle')
    setIsEditorEntering(false)
    setIsResultEntering(false)

    let keepAnalyzingAfterAccepted = false
    try {
      const analysis = await analyzeReferenceScriptText({
        scriptText: normalizedScriptText,
        accountId: requestAccountId,
        topic: normalizedTopic,
        title: uploadTitle,
        projectId: persistedProjectId,
        clientUploadId,
        signal: requestAbortController.signal,
      })
      if (!isCurrentAnalysisRequest()) {
        return
      }

      const completedReference = {
        ...localReference,
        ...analysis.reference,
        status: isProcessingLikeReferenceStatus(analysis.reference?.status)
          ? analysis.reference.status
          : 'ready',
      }
      if (!isProcessingLikeReferenceStatus(completedReference.status)) {
        void refreshEntitlement({ referenceId: completedReference.id, silent: true })
      }
      setUploadTitle('')
      setReferenceScriptText('')
      applyReferenceAnalysisResult({
        accountId: requestAccountId,
        baseReference: localReference,
        analysis: {
          ...analysis,
          reference: completedReference,
        },
      })
      if (isProcessingLikeReferenceStatus(completedReference.status) && completedReference.hasAnalysisPreview) {
        keepAnalyzingAfterAccepted = true
        setCurrentStep('result')
        setUploadPhase('server-accepted')
        setIsAnalyzing(true)
        setIsResultEntering(true)
        window.setTimeout(() => {
          if (isCurrentAccountRequest(requestAccountId)) {
            setIsResultEntering(false)
          }
        }, 420)
      }
    } catch (error) {
      if (!isCurrentAnalysisRequest()) {
        canceledAnalysisTokensRef.current.delete(requestToken)
        return
      }
      if (error?.name === 'AbortError' && !/timeout/i.test(String(error?.message || ''))) {
        canceledAnalysisTokensRef.current.delete(requestToken)
        return
      }
      console.groupCollapsed('[reference-analysis] script analyze failed')
      console.error('message:', error.message)
      console.error('code:', error.code || null)
      console.error('details:', error.details || null)
      console.error('requestId:', error.requestId || null)
      console.error(error)
      console.groupEnd()
      const analyzedFailure = classifyAnalyzeFailure(error)
      setAnalyzeError(analyzedFailure.message || '대본 분석에 실패했습니다. 잠시 후 다시 시도해주세요.')
      setAnalyzeErrorType(analyzedFailure.type)
      setCurrentStep('upload')
      setUploadPhase('failed')
      setReferenceHistory((current) => current.filter((item) => item.id !== localReference.id))
      if (activeReferenceIdRef.current === localReference.id) {
        activeReferenceIdRef.current = null
      }
    } finally {
      if (analysisAbortControllerRef.current === requestAbortController) {
        analysisAbortControllerRef.current = null
      }
      if (isCurrentAnalysisRequest() && !keepAnalyzingAfterAccepted) {
        setIsAnalyzing(false)
      }
    }
  }

  const selectScript = async (scriptId) => {
    const requestAccountId = currentAccount?.id
    const nextScript = generatedScripts.find((item) => item.id === scriptId)
    const activeHistoryItem = referenceHistory.find((item) => item.id === activeReferenceIdRef.current)
    const currentVariantScriptId = selectedScriptId || selectedScript?.id || null
    const variantSessions = activeHistoryItem?.variantSessions || {}
    const targetVariantSession = variantSessions[scriptId] || null
    const restoredActiveScriptId =
      targetVariantSession?.activeScriptId ||
      (activeHistoryItem?.selectedScriptId === scriptId ? activeHistoryItem.activeScriptId : null)

    if (!requestAccountId || !nextScript || isEditorPreparing) {
      return
    }

    if (currentVariantScriptId && currentVariantScriptId !== scriptId) {
      syncHistory(activeReferenceIdRef.current, {
        selectedScriptId: currentVariantScriptId,
        activeScriptId,
        editorContent: serializeEditorSections(editorSections),
        versions,
        feedback,
        pendingSuggestion,
        previousAdvice,
        draftMessage,
        editTarget,
        copilotUsage,
        copilotMemory,
        chatMessages,
      })
    }

    if (
      (targetVariantSession ||
        selectedScript?.id === scriptId ||
        selectedScriptId === scriptId ||
        activeHistoryItem?.selectedScriptId === scriptId) &&
      restoredActiveScriptId
    ) {
      const restoredEditorSections = targetVariantSession?.editorContent || activeHistoryItem?.editorContent
        ? deserializeEditorContent(targetVariantSession?.editorContent || activeHistoryItem.editorContent)
        : editorSections
      const restoredVersions = Array.isArray(targetVariantSession?.versions) && targetVariantSession.versions.length
        ? targetVariantSession.versions
        : Array.isArray(activeHistoryItem?.versions) && activeHistoryItem.versions.length
          ? activeHistoryItem.versions
        : versions
      const restoredFeedback = targetVariantSession?.feedback || activeHistoryItem?.feedback || null
      const restoredPendingSuggestion =
        targetVariantSession?.pendingSuggestion || activeHistoryItem?.pendingSuggestion || null
      const restoredPreviousAdvice = normalizePreviousAdviceForState(
        targetVariantSession?.previousAdvice ||
          (activeHistoryItem?.selectedScriptId === scriptId ? activeHistoryItem?.previousAdvice : null),
      )
      const restoredDraftMessage =
        typeof targetVariantSession?.draftMessage === 'string'
          ? targetVariantSession.draftMessage
          : typeof activeHistoryItem?.draftMessage === 'string'
            ? activeHistoryItem.draftMessage
            : ''
      const restoredEditTarget = COPILOT_EDIT_TARGETS.has(targetVariantSession?.editTarget)
        ? targetVariantSession.editTarget
        : COPILOT_EDIT_TARGETS.has(activeHistoryItem?.editTarget)
          ? activeHistoryItem.editTarget
          : 'all'
      const restoredChatMessages =
        Array.isArray(targetVariantSession?.chatMessages) && targetVariantSession.chatMessages.length
          ? targetVariantSession.chatMessages
          : Array.isArray(activeHistoryItem?.chatMessages) &&
              activeHistoryItem.chatMessages.length &&
              activeHistoryItem.selectedScriptId === scriptId
            ? activeHistoryItem.chatMessages
            : initialState.chatMessages
      const restoredUsage =
        activeHistoryItem?.copilotUsage ||
        copilotUsage ||
        createInitialCopilotUsage()
      const restoredCopilotMemory = normalizeCopilotMemory(
        targetVariantSession?.copilotMemory ||
          (activeHistoryItem?.selectedScriptId === scriptId ? activeHistoryItem?.copilotMemory : null) ||
          createInitialCopilotMemory(),
      )

      setSelectedScript(nextScript)
      setSelectedScriptId(scriptId)
      setActiveScriptId(restoredActiveScriptId)
      setEditorSections(restoredEditorSections)
      setVersions(restoredVersions)
      setFeedback(restoredFeedback)
      setPendingSuggestion(restoredPendingSuggestion)
      setPreviousAdvice(restoredPreviousAdvice)
      setDraftMessage(restoredDraftMessage)
      setEditTarget(restoredEditTarget)
      setChatMessages(restoredChatMessages)
      setCopilotUsage(restoredUsage)
      setCopilotMemory(restoredCopilotMemory)
      setCurrentStep('editor')
      setViewTransition('to-editor')
      setIsEditorPreparing(false)
      setIsEditorEntering(true)
      syncHistory(activeReferenceIdRef.current, {
        selectedScriptId: scriptId,
        activeScriptId: restoredActiveScriptId,
        editorContent: serializeEditorSections(restoredEditorSections),
        versions: restoredVersions,
        feedback: restoredFeedback,
        pendingSuggestion: restoredPendingSuggestion,
        previousAdvice: restoredPreviousAdvice,
        draftMessage: restoredDraftMessage,
        editTarget: restoredEditTarget,
        copilotUsage: restoredUsage,
        copilotMemory: restoredCopilotMemory,
        chatMessages: restoredChatMessages,
        lastStep: 'editor',
      })
      setTimeout(() => {
        if (isCurrentAccountRequest(requestAccountId)) {
          setIsEditorEntering(false)
          setViewTransition('idle')
        }
      }, 420)
      return
    }

    setSelectedScript(nextScript)
    setSelectedScriptId(nextScript.id)
    setEditorSections(createEditorSections(nextScript.sections))
    setFeedback(null)
    setPendingSuggestion(null)
    setPreviousAdvice(null)
    setDraftMessage('')
    setEditTarget('all')
    setChatMessages(initialState.chatMessages)
    setCopilotMemory(createInitialCopilotMemory())
    setIsEditorPreparing(true)
    setCurrentStep('editor')
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
        setIsEditorPreparing(false)
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
        feedback: null,
        pendingSuggestion: null,
        previousAdvice: null,
        draftMessage: '',
        editTarget: 'all',
        copilotUsage,
        copilotMemory: createInitialCopilotMemory(),
        chatMessages: initialState.chatMessages,
        lastStep: 'editor',
      })
      setViewTransition('idle')
      setIsEditorPreparing(false)
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
      setIsEditorPreparing(false)
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
      selectedScriptId: selectedScriptId || selectedScript?.id || null,
      activeScriptId,
      editorContent: serializeEditorSections(editorSections),
      versions,
      feedback,
      pendingSuggestion,
      previousAdvice,
      draftMessage,
      editTarget,
      copilotUsage,
      copilotMemory,
      chatMessages,
      lastStep: 'result',
    })

    setViewTransition('to-result')
    setIsEditorPreparing(false)
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
    setSelectedScriptId(null)
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

  const goToScriptAnalysisMode = () => {
    setActiveToolPage(null)
    setAnalyzeError('')
    setAnalyzeErrorType('')
    setUploadPhase('idle')
    setIsAnalyzing(false)
    setViewTransition('idle')
    setIsEditorEntering(false)
    setIsResultEntering(false)
    setUploadInputModeHint('script')
    setCurrentStep('upload')
  }

  const clearUploadInputModeHint = () => {
    setUploadInputModeHint('')
  }

  const openReference = (referenceId) => {
    const requestAccountId = currentAccount?.id
    const item = referenceHistory.find((entry) => entry.id === referenceId)

    if (!requestAccountId || !item) {
      return
    }
    setActiveToolPage(null)

    const applyOpenedState = ({ detail, baseItem }) => {
      const isProcessingReference = isProcessingLikeReferenceStatus(detail.reference?.status)
      const isFailedReference = detail.reference?.status === 'failed'
      const restoredSelectedScriptId = baseItem.selectedScriptId || null
      const generatedScriptsForDetail =
        Array.isArray(detail.generatedScripts) && detail.generatedScripts.length
          ? detail.generatedScripts
          : Array.isArray(baseItem.generatedScripts)
            ? baseItem.generatedScripts
            : []
      const restoredSelectedScript =
        generatedScriptsForDetail.find((script) => script.id === restoredSelectedScriptId) ||
        (restoredSelectedScriptId
          ? {
              id: restoredSelectedScriptId,
              label:
                restoredSelectedScriptId === 'script-1'
                  ? 'A안'
                  : restoredSelectedScriptId === 'script-2'
                    ? 'B안'
                    : restoredSelectedScriptId === 'script-3'
                      ? 'C안'
                      : '선택한 초안',
              sections: baseItem.editorContent ? deserializeEditorContent(baseItem.editorContent) : createEditorSections(),
            }
          : null)
      const hasRestorableEditor = Boolean(
        restoredSelectedScriptId &&
          (baseItem.activeScriptId || baseItem.editorContent || baseItem.lastStep === 'editor'),
      )
      const restoredEditorSections = baseItem.editorContent
        ? deserializeEditorContent(baseItem.editorContent)
        : createEditorSections(restoredSelectedScript?.sections)
      activeReferenceIdRef.current = baseItem.id
      setReferenceData(detail.reference)
      setGeneratedScripts(generatedScriptsForDetail)
      setSelectedScript(restoredSelectedScript)
      setSelectedScriptId(restoredSelectedScriptId)
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

      setEditorSections(restoredEditorSections)
      setFeedback(baseItem.feedback || null)
      setPendingSuggestion(baseItem.pendingSuggestion || null)
      setPreviousAdvice(normalizePreviousAdviceForState(baseItem.previousAdvice || null))
      setDraftMessage(baseItem.draftMessage || '')
      setEditTarget(COPILOT_EDIT_TARGETS.has(baseItem.editTarget) ? baseItem.editTarget : 'all')
      setChatMessages(
        baseItem.chatMessages || [
          {
            id: `history-${baseItem.id}`,
            role: 'assistant',
            content: `${baseItem.title} 작업을 불러왔습니다.`,
          },
        ],
      )
      setCopilotUsage(baseItem.copilotUsage || createInitialCopilotUsage())
      setCopilotMemory(normalizeCopilotMemory(baseItem.copilotMemory || createInitialCopilotMemory()))
      let restoredStep = 'result'
      if (isProcessingReference) {
        restoredStep = 'analyzing'
      } else if (isFailedReference) {
        restoredStep = 'upload'
      } else if (hasRestorableEditor) {
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
                generatedScripts: generatedScriptsForDetail,
                selectedScriptId: baseItem.selectedScriptId || entry.selectedScriptId || null,
                activeScriptId: baseItem.activeScriptId || entry.activeScriptId || null,
                editorContent: baseItem.editorContent || entry.editorContent || '',
                versions: Array.isArray(baseItem.versions) && baseItem.versions.length
                  ? baseItem.versions
                  : entry.versions,
                feedback: baseItem.feedback || entry.feedback || null,
                pendingSuggestion: baseItem.pendingSuggestion || entry.pendingSuggestion || null,
                draftMessage:
                  typeof baseItem.draftMessage === 'string' ? baseItem.draftMessage : entry.draftMessage,
                editTarget: baseItem.editTarget || entry.editTarget || 'all',
                copilotUsage: baseItem.copilotUsage || entry.copilotUsage || null,
                copilotMemory: baseItem.copilotMemory || entry.copilotMemory || null,
                chatMessages: Array.isArray(baseItem.chatMessages) && baseItem.chatMessages.length
                  ? baseItem.chatMessages
                  : entry.chatMessages,
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
    if (isSavingVersionRef.current) {
      return
    }

    const requestAccountId = currentAccount?.id
    if (!requestAccountId || !activeScriptId) {
      showToast('저장할 스크립트가 없습니다.', 'error')
      return
    }

    isSavingVersionRef.current = true
    setIsSavingVersion(true)
    showToast('버전을 저장하고 있습니다...', 'loading')

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
      showToast('버전 저장이 완료됐습니다.', 'success')
    } catch (error) {
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }
      showToast(error.message || '버전 저장에 실패했습니다.', 'error')
      setChatMessages((current) => [
        ...current,
        {
          id: `version-save-error-${Date.now()}`,
          role: 'assistant',
          content: error.message || '버전 저장에 실패했습니다.',
        },
      ])
    } finally {
      isSavingVersionRef.current = false
      setIsSavingVersion(false)
    }
  }

  const openVersionHistory = () => {
    setIsVersionModalOpen(true)
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
    setChatMessages((current) => {
      const next = [...current, userFeedbackRequestMessage]
      syncHistory(activeReferenceIdRef.current, {
        chatMessages: next,
      })
      return next
    })

    try {
      const previousFeedbackForRecheck =
        feedback?.applied && feedback?.staleAfterApply ? feedback : null
      const result = await generateScriptFeedback({
        accountId: requestAccountId,
        referenceId: referenceData?.id,
        scriptId: activeScriptId,
        currentVersionId: versions[0]?.id,
        selectedLabel: selectedScript?.label,
        sections: editorSections,
        previousFeedback: previousFeedbackForRecheck,
      })
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }
      const normalizedFeedback = {
        ...result,
        id: `feedback-${Date.now()}`,
        applied: false,
        staleAfterApply: false,
        recheckedAfterApply: Boolean(previousFeedbackForRecheck),
        previousFeedbackScore: previousFeedbackForRecheck?.score ?? null,
        scoreDeltaFromPreviousFeedback:
          Number.isFinite(Number(result?.score)) &&
          Number.isFinite(Number(previousFeedbackForRecheck?.score))
            ? Number(result.score) - Number(previousFeedbackForRecheck.score)
            : null,
      }
      setFeedback(normalizedFeedback)
      setCopilotUsage((current) => {
        const next = {
          ...current,
          feedbackUsed: current.feedbackUsed + 1,
        }
        syncHistory(activeReferenceIdRef.current, {
          copilotUsage: next,
        })
        return next
      })
      void refreshEntitlement({ referenceId: referenceData?.id, silent: true })
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
      void refreshEntitlement({ referenceId: referenceData?.id, silent: true, forceRefresh: true })
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

  const applyFeedback = async (targetFeedback = feedback) => {
    if (isApplyingFeedback || targetFeedback?.applied || !targetFeedback) {
      return
    }

    const requestAccountId = currentAccount?.id
    if (!requestAccountId) {
      return
    }
    setIsApplyingFeedback(true)
    const beforeSections = createEditorSections(editorSections)
    let nextSections = null
    let feedbackApplyMessage = ''

    try {
      const applyResult = await applyScriptFeedback({
        accountId: requestAccountId,
        referenceId: referenceData?.id,
        scriptId: activeScriptId,
        currentVersionId: versions[0]?.id,
        selectedLabel: selectedScript?.label,
        sections: beforeSections,
        feedback: targetFeedback,
        editTarget: targetFeedback.editTarget || targetFeedback.targetSection || 'all',
        copilotMemory,
      })

      nextSections = createEditorSections(applyResult.sections)
      feedbackApplyMessage = applyResult.message || ''
      const changedSections = Array.isArray(applyResult.changedSections)
        ? applyResult.changedSections
        : []
      const hasChangedSections =
        changedSections.length > 0 ||
        nextSections.hook !== beforeSections.hook ||
        nextSections.body !== beforeSections.body ||
        nextSections.cta !== beforeSections.cta
      if (!hasChangedSections) {
        setChatMessages((current) => {
          const next = [
            ...current,
            {
              id: `feedback-apply-nochange-${Date.now()}`,
              role: 'assistant',
              content:
                feedbackApplyMessage ||
                '피드백을 반영하려 했지만 에디터에 적용할 수 있는 변경점이 없었습니다. 피드백을 다시 생성하거나 수정 범위를 좁혀 요청해 주세요.',
            },
          ]
          syncHistory(activeReferenceIdRef.current, {
            chatMessages: next,
          })
          return next
        })
        setIsApplyingFeedback(false)
        return
      }
    } catch (error) {
      if (isCurrentAccountRequest(requestAccountId)) {
        setChatMessages((current) => {
          const next = [
            ...current,
            {
              id: `feedback-apply-error-${Date.now()}`,
              role: 'assistant',
              content: error.message || '피드백 진단을 반영한 수정본 생성에 실패했습니다. 다시 시도해주세요.',
            },
          ]
          syncHistory(activeReferenceIdRef.current, {
            chatMessages: next,
          })
          return next
        })
        setIsApplyingFeedback(false)
      }
      return
    }

    const serializedContent = serializeEditorSections(nextSections)
    if (!activeScriptId) {
      setEditorSections(nextSections)
      setPendingSuggestion(null)
      setIsApplyingFeedback(false)
      return
    }

    try {
      const beforeVersion = await saveVersionRecord({
        accountId: requestAccountId,
        scriptId: activeScriptId,
        title: '피드백 반영 전',
        sections: beforeSections,
        versionType: 'feedback_before',
        score: selectedScript?.score ?? versions[0]?.score ?? null,
        metadata: {
          referenceId: referenceData?.id,
          selectedLabel: selectedScript?.label,
          feedbackSummary: targetFeedback.summary,
          pairedFeedbackApply: true,
        },
      })
      const nextVersion = await saveVersionRecord({
        accountId: requestAccountId,
        scriptId: activeScriptId,
        title: '피드백 반영본',
        sections: nextSections,
        versionType: 'feedback_apply',
        score: null,
        metadata: {
          referenceId: referenceData?.id,
          selectedLabel: selectedScript?.label,
          feedbackSummary: targetFeedback.summary,
          feedbackOriginalScore: targetFeedback.score ?? null,
          needsFeedbackRecheck: true,
        },
      })
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }

      setEditorSections(nextSections)
      setPendingSuggestion(null)

      const appliedMessage = {
        id: `feedback-applied-${Date.now()}`,
        role: 'assistant',
        content:
          feedbackApplyMessage ||
          '피드백에서 짚은 문제를 에디터에 반영했습니다. 이제 재평가하면 이전 문제가 해결됐는지 기준으로 다시 판단합니다.',
      }

      const appliedFeedback = {
        ...targetFeedback,
        applied: true,
        staleAfterApply: true,
      }

      setFeedback(appliedFeedback)

      setVersions((current) => {
        const next = [nextVersion, beforeVersion, ...current]
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
          message.feedback &&
          (message.feedback === targetFeedback ||
            (targetFeedback.id && message.feedback.id === targetFeedback.id))
            ? { ...message, feedback: { ...message.feedback, applied: true, staleAfterApply: true } }
            : message,
        )
        const next = [...marked, appliedMessage]
        syncHistory(activeReferenceIdRef.current, {
          chatMessages: next,
          feedback: appliedFeedback,
        })
        return next
      })

      showToast('피드백 반영 전/후 버전 저장 완료')
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

  const sendChatMessage = async (options = {}) => {
    const requestOptions = options && typeof options === 'object' && !options.preventDefault ? options : {}
    const requestAccountId = currentAccount?.id
    const explicitMessage = typeof requestOptions.message === 'string'
    const normalized = (explicitMessage ? requestOptions.message : draftMessage).trim()
    const targetDurationSeconds = Number.isFinite(Number(requestOptions.targetDurationSeconds))
      ? Number(requestOptions.targetDurationSeconds)
      : null
    const explicitPreviousAdvice = normalizePreviousAdviceForState(requestOptions.previousAdvice)
    const requestPreviousAdvice =
      explicitPreviousAdvice ||
      (shouldCarryPreviousAdviceForMessage(normalized) ? agePreviousAdvice(previousAdvice) : null)

    if (!requestAccountId || !normalized) {
      return
    }

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: normalized,
    }
    const nextCopilotMemory = updateCopilotMemoryFromUserMessage(copilotMemory, normalized)
    setPreviousAdvice(requestPreviousAdvice)

    if (!explicitMessage) {
      setDraftMessage('')
    }
    setCopilotMemory(nextCopilotMemory)
    setIsChatLoading(true)
    setChatMessages((current) => {
      const next = [...current, userMessage]
      syncHistory(activeReferenceIdRef.current, {
        chatMessages: next,
        draftMessage: explicitMessage ? draftMessage : '',
        editTarget,
        copilotMemory: nextCopilotMemory,
        previousAdvice: requestPreviousAdvice,
      })
      return next
    })

    try {
      const response = await generateChatReply({
        accountId: requestAccountId,
        referenceId: referenceData?.id,
        scriptId: activeScriptId,
        currentVersionId: versions[0]?.id,
        editTarget,
        selectedLabel: selectedScript?.label,
        editorSections,
        message: normalized,
        copilotMemory: nextCopilotMemory,
        targetDurationSeconds,
        previousAdvice: requestPreviousAdvice,
        replyToMessageId: requestOptions.replyToMessageId || '',
      })
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }

      if (response.type === 'feedback') {
        const normalizedFeedback = { ...response.feedback, id: `feedback-${Date.now()}`, applied: false }
        setFeedback(normalizedFeedback)
        setCopilotUsage((current) => {
          const next = {
            ...current,
            feedbackUsed: current.feedbackUsed + 1,
          }
          syncHistory(activeReferenceIdRef.current, {
            copilotUsage: next,
          })
          return next
        })
        void refreshEntitlement({ referenceId: referenceData?.id, silent: true })
        setChatMessages((current) => {
          const next = [
            ...current,
            {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: response.message,
              feedback: normalizedFeedback,
              intent: response.intent,
            },
          ]
          syncHistory(activeReferenceIdRef.current, {
            feedback: normalizedFeedback,
            chatMessages: next,
          })
          return next
        })
        return
      }

      if (response.type === 'reply') {
        const assistantId = `assistant-${Date.now()}`
        const nextPreviousAdvice = normalizePreviousAdviceForState(
          response.actionableAdvice
            ? {
                ...response.actionableAdvice,
                sourceMessageId: assistantId,
                createdAt: new Date().toISOString(),
                messageTurnsSinceCreated: 0,
              }
            : requestPreviousAdvice,
        )
        setPreviousAdvice(nextPreviousAdvice)
        setChatMessages((current) => {
          const next = [
            ...current,
            {
              id: assistantId,
              role: 'assistant',
              content: response.message,
              intent: response.intent,
              actionableAdvice: nextPreviousAdvice,
            },
          ]
          syncHistory(activeReferenceIdRef.current, {
            chatMessages: next,
            previousAdvice: nextPreviousAdvice,
          })
          return next
        })
        return
      }

      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.message,
        proposedSections: response.proposedSections,
        editTarget: response.editTarget,
        changedSections: response.changedSections,
        flowValidation: response.flowValidation,
        intent: response.intent,
        editPlan: response.editPlan,
        qualityGate: response.qualityGate,
        sessionId: response.personalization?.sessionId,
      }

      setCopilotUsage((current) => {
        const next = {
          ...current,
          chatUsed: current.chatUsed + 1,
        }
        syncHistory(activeReferenceIdRef.current, {
          copilotUsage: next,
        })
        return next
      })
      setPendingSuggestion(response.proposedSections)
      setPreviousAdvice(null)
      void refreshEntitlement({ referenceId: referenceData?.id, silent: true })
      setChatMessages((current) => {
        const next = [...current, assistantMessage]
        syncHistory(activeReferenceIdRef.current, {
          chatMessages: next,
          pendingSuggestion: response.proposedSections,
          previousAdvice: null,
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

  const requestDurationCompress = async (targetSeconds) => {
    const seconds = Number(targetSeconds)
    if (!Number.isFinite(seconds)) {
      return
    }

    await sendChatMessage({
      message: `${Math.floor(seconds)}초로 압축해줘`,
      targetDurationSeconds: Math.floor(seconds),
    })
  }

  const getSuggestionVersionTitle = (target = 'all') => {
    const titleByTarget = {
      hook: 'AI HOOK 수정 반영본',
      body: 'AI BODY 수정 반영본',
      cta: 'AI CTA 수정 반영본',
      all: 'AI 전체 수정 반영본',
    }
    return titleByTarget[target] || 'AI 수정 반영본'
  }

  const applySuggestion = async (sections, messageId = null) => {
    if (isApplyingSuggestion) {
      return
    }

    const requestAccountId = currentAccount?.id
    if (!requestAccountId) {
      return
    }

    const nextSections = createEditorSections(sections)
    const serializedContent = serializeEditorSections(nextSections)
    const sourceMessage = messageId
      ? chatMessages.find((message) => message.id === messageId)
      : null
    const sourceEditTarget = sourceMessage?.editTarget || editTarget || 'all'

    if (!activeScriptId) {
      setEditorSections(nextSections)
      setPendingSuggestion(null)
      setPreviousAdvice(null)
      setCurrentStep('editor')
      setViewTransition('to-editor')
      syncHistory(activeReferenceIdRef.current, {
        editorContent: serializedContent,
        pendingSuggestion: null,
        previousAdvice: null,
        lastStep: 'editor',
      })
      showToast('AI 수정안을 에디터에 반영했습니다')
      requestEditorScroll()
      return
    }

    setIsApplyingSuggestion(true)
    showToast('AI 수정안을 저장하고 있습니다...', 'loading')

    try {
      const nextVersion = await saveVersionRecord({
        accountId: requestAccountId,
        scriptId: activeScriptId,
        title: getSuggestionVersionTitle(sourceEditTarget),
        sections: nextSections,
        versionType: 'ai_generation',
        score: feedback?.score ?? selectedScript?.score ?? versions[0]?.score ?? null,
        metadata: {
          referenceId: referenceData?.id,
          selectedLabel: selectedScript?.label,
          editTarget: sourceEditTarget,
          changedSections: sourceMessage?.changedSections || [],
          intent: sourceMessage?.intent?.intent || sourceMessage?.intent || '',
          operationType: sourceMessage?.editPlan?.operationType || '',
          sessionId: sourceMessage?.sessionId || '',
          source: 'copilot_suggestion_apply',
        },
      })

      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }

      setEditorSections(nextSections)
      setPendingSuggestion(null)
      setPreviousAdvice(null)
      setCurrentStep('editor')
      setViewTransition('to-editor')

      setVersions((current) => {
        const next = [nextVersion, ...current]
        setCachedScriptVersions(requestAccountId, activeScriptId, next)
        syncHistory(activeReferenceIdRef.current, {
          activeScriptId,
          editorContent: serializedContent,
          versions: next,
          pendingSuggestion: null,
          previousAdvice: null,
          lastStep: 'editor',
        })
        return next
      })

      setChatMessages((current) => {
        const next = messageId
          ? current.map((message) =>
              message.id === messageId ? { ...message, suggestionApplied: true } : message,
            )
          : current
        syncHistory(activeReferenceIdRef.current, {
          chatMessages: next,
          pendingSuggestion: null,
          previousAdvice: null,
        })
        return next
      })

      showToast('AI 수정안을 에디터에 반영하고 저장 내역에 남겼습니다.', 'success')
      requestEditorScroll()
    } catch (error) {
      if (!isCurrentAccountRequest(requestAccountId)) {
        return
      }
      showToast(error.message || 'AI 수정안 저장에 실패했습니다.', 'error')
      setChatMessages((current) => {
        const next = [
          ...current,
          {
            id: `suggestion-save-error-${Date.now()}`,
            role: 'assistant',
            content:
              error.message ||
              'AI 수정안 자동 저장에 실패했습니다. 잠시 후 다시 적용해 주세요.',
          },
        ]
        syncHistory(activeReferenceIdRef.current, {
          chatMessages: next,
        })
        return next
      })
    } finally {
      if (isCurrentAccountRequest(requestAccountId)) {
        setIsApplyingSuggestion(false)
      }
    }
  }

  const restoreVersion = async (versionId) => {
    const requestAccountId = currentAccount?.id
    const version = versions.find((item) => item.id === versionId)

    if (!requestAccountId || !version || !activeScriptId) {
      showToast('불러올 버전을 찾지 못했습니다.', 'error')
      return
    }

    showToast('버전을 불러오고 있습니다...')

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
      showToast(error.message || '버전 복원에 실패했습니다.', 'error')
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

  const exportCurrentScriptPdf = async () => {
    if (isPdfExporting) {
      return
    }

    setIsPdfExporting(true)
    try {
      await downloadScriptPdf({
        title: `${referenceData?.title || '스크립트'} · ${selectedScript?.label || 'Export'}`,
        sections: editorSections,
      })
      showToast('PDF 다운로드를 시작했습니다')
    } catch (error) {
      const message = error.message || 'PDF 다운로드에 실패했습니다.'
      const fallbackMessage = `${message}\n\nPDF가 계속 실패하면 에디터의 Hook, Body, CTA 텍스트를 먼저 복사해서 보관해주세요.`
      showToast('PDF 내보내기에 실패했습니다. 텍스트 복사를 이용해주세요.', 'error')
      setChatMessages((current) => [
        ...current,
        {
          id: `pdf-export-error-${Date.now()}`,
          role: 'assistant',
          content: fallbackMessage,
        },
      ])
    } finally {
      setIsPdfExporting(false)
    }
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

  const updateDraftMessage = (value) => {
    const nextValue = typeof value === 'function' ? value(draftMessage) : value
    setDraftMessage(nextValue)
    syncHistory(activeReferenceIdRef.current, {
      draftMessage: nextValue,
      lastStep: currentStep === 'editor' ? 'editor' : 'result',
    })
  }

  const updateEditTarget = (target) => {
    const nextTarget = COPILOT_EDIT_TARGETS.has(target) ? target : 'all'
    setEditTarget(nextTarget)
    syncHistory(activeReferenceIdRef.current, {
      editTarget: nextTarget,
      lastStep: currentStep === 'editor' ? 'editor' : 'result',
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
      activeToolPage,
      referenceData,
      generatedScripts,
      selectedScript,
      selectedScriptId,
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
      editTarget,
      uploadTopic,
      uploadTitle,
      referenceScriptText,
      uploadInputModeHint,
      uploadPhase,
      analyzeError,
      analyzeErrorType,
      pendingSuggestion,
      previousAdvice,
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
      isApplyingSuggestion,
      isEditorPreparing,
      isSavingVersion,
      isPdfExporting,
      viewTransition,
      isEditorEntering,
      isResultEntering,
      goBackToUpload,
      goToScriptAnalysisMode,
      goBackToResults,
      clearScriptSelection,
      setActiveToolPage,
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
      analyzeReferenceScript,
      selectScript,
      openReference,
      saveVersion,
      requestFeedback,
      applyFeedback,
      sendChatMessage,
      requestDurationCompress,
      applySuggestion,
      restoreVersion,
      openVersionHistory,
      exportCurrentScriptPdf,
      updateEditorSection,
      setDraftMessage: updateDraftMessage,
      setEditTarget: updateEditTarget,
      setUploadTopic,
      setUploadTitle,
      setReferenceScriptText,
      clearUploadInputModeHint,
      setIsVersionModalOpen,
      setToast,
      serializeEditorSections,
    }),
    [
      chatMessages,
      currentStep,
      activeToolPage,
      draftMessage,
      editTarget,
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
      isApplyingSuggestion,
      isEditorPreparing,
      isSavingVersion,
      isPdfExporting,
      isEditorEntering,
      isLoggedIn,
      isResultEntering,
      isVersionModalOpen,
      pendingSuggestion,
      previousAdvice,
      activeScriptId,
      toast,
      copilotUsage,
      referenceData,
      referenceHistory,
      selectedScript,
      selectedScriptId,
      uploadTitle,
      uploadTopic,
      referenceScriptText,
      uploadInputModeHint,
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
