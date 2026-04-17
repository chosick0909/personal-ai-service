function hasHangul(value) {
  return /[가-힣]/.test(value)
}

function looksMojibake(value) {
  return /[ÃÂÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßà-ÿ]/.test(value) || value.includes('�')
}

export function normalizeUploadedText(value) {
  if (typeof value !== 'string' || !value) {
    return value
  }

  try {
    const decoded = Buffer.from(value, 'latin1').toString('utf8')

    if (!decoded || decoded === value) {
      return value
    }

    if (hasHangul(decoded)) {
      return decoded
    }

    if (looksMojibake(value) && !looksMojibake(decoded)) {
      return decoded
    }

    return value
  } catch {
    return value
  }
}
