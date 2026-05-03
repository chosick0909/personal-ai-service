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

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export async function downloadScriptPdf({ title, sections }) {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    throw createPdfExportError('현재 환경에서는 브라우저 PDF 내보내기를 사용할 수 없습니다.')
  }

  let html2canvas
  let jsPDF
  try {
    const modules = await Promise.all([import('html2canvas'), import('jspdf')])
    html2canvas = modules[0].default
    jsPDF = modules[1].jsPDF
  } catch (error) {
    throw createPdfExportError('PDF 생성 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.', error)
  }

  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-99999px'
  container.style.top = '0'
  container.style.width = '794px'
  container.style.padding = '48px'
  container.style.background = '#ffffff'
  container.style.color = '#111111'
  container.style.fontFamily =
    'Apple SD Gothic Neo, Pretendard, Noto Sans KR, Malgun Gothic, sans-serif'
  container.style.lineHeight = '1.7'
  container.style.boxSizing = 'border-box'

  const escapeHtml = (value = '') =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll('\n', '<br />')

  container.innerHTML = `
    <div style="font-size: 28px; font-weight: 700; margin-bottom: 28px;">
      ${escapeHtml(title || 'AI Script Export')}
    </div>
    ${[
      ['HOOK', sections.hook],
      ['BODY', sections.body],
      ['CTA', sections.cta],
    ]
      .map(
        ([label, value]) => `
          <section style="margin-bottom: 28px;">
            <div style="font-size: 12px; font-weight: 700; letter-spacing: 0.12em; color: #666; margin-bottom: 10px;">
              ${label}
            </div>
            <div style="border: 1px solid #ddd; border-radius: 18px; padding: 18px 20px; font-size: 15px; white-space: normal; word-break: keep-all;">
              ${escapeHtml(value || '-')}
            </div>
          </section>
        `,
      )
      .join('')}
  `

  document.body.appendChild(container)

  try {
    if (document.fonts?.ready) {
      await Promise.race([document.fonts.ready, wait(1200)])
    }

    let canvas
    try {
      canvas = await html2canvas(container, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
      })
    } catch (error) {
      throw createPdfExportError('브라우저가 PDF 캡처를 완료하지 못했습니다. Safari/iOS 또는 저사양 기기에서는 긴 내용 캡처가 실패할 수 있습니다.', error)
    }

    if (!canvas?.width || !canvas?.height) {
      throw createPdfExportError('PDF로 변환할 화면을 캡처하지 못했습니다. 내용을 줄이거나 새로고침 후 다시 시도해주세요.')
    }

    let imgData
    try {
      imgData = canvas.toDataURL('image/png')
    } catch (error) {
      throw createPdfExportError('PDF 이미지 변환에 실패했습니다. 외부 이미지나 브라우저 보안 설정 때문에 막혔을 수 있습니다.', error)
    }

    let pdf
    try {
      pdf = new jsPDF({
        unit: 'pt',
        format: 'a4',
      })
    } catch (error) {
      throw createPdfExportError('PDF 문서를 만드는 중 오류가 발생했습니다.', error)
    }
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const imgWidth = pageWidth
    const imgHeight = (canvas.height * imgWidth) / canvas.width

    let heightLeft = imgHeight
    let position = 0

    try {
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight

      while (heightLeft > 0) {
        position = heightLeft - imgHeight
        pdf.addPage()
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
        heightLeft -= pageHeight
      }
    } catch (error) {
      throw createPdfExportError('PDF 페이지 구성 중 오류가 발생했습니다. 내용이 너무 길면 나눠서 다시 시도해주세요.', error)
    }

    let blob
    try {
      blob = pdf.output('blob')
    } catch (error) {
      throw createPdfExportError('PDF 파일 생성에 실패했습니다. 브라우저 메모리가 부족할 수 있습니다.', error)
    }

    if (!blob?.size) {
      throw createPdfExportError('빈 PDF가 생성되어 다운로드를 중단했습니다. 새로고침 후 다시 시도해주세요.')
    }

    const filename = `${(title || 'script').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'script'}.pdf`
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = filename
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) {
    if (error?.name === 'PdfExportError') {
      throw error
    }
    throw createPdfExportError('PDF 내보내기 중 알 수 없는 오류가 발생했습니다.', error)
  } finally {
    document.body.removeChild(container)
  }
}
