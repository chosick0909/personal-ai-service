import { AppError } from './errors.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'

function requireSupabaseAdmin() {
  if (!hasSupabaseAdminConfig()) {
    throw new AppError('Supabase admin client is not configured', {
      code: 'SUPABASE_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  return getSupabaseAdmin()
}

async function countTableRows(supabaseAdmin, tableName, filters = []) {
  let query = supabaseAdmin.from(tableName).select('*', { count: 'exact', head: true })

  for (const filter of filters) {
    query = query.eq(filter.column, filter.value)
  }

  const { count, error } = await query

  if (error) {
    throw new AppError(`Failed to count ${tableName}`, {
      code: 'ADMIN_OVERVIEW_COUNT_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  return count ?? 0
}

export async function getAdminOverview() {
  const supabaseAdmin = requireSupabaseAdmin()

  const [
    documentCount,
    chunkCount,
    pdfDocumentCount,
    referenceVideoCount,
    scriptCount,
    scriptVersionCount,
    feedbackCount,
    accountCount,
    globalKnowledgeDocumentCount,
    globalKnowledgeChunkCount,
    recentDocumentsResult,
    recentReferenceVideosResult,
    recentScriptsResult,
    recentScriptVersionsResult,
    recentFeedbackResult,
  ] = await Promise.all([
    countTableRows(supabaseAdmin, 'documents'),
    countTableRows(supabaseAdmin, 'chunks'),
    countTableRows(supabaseAdmin, 'documents', [{ column: 'source', value: 'pdf-upload' }]),
    countTableRows(supabaseAdmin, 'reference_videos'),
    countTableRows(supabaseAdmin, 'scripts'),
    countTableRows(supabaseAdmin, 'script_versions'),
    countTableRows(supabaseAdmin, 'feedback'),
    countTableRows(supabaseAdmin, 'accounts'),
    countTableRows(supabaseAdmin, 'global_knowledge_documents'),
    countTableRows(supabaseAdmin, 'global_knowledge_chunks'),
    supabaseAdmin
      .from('documents')
      .select('id, title, source, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    supabaseAdmin
      .from('reference_videos')
      .select('id, title, topic, processing_status, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    supabaseAdmin
      .from('scripts')
      .select('id, title, current_score, status, updated_at')
      .order('updated_at', { ascending: false })
      .limit(5),
    supabaseAdmin
      .from('script_versions')
      .select('id, title, version_type, score, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    supabaseAdmin
      .from('feedback')
      .select('id, script_id, score, content, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  if (recentDocumentsResult.error) {
    throw new AppError('Failed to load recent documents', {
      code: 'ADMIN_OVERVIEW_DOCUMENTS_FAILED',
      statusCode: 500,
      cause: recentDocumentsResult.error,
    })
  }

  if (recentReferenceVideosResult.error) {
    throw new AppError('Failed to load recent reference videos', {
      code: 'ADMIN_OVERVIEW_REFERENCES_FAILED',
      statusCode: 500,
      cause: recentReferenceVideosResult.error,
    })
  }

  if (recentScriptsResult.error) {
    throw new AppError('Failed to load recent scripts', {
      code: 'ADMIN_OVERVIEW_SCRIPTS_FAILED',
      statusCode: 500,
      cause: recentScriptsResult.error,
    })
  }

  if (recentScriptVersionsResult.error) {
    throw new AppError('Failed to load recent script versions', {
      code: 'ADMIN_OVERVIEW_SCRIPT_VERSIONS_FAILED',
      statusCode: 500,
      cause: recentScriptVersionsResult.error,
    })
  }

  if (recentFeedbackResult.error) {
    throw new AppError('Failed to load recent feedback', {
      code: 'ADMIN_OVERVIEW_FEEDBACK_FAILED',
      statusCode: 500,
      cause: recentFeedbackResult.error,
    })
  }

  return {
    counts: {
      documents: documentCount,
      chunks: chunkCount,
      pdfDocuments: pdfDocumentCount,
      referenceVideos: referenceVideoCount,
      scripts: scriptCount,
      scriptVersions: scriptVersionCount,
      feedback: feedbackCount,
      accounts: accountCount,
      globalKnowledgeDocuments: globalKnowledgeDocumentCount,
      globalKnowledgeChunks: globalKnowledgeChunkCount,
    },
    recentDocuments: recentDocumentsResult.data ?? [],
    recentReferenceVideos: recentReferenceVideosResult.data ?? [],
    recentScripts: recentScriptsResult.data ?? [],
    recentScriptVersions: recentScriptVersionsResult.data ?? [],
    recentFeedback: recentFeedbackResult.data ?? [],
  }
}

function isPdfDocument(document) {
  return (
    document?.metadata?.ingestionType === 'pdf' ||
    document?.source === 'pdf-upload' ||
    document?.source === 'admin-pdf'
  )
}

function mapLegacyAdminDocument(document) {
  return {
    ...document,
    browser_kind: 'legacy',
    browser_label: 'Legacy PDF',
  }
}

function mapGlobalKnowledgeDocument(document) {
  return {
    id: document.id,
    title: document.title,
    source: 'global-knowledge',
    summary: document.summary,
    metadata: {
      ...(document.metadata || {}),
      category: document.category,
    },
    created_at: document.created_at,
    browser_kind: 'global',
    browser_label: 'Global Knowledge',
  }
}

export async function listAdminPdfDocuments() {
  const supabaseAdmin = requireSupabaseAdmin()

  const globalResult = await supabaseAdmin
    .from('global_knowledge_documents')
    .select('id, title, category, source, summary, metadata, created_at')
    .order('created_at', { ascending: false })

  if (globalResult.error) {
    throw new AppError('Failed to load admin global knowledge documents', {
      code: 'ADMIN_GLOBAL_DOCUMENT_LIST_FAILED',
      statusCode: 500,
      cause: globalResult.error,
    })
  }

  const globalDocuments = (globalResult.data ?? []).map(mapGlobalKnowledgeDocument)

  return globalDocuments
}

export async function getAdminPdfDocumentDetail(documentId) {
  const supabaseAdmin = requireSupabaseAdmin()

  const { data: legacyDocument, error: legacyDocumentError } = await supabaseAdmin
    .from('documents')
    .select('id, title, source, metadata, created_at')
    .eq('id', documentId)
    .single()

  if (!legacyDocumentError && legacyDocument) {
    const { data: chunks, error: chunkError } = await supabaseAdmin
      .from('chunks')
      .select('id, document_id, chunk_index, content, metadata, created_at')
      .eq('document_id', documentId)
      .order('chunk_index')

    if (chunkError) {
      throw new AppError('Failed to load admin document chunks', {
        code: 'ADMIN_DOCUMENT_CHUNKS_FAILED',
        statusCode: 500,
        cause: chunkError,
      })
    }

    const chunkRows = chunks ?? []

    return {
      ...mapLegacyAdminDocument(legacyDocument),
      chunkCount: chunkRows.length,
      reconstructedContent: chunkRows.map((chunk) => chunk.content).join('\n\n'),
      chunks: chunkRows,
    }
  }

  const { data: globalDocument, error: globalDocumentError } = await supabaseAdmin
    .from('global_knowledge_documents')
    .select('id, title, category, source, summary, metadata, created_at')
    .eq('id', documentId)
    .single()

  if (!globalDocumentError && globalDocument) {
    const { data: chunks, error: chunkError } = await supabaseAdmin
      .from('global_knowledge_chunks')
      .select('id, document_id, chunk_index, content, metadata, created_at, category, tone, score')
      .eq('document_id', documentId)
      .order('chunk_index')

    if (chunkError) {
      throw new AppError('Failed to load admin global knowledge chunks', {
        code: 'ADMIN_GLOBAL_DOCUMENT_CHUNKS_FAILED',
        statusCode: 500,
        cause: chunkError,
      })
    }

    const chunkRows = chunks ?? []

    return {
      ...mapGlobalKnowledgeDocument(globalDocument),
      chunkCount: chunkRows.length,
      reconstructedContent: chunkRows.map((chunk) => chunk.content).join('\n\n'),
      chunks: chunkRows,
    }
  }

  const cause = legacyDocumentError?.code !== 'PGRST116' ? legacyDocumentError : globalDocumentError
  throw new AppError('Admin document not found', {
    code: 'ADMIN_DOCUMENT_NOT_FOUND',
    statusCode: 404,
    cause,
  })
}
