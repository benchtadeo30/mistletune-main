export function activeSegmentIndex(segments, seconds) {
  'worklet';
  if (!Number.isFinite(seconds)) return -1;
  let low = 0;
  let high = segments.length - 1;
  let candidate = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (segments[mid].start <= seconds) { candidate = mid; low = mid + 1; }
    else high = mid - 1;
  }
  return candidate >= 0 && seconds < segments[candidate].end ? candidate : -1;
}

// Rendering only needs to change when a line or word starts/ends.
export function lyricBoundaries(segments) {
  return [...new Set([0, ...segments.flatMap((segment) => [
    segment.start, segment.end,
    ...(segment.words ?? []).flatMap((word) => [word.start, word.end]),
  ])])].filter(Number.isFinite).sort((a, b) => a - b);
}

export function lyricTimeAt(boundaries, seconds) {
  if (!Number.isFinite(seconds)) return 0;
  let low = 0;
  let high = boundaries.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (boundaries[mid] <= seconds) low = mid + 1;
    else high = mid - 1;
  }
  return boundaries[high] ?? 0;
}

function estimateWordTimings(text, start, end) {
  const tokens = String(text || '').trim().match(/\S+/g) || [];
  if (!tokens.length || end <= start) return [];

  // Weight longer and multi-syllable words more heavily. These are estimates
  // spread across the source line's interval, not measured vocal timings.
  const weights = tokens.map((token) => {
    const letters = token.replace(/[^\p{L}\p{N}]/gu, '');
    const vowelGroups = letters.match(/[aeiouy]+/gi)?.length || 1;
    const syllables = Math.max(1, Math.min(5, vowelGroups));
    const pause = /[,;:]$/.test(token) ? 0.2 : /[.!?]$/.test(token) ? 0.35 : 0;
    return Math.max(1, syllables) + pause;
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const span = end - start;
  let cursor = start;

  return tokens.map((word, index) => {
    const wordStart = cursor;
    cursor = index === tokens.length - 1
      ? end
      : cursor + span * weights[index] / totalWeight;
    return { word, start: wordStart, end: cursor, estimated: true };
  });
}

// The displayed line carries the spaces. Timing providers can divide the same
// text into syllables or send several words under a single timestamp.
function alignToLine(text, timings) {
  const labels = text.trim().split(/\s+/);
  if (labels.length === 1) return timings;
  let index = 0;
  let offset = 0;
  const aligned = [];
  for (const label of labels) {
    let remaining = label.length;
    let start, end;
    let estimated = false;
    while (remaining > 0) {
      const token = timings[index];
      const length = token.word.replace(/\s+/g, '').length;
      const take = Math.min(remaining, length - offset);
      const at = position => token.start + (token.end - token.start) * position / length;
      if (start === undefined) start = offset === 0 ? token.start : at(offset);
      estimated ||= offset > 0 || offset + take < length;
      offset += take;
      remaining -= take;
      end = offset === length ? token.end : at(offset);
      if (offset === length) { index++; offset = 0; }
    }
    aligned.push({ word: label, start, end, ...(estimated ? { estimated: true } : {}) });
  }
  return aligned;
}

export function importedSegments(lines, duration) {
  return lines.map((line, index) => {
    const start = line.time;
    const next = lines[index + 1]?.time;
    const end = line.end ?? next ?? (duration > start ? duration : start + 5);
    const segment = { start, end, text: line.text };
    if (line.text === '♪' || end <= start) return segment;
    const supplied = line.words?.map((word, i) => ({
      ...word, end: word.end ?? line.words[i + 1]?.start ?? end,
    }));
    const normalize = (text) => text.replace(/\s+/g, '');
    if (supplied?.length && normalize(supplied.map((word) => word.word).join('')) === normalize(line.text)
      && supplied.every((word, i) => typeof word.word === 'string' && word.word.trim() && Number.isFinite(word.start) && Number.isFinite(word.end)
        && word.start >= start && word.end > word.start && word.end <= end
        && (i === 0 || word.start >= supplied[i - 1].start))) {
      const words = alignToLine(line.text, supplied);
      return { ...segment, words, ...(words.some(word => word.estimated) ? { wordTimingEstimated: true } : {}) };
    }
    // Estimate per-word highlighting from the line's timed interval. The
    // result is intentionally marked so the UI can disclose its uncertainty.
    const estimated = estimateWordTimings(line.text, start, end);
    return estimated.length ? { ...segment, words: estimated, wordTimingEstimated: true } : segment;
  }).filter((segment) => Number.isFinite(segment.start) && segment.start >= 0 && segment.end > segment.start);
}
