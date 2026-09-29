import { discoverAccounts } from './discovery.js'
import { query, ownedJob } from './store.js'

// Catalog reads never wait behind long-running link imports or call paid providers.
// Reuse the job RPCs to preserve ownership, limits and idempotency.
export async function completeReviewedReferenceJob(db, row) {
  if (row.kind !== 'reference-accounts' || !['queued', 'running'].includes(row.status)) return row
  const result = await discoverAccounts({ db, job: row, stage: async () => {} }, { catalogOnly: true })
  if (!result.accounts.length) result.message = '선택한 조건에 맞는 계정을 준비 중입니다. 다른 조건을 선택해주세요.'
  await query(db.rpc('creator_complete_job', { p_id: row.id, p_result: result }))
  return ownedJob(db, row.id, row.user_id, 'reference-accounts')
}
