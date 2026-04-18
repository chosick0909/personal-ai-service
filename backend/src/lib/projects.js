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

function normalizeProjectName(value = '') {
  return String(value || '').trim().slice(0, 120)
}

export async function listProjects(accountId) {
  const supabaseAdmin = requireSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, account_id, name, created_at, updated_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })

  if (error) {
    throw new AppError('Failed to load projects', {
      code: 'PROJECT_LIST_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  return data || []
}

export async function createProject({ accountId, name }) {
  const normalizedName = normalizeProjectName(name)
  if (!normalizedName) {
    throw new AppError('Project name is required', {
      code: 'PROJECT_NAME_REQUIRED',
      statusCode: 400,
    })
  }

  const supabaseAdmin = requireSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('projects')
    .insert({
      account_id: accountId,
      name: normalizedName,
    })
    .select('id, account_id, name, created_at, updated_at')
    .single()

  if (error) {
    throw new AppError('Failed to create project', {
      code: 'PROJECT_CREATE_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  return data
}

export async function deleteProject({ accountId, projectId }) {
  const normalizedProjectId = String(projectId || '').trim()
  if (!normalizedProjectId) {
    throw new AppError('Project id is required', {
      code: 'PROJECT_ID_REQUIRED',
      statusCode: 400,
    })
  }

  const supabaseAdmin = requireSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('projects')
    .delete()
    .eq('id', normalizedProjectId)
    .eq('account_id', accountId)
    .select('id, name')
    .maybeSingle()

  if (error) {
    throw new AppError('Failed to delete project', {
      code: 'PROJECT_DELETE_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  if (!data) {
    throw new AppError('Project not found', {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    })
  }

  return data
}
