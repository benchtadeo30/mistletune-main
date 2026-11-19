import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import { load, JSON_SCHEMA } from 'js-yaml';
const parser = await readFile(new URL('../components/lyricsParser.js', import.meta.url), 'utf8');
const { parseLyrics } = await import(`data:text/javascript;base64,${Buffer.from(parser).toString('base64')}`);
const source = (await readFile(new URL('../components/onlineLyrics.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '');
const service = () => new Function('load', 'JSON_SCHEMA', 'parseLyrics', `${source}; return {
  downloadLyricsForTrack, lyricsFromRecord, parseLyricsfile, normalizeSpotifyTrackUrl,
};`)(load, JSON_SCHEMA, parseLyrics);
const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
});
const lineRecord = { id: 1, trackName: 'Test', artistName: 'Artist', duration: 100, syncedLyrics: '[00:02]A test line' };
const karaokeRecord = { ...lineRecord, syncedLyrics: '[00:02]<00:02>A <00:03>test <00:04>line<00:05>' };

test('download searches with track metadata and chooses the closest LRCLIB recording', async () => {
  const requests = [];
  const result = await service().downloadLyricsForTrack({
    title: ' Test & More ', artist: ' Artist ', durationSeconds: 100,
  }, {
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      requests.push({ parsed, options });
      if (parsed.origin === 'https://lrclib.net' && parsed.pathname.endsWith('/get')) return response({}, 404);
      if (parsed.origin === 'https://lrclib.net' && parsed.pathname.endsWith('/search')) {
        return response([
          { ...karaokeRecord, id: 2, duration: 130 },
          { ...karaokeRecord, id: 1, duration: 100 },
        ]);
      }
      return response({}, 404);
    },
  });
  assert.equal(result.source, 'LRCLIB');
  assert.equal(result.sourceId, 1);
  const lrclibSearch = requests.find(({ parsed }) => parsed.origin === 'https://lrclib.net' && parsed.pathname.endsWith('/search'));
  assert.equal(lrclibSearch.parsed.searchParams.get('track_name'), 'Test & More');
  assert.equal(lrclibSearch.parsed.searchParams.get('artist_name'), 'Artist');
  assert.equal(lrclibSearch.options.body, undefined);
  assert.ok(lrclibSearch.options.headers['Lrclib-Client']);
});

test('no results, offline failures, malformed payloads and cancellation are recoverable', async () => {
  const { downloadLyricsForTrack } = service();
  assert.equal(await downloadLyricsForTrack({ title: 'Missing', artist: 'Artist' }, {
    fetchImpl: async () => response([], 200),
  }), null);
  await assert.rejects(downloadLyricsForTrack({ title: 'Test', artist: 'Artist' }, {
    fetchImpl: async () => { throw new TypeError('Network failed'); },
  }), /internet connection/);
  assert.equal(await downloadLyricsForTrack({ title: 'Test', artist: 'Artist' }, {
    fetchImpl: async (url) => new URL(url).origin === 'https://lrclib.net' ? response({ wrong: true }) : response({}, 404),
  }), null);

  const controller = new AbortController();
  const pending = downloadLyricsForTrack({ title: 'Test', artist: 'Artist' }, {
    signal: controller.signal,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
    }),
  });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('Lyricsfile word timing is kept and line-timed LRC remains a valid fallback', () => {
  const yaml = `version: '1.0'\nlines:\n  - text: Hello world\n    start_ms: 2000\n    end_ms: 5000\n    words:\n      - text: 'Hello '\n        start_ms: 2000\n        end_ms: 2500\n      - text: world\n        start_ms: 4000\n        end_ms: 5000\n`;
  const { lyricsFromRecord, parseLyricsfile } = service();
  const saved = lyricsFromRecord({ ...lineRecord, lyricsfile: yaml });
  assert.equal(saved.format, 'lyricsfile');
  assert.equal(saved.source, 'LRCLIB');
  assert.deepEqual(saved.parsed.lines[0].words, [
    { word: 'Hello', start: 2, end: 2.5 }, { word: 'world', start: 4, end: 5 },
  ]);
  assert.equal(parseLyricsfile('lines: [broken'), null);
  assert.equal(lyricsFromRecord({ ...karaokeRecord, lyricsfile: 'lines: [broken' }).text, karaokeRecord.syncedLyrics);
  assert.equal(lyricsFromRecord(lineRecord).text, lineRecord.syncedLyrics);
  assert.equal(lyricsFromRecord({ id: 8, plainLyrics: 'Just words' }).text, 'Just words');
});

test('Spotify links normalize to a track URL', () => {
  assert.equal(service().normalizeSpotifyTrackUrl('https://open.spotify.com/track/0123456789abcdefghijkl?si=abc'),
    'https://open.spotify.com/track/0123456789abcdefghijkl');
  assert.equal(service().normalizeSpotifyTrackUrl('https://example.com/song'), null);
});
