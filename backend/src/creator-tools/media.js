import { analyzeFeedback } from './feedback.js'
import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import ffprobe from '@ffprobe-installer/ffprobe'
import { ZipArchive } from 'archiver'
import { getOpenAIClient } from '../lib/openai.js'
import { BUCKET, OUTPUT_BUCKET, query, signedDownload, ownedMedia } from './store.js'
import { MAX_BYTES, fail, safeCutCandidates, keepRanges, projectSubtitles, toSrt, validateManifest } from './domain.js'

export function runProgram(binary, args, signal, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], signal, timeout, killSignal: 'SIGKILL' })
    let stdout = '', stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 2e6) child.kill('SIGKILL') })
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-100000) })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(Object.assign(new Error('MEDIA_PROCESS_FAILED'), { code: 'MEDIA_PROCESS_FAILED' })))
  })
}
const inputFlags = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm']
export async function probeVideo(path, signal) {
  const { stdout } = await runProgram(process.env.CREATOR_FFPROBE_PATH || ffprobe.path,
    ['-v', 'error', ...inputFlags, '-show_format', '-show_streams', '-of', 'json', path], signal, 15000)
  const info = JSON.parse(stdout)
  const video = info.streams?.find((s) => s.codec_type === 'video')
  const audio = info.streams?.find((s) => s.codec_type === 'audio')
  const duration = Number(info.format?.duration)
  if (!video || !audio) fail('VIDEO_AUDIO_REQUIRED', '음성이 포함된 영상을 올려주세요.')
  if (!Number.isFinite(duration) || duration <= 0 || duration > 300) fail('VIDEO_DURATION_LIMIT', '5분 이하 영상을 올려주세요.')
  if (video.width > 4096 || video.height > 4096 || video.width * video.height > 8847360) fail('VIDEO_RESOLUTION_LIMIT', '4K 이하 해상도의 영상을 올려주세요.')
  return { duration, width: video.width, height: video.height }
}
export async function ff(args, signal) {
  return runProgram(process.env.CREATOR_FFMPEG_PATH || ffmpeg.path, ['-nostdin', '-y', '-threads', '2', ...args], signal)
}
export async function workspace(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'hookai-creator-media-'))
  try { return await fn(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}
export async function downloadStored(db, path, target, signal) {
  const url = await signedDownload(db, path)
  // Server-generated storage URL only; never accepts a URL from the client.
  const response = await fetch(url, { signal, redirect: 'error' })
  if (!response.ok) fail('UPLOAD_MISSING', '업로드가 완료되지 않았거나 영상 보관 기간이 지났습니다.', 422)
  let bytes = 0
  await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _enc, next) {
    bytes += chunk.length
    next(bytes > MAX_BYTES ? new Error('VIDEO_TOO_LARGE') : null, chunk)
  } }), createWriteStream(target, { flags: 'wx' }), { signal })
}
export async function uploadFile(db, path, local, contentType, { bucket = BUCKET, limit = MAX_BYTES } = {}) {
  const size = (await stat(local)).size
  if (size > limit) fail('OUTPUT_TOO_LARGE', '편집 결과 용량이 너무 큽니다. 더 작은 영상으로 시도해주세요.', 422)
  await query(db.storage.from(bucket).upload(path, createReadStream(local), { contentType, upsert: true, duplex: 'half' }))
  return path
}
export async function transcribeFile(ctx, path, duration) {
  const audioPath = `${path}.mp3`
  await ff([...inputFlags, '-i', path, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audioPath], ctx.signal)
  const transcript = await ctx.providers.call('openai', 'timed-transcription', () => getOpenAIClient().audio.transcriptions.create({
    file: createReadStream(audioPath), model: 'whisper-1', response_format: 'verbose_json',
    timestamp_granularities: ['word', 'segment'],
  }, { signal: ctx.signal, timeout: 120000, maxRetries: 0 }))
  const words = (transcript.words || []).filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start && w.start >= 0 && w.end <= duration + 0.02)
  let previousEnd = 0
  const subtitles = (transcript.segments || []).flatMap((s, i) => {
    const start = Math.max(previousEnd, Number(s.start)), end = Math.min(duration, Number(s.end))
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !s.text?.trim()) return []
    previousEnd = end
    return [{ id: `cue-${i}`, start, end, text: s.text.trim() }]
  })
  if (!subtitles.length || !String(transcript.text || '').trim()) fail('TRANSCRIPT_EMPTY', '음성을 인식하지 못했습니다. 대본 붙여넣기를 이용해주세요.', 422)
  return { text: transcript.text.trim(), language: transcript.language || 'unknown', words, subtitles }
}
export async function analyzeMedia(ctx) {
  const { db, job, stage, checkpoint, signal } = ctx
  const media = await ownedMedia(db, job.input.projectId, job.user_id)
  if (Date.parse(media.original_expires_at) <= Date.now()) fail('MEDIA_EXPIRED', '원본 보관 기간이 지났습니다.', 410)
  return workspace(async (directory) => {
    await stage('reading_video')
    const input = join(directory, 'original')
    await downloadStored(db, media.original_path, input, signal)
    const info = await probeVideo(input, signal)
    await stage('transcribing')
    const transcript = await checkpoint('transcript', () => transcribeFile(ctx, input, info.duration))
    const feedback = job.input.feedbackCaption !== undefined ? await analyzeFeedback(ctx, input, directory, transcript, info.duration) : null
    await stage('finding_safe_cuts')
    const detection = await ff([...inputFlags, '-i', input, '-vn', '-af', 'silencedetect=noise=-35dB:d=1.2', '-f', 'null', '-'], signal)
    let start = 0
    const silences = []
    for (const match of detection.stderr.matchAll(/silence_(start|end): ([\d.]+)/g)) {
      if (match[1] === 'start') start = Number(match[2])
      else silences.push({ start, end: Number(match[2]) })
    }
    const preview = join(directory, 'preview.mp4')
    await ff([...inputFlags, '-i', input, '-map', '0:v:0', '-map', '0:a:0', '-vf', "scale='min(720,iw)':-2,setsar=1", '-c:v', 'libx264', '-preset', 'fast', '-crf', '28', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', preview], signal)
    const previewPath = `${job.user_id}/${media.id}/preview.mp4`
    await query(db.from('creator_media_artifacts').upsert({ path: previewPath, bucket: BUCKET, project_id: media.id, expires_at: media.original_expires_at }))
    await uploadFile(db, previewPath, preview, 'video/mp4')
    const manifest = { subtitles: transcript.subtitles, words: transcript.words, cuts: safeCutCandidates(silences, transcript.words, info.duration) }
    await query(db.from('creator_media_projects').update({ status: 'ready', duration_seconds: info.duration, manifest,
      preview_path: previewPath, job_id: job.id }).eq('id', media.id).eq('revision', 0))
    return { projectId: media.id, ...(feedback ? { feedback } : {}) }
  })
}
export async function renderMedia(ctx) {
  const { db, job, stage, signal } = ctx
  const media = await ownedMedia(db, job.input.projectId, job.user_id)
  if (Date.parse(media.original_expires_at) <= Date.now()) fail('MEDIA_EXPIRED', '원본 보관 기간이 지났습니다.', 410)
  if (media.revision !== job.input.revision) fail('EDIT_CONFLICT', '편집 내용이 변경되었습니다. 최신 내용으로 다시 내보내주세요.', 409)
  const manifest = validateManifest(job.input.manifest, media.manifest, Number(media.duration_seconds))
  return workspace(async (directory) => {
    await stage('reading_video')
    const input = join(directory, 'original')
    await downloadStored(db, media.original_path, input, signal)
    const info = await probeVideo(input, signal)
    const kept = manifest.clips || keepRanges(info.duration, manifest.cuts)
    await stage('rendering')
    const filters = kept.flatMap((r, i) => [
      `[0:v]trim=start=${r.start}:end=${r.end},setpts=PTS-STARTPTS,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1[v${i}]`,
      `[0:a]atrim=start=${r.start}:end=${r.end},asetpts=PTS-STARTPTS[a${i}]`,
    ])
    filters.push(`${kept.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${kept.length}:v=1:a=1[outv][outa]`)
    const output = join(directory, 'edited.mp4')
    await ff([...inputFlags, '-i', input, '-filter_complex_threads', '1', '-filter_complex', filters.join(';'),
      '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-threads', '2', '-preset', 'fast', '-crf', '23',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-fs', String(MAX_BYTES), output], signal)
    const actual = await probeVideo(output, signal)
    const expected = kept.reduce((n, r) => n + r.end - r.start, 0)
    if (Math.abs(actual.duration - expected) > 0.3) fail('RENDER_INCOMPLETE', '영상 렌더링이 완료되지 않았습니다. 더 작은 영상으로 시도해주세요.', 422)
    const srt = join(directory, 'subtitles.srt')
    await writeFile(srt, toSrt(projectSubtitles(manifest.subtitles, kept)), 'utf8')
    await stage('packaging')
    const zip = join(directory, 'export.zip')
    await new Promise((resolve, reject) => {
      const stream = createWriteStream(zip)
      const archive = new ZipArchive({ zlib: { level: 0 } })
      stream.on('close', resolve); stream.on('error', reject); archive.on('error', reject)
      archive.pipe(stream)
      archive.file(output, { name: 'edited.mp4' }); archive.file(srt, { name: 'subtitles.srt' })
      const extension = media.mime_type === 'video/quicktime' ? 'mov' : media.mime_type === 'video/webm' ? 'webm' : 'mp4'
      archive.file(input, { name: `original.${extension}` })
      archive.finalize().catch(reject)
    })
    const path = `${job.user_id}/${media.id}/output-${media.revision}.zip`
    const expires = new Date(Date.now() + 7 * 86400000).toISOString()
    await query(db.from('creator_media_artifacts').upsert({ path, bucket: OUTPUT_BUCKET, project_id: media.id, expires_at: expires }))
    await uploadFile(db, path, zip, 'application/zip', { bucket: OUTPUT_BUCKET, limit: 800 * 1024 * 1024 })
    const updated = await query(db.from('creator_media_projects').update({ status: 'completed', output_path: path,
      output_expires_at: expires, output_deleted_at: null, job_id: job.id }).eq('id', media.id).eq('revision', media.revision).select().maybeSingle())
    if (!updated) { await db.storage.from(OUTPUT_BUCKET).remove([path]); fail('EDIT_CONFLICT', '편집 내용이 변경되었습니다.', 409) }
    return { projectId: media.id, revision: media.revision, expiresAt: expires }
  })
}
