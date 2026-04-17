import { AppError } from './errors.js'
import { chunkText } from './chunking.js'
import { createEmbeddings } from './embeddings.js'
import { logAIError } from './ai-error-logger.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'

export async function ingestDocument({
  title,
  content,
  accountId,
  source = 'manual',
  metadata = {},
}) {
  if (!hasSupabaseAdminConfig()) {
    throw new AppError('Supabase admin client is not configured', {
      code: 'SUPABASE_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  const normalizedTitle = title?.trim()
  const normalizedContent = content?.trim()

  if (!normalizedTitle || !normalizedContent) {
    throw new AppError('title and content are required', {
      code: 'INVALID_DOCUMENT_PAYLOAD',
      statusCode: 400,
    })
  }

  const supabaseAdmin = getSupabaseAdmin()
  const preparedChunks = chunkText(normalizedContent)

  if (!preparedChunks.length) {
    throw new AppError('Unable to create chunks from the provided content', {
      code: 'EMPTY_CHUNKS',
      statusCode: 400,
    })
  }

  const embeddingResults = await createEmbeddings(
    preparedChunks.map((chunk) => chunk.content),
    {
      title: normalizedTitle,
      source,
      chunkCount: preparedChunks.length,
    },
  )

  const { data: document, error: documentError } = await supabaseAdmin
    .from('documents')
    .insert({
      account_id: accountId,
      title: normalizedTitle,
      source,
      metadata: {
        ...metadata,
        accountId,
        chunkCount: preparedChunks.length,
      },
    })
    .select('id, title, source, metadata, created_at')
    .single()

  if (documentError) {
    logAIError('db', documentError, {
      title: normalizedTitle,
      source,
      stage: 'insert-document',
    })

    throw new AppError('Failed to save document', {
      code: 'DOCUMENT_INSERT_FAILED',
      statusCode: 500,
      cause: documentError,
    })
  }

  const rows = preparedChunks.map((chunk, index) => ({
    account_id: accountId,
    document_id: document.id,
    chunk_index: chunk.chunkIndex,
    content: chunk.content,
    metadata: {
      accountId,
      source,
      title: normalizedTitle,
    },
    embedding: embeddingResults[index]?.vector || null,
  }))

  const { error: chunkError } = await supabaseAdmin.from('chunks').insert(rows)

  if (chunkError) {
    logAIError('db', chunkError, {
      documentId: document.id,
      stage: 'insert-chunks',
      chunkCount: rows.length,
    })

    throw new AppError('Failed to save document chunks', {
      code: 'CHUNK_INSERT_FAILED',
      statusCode: 500,
      cause: chunkError,
    })
  }

  return {
    document,
    chunkCount: rows.length,
    chunks: rows.map(({ chunk_index: chunkIndex, content }) => ({
      chunkIndex,
      contentPreview: content.slice(0, 120),
    })),
  }
}
