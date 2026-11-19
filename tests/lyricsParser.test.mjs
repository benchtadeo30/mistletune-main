import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = await readFile(new URL('../components/lyricsParser.js', import.meta.url), 'utf8');
const { parseLyrics, activeLyricIndex } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('LRC sorts timestamps, supports repeated lines and fractional seconds', () => {
  const lyrics = parseLyrics('[ar:Test artist]\n[00:20.500]Winter lights\n[00:01.25][00:10.250]A festive tune');
  assert.equal(lyrics.synced, true);
  assert.deepEqual(lyrics.lines.map((line) => line.time), [1.25, 10.25, 20.5]);
  assert.equal(lyrics.lines[0].text, 'A festive tune');
  assert.equal(lyrics.lines[1].text, 'A festive tune');
});

test('active line follows playback in both directions and before the first line', () => {
  const { lines } = parseLyrics('[00:05]First\n[00:10]Second\n[00:20]Third');
  assert.equal(activeLyricIndex(lines, 0), -1);
  assert.equal(activeLyricIndex(lines, 10), 1);
  assert.equal(activeLyricIndex(lines, 25), 2);
  assert.equal(activeLyricIndex(lines, 6), 0);
});

test('plain text stays untimed and preserves Unicode', () => {
  const lyrics = parseLyrics('\uFEFFMaligayang Pasko\r\n\r\nAwit natin');
  assert.equal(lyrics.synced, false);
  assert.deepEqual(lyrics.lines, [{ time: null, text: 'Maligayang Pasko' }, { time: null, text: 'Awit natin' }]);
});

test('offsets, instrumental gaps, and empty files', () => {
  assert.deepEqual(parseLyrics('[offset:-500]\n[00:01.00]\n[00:02]Sing').lines, [{ time: 0.5, text: '♪' }, { time: 1.5, text: 'Sing' }]);
  assert.deepEqual(parseLyrics('[ar:Artist]\n\n').lines, []);
  assert.equal(activeLyricIndex([], 5), -1);
});

test('enhanced LRC preserves word timestamps, offsets and repeated lines', () => {
  const result = parseLyrics('[offset:-250]\n[00:02][00:12]<00:02>Hello <00:03.50>world<00:04.00>');
  assert.equal(result.lines[0].text, 'Hello world');
  assert.deepEqual(result.lines[0].words, [
    { word: 'Hello', start: 1.75, end: 3.25 },
    { word: 'world', start: 3.25, end: 3.75 },
  ]);
  assert.deepEqual(result.lines[1].words.map((word) => word.start), [11.75, 13.25]);
});
