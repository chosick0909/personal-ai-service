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

function throwProjectDbError(baseCode, actionLabel, error) {
  const pgCode = String(error?.code || '').trim()

  if (pgCode === '42P01') {
    throw new AppError('Projects schema is missing. Run latest migration first.', {
      code: 'PROJECT_SCHEMA_MISSING',
      statusCode: 400,
      exposeMessage: true,
      details: {
        action: actionLabel,
        hint:
          'Apply migration: supabase/migrations/20260418224000_add_projects_and_reference_project_link.sql',
      },
      cause: error,
    })
  }

  if (pgCode === '23503') {
    throw new AppError('Account or project relation is invalid.', {
      code: 'PROJECT_RELATION_INVALID',
      statusCode: 400,
      details: {
        action: actionLabel,
      },
      cause: error,
    })
  }

  throw new AppError(`Failed to ${actionLabel} project`, {
    code: baseCode,
    statusCode: 500,
    cause: error,
  })
}

export async function listProjects(accountId) {
  const supabaseAdmin = requireSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, account_id, name, created_at, updated_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })

  if (error) {
    throwProjectDbError('PROJECT_LIST_FAILED', 'load', error)
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
    throwProjectDbError('PROJECT_CREATE_FAILED', 'create', error)
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
    throwProjectDbError('PROJECT_DELETE_FAILED', 'delete', error)
  }

  if (!data) {
    throw new AppError('Project not found', {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    })
  }

  return data
}
