import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
const source = await readFile(new URL('../components/syncedLyricsUtils.js', import.meta.url), 'utf8');
const { activeSegmentIndex, importedSegments, lyricBoundaries, lyricTimeAt } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const segments = [{ start: 2, end: 4, text: 'A' }, { start: 7, end: 10, text: 'B' }];
test('word spacing follows the downloaded line while preserving syllable timing and pauses', () => {
  const line = { time: 1, end: 5, text: 'Golden sky!', words: [
    { word: 'Gol', start: 1, end: 1.5 }, { word: 'den', start: 1.5, end: 2 },
    { word: 'sky!', start: 4, end: 5 },
  ] };
  assert.deepEqual(importedSegments([line], 5)[0].words, [
    { word: 'Golden', start: 1, end: 2 }, { word: 'sky!', start: 4, end: 5 },
  ]);
  const cached = { ...line, words: [{ word: 'Goldensky!', start: 1, end: 5 }] };
  const repaired = importedSegments([cached], 5)[0];
  assert.deepEqual(repaired.words.map(word => word.word), ['Golden', 'sky!']);
  assert.equal(repaired.words[0].end, repaired.words[1].start);
  assert.equal(repaired.words[1].end, 5);
  assert.equal(repaired.wordTimingEstimated, true);
});
test('timestamp boundaries and instrumental gaps do not retain a stale highlighted line', () => {
  assert.equal(activeSegmentIndex(segments, 0), -1);
  assert.equal(activeSegmentIndex(segments, 2), 0);
  assert.equal(activeSegmentIndex(segments, 4), -1);
  assert.equal(activeSegmentIndex(segments, 5), -1);
  assert.equal(activeSegmentIndex(segments, 10.1), -1);
});

test('word boundaries preserve vocal gaps, rapid words, and backward seeks', () => {
  const timed = [{ start: 3, end: 5, words: [
    { word: 'A', start: 3, end: 3.08 },
    { word: 'B', start: 3.08, end: 3.2 },
    { word: 'C', start: 4.5, end: 5 },
  ] }];
  const boundaries = lyricBoundaries(timed);
  assert.equal(lyricTimeAt(boundaries, 2.9), 0);
  assert.equal(lyricTimeAt(boundaries, 3.079), 3);
  assert.equal(lyricTimeAt(boundaries, 3.08), 3.08);
  assert.equal(lyricTimeAt(boundaries, 4), 3.2);
  assert.equal(lyricTimeAt(boundaries, 5), 5);
  assert.equal(lyricTimeAt(boundaries, 3.1), 3.08);
});

const karaokeSource = await readFile(new URL('../components/karaokeTiming.js', import.meta.url), 'utf8');
const { startNativeLyricClock, effectiveLyricTimeMs, wordSweepProgress, lyricTapPositionMs } = await import(`data:text/javascript;base64,${Buffer.from(karaokeSource).toString('base64')}`);
test('native clock follows pause, buffering, backward seeks and repeat without React state', () => {
  let displayed;
  let nextFrame;
  let cancelled;
  const player = { currentTime: 7.5 };
  const stop = startNativeLyricClock(player, (ms) => { displayed = ms; }, (fn) => { nextFrame = fn; return 42; }, (id) => { cancelled = id; });
  assert.equal(displayed, 7500);
  nextFrame();
  assert.equal(displayed, 7500);
  player.currentTime = 3;
  nextFrame();
  assert.equal(displayed, 3000);
  player.currentTime = 0;
  nextFrame();
  assert.equal(displayed, 0);
  stop();
  assert.equal(cancelled, 42);
  player.currentTime = 99;
  nextFrame();
  assert.equal(displayed, 0);
});
test('earlier correction, lookahead, seek inverse and continuous sweep agree', () => {
  assert.equal(effectiveLyricTimeMs(1000, -150), 1200);
  assert.equal(effectiveLyricTimeMs(1000, 150), 900);
  const tap = lyricTapPositionMs(2000, -150);
  assert.equal(effectiveLyricTimeMs(tap, -150), 2000);
  assert.equal(wordSweepProgress(1999, 2000, 2400), 0);
  assert.equal(wordSweepProgress(2200, 2000, 2400), 0.5);
  assert.equal(wordSweepProgress(2500, 2000, 2400), 1);
  assert.equal(wordSweepProgress(2200, 2000, 2000), 0);
});
test('seeking backward or forward recomputes the active line without playback history', () => {
  assert.equal(activeSegmentIndex(segments, 9), 1);
  assert.equal(activeSegmentIndex(segments, 3), 0);
  assert.equal(activeSegmentIndex(segments, 8), 1);
  assert.equal(activeSegmentIndex([], 5), -1);
  assert.equal(activeSegmentIndex(segments, NaN), -1);
});
test('imported LRC keeps timestamps and estimates karaoke words through track duration', () => {
  const result = importedSegments([{ time: 1, text: 'A' }, { time: 3, text: 'B' }], 7);
  assert.deepEqual(result.map(({ start, end, text }) => ({ start, end, text })), [{ start: 1, end: 3, text: 'A' }, { start: 3, end: 7, text: 'B' }]);
  assert.deepEqual(result[0].words, [{ word: 'A', start: 1, end: 3, estimated: true }]);
  assert.deepEqual(result[1].words, [{ word: 'B', start: 3, end: 7, estimated: true }]);
});

test('supplied word ends preserve vocal silence and line-only lyrics get estimated timings', () => {
  const result = importedSegments([
    { time: 2, end: 5, text: 'One two', words: [{ word: 'One', start: 2, end: 2.5 }, { word: 'two', start: 4, end: 5 }] },
    { time: 5, text: '♪' }, { time: 7, text: 'A longer word' },
  ], 10);
  assert.equal(result[0].words[0].end, 2.5);
  assert.equal(result[1].words, undefined);
  assert.deepEqual(result[2].words.map(({ word }) => word), ['A', 'longer', 'word']);
  assert.equal(result[2].wordTimingEstimated, true);
  assert.equal(result[2].start, 7);
  assert.equal(result[2].end, 10);
});

test('duplicate timestamps and unknown duration never produce invalid word intervals', () => {
  const result = importedSegments([{ time: 1, text: 'A' }, { time: 1, text: 'B' }, { time: 5, text: 'Last line' }], 0);
  assert.ok(result.every((line) => line.end > line.start));
  assert.ok(result.at(-1).words.every((word) => word.end > word.start));
});

test('per-song delay correction advances lyrics and keeps lyric taps aligned', () => {
  const offsetMs = -2150;
  const lookaheadMs = 50;
  assert.equal(effectiveLyricTimeMs(12000, offsetMs, lookaheadMs), 14200);
  const audioPosition = lyricTapPositionMs(30000, offsetMs, lookaheadMs);
  assert.equal(audioPosition, 27800);
  assert.equal(effectiveLyricTimeMs(audioPosition, offsetMs, lookaheadMs), 30000);
  assert.equal(effectiveLyricTimeMs(12000, 850, lookaheadMs), 11200);
});
