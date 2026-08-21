import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyAccessToken } from '../src/lib/auth.js'

test('verifyAccessToken uses verified JWT claims without fetching the user', async () => {
  let getUserCalled = false
  const authClient = {
    auth: {
      getClaims: async (token) => ({
        data: {
          claims: {
            sub: 'user-123',
            email: 'student@example.com',
          },
        },
        error: null,
      }),
      getUser: async () => {
        getUserCalled = true
      },
    },
  }

  const auth = await verifyAccessToken(authClient, 'access-token')

  assert.deepEqual(auth, {
    userId: 'user-123',
    email: 'student@example.com',
  })
  assert.equal(getUserCalled, false)
})

test('verifyAccessToken rejects claims without a subject', async () => {
  const authClient = {
    auth: {
      getClaims: async () => ({
        data: { claims: { email: 'student@example.com' } },
        error: null,
      }),
    },
  }

  await assert.rejects(
    () => verifyAccessToken(authClient, 'access-token'),
    (error) => error?.code === 'UNAUTHORIZED' && error?.statusCode === 401,
  )
})

test('verifyAccessToken maps connection failures to a retryable auth error', async () => {
  const authClient = {
    auth: {
      getClaims: async () => {
        throw new TypeError('fetch failed')
      },
    },
  }

  await assert.rejects(
    () => verifyAccessToken(authClient, 'access-token'),
    (error) => error?.code === 'AUTH_SERVICE_UNAVAILABLE' && error?.statusCode === 503,
  )
})
