import { safeGetStorageItem, safeSetStorageItem } from '../lib/safeStorage'
import { COPILOT_EDIT_TARGETS } from './appStateConstants'
import { normalizeCopilotMemory } from './copilotMemory'

const REFERENCE_HISTORY_CACHE_KEY = 'personal-ai-service:reference-history-cache:v1'
const REFERENCE_HISTORY_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30
const ACCOUNTS_CACHE_KEY = 'personal-ai-service:accounts-cache:v1'
const ACCOUNTS_CACHE_TTL_MS = 1000 * 60 * 60 * 24
const REFERENCE_DETAIL_CACHE_KEY = 'personal-ai-service:reference-detail-cache:v1'
const REFERENCE_DETAIL_CACHE_TTL_MS = 1000 * 60 * 60 * 24
const SCRIPT_VERSIONS_CACHE_KEY = 'personal-ai-service:script-versions-cache:v1'
const SCRIPT_VERSIONS_CACHE_TTL_MS = 1000 * 60 * 60 * 12

export function normalizeHistoryCacheItem(item = {}) {
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
            suggestionApplied: Boolean(message.suggestionApplied),
            editTarget: typeof message.editTarget === 'string' ? message.editTarget : undefined,
            changedSections: Array.isArray(message.changedSections) ? message.changedSections : undefined,
            flowValidation:
              message.flowValidation && typeof message.flowValidation === 'object'
                ? message.flowValidation
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
    pendingSuggestion:
      item.pendingSuggestion && typeof item.pendingSuggestion === 'object' ? item.pendingSuggestion : null,
    draftMessage: typeof item.draftMessage === 'string' ? item.draftMessage : '',
    editTarget: COPILOT_EDIT_TARGETS.has(item.editTarget) ? item.editTarget : 'all',
    copilotUsage:
      item.copilotUsage && typeof item.copilotUsage === 'object'
        ? {
            chatUsed: Number(item.copilotUsage.chatUsed || 0),
            feedbackUsed: Number(item.copilotUsage.feedbackUsed || 0),
          }
        : null,
    copilotMemory:
      item.copilotMemory && typeof item.copilotMemory === 'object'
        ? normalizeCopilotMemory(item.copilotMemory)
        : null,
    generatedScripts: Array.isArray(item.generatedScripts) ? item.generatedScripts : [],
    chatMessages: normalizedChatMessages,
    lastStep:
      item.lastStep === 'editor' || item.lastStep === 'result' || item.lastStep === 'upload'
        ? item.lastStep
        : null,
  }
}

export function mergeHistoryItem(serverItem, localItem) {
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
    pendingSuggestion: normalizedLocal.pendingSuggestion || normalizedServer.pendingSuggestion,
    draftMessage: normalizedLocal.draftMessage || normalizedServer.draftMessage,
    editTarget: normalizedLocal.editTarget || normalizedServer.editTarget,
    copilotUsage: normalizedLocal.copilotUsage || normalizedServer.copilotUsage,
    copilotMemory: normalizedLocal.copilotMemory || normalizedServer.copilotMemory,
    generatedScripts:
      normalizedLocal.generatedScripts?.length ? normalizedLocal.generatedScripts : normalizedServer.generatedScripts,
    chatMessages:
      normalizedLocal.chatMessages?.length ? normalizedLocal.chatMessages : normalizedServer.chatMessages,
    lastStep: normalizedLocal.lastStep || normalizedServer.lastStep,
  }
}

export function pickPreferredAccount(accounts = [], {
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
  const raw = safeGetStorageItem(REFERENCE_HISTORY_CACHE_KEY)
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
  safeSetStorageItem(REFERENCE_HISTORY_CACHE_KEY, JSON.stringify(next))
}

export function getCachedReferenceHistory(accountId) {
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

export function setCachedReferenceHistory(accountId, items) {
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
  const raw = safeGetStorageItem(key)
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
  safeSetStorageItem(key, JSON.stringify(next))
}

export function resolveOwnerCacheKey(user) {
  return String(user?.id || user?.email || '').trim()
}

export function getCachedAccounts(user) {
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

export function setCachedAccounts(user, accounts) {
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

export function referenceDetailCacheKey(accountId, referenceId) {
  return `${String(accountId || '').trim()}::${String(referenceId || '').trim()}`
}

export function getCachedReferenceDetail(accountId, referenceId) {
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

export function setCachedReferenceDetail(accountId, referenceId, detail) {
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

export function removeCachedReferenceDetail(accountId, referenceId) {
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

export function removeCachedReferenceDetailsForAccount(accountId) {
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

export function getCachedScriptVersions(accountId, scriptId) {
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

export function setCachedScriptVersions(accountId, scriptId, versions) {
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
