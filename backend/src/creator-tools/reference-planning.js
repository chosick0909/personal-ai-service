import { readFileSync } from 'node:fs'

export const REFERENCE_PLANNING_VERSION = 'student-topics-v1'
const corrections = JSON.parse(readFileSync(new URL('../../catalog/reference-student-topics-20260930.json', import.meta.url), 'utf8'))
const byUsername = new Map(corrections.accounts.map(row => [row.username, row]))
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 500

// A filmable topic for the student's audience, not an interview for the account owner.
export function generatedPlanningTopics(rank, profile) {
  const posts = new Set((profile?.exampleMedia || []).map(post => post.permalink))
  const topics = rank?.contentTopics
  if (!Array.isArray(topics) || topics.length < 1 || topics.length > 3) return null
  if (!topics.every(topic => topic && ['title', 'viewerProblem', 'filmingPlan'].every(key => text(topic[key]))
    && posts.has(topic.sourcePostUrl))) return null
  if (new Set(topics.map(topic => topic.title.trim())).size !== topics.length) return null
  return topics.map(topic => ({ title:topic.title.trim(), viewerProblem:topic.viewerProblem.trim(),
    filmingPlan:topic.filmingPlan.trim(), sourcePostUrl:topic.sourcePostUrl }))
}

export function referencePlanningPoints(account, category) {
  if (account.referencePointsVersion === REFERENCE_PLANNING_VERSION
    && Array.isArray(account.referencePoints) && account.referencePoints.length > 0
    && account.referencePoints.length <= 3 && account.referencePoints.every(text)) {
    return { referencePoints:[...account.referencePoints], referencePointsVersion:REFERENCE_PLANNING_VERSION,
      referencePointsStatus:'ready' }
  }
  const correction = category === corrections.category ? byUsername.get(account.username) : null
  const oldPoints = Array.isArray(account.referencePoints) ? account.referencePoints.slice(0, 3) : []
  // Only correct the exact legacy wording, without changing account eligibility,
  // verification dates or newly edited topics. No paid call or DB write on reads.
  if (correction && JSON.stringify(oldPoints) === JSON.stringify(correction.sourcePoints)) {
    return { referencePoints:[...correction.topics], referencePointsVersion:REFERENCE_PLANNING_VERSION,
      referencePointsStatus:'ready' }
  }
  return { referencePoints:[], referencePointsStatus:'needs_review' }
}

export function presentReferencePlanning(result, category) {
  if (!result || !Array.isArray(result.accounts)) return result
  return { ...result, accounts:result.accounts.map(account => ({ ...account, ...referencePlanningPoints(account, category) })) }
}
