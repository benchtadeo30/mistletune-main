import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
const parserSource = await readFile(new URL('../components/lyricsParser.js', import.meta.url), 'utf8');
const { parseLyrics } = await import(`data:text/javascript;base64,${Buffer.from(parserSource).toString('base64')}`);
const source = (await readFile(new URL('../components/lyricsStorage.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '');
const disk = new Map();
const storage = {
  getItem: async (key) => disk.get(key), setItem: async (key, value) => disk.set(key, value),
  removeItem: async (key) => disk.delete(key), getAllKeys: async () => [...disk.keys()],
  multiRemove: async (keys) => keys.forEach((key) => disk.delete(key)),
};
const open = () => new Function('AsyncStorage', 'parseLyrics', `${source}; return { saveLyrics, loadLyrics, removeLyrics, clearLibraryLyrics };`)(storage, parseLyrics);

test('downloaded word timings survive restart, replacement and library isolation', async () => {
  const saved = { text: 'yaml', source: 'LRCLIB', sourceId: 5, format: 'lyricsfile', parsed: {
    synced: true, lines: [{ time: 1, text: 'Hello', words: [{ word: 'Hello', start: 1, end: 2 }] }],
  } };
  await open().saveLyrics('a', 'song', saved);
  assert.deepEqual((await open().loadLyrics('a', 'song')).lines, saved.parsed.lines);
  assert.equal(await open().loadLyrics('b', 'song'), null);
  await open().saveLyrics('a', 'song', { text: '[00:02]Replacement', name: 'Own LRC' });
  assert.equal((await open().loadLyrics('a', 'song')).lines[0].text, 'Replacement');
  await assert.rejects(open().saveLyrics('a', 'song', { text: '' }), /empty/);
  assert.equal((await open().loadLyrics('a', 'song')).lines[0].text, 'Replacement');
  await open().removeLyrics('a', 'song');
  assert.equal(await open().loadLyrics('a', 'song'), null);
});

test('clearing a library removes its downloaded lyrics and offsets only', async () => {
  await open().saveLyrics('a', 'song', { text: 'A' });
  await open().saveLyrics('b', 'song', { text: 'B' });
  disk.set('music-player.lyric-offset-ms:a:song', '250');
  await open().clearLibraryLyrics('a');
  assert.equal(await open().loadLyrics('a', 'song'), null);
  assert.equal(disk.has('music-player.lyric-offset-ms:a:song'), false);
  assert.equal((await open().loadLyrics('b', 'song')).lines[0].text, 'B');
});
