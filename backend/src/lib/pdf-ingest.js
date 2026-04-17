import { PDFParse } from 'pdf-parse'
import { AppError } from './errors.js'
import { ingestDocument } from './document-ingest.js'
import { normalizeUploadedText } from './text-normalize.js'

function isPdfFile(file) {
  if (!file) {
    return false
  }

  return (
    file.mimetype === 'application/pdf' ||
    file.originalname?.toLowerCase().endsWith('.pdf')
  )
}

function sanitizeExtractedPdfText(value) {
  if (typeof value !== 'string') {
    return ''
  }

  return value
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\r\n/g, '\n')
    .trim()
}

function looksLikeCorruptedPdfText(value) {
  if (!value) {
    return false
  }

  const meaningful = value.replace(/\s+/g, '')

  if (!meaningful) {
    return false
  }

  const allowedChars =
    meaningful.match(/[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9.,!?()[\]{}:;'"“”‘’\-_/+*&%#@=<>~]/g)?.length || 0
  const oddChars = meaningful.length - allowedChars
  const oddRatio = oddChars / meaningful.length
  const hangulChars = meaningful.match(/[가-힣ㄱ-ㅎㅏ-ㅣ]/g)?.length || 0
  const hangulRatio = hangulChars / meaningful.length

  return oddRatio > 0.3 && hangulRatio < 0.2
}

export async function ingestPdfDocument({ file, title, accountId, source, metadata = {} }) {
  if (!file) {
    throw new AppError('PDF file is required', {
      code: 'PDF_FILE_REQUIRED',
      statusCode: 400,
    })
  }

  if (!isPdfFile(file)) {
    throw new AppError('Only PDF files are supported', {
      code: 'INVALID_PDF_FILE',
      statusCode: 400,
    })
  }

  const parser = new PDFParse({ data: file.buffer })

  try {
    const result = await parser.getText()
    const extractedText = sanitizeExtractedPdfText(result.text)
    const normalizedOriginalName = normalizeUploadedText(file.originalname)
    const normalizedTitle =
      title?.trim() || normalizedOriginalName?.replace(/\.pdf$/i, '') || 'Untitled PDF'

    if (!extractedText) {
      throw new AppError('No extractable text was found in the PDF', {
        code: 'PDF_TEXT_EMPTY',
        statusCode: 400,
      })
    }

    if (looksLikeCorruptedPdfText(extractedText)) {
      throw new AppError('This PDF text layer looks corrupted and needs OCR-based extraction', {
        code: 'PDF_TEXT_CORRUPTED',
        statusCode: 400,
      })
    }

    return ingestDocument({
      accountId,
      title: normalizedTitle,
      content: extractedText,
      source: source?.trim() || 'pdf-upload',
      metadata: {
        ...metadata,
        fileName: normalizedOriginalName,
        mimeType: file.mimetype,
        fileSize: file.size,
        totalPages: result.total ?? null,
        ingestionType: 'pdf',
      },
    })
  } finally {
    await parser.destroy()
  }
}
