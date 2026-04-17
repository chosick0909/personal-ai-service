import { AppError } from './errors.js'
import { createEmbeddings } from './embeddings.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'

const DEFAULT_CATEGORY_PRIORITY = ['hook', 'copywriting', 'examples', 'planning', 'monetization']

function hasSupabase() {
  if (!hasSupabaseAdminConfig()) {
    throw new AppError('Supabase admin client is not configured', {
      code: 'SUPABASE_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  return getSupabaseAdmin()
}

function normalizeText(value) {
  return (value || '').toLowerCase()
}

export function inferGlobalKnowledgeCategories({ title, topic, transcript, frameSummary }) {
  const corpus = normalizeText([title, topic, transcript, frameSummary].filter(Boolean).join('\n'))
  const categories = new Set()

  if (
    /후킹|hook|첫 문장|스크롤|시선|오프닝|첫 3초|초반/.test(corpus)
  ) {
    categories.add('hook')
    categories.add('copywriting')
  }

  if (
    /카피|copy|멘트|문구|cta|전환 문구|표현|문장|광고|릴스 대본/.test(corpus)
  ) {
    categories.add('copywriting')
    categories.add('examples')
  }

  if (
    /기획|콘텐츠|주제|구성|전개|전략|워크북|타겟|페르소나/.test(corpus)
  ) {
    categories.add('planning')
  }

  if (
    /수익|매출|브랜딩|상품|판매|세일즈|전환율|구매|고객/.test(corpus)
  ) {
    categories.add('monetization')
  }

  categories.add('copywriting')

  return DEFAULT_CATEGORY_PRIORITY.filter((category) => categories.has(category))
}

export async function retrieveGlobalKnowledgeContext({
  title,
  topic,
  transcript,
  frameSummary,
  topK = 4,
}) {
  const supabase = hasSupabase()
  const categories = inferGlobalKnowledgeCategories({
    title,
    topic,
    transcript,
    frameSummary,
  })

  const queryText = [
    title ? `레퍼런스 제목: ${title}` : null,
    topic ? `내 주제: ${topic}` : null,
    transcript ? `전사 요약: ${transcript.slice(0, 1800)}` : null,
    frameSummary ? `프레임 요약: ${frameSummary.slice(0, 1200)}` : null,
  ]
    .filter(Boolean)
    .join('\n\n')

  const [embeddingResult] = await createEmbeddings(queryText, {
    stage: 'global-knowledge-retrieval',
    title,
    topic,
    categories,
  })

  const merged = []

  for (const category of categories) {
    const { data, error } = await supabase.rpc('match_global_knowledge_context', {
      p_category: category,
      query_embedding: embeddingResult.vector,
      match_count: Math.min(Math.max(topK, 1), 5),
    })

    if (error) {
      throw new AppError('Failed to search global knowledge context', {
        code: 'GLOBAL_KNOWLEDGE_SEARCH_FAILED',
        statusCode: 500,
        cause: error,
        details: {
          category,
        },
      })
    }

    merged.push(...(data || []))
  }

  const deduped = Array.from(
    merged
      .reduce((map, item) => {
        const existing = map.get(item.id)

        if (!existing || Number(item.final_rank || 0) > Number(existing.final_rank || 0)) {
          map.set(item.id, item)
        }

        return map
      }, new Map())
      .values(),
  )
    .sort((a, b) => Number(b.final_rank || 0) - Number(a.final_rank || 0))
    .slice(0, Math.min(Math.max(topK, 1), 5))

  const contextText = deduped.length
    ? deduped
        .map((item, index) => {
          const titleFromMetadata =
            item.metadata?.legacyTitle ||
            item.metadata?.title ||
            item.metadata?.fileName ||
            '자료'

          return [
            `[지식 ${index + 1}]`,
            `title: ${titleFromMetadata}`,
            `category: ${item.category}`,
            item.content,
          ].join('\n')
        })
        .join('\n\n')
    : ''

  return {
    categories,
    items: deduped,
    contextText,
  }
}
