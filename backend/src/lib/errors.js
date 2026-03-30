export class AppError extends Error {
  constructor(
    message,
    { code = 'INTERNAL_SERVER_ERROR', statusCode = 500, details, cause } = {},
  ) {
    super(message, { cause })
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
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
  const message =
    statusCode >= 500 ? 'Internal server error' : error.message || 'Request failed'

  res.status(statusCode).json({
    error: {
      code,
      message,
      details: error.details || null,
      requestId: req.requestId,
    },
  })
}
