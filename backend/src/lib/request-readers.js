import { AppError } from './errors.js'

export function readString(value, { field, maxLength = 2000, required = false } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : ''

  if (!normalized) {
    if (required) {
      throw new AppError(`${field} is required`, {
        code: 'INVALID_INPUT',
        statusCode: 400,
        details: { field },
      })
    }
    return ''
  }

  if (normalized.length > maxLength) {
    throw new AppError(`${field} is too long`, {
      code: 'INVALID_INPUT',
      statusCode: 400,
      details: { field, maxLength },
    })
  }

  return normalized
}

export function readRequestCharacterId(req) {
  return readString(
    req.body?.characterId ||
      req.body?.character_id ||
      req.query?.characterId ||
      req.query?.character_id ||
      req.headers['x-character-id'],
    {
      field: 'characterId',
      maxLength: 80,
    },
  )
}

export function readTextList(value, { maxItems = 12 } = {}) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, maxItems)
  }

  if (typeof value === 'string') {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, maxItems)
  }

  return []
}

export function readNumber(value, { field, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new AppError(`${field} is invalid`, {
      code: 'INVALID_INPUT',
      statusCode: 400,
      details: { field, min, max },
    })
  }

  return parsed
}
