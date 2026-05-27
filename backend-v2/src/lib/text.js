function looksLikeMojibake(value) {
  if (typeof value !== 'string' || !value) return false;
  return /(?:Ã.|Â.|â.|ðŸ|Ð|Ñ)/.test(value);
}

function tryLatin1ToUtf8(value) {
  try {
    return Buffer.from(value, 'latin1').toString('utf8');
  } catch {
    return value;
  }
}

function countBadMarks(value) {
  const matches = value.match(/[�ÃÂâðÐÑ]/g);
  return matches ? matches.length : 0;
}

export function normalizeText(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.normalize('NFC');

  if (!looksLikeMojibake(trimmed)) return trimmed;

  const repaired = tryLatin1ToUtf8(trimmed).normalize('NFC');
  return countBadMarks(repaired) <= countBadMarks(trimmed) ? repaired : trimmed;
}

export function normalizeObjectStrings(value) {
  if (typeof value === 'string') return normalizeText(value);
  if (Array.isArray(value)) return value.map(normalizeObjectStrings);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, normalizeObjectStrings(inner)])
    );
  }
  return value;
}
