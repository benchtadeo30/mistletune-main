import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

const nlpSource = (await readFile(new URL('../components/nlpService.js', import.meta.url), 'utf8'))
  .replaceAll('export ', '');
const { chatWithNlp } = new Function(`${nlpSource}; return { chatWithNlp };`)();
const recommendationSource = (await readFile(new URL('../components/ollamaService.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '');
const { parseSongRecommendations } = new Function('AsyncStorage', 'chatWithNlp',
  `${recommendationSource}; return { parseSongRecommendations };`)(null, () => {});

const tracks = [
  { id: '1', title: 'Blue Skies', artist: 'Ed Sheeran', album: 'Blue Hour', albumArtist: 'Ed Sheeran', source: 'file:///blue.mp3' },
  { id: '2', title: 'Golden Day', artist: 'Ed Sheeran', album: 'Blue Hour', albumArtist: 'Ed Sheeran', source: 'file:///golden.mp3' },
  { id: '3', title: 'Quiet Night', artist: 'Ava Lane', album: 'Soft Sounds', albumArtist: 'Ava Lane', source: 'file:///quiet.mp3' },
];
const albums = [
  { id: 'album-blue', title: 'Blue Hour', artist: 'Ed Sheeran', tracks: tracks.slice(0, 2) },
  { id: 'album-soft', title: 'Soft Sounds', artist: 'Ava Lane', tracks: tracks.slice(2) },
];
const podcasts = [
  { id: 'pod-1', title: 'Science Today', author: 'Maya', description: 'Space and science news', uri: 'file:///science.mp4' },
];

test('finds and recommends a song by title', async () => {
  const reply = await chatWithNlp('play Blue Skies', tracks);
  assert.match(reply, /\[SONG: Blue Skies\]/);
});

test('finds songs by artist instead of treating the artist name as a song title', async () => {
  const reply = await chatWithNlp('play songs by Ed Sheeran', tracks);
  assert.match(reply, /\[SONG: Blue Skies\]/);
  assert.match(reply, /\[SONG: Golden Day\]/);
  assert.doesNotMatch(reply, /couldn.t find/i);
});

test('lists albums, plays a selected album, and lists its songs', async () => {
  const listed = await chatWithNlp('show all albums', tracks, null, [], [], albums);
  assert.match(listed, /\[ALBUM: Blue Hour\]/);
  assert.match(listed, /\[ALBUM: Soft Sounds\]/);

  const selected = await chatWithNlp('play album Blue Hour', tracks, null, [], [], albums);
  assert.match(selected, /\[ALBUM: Blue Hour\]/);

  const songs = await chatWithNlp('show songs in Blue Hour album', tracks, null, [], [], albums);
  assert.match(songs, /\[SONG: Blue Skies\]/);
  assert.match(songs, /\[SONG: Golden Day\]/);
});

test('finds podcast episodes and makes the result tappable', async () => {
  const reply = await chatWithNlp('play podcast Science Today', tracks, null, podcasts);
  assert.match(reply, /\[PODCAST: Science Today\]/);
  const recommendations = parseSongRecommendations(reply, podcasts.map((podcast) => ({ ...podcast, mediaType: 'podcast' })), albums);
  assert.equal(recommendations[0].type, 'podcast');
  assert.equal(recommendations[0].track.id, 'pod-1');
});

test('album recommendations resolve to the right album for the play button', () => {
  const recommendations = parseSongRecommendations('Tap [ALBUM: Blue Hour] to play.', tracks, albums);
  assert.equal(recommendations[0].type, 'album');
  assert.equal(recommendations[0].album.id, 'album-blue');
});
