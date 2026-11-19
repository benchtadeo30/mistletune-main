import { load, JSON_SCHEMA } from 'js-yaml';
import { parseLyrics } from './lyricsParser';

const LRCLIB_API = 'https://lrclib.net/api';
const LRC_RED_API = 'https://lrc.red';
const LIRIQO_API = 'https://api.liriqo-alfarrizi.my.id/v1';
const LYRICS_DB_API = 'https://lyricsdb.kollod.dev/api';
const LYRICS_OVH_API = 'https://api.lyrics.ovh/v1';
const SPICY_LYRICS_API = 'https://api.spicylyrics.org/v1';
// Publishable client key; this key type is intended to ship in client apps.
const SPICY_LYRICS_CLIENT_KEY = 'sl_pk_oXjzjuKT5Zopbinvqj_YeXdv6m5OELSYwQGlX1ER_b0';
const REQUEST_TIMEOUT_MS = 12000;
const LIRIQO_TIMEOUT_MS = 25000;
const RETRY_AFTER = new Map();

function makeRequestSignal(signal, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  return { controller, abort, timedOut: () => timedOut, cleanup: () => {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  } };
}

function checkProviderBackoff(provider) {
  const waitUntil = RETRY_AFTER.get(provider) || 0;
  if (Date.now() < waitUntil) {
    throw new Error(`${provider} is busy. Try again in ${Math.ceil((waitUntil - Date.now()) / 1000)} seconds.`);
  }
}

function updateProviderBackoff(provider, response) {
  const retry = response.headers.get('Retry-After');
  const seconds = Number(retry);
  const parsedDate = retry ? Date.parse(retry) : NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(parsedDate) ? parsedDate - Date.now() : 30000;
  const waitUntil = Date.now() + Math.max(1000, delay);
  RETRY_AFTER.set(provider, waitUntil);
  return `${provider} is busy. Try again in ${Math.ceil((waitUntil - Date.now()) / 1000)} seconds.`;
}

async function request(url, provider, signal, fetchImpl, format = 'json', timeoutMs = REQUEST_TIMEOUT_MS, includeHeaders = false) {
  checkProviderBackoff(provider);
  const requestSignal = makeRequestSignal(signal, timeoutMs);
  try {
    const headers = provider === 'LRCLIB'
      ? { Accept: 'application/json', 'Lrclib-Client': 'MistleTunes/1.0 (https://expo.dev/@benchtadeo30/music-player)' }
      : provider === 'lrc.red'
        ? { Accept: format === 'json' ? 'application/json' : 'text/plain', 'X-Client-ID': 'MistleTunes (https://expo.dev/@benchtadeo30/music-player)' }
        : provider === 'LiriQo'
          ? { Accept: 'application/json', 'X-LiriQo-Client': 'MistleTunes/1.0' }
          : provider === 'Spicy Lyrics'
            ? { Accept: 'application/json', Authorization: `Bearer ${SPICY_LYRICS_CLIENT_KEY}` }
        : { Accept: 'application/json' };
    const response = await fetchImpl(url, { signal: requestSignal.controller.signal, headers });
    if (response.status === 429 || response.status === 503) throw new Error(updateProviderBackoff(provider, response));
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${provider} request failed (${response.status}).`);
    const contentType = response.headers.get('Content-Type') || '';
    if (format === 'json') {
      if (!contentType.includes('json')) throw new Error(`${provider} returned an unexpected response.`);
      const data = await response.json();
      return includeHeaders ? { data, headers: response.headers } : data;
    }
    return await response.text();
  } catch (error) {
    if (requestSignal.timedOut()) throw new Error(`${provider} timed out. Check your internet connection and try again.`);
    if (error?.name === 'TypeError') throw new Error(`Could not connect to ${provider}. Check your internet connection.`);
    throw error;
  } finally {
    requestSignal.cleanup();
  }
}

const lyricTag = '(?:(?:official|unofficial)\\s+)?(?:lyrics?|karaoke(?:\\s+(?:video|style|version))?)(?:\\s+(?:video|audio))?';
const featureTag = '(?:feat(?:uring)?|ft)\\.?\\s+.*$';

function cleanTitle(value) {
  const original = String(value || '').trim();
  const cleaned = original
    .replace(new RegExp(`[\\[(]\\s*${lyricTag}\\s*[\\])]`, 'ig'), ' ')
    .replace(new RegExp(`(?:[-\\u2013\\u2014|:]\\s*|\\s+)${lyricTag}(?=$|\\s*[\\])])`, 'ig'), ' ')
    .replace(new RegExp(`\\s+${featureTag}`, 'i'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || original;
}

function cleanArtist(value) {
  return String(value || '').replace(new RegExp(`\\s+${featureTag}`, 'i'), '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return String(value || '').toLowerCase()
    .replace(new RegExp(lyricTag, 'ig'), ' ')
    .replace(/\b(?:feat(?:uring)?|ft)\.?\b.*$/i, ' ')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function artistCandidates(artist) {
  const full = String(artist || '').replace(/\s+/g, ' ').trim();
  const primary = cleanArtist(full);
  return [...new Set([full, primary].filter(Boolean))];
}

function candidateScore(record, title, artists, durationSeconds) {
  const wantedTitle = normalize(title);
  const foundTitle = normalize(record?.trackName || record?.title || record?.name);
  const wantedArtists = artists.map(normalize).filter(Boolean);
  const foundArtist = normalize(record?.artistName || record?.artist);
  if (!wantedTitle || !foundTitle || !foundArtist) return -1;
  const titleMatch = wantedTitle === foundTitle ? 1
    : wantedTitle.includes(foundTitle) || foundTitle.includes(wantedTitle) ? 0.82
      : (() => {
        const wantedWords = new Set(wantedTitle.split(' '));
        const shared = foundTitle.split(' ').filter((word) => wantedWords.has(word)).length;
        return shared / Math.max(wantedWords.size, foundTitle.split(' ').length);
      })();
  const artistMatch = wantedArtists.some((wanted) => wanted === foundArtist) ? 1
    : wantedArtists.some((wanted) => wanted.includes(foundArtist) || foundArtist.includes(wanted)) ? 0.8
      : (() => {
        const words = new Set(wantedArtists.join(' ').split(' ').filter((word) => word.length > 1));
        const found = foundArtist.split(' ').filter((word) => word.length > 1);
        return found.length ? found.filter((word) => words.has(word)).length / found.length : 0;
      })();
  if (titleMatch < 0.6 || artistMatch < 0.35) return -1;
  const actualDuration = Number(record?.duration);
  const durationPenalty = Number.isFinite(durationSeconds) && durationSeconds > 0 && actualDuration > 0
    ? Math.min(Math.abs(actualDuration - durationSeconds) / 300, 0.18) : 0;
  const wordSync = record?.hasWordSync || record?.sync === 'word' || /word/i.test(record?.sync || '');
  const synced = wordSync || Boolean(record?.syncedLyrics || record?.files?.lrc);
  const hasText = wordSync || synced || Boolean(record?.plainLyrics);
  return titleMatch * 0.55 + artistMatch * 0.4 + (hasText ? 0.05 : 0) - durationPenalty;
}

function hasWords(lyrics) {
  return Boolean(lyrics?.parsed?.lines?.some((line) => line.words?.length));
}

function liriQoWordTimings(rawWords, lineText) {
  if (!Array.isArray(rawWords)) return [];
  const words = [];
  // Keep the individual intervals when the full line supplies word boundaries.
  // Some responses contain an array of whole words without separator characters.
  const separateTokens = /\s/u.test(lineText) || (!lineText && !rawWords.some(item => /\s/u.test(item?.text || '')));
  let current = null;
  for (const item of rawWords) {
    const text = typeof item?.text === 'string' ? item.text : '';
    const startMs = Number(item?.start);
    const endMs = Number(item?.end);
    if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) continue;
    if (current && /^\s/u.test(text)) {
      if (current.word.trim()) words.push({ word: current.word.trim(), start: current.start / 1000, end: current.end / 1000 });
      current = null;
    }
    if (!current) current = { word: '', start: startMs, end: endMs };
    current.word += text;
    current.end = Math.max(current.end, endMs);
    // Preserve the provider's timing while combining syllable fragments into words.
    if (separateTokens || /\s$/.test(text)) {
      if (current.word.trim()) words.push({ ...current, word: current.word.trim(), start: current.start / 1000, end: current.end / 1000 });
      current = null;
    }
  }
  if (current?.word.trim()) words.push({ ...current, word: current.word.trim(), start: current.start / 1000, end: current.end / 1000 });
  return words;
}

function lyricsFromLiriQoTrack(data, candidate, title, artist) {
  const timed = Array.isArray(candidate?.timed) ? candidate.timed : [];
  const lines = timed.map((line, index) => {
    const rawWords = Array.isArray(line?.words) ? line.words
      : candidate?.words?.[line?.id] || candidate?.words?.[index] || [];
    const lineText = String(line?.text || '').trim();
    const words = liriQoWordTimings(rawWords, lineText);
    const text = lineText || words.map(word => word.word).join(' ');
    const startMs = Number(line?.start);
    const endMs = Number(line?.end);
    const firstWord = words[0];
    const lastWord = words[words.length - 1];
    const start = Number.isFinite(startMs) && startMs >= 0 ? Math.min(startMs / 1000, firstWord?.start ?? Infinity) : firstWord?.start;
    const end = Number.isFinite(endMs) && endMs > 0 ? Math.max(endMs / 1000, lastWord?.end ?? 0) : lastWord?.end;
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const normalized = (value) => value.replace(/\s+/g, '');
    const alignedWords = words.length && normalized(words.map((word) => word.word).join('')) === normalized(text) ? words : [];
    return { time: start, end, text, ...(alignedWords.length ? { words: alignedWords } : {}) };
  }).filter(Boolean).sort((a, b) => a.time - b.time);
  const sourceName = candidate?.upstreamProvider || candidate?.provider || 'LiriQo';
  const metadata = {
    name: `${data?.metadata?.title || title} — ${data?.metadata?.artist || artist}`,
    source: `LiriQo (${sourceName})`,
    sourceUrl: 'https://github.com/AlFarrizi-Studio/LiriQo',
    sourceId: data?.videoId,
  };
  if (lines.length) {
    return {
      ...metadata,
      text: JSON.stringify(candidate),
      format: 'lyricsfile',
      parsed: { synced: true, lines },
    };
  }
  const plain = typeof candidate?.plain === 'string' ? candidate.plain.trim() : '';
  return plain && parseLyrics(plain).lines.length ? { ...metadata, text: plain } : null;
}

export function normalizeSpotifyTrackUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const trackIndex = parts.lastIndexOf('track');
    const id = parts[trackIndex + 1];
    if (trackIndex < 0 || !/^[a-zA-Z0-9]{22}$/.test(id || '')) return null;
    return `https://open.spotify.com/track/${id}`;
  } catch { return null; }
}

function spicyWordsFromSyllables(syllables) {
  if (!Array.isArray(syllables)) return [];
  const words = [];
  let current = null;
  const flush = () => {
    if (current?.word.trim() && current.end > current.start) {
      words.push({ word: current.word.trim(), start: current.start, end: current.end });
    }
    current = null;
  };
  for (const syllable of syllables) {
    const text = typeof syllable?.Text === 'string' ? syllable.Text : '';
    const start = Number(syllable?.StartTime);
    const end = Number(syllable?.EndTime);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue;
    if (!current) current = { word: '', start, end };
    current.word += text;
    current.end = Math.max(current.end, end);
    // A true flag means this syllable continues into the next part of its word.
    if (syllable.IsPartOfWord !== true) flush();
  }
  flush();
  return words;
}

function spicyLyricsFromResponse(response, track, spotifyId) {
  const body = response?.Body;
  if (!body || response?.Status >= 400 || body.error === true) return null;
  const syncType = String(body.Type || 'Static').toLowerCase();
  const content = Array.isArray(body.Content) ? body.Content : [];
  const lines = content.map((item) => {
    const lead = item?.Lead || item;
    const syllables = Array.isArray(lead?.Syllables) ? lead.Syllables : [];
    const decodedWords = spicyWordsFromSyllables(syllables);
    const words = syncType === 'syllable' ? decodedWords : [];
    const textValue = [lead?.Text, lead?.Words, item?.Text, item?.Words, item?.Lyrics]
      .find((value) => typeof value === 'string' && value.trim());
    const text = String(textValue || (decodedWords.length ? decodedWords.map((word) => word.word).join(' ') : '')).trim();
    const rawStart = syncType === 'syllable' ? lead?.StartTime ?? item?.StartTime : item?.StartTime ?? lead?.StartTime;
    const rawEnd = syncType === 'syllable' ? lead?.EndTime ?? item?.EndTime : item?.EndTime ?? lead?.EndTime;
    const startValue = rawStart == null ? NaN : Number(rawStart);
    const endValue = rawEnd == null ? NaN : Number(rawEnd);
    const start = Number.isFinite(startValue) && startValue >= 0 ? startValue : words[0]?.start;
    const end = Number.isFinite(endValue) && endValue > start ? endValue : words[words.length - 1]?.end;
    if (!text) return null;
    return {
      time: Number.isFinite(start) ? start : null,
      ...(Number.isFinite(end) && Number.isFinite(start) && end > start ? { end } : {}),
      text,
      ...(words.length ? { words } : {}),
    };
  }).filter(Boolean).sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  if (!lines.length) return null;

  const source = String(body.source || '').toLowerCase();
  const providers = {
    spicy_lyrics: { name: 'Spicy Lyrics', url: 'https://spicylyrics.org' },
    apple_music: { name: 'Apple Music', url: 'https://music.apple.com' },
    spotify: { name: 'Spotify', url: 'https://open.spotify.com' },
  };
  const provider = providers[source] || { name: 'Unknown source' };
  const contributors = body.UploadAttribution || {};
  const contributor = (value, fallback) => {
    if (!value || typeof value !== 'object') return null;
    const url = typeof value.url === 'string' && /^https:\/\//i.test(value.url) ? value.url : null;
    return { name: String(value.username || fallback), ...(url ? { url } : {}) };
  };
  const attribution = {
    provider: provider.name,
    ...(provider.url ? { providerUrl: provider.url } : {}),
    ...(source === 'spicy_lyrics' ? {
      uploader: contributor(contributors.Uploader, 'Uploader'),
      maker: contributor(contributors.Maker, 'Maker'),
    } : {}),
  };
  return {
    name: `${track.title} — ${track.artist}`,
    source: provider.name,
    sourceUrl: provider.url,
    sourceId: spotifyId || body.id,
    licenseProvider: 'Spicy Lyrics',
    attribution,
    text: JSON.stringify(body),
    format: 'lyricsfile',
    parsed: { synced: syncType === 'syllable' || syncType === 'line', lines },
  };
}

async function findSpicyLyrics(track, title, artists, spotifyUrl, signal, fetchImpl) {
  const spotifyMatch = normalizeSpotifyTrackUrl(spotifyUrl || track.spotifyUrl || track.spotifyUri);
  const spotifyId = spotifyMatch?.split('/').pop()
    || String(track.spotifyId || track.spotifyTrackId || '').match(/^[A-Za-z0-9]{22}$/)?.[0];
  let selectedId = spotifyId;
  if (!selectedId) {
    const query = new URLSearchParams({ title, artist: artists[0] });
    if (track.album) query.set('album', String(track.album));
    if (Number.isFinite(track.durationSeconds) && track.durationSeconds > 0) query.set('duration', String(track.durationSeconds));
    const search = await request(`${SPICY_LYRICS_API}/tracks/search?${query}`, 'Spicy Lyrics', signal, fetchImpl);
    const results = Array.isArray(search?.Body?.results) ? search.Body.results : [];
    const exact = results.find((result) => result?.tier === 'exact' && /^[A-Za-z0-9]{22}$/.test(result.id || ''));
    if (!exact) return null;
    selectedId = exact.id;
  }
  const response = await request(`${SPICY_LYRICS_API}/lyrics/${encodeURIComponent(selectedId)}`, 'Spicy Lyrics', signal, fetchImpl);
  return spicyLyricsFromResponse(response, track, selectedId);
}

async function findLiriQo(track, title, artists, spotifyUrl, signal, fetchImpl) {
  const query = new URLSearchParams({ full: '1' });
  if (spotifyUrl) query.set('url', spotifyUrl);
  else {
    query.set('title', title);
    query.set('artist', artists[0]);
    if (track.album) query.set('album', String(track.album));
  }
  if (Number.isFinite(track.durationSeconds) && track.durationSeconds > 0) query.set('duration', String(track.durationSeconds));
  if (!spotifyUrl && track.isrc) query.set('isrc', String(track.isrc));
  const data = await request(`${LIRIQO_API}/lyrics?${query}`, 'LiriQo', signal, fetchImpl, 'json', LIRIQO_TIMEOUT_MS);
  if (!data || data.error || !Array.isArray(data.tracks)) return null;
  const matchScore = Number(data.matchScore);
  if (Number.isFinite(matchScore) && matchScore < 0.72) return null;
  if (data.metadata && candidateScore(data.metadata, title, artists, track.durationSeconds) < 0.62) return null;
  const candidates = [...new Map([data.primary, ...data.tracks].filter(Boolean)
    .map((candidate) => [candidate.provider || JSON.stringify(candidate), candidate])).values()];
  const results = candidates.map((candidate) => lyricsFromLiriQoTrack(data, candidate, title, artists[0])).filter(Boolean);
  results.sort((a, b) => Number(hasWords(b)) - Number(hasWords(a))
    || Number(Boolean(b.parsed?.synced)) - Number(Boolean(a.parsed?.synced)));
  return results[0] || null;
}

function isCompactLyricToken(value) {
  return Array.isArray(value) && value.length >= 4
    && Number.isInteger(value[0]) && value[0] >= 1 && value[0] <= 4
    && Number.isFinite(value[1]) && value[1] >= 0
    && Number.isFinite(value[2]) && value[2] >= 0
    && typeof value[3] === 'string';
}

function parseLyricsDbPayload(payload) {
  if (!Array.isArray(payload) || payload.length > 5000) return null;
  const lines = [];
  for (const group of payload) {
    if (!Array.isArray(group)) continue;
    const tokens = group.filter(isCompactLyricToken);
    if (!tokens.length) continue;
    const words = [];
    let current = null;
    for (const token of tokens) {
      const [vocalType, startMs, lengthMs, tokenText] = token;
      if (!tokenText) continue;
      if (!current || current.vocalType !== vocalType) {
        if (current) words.push(current);
        current = { vocalType, text: '', startMs, endMs: startMs };
      }
      current.text += tokenText;
      current.endMs = Math.max(current.endMs, startMs + lengthMs);
      // LyricsDB uses a trailing space to mark the end of an authored word;
      // non-space-ending tokens are syllables that belong to the same word.
      if (/\s$/.test(tokenText)) {
        words.push(current);
        current = null;
      }
    }
    if (current) words.push(current);
    const validWords = words.filter((word) => word.text.trim()).map((word) => ({
      word: word.text.trim(), start: word.startMs / 1000, end: word.endMs / 1000,
    }));
    const text = tokens.map((token) => token[3]).join('').trim();
    if (!text || !validWords.length) continue;
    lines.push({
      time: Math.min(...tokens.map((token) => token[1])) / 1000,
      text,
      words: validWords,
    });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines.length ? { synced: true, lines } : null;
}

async function findLyricsDb(track, title, artists, signal, fetchImpl) {
  const query = new URLSearchParams({ title, artist: artists[0], format: 'json' });
  if (track.album) query.set('album', String(track.album));
  if (Number.isFinite(track.durationSeconds) && track.durationSeconds > 0) {
    query.set('duration', String(Math.round(track.durationSeconds)));
  }
  const result = await request(`${LYRICS_DB_API}/lyrics/fuzzy?${query}`, 'LyricsDB', signal, fetchImpl, 'json', REQUEST_TIMEOUT_MS, true);
  if (!result) return null;
  // Reject ambiguous fuzzy matches instead of attaching another recording's lyrics.
  const matchScore = Number(result.headers.get('X-Match-Score'));
  if (!Number.isFinite(matchScore) || matchScore < 0.82) return null;
  const parsed = parseLyricsDbPayload(result.data);
  if (!parsed?.lines?.some((line) => line.words?.length)) return null;
  return {
    name: `${title} — ${artists[0]}`,
    source: 'LyricsDB (word-timed)',
    sourceUrl: 'https://lyricsdb.kollod.dev',
    sourceId: result.headers.get('X-Match-Track-Id') || undefined,
    text: JSON.stringify(result.data),
    format: 'lyricsfile',
    parsed,
  };
}

function rankRecords(records, title, artists, durationSeconds) {
  if (!Array.isArray(records)) return [];
  return records.map((record) => ({ record, score: candidateScore(record, title, artists, durationSeconds) }))
    .filter(({ record, score }) => score >= 0 && !record.instrumental)
    .sort((a, b) => b.score - a.score)
    .map(({ record }) => record);
}

function lyricsQuality(lyrics) {
  if (hasWords(lyrics)) return 3;
  if (lyrics?.parsed?.synced || (typeof lyrics?.text === 'string' && parseLyrics(lyrics.text).synced)) return 2;
  return lyrics?.text ? 1 : 0;
}

async function findLrclib(track, title, artists, signal, fetchImpl) {
  const ranked = [];
  let lastError = null;
  const directQuery = new URLSearchParams({ track_name: title, artist_name: artists[0] });
  if (track.album) directQuery.set('album_name', track.album);
  if (Number.isFinite(track.durationSeconds) && track.durationSeconds > 0) directQuery.set('duration', String(Math.round(track.durationSeconds)));
  try {
    const direct = await request(`${LRCLIB_API}/get?${directQuery}`, 'LRCLIB', signal, fetchImpl);
    if (direct) ranked.push(direct);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (!/\(404\)/.test(error.message) && !/\b404\b/.test(error.message)) lastError = error;
  }

  const queries = [];
  for (const artist of artists) {
    queries.push(new URLSearchParams({ track_name: title, artist_name: artist }));
  }
  queries.push(new URLSearchParams({ q: `${title} ${artists.join(' ')}` }));
  for (const query of queries) {
    try {
      const records = await request(`${LRCLIB_API}/search?${query}`, 'LRCLIB', signal, fetchImpl);
      ranked.push(...(Array.isArray(records) ? records : records && !records.error ? [records] : []));
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error.message.includes('busy. Try again')) throw error;
      lastError = error;
    }
    if (rankRecords(ranked, title, artists, track.durationSeconds).length) break;
  }
  const matches = rankRecords([...new Map(ranked.map((record) => [record.id || JSON.stringify(record), record])).values()], title, artists, track.durationSeconds);
  const result = matches.map((record) => {
    try { return { record, lyrics: lyricsFromRecord(record, 'LRCLIB') }; } catch { return null; }
  }).filter(Boolean).sort((a, b) => Number(hasWords(b.lyrics)) - Number(hasWords(a.lyrics))
    || Number(Boolean(b.record.syncedLyrics)) - Number(Boolean(a.record.syncedLyrics)))[0]?.lyrics || null;
  if (!result && lastError && !ranked.length) throw lastError;
  return result;
}

async function findLrcRed(track, title, artists, signal, fetchImpl) {
  const hits = [];
  const isrc = String(track.isrc || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) {
    try {
      const details = await request(`${LRC_RED_API}/s/${encodeURIComponent(isrc)}.json`, 'lrc.red', signal, fetchImpl);
      if (details && candidateScore(details, title, artists, track.durationSeconds) >= 0) hits.push(details);
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  const query = `${title} ${artists[0]}`.trim();
  const searchUrl = new URL(`${LRC_RED_API}/search.json`);
  searchUrl.searchParams.set('q', query);
  const search = await request(searchUrl.toString(), 'lrc.red', signal, fetchImpl);
  hits.push(...rankRecords(search?.hits, title, artists, track.durationSeconds));
  const uniqueHits = [...new Map(hits.filter((hit) => hit.isrc).map((hit) => [hit.isrc, hit])).values()];
  for (const hit of uniqueHits.slice(0, 5)) {
    if (!hit.isrc) continue;
    const details = hit.files ? hit : await request(`${LRC_RED_API}/s/${encodeURIComponent(hit.isrc)}.json`, 'lrc.red', signal, fetchImpl);
    if (!details?.files?.lyricsfile && !details?.isrc) continue;
    const lyricsUrl = `${LRC_RED_API}/s/${encodeURIComponent(hit.isrc)}.lyricsfile.yaml`;
    const lyricsfile = await request(lyricsUrl, 'lrc.red', signal, fetchImpl, 'text');
    if (!lyricsfile) continue;
    try {
      const lyrics = lyricsFromRecord({
        id: details.isrc,
        trackName: details.title || hit.title,
        artistName: details.artist || hit.artist,
        duration: details.duration || hit.duration,
        lyricsfile,
      }, 'lrc.red');
      if (hasWords(lyrics)) return lyrics;
    } catch { /* Try the next exact-metadata result. */ }
  }
  return null;
}

async function findLyricsOvh(title, artists, signal, fetchImpl) {
  for (const artist of artists) {
    const url = `${LYRICS_OVH_API}/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    const response = await request(url, 'lyrics.ovh', signal, fetchImpl);
    const text = typeof response?.lyrics === 'string' ? response.lyrics.trim() : '';
    if (text && parseLyrics(text).lines.length) {
      return {
        name: `${title} — ${artist}`,
        source: 'lyrics.ovh',
        sourceUrl: 'https://lyrics.ovh',
        text,
      };
    }
  }
  return null;
}

async function findLyrist(title, artists, signal, fetchImpl) {
  for (const artist of artists) {
    const url = `${'https://lyrist.vercel.app/api'}/${encodeURIComponent(title)}/${encodeURIComponent(artist)}`;
    const result = await request(url, 'Lyrist', signal, fetchImpl, 'json', 5000);
    const text = typeof result?.lyrics === 'string' ? result.lyrics.trim() : '';
    if (text && parseLyrics(text).lines.length) {
      return {
        name: `${result.title || title} — ${result.artist || artist}`,
        source: result.source ? `Lyrist (${result.source})` : 'Lyrist',
        sourceUrl: 'https://github.com/asrvd/lyrist',
        text,
      };
    }
  }
  return null;
}

// Lookups run only when the user taps Download. Try Spicy Lyrics first, then
// other word-timed sources, LRCLIB, and plain text.
export async function downloadLyricsForTrack(track, { fetchImpl = fetch, signal, spotifyUrl } = {}) {
  const originalTitle = String(track?.title || '').trim();
  const title = cleanTitle(originalTitle);
  const artist = String(track?.artist || '').trim();
  if (!title || !artist || /^unknown artist$/i.test(artist)) return null;
  const artists = artistCandidates(artist);
  const normalizedTrack = { ...track, durationSeconds: Number(track.durationSeconds) || 0 };
  const normalizedSpotifyUrl = normalizeSpotifyTrackUrl(spotifyUrl);
  const failures = [];
  const fallbackLyrics = [];
  try {
    const spicyLyrics = await findSpicyLyrics(normalizedTrack, title, artists, normalizedSpotifyUrl, signal, fetchImpl);
    if (spicyLyrics && hasWords(spicyLyrics)) return spicyLyrics;
    if (spicyLyrics) fallbackLyrics.push(spicyLyrics);
  } catch (error) {
    if (signal?.aborted) throw error;
    failures.push(error);
  }
  try {
    const liriQoLyrics = await findLiriQo(normalizedTrack, title, artists, normalizedSpotifyUrl, signal, fetchImpl);
    if (liriQoLyrics && hasWords(liriQoLyrics)) return liriQoLyrics;
    if (liriQoLyrics) fallbackLyrics.push(liriQoLyrics);
  } catch (error) {
    if (signal?.aborted) throw error;
    failures.push(error);
  }
  try {
    const wordTimed = await findLyricsDb(normalizedTrack, title, artists, signal, fetchImpl);
    if (wordTimed) return wordTimed;
  } catch (error) {
    if (signal?.aborted) throw error;
    failures.push(error);
  }
  try {
    const wordTimed = await findLrcRed(normalizedTrack, title, artists, signal, fetchImpl);
    if (wordTimed) return wordTimed;
  } catch (error) {
    if (signal?.aborted) throw error;
    failures.push(error);
  }
  try {
    const lrclibLyrics = await findLrclib(normalizedTrack, title, artists, signal, fetchImpl);
    if (lrclibLyrics && hasWords(lrclibLyrics)) return lrclibLyrics;
    if (lrclibLyrics) fallbackLyrics.push(lrclibLyrics);
  } catch (error) {
    if (signal?.aborted) throw error;
    failures.push(error);
  }
  try {
    const plainLyrics = await findLyricsOvh(title, artists, signal, fetchImpl);
    if (plainLyrics) fallbackLyrics.push(plainLyrics);
  } catch (error) {
    if (signal?.aborted) throw error;
    failures.push(error);
  }
  try {
    const hostedLyrics = await findLyrist(title, artists, signal, fetchImpl);
    if (hostedLyrics) fallbackLyrics.push(hostedLyrics);
  } catch (error) {
    if (signal?.aborted) throw error;
    failures.push(error);
  }
  if (failures.length >= 2 && failures.every((error) => /internet connection|timed out|busy\./i.test(error.message))) {
    throw new Error('Could not reach the lyric services. Check your internet connection and try again.');
  }
  if (!fallbackLyrics.length && failures.some((error) => /Spicy Lyrics request failed \((?:401|403)\)/i.test(error.message))) {
    throw new Error('Spicy Lyrics mobile access is not enabled for this key.');
  }
  return fallbackLyrics.sort((a, b) => lyricsQuality(b) - lyricsQuality(a))[0] || null;
}

export function parseLyricsfile(text) {
  if (typeof text !== 'string' || text.length > 500000) return null;
  try {
    const data = load(text, { schema: JSON_SCHEMA });
    if (!data || !Array.isArray(data.lines) || data.lines.length > 5000) return null;
    const validTime = (value) => Number.isInteger(value) && value >= 0;
    const lines = data.lines.filter((line) => line && typeof line.text === 'string' && validTime(line.start_ms)).map((line) => {
      const words = Array.isArray(line.words) ? line.words.filter((word) => word && typeof word.text === 'string'
        && word.text.trim() && validTime(word.start_ms)).map((word) => ({
        word: word.text.trim(), start: word.start_ms / 1000,
        ...(validTime(word.end_ms) ? { end: word.end_ms / 1000 } : {}),
      })).sort((a, b) => a.start - b.start) : [];
      return { time: line.start_ms / 1000, text: line.text.trim() || '♪',
        ...(validTime(line.end_ms) && line.end_ms > line.start_ms ? { end: line.end_ms / 1000 } : {}),
        ...(words.length ? { words } : {}),
      };
    }).sort((a, b) => a.time - b.time);
    return lines.length ? { synced: true, lines } : null;
  } catch { return null; }
}

export function lyricsFromRecord(record, source = 'LRCLIB') {
  const metadata = {
    name: `${record.trackName || record.title || 'Lyrics'} — ${record.artistName || record.artist || 'Unknown artist'}`,
    source,
    sourceUrl: source === 'lrc.red' ? 'https://lrc.red' : source === 'LyricsDB' ? 'https://lyricsdb.kollod.dev' : 'https://lrclib.net',
    sourceId: record.id || record.isrc,
  };
  const parsed = parseLyricsfile(record.lyricsfile);
  if (parsed?.lines?.length) return { ...metadata, text: record.lyricsfile, format: 'lyricsfile', parsed };
  const text = record.syncedLyrics?.trim();
  if (text && parseLyrics(text).lines.length) return { ...metadata, text };
  const plain = record.plainLyrics?.trim();
  if (plain && parseLyrics(plain).lines.length) return { ...metadata, text: plain };
  throw new Error('This recording has no usable lyrics.');
}
