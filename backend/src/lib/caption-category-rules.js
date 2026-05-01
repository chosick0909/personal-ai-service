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

function normalizeRule(row) {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    category: row.category,
    core: row.core,
    winningFeatures: Array.isArray(row.winning_features) ? row.winning_features : [],
    hookPatterns: Array.isArray(row.hook_patterns) ? row.hook_patterns : [],
    captionFlow: Array.isArray(row.caption_flow) ? row.caption_flow : [],
    ctaPatterns: Array.isArray(row.cta_patterns) ? row.cta_patterns : [],
    bannedExpressions: Array.isArray(row.banned_expressions) ? row.banned_expressions : [],
  }
}

export async function getCaptionCategoryRule(category) {
  const normalizedCategory = String(category || '').trim()
  if (!normalizedCategory) {
    return null
  }

  const supabaseAdmin = requireSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('caption_category_rules')
    .select('id, category, core, winning_features, hook_patterns, caption_flow, cta_patterns, banned_expressions')
    .eq('category', normalizedCategory)
    .maybeSingle()

  if (error) {
    const missingTable = error.code === '42P01' || /caption_category_rules/i.test(String(error.message || ''))
    if (missingTable) {
      return null
    }

    throw new AppError('Failed to load caption category rule', {
      code: 'CAPTION_CATEGORY_RULE_FETCH_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  return normalizeRule(data)
}

