import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import os from 'node:os'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { execFile as execFileCallback } from 'node:child_process'
import { AppError } from './errors.js'
import { getOpenAIClient, getOpenAIModels, hasOpenAIConfig } from './openai.js'
import { parseModelJson } from './model-json.js'
import { logAIError } from './ai-error-logger.js'

const execFile = promisify(execFileCallback)
const ffmpegPath = ffmpegInstaller.path
const ffprobePath = ffprobeInstaller.path

function summarizeStderr(stderr) {
  const text = stderr?.toString() || ''

  if (!text) {
    return null
  }

  const trimmed = text.trim()

  if (trimmed.length <= 1200) {
    return trimmed
  }

  return `${trimmed.slice(0, 450)}\n...\n${trimmed.slice(-700)}`
}

function sanitizeBaseName(filename) {
  return basename(filename, extname(filename))
    .replace(/[^a-zA-Z0-9-_가-힣 ]/g, '')
    .trim() || 'reference-video'
}

function buildFrameTimestamps(durationSeconds) {
  const cappedDuration = Math.max(0.5, Math.min(durationSeconds || 3, 3))
  const raw = [0, cappedDuration * 0.33, cappedDuration * 0.66, cappedDuration - 0.05]
  const normalized = raw
    .map((value) => Number(Math.max(0, value).toFixed(2)))
    .filter((value, index, array) => array.indexOf(value) === index)

  return normalized.length ? normalized : [0]
}

export async function createVideoWorkspace(file) {
  const workspace = await mkdtemp(join(os.tmpdir(), 'personal-ai-video-'))
  const videoPath = join(workspace, `${sanitizeBaseName(file.originalname)}${extname(file.originalname) || '.mp4'}`)
  await writeFile(videoPath, file.buffer)

  return {
    workspace,
    videoPath,
  }
}

export async function cleanupVideoWorkspace(workspace) {
  if (!workspace) {
    return
  }

  await rm(workspace, { recursive: true, force: true })
}

export async function getVideoDuration(videoPath) {
  let stdout

  try {
    const result = await execFile(ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ])
    stdout = result.stdout
  } catch (error) {
    throw new AppError('Failed to inspect video duration', {
      code: 'VIDEO_PROBE_FAILED',
      statusCode: 500,
      details: {
        stage: 'probe-duration',
        stderr: summarizeStderr(error.stderr),
      },
      cause: error,
    })
  }

  return Number.parseFloat(stdout.trim()) || 0
}

export async function hasAudioStream(videoPath) {
  try {
    const { stdout } = await execFile(ffprobePath, [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'csv=p=0',
      videoPath,
    ])

    return stdout
      .split('\n')
      .map((line) => line.trim())
      .some((line) => line === 'audio')
  } catch (error) {
    throw new AppError('Failed to inspect audio streams', {
      code: 'AUDIO_STREAM_PROBE_FAILED',
      statusCode: 500,
      details: {
        stage: 'probe-audio-stream',
        stderr: summarizeStderr(error.stderr),
      },
      cause: error,
    })
  }
}

export async function extractAudioTrack(videoPath, workspace) {
  const audioPath = join(workspace, 'audio.wav')

  try {
    await execFile(ffmpegPath, [
      '-y',
      '-i',
      videoPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      audioPath,
    ])
  } catch (error) {
    throw new AppError('Failed to extract audio track from video', {
      code: 'AUDIO_EXTRACTION_FAILED',
      statusCode: 500,
      details: {
        stage: 'extract-audio',
        stderr: summarizeStderr(error.stderr),
      },
      cause: error,
    })
  }

  return audioPath
}

export async function extractFrames(videoPath, workspace, durationSeconds) {
  const framesDir = join(workspace, 'frames')
  await mkdir(framesDir, { recursive: true })

  const timestamps = buildFrameTimestamps(durationSeconds)
  const frames = []

  for (const [index, timestamp] of timestamps.entries()) {
    const framePath = join(framesDir, `frame-${index + 1}.jpg`)

    try {
      await execFile(ffmpegPath, [
        '-y',
        '-ss',
        `${timestamp}`,
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        framePath,
      ])
    } catch (error) {
      throw new AppError('Failed to extract video frames', {
        code: 'FRAME_EXTRACTION_FAILED',
        statusCode: 500,
        details: {
          stage: 'extract-frames',
          timestamp,
          stderr: summarizeStderr(error.stderr),
        },
        cause: error,
      })
    }

    const buffer = await readFile(framePath)
    frames.push({
      timestamp,
      framePath,
      dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
    })
  }

  return frames
}

export async function transcribeVideoAudio(audioPath, context = {}) {
  if (!hasOpenAIConfig()) {
    throw new AppError('OpenAI API key is not configured', {
      code: 'OPENAI_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  const openai = getOpenAIClient()
  const { transcribeModel } = getOpenAIModels()
  const responseFormat = transcribeModel.startsWith('gpt-4o') ? 'json' : 'verbose_json'

  try {
    const response = await openai.audio.transcriptions.create({
      file: createReadStream(audioPath),
      model: transcribeModel,
      response_format: responseFormat,
    })

    return {
      text: response.text || '',
      segments: response.segments || [],
      duration: response.duration || null,
      model: transcribeModel,
    }
  } catch (error) {
    logAIError('whisper', error, {
      model: transcribeModel,
      responseFormat,
      ...context,
    })

    throw new AppError('Audio transcription failed', {
      code: 'TRANSCRIPTION_FAILED',
      statusCode: 502,
      details: {
        stage: 'transcription',
        model: transcribeModel,
        responseFormat,
      },
      cause: error,
    })
  }
}

export async function analyzeVideoFrames(frames, { title, topic }) {
  if (!hasOpenAIConfig()) {
    throw new AppError('OpenAI API key is not configured', {
      code: 'OPENAI_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  const openai = getOpenAIClient()
  const { visionModel } = getOpenAIModels()

  try {
    const response = await openai.chat.completions.create({
      model: visionModel,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content:
            '당신은 숏폼 영상의 첫 3초 후킹을 분석하는 한국어 전문가다. 전달받은 프레임들을 보고 시각적 훅 요소를 요약하고, 프레임별 핵심 관찰을 JSON으로만 반환한다.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `영상 제목: ${title}\n주제: ${topic}\n` +
                '다음 프레임들을 보고 JSON으로만 답하세요. 형식: ' +
                '{"summary":"", "frames":[{"timestamp":0,"observation":"","hookReason":""}]}',
            },
            ...frames.map((frame) => ({
              type: 'image_url',
              image_url: {
                url: frame.dataUrl,
                detail: 'low',
              },
            })),
          ],
        },
      ],
    })

    return parseModelJson(response.choices[0]?.message?.content || '')
  } catch (error) {
    logAIError('vision', error, {
      title,
      topic,
      frameCount: frames.length,
    })

    throw new AppError('Vision frame analysis failed', {
      code: 'VISION_ANALYSIS_FAILED',
      statusCode: 502,
      details: {
        stage: 'vision',
        model: visionModel,
        frameCount: frames.length,
      },
      cause: error,
    })
  }
}
