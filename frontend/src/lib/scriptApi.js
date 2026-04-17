import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { apiFetch, createApiError, parseApiResponse } from './api'

export async function createScriptSelection({
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

export async function loadScriptVersions(scriptId) {
  const response = await apiFetch(`/api/scripts/${scriptId}/versions`)
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '버전 목록을 불러오지 못했습니다.')
  }

  return payload.versions || []
}

export async function restoreScriptVersionRecord({ scriptId, versionId }) {
  const response = await apiFetch(`/api/scripts/${scriptId}/restore`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ versionId }),
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '버전 복원에 실패했습니다.')
  }

  return payload
}

export async function downloadScriptPdf({ title, sections }) {
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
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
    })

    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF({
      unit: 'pt',
      format: 'a4',
    })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const imgWidth = pageWidth
    const imgHeight = (canvas.height * imgWidth) / canvas.width

    let heightLeft = imgHeight
    let position = 0

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
    heightLeft -= pageHeight

    while (heightLeft > 0) {
      position = heightLeft - imgHeight
      pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight
    }

    pdf.save(`${(title || 'script').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'script'}.pdf`)
  } finally {
    document.body.removeChild(container)
  }
}
