import { AppError } from './errors.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'

const SCRIPT_CREATE_DEDUPE_WINDOW_SECONDS = Number.parseInt(
  String(process.env.SCRIPT_CREATE_DEDUPE_WINDOW_SECONDS || '120'),
  10,
)

function requireSupabaseAdmin() {
  if (!hasSupabaseAdminConfig()) {
    throw new AppError('Supabase admin client is not configured', {
      code: 'SUPABASE_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  return getSupabaseAdmin()
}

function isMissingColumnError(error, columnName) {
  const code = String(error?.code || '').trim()
  const message = String(error?.message || '').toLowerCase()
  if (code === '42703' && message.includes(String(columnName || '').toLowerCase())) {
    return true
  }
  return message.includes(String(columnName || '').toLowerCase()) && message.includes('schema cache')
}

function normalizeSections(sections = {}) {
  return {
    hook: sections.hook?.trim() || '',
    body: sections.body?.trim() || '',
    cta: sections.cta?.trim() || '',
  }
}

function serializeSections(sections = {}) {
  return [sections.hook || '', '', sections.body || '', '', sections.cta || ''].join('\n')
}

function mapVersion(version) {
  return {
    id: version.id,
    versionNumber: version.version_number,
    versionType: version.version_type,
    source: version.version_type,
    title: version.title,
    content: version.content,
    score: version.score,
    createdAt: version.created_at,
  }
}

async function getOwnedReferenceOrThrow(supabaseAdmin, accountId, referenceId) {
  if (!referenceId) {
    throw new AppError('referenceId is required', {
      code: 'REFERENCE_ID_REQUIRED',
      statusCode: 400,
    })
  }

  const { data, error } = await supabaseAdmin
    .from('reference_videos')
    .select('id, title, topic')
    .eq('account_id', accountId)
    .eq('id', referenceId)
    .single()

  if (error) {
    const statusCode = error.code === 'PGRST116' ? 404 : 500
    throw new AppError(statusCode === 404 ? 'Reference not found' : 'Failed to load reference', {
      code: statusCode === 404 ? 'REFERENCE_NOT_FOUND' : 'REFERENCE_FETCH_FAILED',
      statusCode,
      cause: error,
    })
  }

  return data
}

async function getOwnedScriptOrThrow(supabaseAdmin, accountId, scriptId) {
  const { data, error } = await supabaseAdmin
    .from('scripts')
    .select('id, title, category, tone, current_content, metadata, created_at, updated_at, current_score')
    .eq('account_id', accountId)
    .eq('id', scriptId)
    .single()

  if (error) {
    const statusCode = error.code === 'PGRST116' ? 404 : 500
    throw new AppError(statusCode === 404 ? 'Script not found' : 'Failed to load script', {
      code: statusCode === 404 ? 'SCRIPT_NOT_FOUND' : 'SCRIPT_FETCH_FAILED',
      statusCode,
      cause: error,
    })
  }

  return data
}

async function findRecentDuplicateScript({
  supabaseAdmin,
  accountId,
  referenceId,
  selectedLabel,
  title,
  content,
}) {
  const windowSeconds = Number.isFinite(SCRIPT_CREATE_DEDUPE_WINDOW_SECONDS)
    ? Math.max(30, Math.min(600, SCRIPT_CREATE_DEDUPE_WINDOW_SECONDS))
    : 120
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString()

  const { data, error } = await supabaseAdmin
    .from('scripts')
    .select('id, title, current_content, current_score, category, tone, metadata, created_at, updated_at')
    .eq('account_id', accountId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error || !Array.isArray(data)) {
    return null
  }

  return (
    data.find((item) => {
      const metadataReferenceId = String(item?.metadata?.referenceId || '').trim()
      const sameReference = metadataReferenceId === String(referenceId || '').trim()
      if (!sameReference) return false
      const sameTitle = String(item.title || '').trim() === String(title || '').trim()
      const sameContent = String(item.current_content || '').trim() === String(content || '').trim()
      const metadataLabel = String(item?.metadata?.selectedLabel || '').trim()
      const sameLabel = metadataLabel === String(selectedLabel || '').trim()
      return sameTitle && sameContent && sameLabel
    }) || null
  )
}

export async function createScriptFromSelection({
  accountId,
  referenceId,
  selectedLabel,
  title,
  sections,
  score = null,
}) {
  const supabaseAdmin = requireSupabaseAdmin()
  const normalizedSections = normalizeSections(sections)
  const content = serializeSections(normalizedSections)
  const scriptTitle = title?.trim() || `${selectedLabel || '스크립트'} 초안`
  await getOwnedReferenceOrThrow(supabaseAdmin, accountId, referenceId)
  const duplicateScript = await findRecentDuplicateScript({
    supabaseAdmin,
    accountId,
    referenceId,
    selectedLabel,
    title: scriptTitle,
    content,
  })

  if (duplicateScript?.id) {
    const versions = await listScriptVersions(accountId, duplicateScript.id)
    return {
      script: {
        id: duplicateScript.id,
        title: duplicateScript.title,
        currentContent: duplicateScript.current_content,
        currentScore: duplicateScript.current_score,
        category: duplicateScript.category,
        tone: duplicateScript.tone,
        metadata: duplicateScript.metadata,
        createdAt: duplicateScript.created_at,
        updatedAt: duplicateScript.updated_at,
      },
      versions,
      deduplicated: true,
    }
  }

  const scriptPayload = {
    account_id: accountId,
    reference_video_id: referenceId,
    title: scriptTitle,
    category: 'reference-video-script',
    tone: null,
    current_content: content,
    autosave_content: content,
    current_score: score,
    status: 'active',
    metadata: {
      referenceId,
      selectedLabel,
      sections: normalizedSections,
    },
  }

  let { data: script, error: scriptError } = await supabaseAdmin
    .from('scripts')
    .insert(scriptPayload)
    .select('id, title, category, tone, current_content, current_score, metadata, created_at, updated_at')
    .single()

  if (isMissingColumnError(scriptError, 'reference_video_id')) {
    delete scriptPayload.reference_video_id
    const fallback = await supabaseAdmin
      .from('scripts')
      .insert(scriptPayload)
      .select('id, title, category, tone, current_content, current_score, metadata, created_at, updated_at')
      .single()
    script = fallback.data
    scriptError = fallback.error
  }

  if (scriptError) {
    throw new AppError('Failed to create script', {
      code: 'SCRIPT_CREATE_FAILED',
      statusCode: 500,
      cause: scriptError,
    })
  }

  const { data: version, error: versionError } = await supabaseAdmin
    .from('script_versions')
    .insert({
      account_id: accountId,
      script_id: script.id,
      version_number: 1,
      version_type: 'ai_generation',
      title: `${selectedLabel || 'AI'} 초안`,
      content,
      category: script.category,
      tone: script.tone,
      score,
      status: 'active',
      metadata: {
        referenceId,
        selectedLabel,
        sections: normalizedSections,
      },
    })
    .select('id, version_number, version_type, title, content, score, created_at')
    .single()

  if (versionError) {
    throw new AppError('Failed to create initial script version', {
      code: 'SCRIPT_INITIAL_VERSION_FAILED',
      statusCode: 500,
      cause: versionError,
    })
  }

  return {
    script: {
      id: script.id,
      title: script.title,
      currentContent: script.current_content,
      currentScore: script.current_score,
      category: script.category,
      tone: script.tone,
      metadata: script.metadata,
      createdAt: script.created_at,
      updatedAt: script.updated_at,
    },
    versions: [mapVersion(version)],
  }
}

export async function listScriptVersions(accountId, scriptId) {
  const supabaseAdmin = requireSupabaseAdmin()
  await getOwnedScriptOrThrow(supabaseAdmin, accountId, scriptId)
  const { data, error } = await supabaseAdmin
    .from('script_versions')
    .select('id, version_number, version_type, title, content, score, created_at')
    .eq('account_id', accountId)
    .eq('script_id', scriptId)
    .order('version_number', { ascending: false })

  if (error) {
    throw new AppError('Failed to load script versions', {
      code: 'SCRIPT_VERSIONS_FETCH_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  return data.map(mapVersion)
}

export async function saveScriptVersion({
  accountId,
  scriptId,
  title,
  sections,
  versionType,
  score = null,
  metadata = {},
}) {
  const supabaseAdmin = requireSupabaseAdmin()
  const normalizedSections = normalizeSections(sections)
  const content = serializeSections(normalizedSections)

  const script = await getOwnedScriptOrThrow(supabaseAdmin, accountId, scriptId)

  const { count, error: countError } = await supabaseAdmin
    .from('script_versions')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('script_id', scriptId)

  if (countError) {
    throw new AppError('Failed to count script versions', {
      code: 'SCRIPT_VERSION_COUNT_FAILED',
      statusCode: 500,
      cause: countError,
    })
  }

  const versionNumber = (count || 0) + 1
  const nextTitle = title?.trim() || script.title

  const { data: latestVersionRows } = await supabaseAdmin
    .from('script_versions')
    .select('id, version_number, version_type, title, content, score, created_at')
    .eq('account_id', accountId)
    .eq('script_id', scriptId)
    .order('version_number', { ascending: false })
    .limit(1)
  const latestVersion = Array.isArray(latestVersionRows) ? latestVersionRows[0] : null
  if (
    latestVersion &&
    String(latestVersion.content || '').trim() === String(content || '').trim() &&
    String(latestVersion.version_type || '').trim() === String(versionType || '').trim()
  ) {
    return {
      version: mapVersion(latestVersion),
      deduplicated: true,
    }
  }

  const { data: version, error: versionError } = await supabaseAdmin
    .from('script_versions')
    .insert({
      account_id: accountId,
      script_id: scriptId,
      version_number: versionNumber,
      version_type: versionType,
      title: nextTitle,
      content,
      category: script.category,
      tone: script.tone,
      score,
      status: 'active',
      metadata: {
        ...metadata,
        sections: normalizedSections,
      },
    })
    .select('id, version_number, version_type, title, content, score, created_at')
    .single()

  if (versionError) {
    throw new AppError('Failed to save script version', {
      code: 'SCRIPT_VERSION_SAVE_FAILED',
      statusCode: 500,
      cause: versionError,
    })
  }

  const { error: updateError } = await supabaseAdmin
    .from('scripts')
    .update({
      title: nextTitle,
      current_content: content,
      autosave_content: content,
      current_score: score,
      status: 'active',
      metadata: {
        ...metadata,
        sections: normalizedSections,
      },
    })
    .eq('account_id', accountId)
    .eq('id', scriptId)

  if (updateError) {
    throw new AppError('Failed to update current script', {
      code: 'SCRIPT_UPDATE_FAILED',
      statusCode: 500,
      cause: updateError,
    })
  }

  return {
    version: mapVersion(version),
  }
}

export async function restoreScriptVersion({
  accountId,
  scriptId,
  versionId,
}) {
  const supabaseAdmin = requireSupabaseAdmin()
  await getOwnedScriptOrThrow(supabaseAdmin, accountId, scriptId)

  const { data: version, error: versionError } = await supabaseAdmin
    .from('script_versions')
    .select('id, content, score, title')
    .eq('account_id', accountId)
    .eq('script_id', scriptId)
    .eq('id', versionId)
    .single()

  if (versionError) {
    const statusCode = versionError.code === 'PGRST116' ? 404 : 500

    throw new AppError(
      statusCode === 404 ? 'Script version not found' : 'Failed to load script version',
      {
        code: statusCode === 404 ? 'SCRIPT_VERSION_NOT_FOUND' : 'SCRIPT_VERSION_FETCH_FAILED',
        statusCode,
        cause: versionError,
      },
    )
  }

  const { error: updateError } = await supabaseAdmin
    .from('scripts')
    .update({
      title: version.title,
      current_content: version.content,
      autosave_content: version.content,
      current_score: version.score,
    })
    .eq('account_id', accountId)
    .eq('id', scriptId)

  if (updateError) {
    throw new AppError('Failed to restore script version', {
      code: 'SCRIPT_RESTORE_FAILED',
      statusCode: 500,
      cause: updateError,
    })
  }

  return {
    content: version.content,
    score: version.score,
  }
}

export async function saveFeedbackRecord({
  accountId,
  scriptId,
  scriptVersionId = null,
  score = null,
  content,
  metadata = {},
}) {
  const supabaseAdmin = requireSupabaseAdmin()
  await getOwnedScriptOrThrow(supabaseAdmin, accountId, scriptId)
  const normalizedContent = content?.trim()

  if (!normalizedContent) {
    throw new AppError('feedback content is required', {
      code: 'INVALID_FEEDBACK_CONTENT',
      statusCode: 400,
    })
  }

  const { data, error } = await supabaseAdmin
    .from('feedback')
    .insert({
      account_id: accountId,
      script_id: scriptId,
      script_version_id: scriptVersionId,
      type: 'feedback',
      category: 'reference-video-script',
      score,
      content: normalizedContent,
      metadata,
    })
    .select('id, score, content, created_at')
    .single()

  if (error) {
    throw new AppError('Failed to save feedback record', {
      code: 'FEEDBACK_SAVE_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  return data
}
