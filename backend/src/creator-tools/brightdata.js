import { setTimeout as delay } from 'node:timers/promises'
import { fail } from './domain.js'

export async function collectInstagram({ url, request, checkpoint, signal, pause = delay }) {
  return collectDataset({ input: [{ url }], dataset: process.env.BRIGHT_DATA_REELS_DATASET || 'gd_lyclm20il4r5helnj', receiptKey: 'brightDataReceipt', request, checkpoint, signal, pause })
}

export async function collectDataset({ input, dataset, receiptKey, fields, request, checkpoint, signal, pause = delay }) {
  if (!/^gd_[a-zA-Z0-9]+$/.test(dataset || '')) fail('PROVIDER_NOT_CONFIGURED', '데이터 공급자 설정을 확인해주세요.', 503)
  // Persist the provider receipt before polling so worker retries reuse collection.
  const receipt = await checkpoint(receiptKey, async () => {
    const projection = fields ? `&custom_output_fields=${encodeURIComponent(fields.join('|'))}` : ''
    const result = await request('trigger', `/trigger?dataset_id=${dataset}&include_errors=true${projection}`, {
      method: 'POST', body: JSON.stringify(input),
    })
    if (!/^[a-zA-Z0-9_]+$/.test(result?.snapshot_id || '')) fail('PROVIDER_INVALID_RESPONSE', '영상 수집 응답을 확인하지 못했습니다.', 502)
    return { snapshotId: result.snapshot_id }
  })
  const id = encodeURIComponent(receipt.snapshotId)
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const progress = await request('progress', `/progress/${id}`, {})
    if (progress.status === 'ready') return request('download', `/snapshot/${id}?format=json`, {})
    if (['failed', 'canceled'].includes(progress.status)) fail('LINK_COLLECTION_FAILED', '영상 수집을 완료하지 못했습니다. 파일·대본 업로드로 전환해주세요.', 422)
    await pause(10000, undefined, { signal })
  }
  fail('PROVIDER_PENDING', '영상 수집이 지연되어 같은 작업의 상태를 다시 확인합니다.', 503)
}
