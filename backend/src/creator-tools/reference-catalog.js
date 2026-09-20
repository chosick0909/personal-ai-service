import { username } from './domain.js'
import { REFERENCE_CATEGORIES } from './categories.js'
import { referencePerformance, hardReferenceMetrics, REFERENCE_QUALITY_VERSION, catalogQualityEligible, referenceQualityEligible, instagramPostUrl } from './reference-quality.js'

export function reviewRecord(row, rank, category) {
  const assessment = { domesticCreator:null, domesticCreatorEvidence:[], accountType:'unknown', accountTypeEvidence:[], ordinaryCreator:null, ordinaryCreatorEvidence:[],
    monetizationEvidence:[], monetizationSourceUrls:[], productionLevel:'unknown', productionEvidence:[],
    replicability:null, replicabilityEvidence:[], evidencePostUrls:[], ...rank }
  return { username:row.username, profileUrl:`https://www.instagram.com/${row.username}/`,
    performance:referencePerformance(row.profile), professional:true, reviewedByOperator:false, reviewedBy:'', reviewedAt:null,
    verifiedAt:row.verified_at, lastActiveAt:row.last_active_at,
    automaticDecision:hardReferenceMetrics(row.profile) && referenceQualityEligible(assessment, row.profile) ? 'eligible_for_review' : 'rejected_or_unknown',
    profile:{ ...row.profile, qualityVersion:REFERENCE_QUALITY_VERSION, accountType:assessment.accountType,
      categories:[category], accountInsights:{ [category]:assessment } } }
}
export function normalizeReviewedCatalog(rows, now = Date.now()) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 150) throw new Error('Catalog must contain 1 to 150 reviewed accounts')
  const seen = new Set()
  return rows.map(row => {
    const name = username(row.username)
    if (seen.has(name)) throw new Error('Duplicate catalog username')
    seen.add(name)
    if (row.profileUrl !== `https://www.instagram.com/${name}/` || row.professional !== true) throw new Error('Verified profile identity required')
    const profile = { ...row.profile, reviewedByOperator:row.reviewedByOperator, reviewedBy:row.reviewedBy, reviewedAt:row.reviewedAt }
    const normalized = { username:name, professional:true, active:true, verified_at:row.verifiedAt, last_active_at:row.lastActiveAt, profile }
    if (!Array.isArray(profile.categories) || !profile.categories.length || profile.categories.some(category =>
      !REFERENCE_CATEGORIES.includes(category) || !catalogQualityEligible(normalized, category, now))) {
      throw new Error('Current quality evidence, hard metrics and dated operator review required')
    }
    if (Date.parse(row.reviewedAt) < Date.parse(row.verifiedAt)
      || !profile.exampleMedia.length || profile.exampleMedia.some(item => !instagramPostUrl(item.permalink))) {
      throw new Error('Review must follow collection and include valid evidence posts')
    }
    return normalized
  })
}
