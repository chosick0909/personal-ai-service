const DEFAULT_MAX_CHUNK_LENGTH = 800
const DEFAULT_OVERLAP_LENGTH = 120

function normalizeWhitespace(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitParagraphs(text) {
  return normalizeWhitespace(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

export function chunkText(
  text,
  {
    maxChunkLength = DEFAULT_MAX_CHUNK_LENGTH,
    overlapLength = DEFAULT_OVERLAP_LENGTH,
  } = {},
) {
  const paragraphs = splitParagraphs(text)

  if (!paragraphs.length) {
    return []
  }

  const chunks = []
  let currentChunk = ''

  for (const paragraph of paragraphs) {
    const nextChunk = currentChunk
      ? `${currentChunk}\n\n${paragraph}`
      : paragraph

    if (nextChunk.length <= maxChunkLength) {
      currentChunk = nextChunk
      continue
    }

    if (currentChunk) {
      chunks.push(currentChunk)
    }

    if (paragraph.length <= maxChunkLength) {
      currentChunk = paragraph
      continue
    }

    let start = 0
    while (start < paragraph.length) {
      const end = Math.min(start + maxChunkLength, paragraph.length)
      const slice = paragraph.slice(start, end).trim()

      if (slice) {
        chunks.push(slice)
      }

      if (end >= paragraph.length) {
        break
      }

      start = Math.max(end - overlapLength, start + 1)
    }

    currentChunk = ''
  }

  if (currentChunk) {
    chunks.push(currentChunk)
  }

  return chunks.map((content, chunkIndex) => ({
    chunkIndex,
    content,
  }))
}
