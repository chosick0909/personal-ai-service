const MIN_COMPRESS_BYTES = 35 * 1024 * 1024
const MAX_TRANSCODE_SECONDS = 150
const TARGET_MAX_DIMENSION = 720
const TARGET_FRAME_RATE = 30
const TARGET_VIDEO_BITRATE = 1_800_000
const TARGET_AUDIO_BITRATE = 96_000
const METADATA_TIMEOUT_MS = 5000
const COMPRESSION_TIMEOUT_MS = 12000
const ENABLE_CLIENT_VIDEO_OPTIMIZATION =
  String(import.meta.env.VITE_ENABLE_CLIENT_VIDEO_OPTIMIZATION || '').trim() === 'true'

function isLikelyIOS() {
  if (typeof navigator === 'undefined') {
    return false
  }

  const userAgent = navigator.userAgent || ''
  const platform = navigator.platform || ''
  const touchPoints = navigator.maxTouchPoints || 0
  return /iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && touchPoints > 1)
}

function withTimeout(promise, timeoutMs, message) {
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      window.clearTimeout(timer)
    }
  })
}

function canUseBrowserVideoCompression() {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined'
  )
}

function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ]

  return candidates.find((item) => MediaRecorder.isTypeSupported?.(item)) || ''
}

function replaceExtension(fileName = 'reference-video', extension = 'webm') {
  const normalizedExtension = extension.replace(/^\./, '') || 'webm'
  const base = String(fileName || 'reference-video').replace(/\.[^.]+$/, '')
  return `${base}.optimized.${normalizedExtension}`
}

function loadVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.playsInline = true
    video.muted = true

    const cleanup = () => {
      if (timer) {
        window.clearTimeout(timer)
      }
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
    }

    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('영상 정보 읽기 시간이 초과되었습니다.'))
    }, METADATA_TIMEOUT_MS)

    video.onloadedmetadata = () => {
      const duration = Number(video.duration || 0)
      const width = Number(video.videoWidth || 0)
      const height = Number(video.videoHeight || 0)
      cleanup()
      resolve({ duration, width, height })
    }
    video.onerror = () => {
      cleanup()
      reject(new Error('영상 정보를 읽지 못했습니다.'))
    }
    video.src = url
  })
}

function getTargetSize(width, height) {
  if (!width || !height) {
    return { width: 720, height: 1280 }
  }

  const longSide = Math.max(width, height)
  if (longSide <= TARGET_MAX_DIMENSION) {
    return { width, height }
  }

  const scale = TARGET_MAX_DIMENSION / longSide
  return {
    width: Math.max(2, Math.round((width * scale) / 2) * 2),
    height: Math.max(2, Math.round((height * scale) / 2) * 2),
  }
}

export async function optimizeVideoForUpload(file, { onProgress } = {}) {
  if (!file || !file.type?.startsWith('video/')) {
    return { file, optimized: false, reason: 'not-video' }
  }

  if (!ENABLE_CLIENT_VIDEO_OPTIMIZATION) {
    return { file, optimized: false, reason: 'disabled' }
  }

  if (!canUseBrowserVideoCompression()) {
    return { file, optimized: false, reason: 'unsupported-browser' }
  }

  if (isLikelyIOS()) {
    return { file, optimized: false, reason: 'ios-skip' }
  }

  if (file.size < MIN_COMPRESS_BYTES) {
    return { file, optimized: false, reason: 'small-file' }
  }

  const mimeType = pickMimeType()
  if (!mimeType) {
    return { file, optimized: false, reason: 'unsupported-mime' }
  }

  const metadata = await loadVideoMetadata(file)
  if (!metadata.duration || metadata.duration > MAX_TRANSCODE_SECONDS) {
    return {
      file,
      optimized: false,
      reason: metadata.duration > MAX_TRANSCODE_SECONDS ? 'too-long' : 'unknown-duration',
      metadata,
    }
  }

  const sourceUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  const chunks = []
  let animationFrameId = null
  let audioContext = null
  let recorder = null
  let outputStream = null

  try {
    if (!context) {
      throw new Error('Canvas context is not available.')
    }

    const targetSize = getTargetSize(metadata.width, metadata.height)
    canvas.width = targetSize.width
    canvas.height = targetSize.height

    video.preload = 'auto'
    video.playsInline = true
    video.muted = true

    await new Promise((resolve, reject) => {
      if (video.readyState >= 2) {
        resolve()
        return
      }
      video.onloadeddata = resolve
      video.onerror = () => reject(new Error('영상을 압축용으로 불러오지 못했습니다.'))
      video.src = sourceUrl
    })

    const canvasStream = canvas.captureStream(TARGET_FRAME_RATE)
    outputStream = new MediaStream(canvasStream.getVideoTracks())

    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext
      if (AudioContextCtor) {
        audioContext = new AudioContextCtor()
        await audioContext.resume?.()
        const source = audioContext.createMediaElementSource(video)
        const destination = audioContext.createMediaStreamDestination()
        source.connect(destination)
        destination.stream.getAudioTracks().forEach((track) => outputStream.addTrack(track))
      }
    } catch {
      // Audio capture support differs by mobile browser. If it fails, keep video optimization as fallback.
    }

    recorder = new MediaRecorder(outputStream, {
      mimeType,
      videoBitsPerSecond: TARGET_VIDEO_BITRATE,
      audioBitsPerSecond: TARGET_AUDIO_BITRATE,
    })

    recorder.ondataavailable = (event) => {
      if (event.data?.size) {
        chunks.push(event.data)
      }
    }

    const draw = () => {
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const progress = metadata.duration
        ? Math.min(99, Math.round((video.currentTime / metadata.duration) * 100))
        : 0
      onProgress?.(progress)
      animationFrameId = window.requestAnimationFrame(draw)
    }

    const finished = new Promise((resolve, reject) => {
      recorder.onstop = resolve
      recorder.onerror = () => reject(new Error('영상 압축에 실패했습니다.'))
      video.onended = () => {
        if (recorder?.state === 'recording') {
          recorder.stop()
        }
      }
      video.onerror = () => reject(new Error('영상 재생 중 압축이 중단되었습니다.'))
    })

    recorder.start(1000)
    draw()
    await withTimeout(video.play(), 3000, '영상 최적화 재생이 지연되었습니다.')
    await withTimeout(finished, COMPRESSION_TIMEOUT_MS, '영상 최적화 시간이 초과되었습니다.')

    onProgress?.(100)
    const blob = new Blob(chunks, { type: mimeType.split(';')[0] || 'video/webm' })
    if (!blob.size || blob.size >= file.size * 0.92) {
      return { file, optimized: false, reason: 'not-smaller', metadata }
    }

    const extension = blob.type.includes('mp4') ? 'mp4' : 'webm'
    const optimizedFile = new File([blob], replaceExtension(file.name, extension), {
      type: blob.type || 'video/webm',
      lastModified: Date.now(),
    })

    return {
      file: optimizedFile,
      optimized: true,
      originalSize: file.size,
      optimizedSize: optimizedFile.size,
      metadata,
    }
  } finally {
    if (animationFrameId) {
      window.cancelAnimationFrame(animationFrameId)
    }
    if (recorder?.state === 'recording') {
      recorder.stop()
    }
    outputStream?.getTracks?.().forEach((track) => track.stop())
    await audioContext?.close?.()
    URL.revokeObjectURL(sourceUrl)
    video.removeAttribute('src')
    video.load()
  }
}
