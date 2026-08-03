import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isReferentialCopilotRequest,
  resolveCopilotConversationReference,
} from '../src/lib/copilot/conversation-context.js'

function feedbackReference(overrides = {}) {
  return {
    sourceType: 'feedback',
    sourceMessageId: 'feedback-1',
    sourceDraftId: 'draft-b',
    sourceVariantId: 'variant-b',
    feedback: {
      summary: 'CTA 행동 이유를 보강하세요.',
    },
    ...overrides,
  }
}

test('explicit reply context wins over pending conversation action', () => {
  const explicitReplyContext = feedbackReference({ sourceMessageId: 'explicit-feedback' })
  const result = resolveCopilotConversationReference({
    userMessage: '그렇게 수정해줘',
    explicitReplyContext,
    conversationContext: {
      pendingAction: feedbackReference({ sourceMessageId: 'pending-feedback' }),
    },
    currentDraftId: 'draft-b',
    currentVariantId: 'variant-b',
  })

  assert.equal(result.source, 'explicit_reply')
  assert.equal(result.replyContext.sourceMessageId, 'explicit-feedback')
})

test('referential request resolves the current variant pending feedback', () => {
  const result = resolveCopilotConversationReference({
    userMessage: '아까 피드백대로 수정해줘',
    conversationContext: {
      pendingAction: feedbackReference(),
    },
    currentDraftId: 'draft-b',
    currentVariantId: 'variant-b',
  })

  assert.equal(result.source, 'pending_action')
  assert.equal(result.replyContext.sourceMessageId, 'feedback-1')
})

test('a new explicit request does not inherit pending conversation action', () => {
  const result = resolveCopilotConversationReference({
    userMessage: 'BODY만 존댓말로 바꿔줘',
    conversationContext: {
      pendingAction: feedbackReference(),
    },
    currentDraftId: 'draft-b',
    currentVariantId: 'variant-b',
  })

  assert.equal(result.source, 'none')
  assert.equal(result.replyContext, null)
})

test('pending action from another variant is ignored', () => {
  const result = resolveCopilotConversationReference({
    userMessage: '그렇게 수정해줘',
    conversationContext: {
      pendingAction: feedbackReference({ sourceVariantId: 'variant-a' }),
    },
    currentDraftId: 'draft-b',
    currentVariantId: 'variant-b',
  })

  assert.equal(result.source, 'stale_or_missing')
  assert.equal(result.replyContext, null)
})

test('common Korean reference phrases are recognized', () => {
  assert.equal(isReferentialCopilotRequest('방금 말한 방향으로 다시 해줘'), true)
  assert.equal(isReferentialCopilotRequest('CTA만 상담 유도로 바꿔줘'), false)
})
