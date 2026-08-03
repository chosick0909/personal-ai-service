const OPERATION_TYPES = [
  'topic_reframe',
  'framing_rewrite',
  'tone_adjust',
  'partial_rewrite',
  'edit_partial',
  'insert_material',
  'duration_compress',
  'format_apply',
  'cta_reframe',
]

const SECTION_TARGETS = ['all', 'hook', 'body', 'cta']

export const COPILOT_SEMANTIC_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'hookai_semantic_edit_instruction',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'intent',
        'confidence',
        'topicChange',
        'operations',
        'locks',
        'metadata',
        'userFacingNeed',
        'clarificationQuestion',
      ],
      properties: {
        intent: {
          type: 'string',
          enum: ['edit_script', 'apply_feedback', 'ask_advice', 'unknown'],
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
        },
        topicChange: {
          type: 'object',
          additionalProperties: false,
          required: ['requested', 'oldSubjects', 'newSubject', 'confidence', 'evidence'],
          properties: {
            requested: { type: 'boolean' },
            oldSubjects: {
              type: 'array',
              maxItems: 8,
              items: { type: 'string' },
            },
            newSubject: { type: ['string', 'null'] },
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
            },
            evidence: { type: ['string', 'null'] },
          },
        },
        operations: {
          type: 'array',
          maxItems: 8,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target', 'goal', 'styleTarget', 'evidence', 'confidence'],
            properties: {
              type: {
                type: 'string',
                enum: OPERATION_TYPES,
              },
              target: {
                type: 'string',
                enum: SECTION_TARGETS,
              },
              goal: { type: 'string' },
              styleTarget: { type: ['string', 'null'] },
              evidence: { type: ['string', 'null'] },
              confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
              },
            },
          },
        },
        locks: {
          type: 'array',
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['target', 'lockType', 'evidence'],
            properties: {
              target: {
                type: 'string',
                enum: SECTION_TARGETS,
              },
              lockType: {
                type: 'string',
                enum: ['keep_exact', 'preserve_meaning', 'do_not_touch'],
              },
              evidence: { type: ['string', 'null'] },
            },
          },
        },
        metadata: {
          type: 'object',
          additionalProperties: false,
          required: [
            'requestedMaterials',
            'forbiddenSurfacePhrases',
            'salesContext',
            'toneHint',
            'explicitKeep',
            'explicitRemove',
            'allowComparisonWithOldSubject',
            'targetDurationSeconds',
          ],
          properties: {
            requestedMaterials: {
              type: 'array',
              maxItems: 8,
              items: { type: 'string' },
            },
            forbiddenSurfacePhrases: {
              type: 'array',
              maxItems: 24,
              items: { type: 'string' },
            },
            salesContext: { type: ['string', 'null'] },
            toneHint: { type: ['string', 'null'] },
            explicitKeep: {
              type: 'array',
              maxItems: 8,
              items: { type: 'string' },
            },
            explicitRemove: {
              type: 'array',
              maxItems: 8,
              items: { type: 'string' },
            },
            allowComparisonWithOldSubject: { type: 'boolean' },
            targetDurationSeconds: {
              type: ['number', 'null'],
              minimum: 1,
            },
          },
        },
        userFacingNeed: {
          type: 'string',
          enum: ['modify_script', 'answer_question', 'clarify'],
        },
        clarificationQuestion: { type: ['string', 'null'] },
      },
    },
  },
}

function compactStrings(value, limit) {
  const output = []
  const seen = new Set()
  for (const item of Array.isArray(value) ? value : []) {
    const normalized = String(item || '').replace(/\s+/g, ' ').trim()
    if (!normalized || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    output.push(normalized)
    if (output.length >= limit) {
      break
    }
  }
  return output
}

export function semanticInstructionFromModelOutput(
  raw = {},
  {
    userMessage = '',
    regexSignals = {},
  } = {},
) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const topicChange = source.topicChange && typeof source.topicChange === 'object'
    ? source.topicChange
    : {}
  const metadata = source.metadata && typeof source.metadata === 'object'
    ? source.metadata
    : {}
  const oldSubjects = compactStrings(topicChange.oldSubjects, 8)
  const newSubject = String(topicChange.newSubject || '').replace(/\s+/g, ' ').trim() || null
  const operations = Array.isArray(source.operations) ? source.operations : []
  const primaryOperation = operations[0] || {}

  return {
    intent: source.intent || 'unknown',
    confidence: Number(source.confidence || 0),
    topicChange: {
      requested: Boolean(topicChange.requested),
      oldSubject: oldSubjects[0] || null,
      oldSubjects,
      newSubject,
      confidence: Number(topicChange.confidence || 0),
      evidence: String(topicChange.evidence || '').trim() || null,
    },
    operations,
    locks: Array.isArray(source.locks) ? source.locks : [],
    replyReference: {
      hasReplyTarget: false,
      sourceType: '',
      sourceMessageId: '',
      sourceDraftId: '',
      inheritedOperations: [],
    },
    userFacingNeed: source.userFacingNeed || 'modify_script',
    clarificationQuestion: source.clarificationQuestion || null,
    regexSignals,
    parserSource: 'llm_strict_schema',
    validation: {
      strictSchemaApplied: true,
      parserSource: 'llm_strict_schema',
    },
    legacyInstruction: {
      operationType: primaryOperation.type || 'unknown',
      newSubject: topicChange.requested ? newSubject || '' : '',
      oldSubjectToRemove: oldSubjects,
      forbiddenSurfacePhrases: compactStrings(metadata.forbiddenSurfacePhrases, 24),
      requestedMaterials: compactStrings(metadata.requestedMaterials, 8),
      salesContext: String(metadata.salesContext || '').trim(),
      toneHint: String(metadata.toneHint || primaryOperation.styleTarget || '').trim(),
      explicitKeep: compactStrings(metadata.explicitKeep, 8),
      explicitRemove: compactStrings(metadata.explicitRemove, 8),
      allowComparisonWithOldSubject: Boolean(metadata.allowComparisonWithOldSubject),
      targetDurationSeconds: Number(metadata.targetDurationSeconds) || null,
      confidence: Number(source.confidence || 0),
      reason: String(primaryOperation.goal || '').trim(),
      sourceUserMessage: String(userMessage || '').trim(),
    },
  }
}
