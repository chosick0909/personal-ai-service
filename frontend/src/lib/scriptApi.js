import { apiFetch, createApiError, parseApiResponse } from './api'

export async function createScriptSelection({
  accountId,
  referenceId,
  selectedLabel,
  title,
  sections,
  score,
}) {
  const response = await apiFetch('/api/scripts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountId,
      referenceId,
      selectedLabel,
      title,
      sections,
      score,
    }),
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '스크립트 생성에 실패했습니다.')
  }

  return payload
}

export async function saveVersionRecord({
  accountId,
  scriptId,
  title,
  sections,
  versionType,
  score,
  metadata,
}) {
  const response = await apiFetch(`/api/scripts/${scriptId}/versions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountId,
      title,
      sections,
      versionType,
      score,
      metadata,
    }),
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '버전 저장에 실패했습니다.')
  }

  return payload.version
}

function appendAccountQuery(path, accountId) {
  const normalizedAccountId = String(accountId || '').trim()
  if (!normalizedAccountId) {
    return path
  }

  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}accountId=${encodeURIComponent(normalizedAccountId)}`
}

export async function loadScriptVersions(scriptId, accountId) {
  const response = await apiFetch(appendAccountQuery(`/api/scripts/${scriptId}/versions`, accountId))
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '버전 목록을 불러오지 못했습니다.')
  }

  return payload.versions || []
}

export async function restoreScriptVersionRecord({ accountId, scriptId, versionId }) {
  const response = await apiFetch(`/api/scripts/${scriptId}/restore`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accountId, versionId }),
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '버전 복원에 실패했습니다.')
  }

  return payload
}

function createPdfExportError(message, cause) {
  const error = new Error(message)
  error.name = 'PdfExportError'
  error.cause = cause
  return error
}

function normalizePdfSections(sections = {}) {
  if (Array.isArray(sections)) {
    return sections.map((section) => [
      section.label || section.title || '',
      section.value || section.content || '',
    ])
  }

  return [
    ['HOOK', sections.hook],
    ['BODY', sections.body],
    ['CTA', sections.cta],
  ]
}

const PDF_FONT_PATH = 'fonts/NanumGothic-Regular.ttf'
const MIN_FONT_BYTES = 100_000

function getPdfFontUrlCandidates() {
  const candidates = []
  const addCandidate = (path) => {
    if (!path || candidates.includes(path)) {
      return
    }
    candidates.push(path)
  }

  const baseUrl = import.meta.env.BASE_URL || '/'
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`

  addCandidate(`${normalizedBaseUrl}${PDF_FONT_PATH}`)
  addCandidate(`/${PDF_FONT_PATH}`)

  if (typeof window !== 'undefined' && window.location?.protocol === 'file:') {
    addCandidate(new URL(`./${PDF_FONT_PATH}`, window.location.href).href)
    addCandidate(new URL(`./public/${PDF_FONT_PATH}`, window.location.href).href)
  }

  return candidates
}

function isPdfControlCharacter(codePoint) {
  return codePoint <= 8
    || codePoint === 11
    || codePoint === 12
    || (codePoint >= 14 && codePoint <= 31)
    || codePoint === 127
}

function isUnsupportedPdfGlyph(codePoint) {
  return codePoint === 0x200D
    || codePoint === 0xFE0E
    || codePoint === 0xFE0F
    || (codePoint >= 0x1F000 && codePoint <= 0x1FAFF)
    || (codePoint >= 0x2600 && codePoint <= 0x27BF)
}

function sanitizePdfText(value) {
  let output = ''
  for (const character of String(value ?? '').normalize('NFC')) {
    const codePoint = character.codePointAt(0)
    if (isPdfControlCharacter(codePoint) || isUnsupportedPdfGlyph(codePoint)) {
      continue
    }
    output += character
  }
  return output.replace(/[ \t]{2,}/g, ' ')
}

async function fetchFontAsBase64(paths = getPdfFontUrlCandidates()) {
  let lastError

  for (const path of paths) {
    try {
      const response = await fetch(path, { cache: 'force-cache' })
      if (!response.ok) {
        throw new Error(`font request failed: ${response.status}`)
      }

      const buffer = await response.arrayBuffer()
      if (buffer.byteLength < MIN_FONT_BYTES) {
        throw new Error('font response was not a valid font file')
      }

      const bytes = new Uint8Array(buffer)
      let binary = ''
      const chunkSize = 0x8000
      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
      }
      return window.btoa(binary)
    } catch (error) {
      lastError = error
    }
  }

  throw createPdfExportError('PDF 한글 폰트를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.', lastError)
}

function shouldOpenPdfInNewTab() {
  if (typeof navigator === 'undefined') {
    return false
  }

  const userAgent = navigator.userAgent || ''
  const isIos = /iPad|iPhone|iPod/i.test(userAgent)
  const isIpadDesktopMode = /Macintosh/i.test(userAgent) && Number(navigator.maxTouchPoints || 0) > 1
  return isIos || isIpadDesktopMode
}

function triggerPdfDelivery(blob, filename) {
  const url = URL.createObjectURL(blob)

  if (shouldOpenPdfInNewTab()) {
    const openedWindow = window.open(url, '_blank', 'noopener,noreferrer')
    if (openedWindow) {
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return 'new-tab'
    }
  }

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000)
  return 'download'
}

export async function downloadScriptPdf({ title, sections }) {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    throw createPdfExportError('현재 환경에서는 브라우저 PDF 내보내기를 사용할 수 없습니다.')
  }

  let jsPDF
  try {
    const module = await import('jspdf')
    jsPDF = module.jsPDF
  } catch (error) {
    throw createPdfExportError('PDF 생성 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.', error)
  }

  try {
    const fontBase64 = await fetchFontAsBase64()
    const pdf = new jsPDF({
      unit: 'pt',
      format: 'a4',
    })
    pdf.addFileToVFS('NanumGothic-Regular.ttf', fontBase64)
    pdf.addFont('NanumGothic-Regular.ttf', 'NanumGothic', 'normal')
    pdf.setFont('NanumGothic', 'normal')

    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 48
    const contentWidth = pageWidth - margin * 2
    let y = margin

    const ensureSpace = (height) => {
      if (y + height <= pageHeight - margin) {
        return
      }
      pdf.addPage()
      pdf.setFont('NanumGothic', 'normal')
      y = margin
    }

    const writeLines = (lines, { fontSize = 12, lineHeight = 18, color = '#111111' } = {}) => {
      pdf.setFontSize(fontSize)
      pdf.setTextColor(color)
      lines.forEach((line) => {
        ensureSpace(lineHeight)
        pdf.text(sanitizePdfText(line) || ' ', margin, y)
        y += lineHeight
      })
    }

    const normalizedTitle = sanitizePdfText(title || 'AI Script Export')
    writeLines(pdf.splitTextToSize(normalizedTitle, contentWidth), {
      fontSize: 22,
      lineHeight: 30,
      color: '#111111',
    })
    y += 12

    normalizePdfSections(sections).forEach(([label, value]) => {
      const normalizedValue = sanitizePdfText(value || '-')
      const valueLines = pdf.splitTextToSize(normalizedValue, contentWidth)
      ensureSpace(34)

      writeLines([sanitizePdfText(label || 'SECTION').toUpperCase()], {
        fontSize: 10,
        lineHeight: 16,
        color: '#555555',
      })
      pdf.setDrawColor('#DDDDDD')
      pdf.line(margin, y, pageWidth - margin, y)
      y += 18
      writeLines(valueLines, {
        fontSize: 12,
        lineHeight: 18,
        color: '#111111',
      })
      y += 20
    })

    let blob
    try {
      blob = pdf.output('blob')
    } catch (error) {
      throw createPdfExportError('PDF 파일 생성에 실패했습니다. 브라우저 메모리가 부족할 수 있습니다.', error)
    }

    if (!blob?.size) {
      throw createPdfExportError('빈 PDF가 생성되어 다운로드를 중단했습니다. 새로고침 후 다시 시도해주세요.')
    }

    const filename = `${normalizedTitle.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'script'}.pdf`
    const delivery = triggerPdfDelivery(blob, filename)
    return { delivery, filename }
  } catch (error) {
    if (error?.name === 'PdfExportError') {
      throw error
    }
    throw createPdfExportError('PDF 내보내기 중 알 수 없는 오류가 발생했습니다.', error)
  }
}
