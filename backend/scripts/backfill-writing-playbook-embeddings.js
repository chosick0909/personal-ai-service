import 'dotenv/config'
import { ensureWritingPlaybookRuleEmbeddings } from '../src/lib/writing-playbook.js'

const limit = Number.parseInt(process.argv[2] || process.env.WRITING_PLAYBOOK_EMBEDDING_BACKFILL_LIMIT || '40', 10)

const result = await ensureWritingPlaybookRuleEmbeddings({
  limit: Number.isFinite(limit) && limit > 0 ? limit : 40,
})

console.log(JSON.stringify(result, null, 2))
