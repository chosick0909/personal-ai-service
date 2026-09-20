import dotenv from 'dotenv'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { database, query } from '../src/creator-tools/store.js'
import { normalizeReviewedCatalog } from '../src/creator-tools/reference-catalog.js'

dotenv.config({ path:fileURLToPath(new URL('../../.env', import.meta.url)), quiet:true })
const [command, file, ...options] = process.argv.slice(2)
if (command !== 'catalog' || !file || options.some(option => option !== '--validate-only')) {
  console.error('Usage: node backend/scripts/manage-creator-tools.js catalog <reviewed.json> [--validate-only]')
  process.exitCode = 1
} else {
  const rows = normalizeReviewedCatalog(JSON.parse(await readFile(file, 'utf8')))
  if (options.includes('--validate-only')) console.log(`Validated ${rows.length} reviewed accounts. No database writes or paid calls.`)
  else {
    await query(database().from('creator_reference_catalog').upsert(rows, { onConflict:'username' }))
    console.log(`Imported ${rows.length} operator-reviewed accounts.`)
  }
}
