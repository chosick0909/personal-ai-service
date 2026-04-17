import { AppError } from './errors.js'
import { buildCacheKey, cacheConfig, getCacheJson, setCacheJson } from './cache.js'
import { createEmbeddings } from './embeddings.js'
import { logAIError } from './ai-error-logger.js'
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

export async function listDocuments(accountId) {
  const supabaseAdmin = requireSupabaseAdmin()

  const { data, error } = await supabaseAdmin
    .from('documents')
    .select('id, title, source, metadata, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new AppError('Failed to load documents', {
      code: 'DOCUMENT_LIST_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  return data
}

export async function getDocumentWithChunks(documentId, accountId) {
  const supabaseAdmin = requireSupabaseAdmin()

  const { data: document, error: documentError } = await supabaseAdmin
    .from('documents')
    .select('id, title, source, metadata, created_at')
    .eq('id', documentId)
    .eq('account_id', accountId)
    .single()

  if (documentError) {
    const statusCode = documentError.code === 'PGRST116' ? 404 : 500

    throw new AppError(
      statusCode === 404 ? 'Document not found' : 'Failed to load document',
      {
        code: statusCode === 404 ? 'DOCUMENT_NOT_FOUND' : 'DOCUMENT_FETCH_FAILED',
        statusCode,
        cause: documentError,
      },
    )
  }

  const { data: chunks, error: chunkError } = await supabaseAdmin
    .from('chunks')
    .select('id, document_id, chunk_index, content, metadata, created_at')
    .eq('account_id', accountId)
    .eq('document_id', documentId)
    .order('chunk_index')

  if (chunkError) {
    throw new AppError('Failed to load document chunks', {
      code: 'CHUNK_FETCH_FAILED',
      statusCode: 500,
      cause: chunkError,
    })
  }

  return {
    ...document,
    chunks,
  }
}

export async function searchChunks({ query, accountId, matchCount = 5 }) {
  const supabaseAdmin = requireSupabaseAdmin()
  const normalizedQuery = query?.trim()
  const normalizedMatchCount = Math.min(Math.max(matchCount, 1), 50)

  if (!normalizedQuery) {
    throw new AppError('query is required', {
      code: 'INVALID_SEARCH_QUERY',
      statusCode: 400,
    })
  }

  const cacheKey = buildCacheKey('rag:account-chunks', {
    accountId,
    query: normalizedQuery,
    matchCount: normalizedMatchCount,
  })

  if (cacheConfig.enableRagQueryCache) {
    const cached = await getCacheJson(cacheKey)
    if (Array.isArray(cached)) {
      return cached
    }
  }

  const [embeddingResult] = await createEmbeddings(normalizedQuery, {
    query: normalizedQuery,
    matchCount: normalizedMatchCount,
  })

  const { data, error } = await supabaseAdmin.rpc('match_legacy_account_chunks', {
    p_account_id: accountId,
    query_embedding: embeddingResult.vector,
    match_count: normalizedMatchCount,
  })

  if (error) {
    logAIError('db', error, {
      query: normalizedQuery,
      stage: 'match-chunks-rpc',
      matchCount: normalizedMatchCount,
    })

    throw new AppError('Failed to search document chunks', {
      code: 'SEARCH_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  if (cacheConfig.enableRagQueryCache) {
    await setCacheJson(cacheKey, data || [], cacheConfig.ragQueryCacheTtlSeconds)
  }

  return data
}
