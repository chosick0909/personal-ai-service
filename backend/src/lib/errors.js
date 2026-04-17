export class AppError extends Error {
  constructor(
    message,
    {
      code = 'INTERNAL_SERVER_ERROR',
      statusCode = 500,
      details,
      cause,
      exposeMessage = false,
    } = {},
  ) {
    super(message, { cause })
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
    this.exposeMessage = exposeMessage
  }
}

export function asyncHandler(handler) {
  return async function wrappedHandler(req, res, next) {
    try {
      await handler(req, res, next)
    } catch (error) {
      next(error)
    }
  }
}

export function notFoundHandler(req, _res, next) {
  next(
    new AppError(`Route not found: ${req.method} ${req.originalUrl}`, {
      code: 'ROUTE_NOT_FOUND',
      statusCode: 404,
    }),
  )
}

export function errorHandler(error, req, res, _next) {
  const statusCode = error.statusCode || 500
  const code = error.code || 'INTERNAL_SERVER_ERROR'
  const isDevelopment = (process.env.NODE_ENV || 'development') === 'development'
  const exposeMessage = Boolean(error.exposeMessage)
  const message =
    statusCode >= 500 && !isDevelopment && !exposeMessage
      ? 'Internal server error'
      : error.message || 'Request failed'
  const rawDetails =
    error.details ||
    (isDevelopment && error.cause
      ? {
          cause: error.cause.message || String(error.cause),
        }
      : null)
  const details = !isDevelopment && statusCode >= 500 ? null : rawDetails

  console.error('[api-error]', {
    requestId: req.requestId,
    method: req.method,
    route: req.originalUrl,
    statusCode,
    code,
    message: error.message || 'Request failed',
    details,
    cause: error.cause?.message || null,
  })

  res.status(statusCode).json({
    error: {
      code,
      message,
      details,
      requestId: req.requestId,
    },
  })
}
