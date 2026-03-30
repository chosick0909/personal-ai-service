import * as Sentry from '@sentry/react'

const environment = import.meta.env.MODE || 'development'
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
const release = import.meta.env.VITE_APP_RELEASE || 'local-dev'

export function initFrontendSentry() {
  if (!sentryDsn) {
    return
  }

  Sentry.init({
    dsn: sentryDsn,
    enabled: true,
    environment,
    release,
    sendDefaultPii: true,
    tracesSampleRate: environment === 'production' ? 0.2 : 1.0,
    integrations: [Sentry.browserTracingIntegration()],
    beforeSend(event) {
      return event
    },
  })
}

export function addUserBreadcrumb(category, message, data = {}) {
  Sentry.addBreadcrumb({
    category,
    message,
    level: 'info',
    data,
  })
}

export function installSentryTestHelpers() {
  window.sentryTest = () => {
    Sentry.captureException(new Error(`SENTRY_CAPTURE_TEST_${Date.now()}`))
    setTimeout(() => {
      throw new Error(`SENTRY_UNCAUGHT_TEST_${Date.now()}`)
    }, 0)
  }
}
