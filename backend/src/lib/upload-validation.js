import { rm } from 'node:fs/promises'
import { AppError } from './errors.js'

function bytesAt(buffer, offset, bytes) {
  if (!Buffer.isBuffer(buffer) || buffer.length < offset + bytes.length) {
    return false
  }
  return bytes.every((value, index) => buffer[offset + index] === value)
}

function isPdfByMagicBytes(buffer) {
  return bytesAt(buffer, 0, [0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-
}

function isVideoByMagicBytes(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return false
  }

  const isIsoBmffFamily = String(buffer.subarray(4, 8)) === 'ftyp' // mp4/mov/m4v
  if (isIsoBmffFamily) return true

  const isMatroskaFamily = bytesAt(buffer, 0, [0x1a, 0x45, 0xdf, 0xa3]) // webm/mkv
  if (isMatroskaFamily) return true

  const isAvi =
    String(buffer.subarray(0, 4)) === 'RIFF' &&
    String(buffer.subarray(8, 12)) === 'AVI ' // avi
  return isAvi
}

async function readMagicBytesFromUpload(file, size = 64) {
  if (!file) {
    return Buffer.alloc(0)
  }

  if (Buffer.isBuffer(file.buffer) && file.buffer.length > 0) {
    return file.buffer.subarray(0, size)
  }

  if (typeof file.path === 'string' && file.path) {
    const fsModule = await import('node:fs/promises')
    const handle = await fsModule.open(file.path, 'r')
    try {
      const buffer = Buffer.alloc(size)
      const { bytesRead } = await handle.read(buffer, 0, size, 0)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  return Buffer.alloc(0)
}

export async function removeUploadedTempFile(file) {
  if (!file?.path) {
    return
  }

  try {
    await rm(file.path, { force: true })
  } catch {
    // ignore cleanup failures for temp files
  }
}

export async function validateUploadedFile(file, {
  fieldName,
  allowedMimePrefixes = [],
  allowedMimeTypes = [],
  allowedExtensions = [],
  magicType = null,
}) {
  if (!file) {
    throw new AppError(`${fieldName} file is required`, {
      code: 'FILE_REQUIRED',
      statusCode: 400,
      details: { fieldName },
    })
  }

  const mimeType = String(file.mimetype || '').toLowerCase()
  const fileName = String(file.originalname || '').toLowerCase()
  const extension = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()

  const allowedByExactMime = allowedMimeTypes.some((item) => item.toLowerCase() === mimeType)
  const allowedByPrefix = allowedMimePrefixes.some((prefix) => mimeType.startsWith(prefix.toLowerCase()))
  const allowedByExtension = allowedExtensions.some((ext) => ext.toLowerCase() === extension)

  if (!allowedByExactMime && !allowedByPrefix && !allowedByExtension) {
    throw new AppError(`Unsupported ${fieldName} file type`, {
      code: 'UNSUPPORTED_FILE_TYPE',
      statusCode: 400,
      details: {
        fieldName,
        mimeType,
        extension,
      },
    })
  }

  const magicBytes = magicType ? await readMagicBytesFromUpload(file, 64) : null

  if (magicType === 'pdf' && !isPdfByMagicBytes(magicBytes)) {
    throw new AppError(`Unsupported ${fieldName} file signature`, {
      code: 'INVALID_FILE_SIGNATURE',
      statusCode: 400,
      details: { fieldName, expected: 'pdf' },
    })
  }

  if (magicType === 'video' && !isVideoByMagicBytes(magicBytes)) {
    throw new AppError(`Unsupported ${fieldName} file signature`, {
      code: 'INVALID_FILE_SIGNATURE',
      statusCode: 400,
      details: { fieldName, expected: 'video-container' },
    })
  }
}
