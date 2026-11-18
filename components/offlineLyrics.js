import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform, TurboModuleRegistry } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { readGeneratedLyrics, writeGeneratedLyrics, lyricsCacheIdentity } from './generatedLyricsCache';
import { localAudioUri, monoChunk, MAX_LYRIC_AUDIO_SECONDS, TRANSCRIPTION_SAMPLE_RATE } from './transcriptionUtils';
import { appendOfflineSegments } from './offlineLyricsSegments';
import { detectWhisperLanguage } from './whisperLanguage';

const UNAVAILABLE_MESSAGE = 'This app build cannot generate offline lyrics. Install a rebuilt MistleTunes APK with ExecuTorch, Audio API, and the bundled Whisper model. Your music and saved lyrics are still available.';
let unavailableMessage = null;
let serial = Promise.resolve();
const pending = new Map();
export async function getOfflineLyricsStatus() {
  if (Platform.OS === 'web') return { ready: false, message: 'New lyrics are generated offline in the installed MistleTunes Android or iOS app. Saved and imported lyrics still work here.' };
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return { ready: false, message: 'Your songs are ready. Automatic offline lyrics need a new MistleTunes APK with the bundled Whisper model. Expo Go can display saved or imported lyrics.' };
  if (unavailableMessage) return { ready: false, message: unavailableMessage };
  // Check the native binary before evaluating either library's entry point.
  // Legacy Whisper uses ETInstaller; the new root API uses RnExecutorch.
  try {
    if (!TurboModuleRegistry.get('ETInstaller') || !TurboModuleRegistry.get('AudioAPIModule')) {
      return { ready: false, message: UNAVAILABLE_MESSAGE };
    }
  } catch {
    return { ready: false, message: UNAVAILABLE_MESSAGE };
  }
  return { ready: true };
}
// Only bundled numeric asset references are accepted. Remote URLs, including Metro
// model URLs, are rejected. Numeric sources also bypass ExecuTorch download telemetry.
export const offlineModelFetcher = {
  async fetch(progress, ...sources) {
    const directory = FileSystem.documentDirectory + 'OfflineWhisper/';
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const paths = [];
    for (const source of sources) {
      if (typeof source !== 'number') throw new Error('Offline Whisper only accepts models bundled in the APK.');
      const asset = Asset.fromModule(source);
      const destination = directory + (asset.hash || asset.name) + '.' + asset.type;
      const existing = await FileSystem.getInfoAsync(destination);
      if (!existing.exists || existing.size === 0) {
        let uri = asset.localUri || asset.uri;
        if (!uri || /^https?:/i.test(uri)) throw Object.assign(new Error('The Whisper model is not embedded in this build. Install the rebuilt MistleTunes APK to generate lyrics without internet.'), { code: 'OFFLINE_UNAVAILABLE' });
        if (uri.startsWith('file:///android_res/')) {
          // ExpoAsset extracts Android resources locally; the remote URL guard above
          // ensures this operation cannot request a server.
          await asset.downloadAsync();
          uri = asset.localUri;
        }
        if (!uri || (/^[a-z]+:/i.test(uri) && !/^(file|asset):/i.test(uri))) throw new Error('The offline model is not a local bundled resource.');
        const temporary = destination + '.part';
        try {
          await FileSystem.copyAsync({ from: uri, to: temporary });
          await FileSystem.moveAsync({ from: temporary, to: destination });
        } finally { await FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => {}); }
      }
      paths.push(destination.replace(/^file:\/\//, ''));
    }
    progress?.(1);
    return { paths, wasDownloaded: paths.map(() => false) };
  },
  readAsString(path) { return FileSystem.readAsStringAsync(path.startsWith('file://') ? path : 'file://' + path); },
};
export function transcribeOffline(track, options = {}) {
  const key = JSON.stringify([options.libraryId, track.id, track.source, !!options.force]);
  if (pending.has(key)) return pending.get(key);
  const job = serial.then(() => generate(track, options));
  serial = job.catch(() => {});
  pending.set(key, job);
  job.finally(() => pending.delete(key)).catch(() => {});
  return job;
}
async function generate(track, { libraryId, force = false, onStage, onProgress, cancelToken } = {}) {
  if (!force) {
    const cached = await readGeneratedLyrics(track, libraryId);
    if (cached) return cached.segments;
  }
  const status = await getOfflineLyricsStatus();
  if (!status.ready) throw Object.assign(new Error(status.message), { code: 'OFFLINE_UNAVAILABLE' });
  const checkCancelled = () => { if (cancelToken?.cancelled) throw Object.assign(new Error('Lyrics generation cancelled.'), { code: 'CANCELLED' }); };
  checkCancelled();
  const uri = localAudioUri(track.source || track.uri);
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new Error('The local song file is no longer available.');
  if ((info.size || 0) > 64 * 1024 * 1024 || track.duration > MAX_LYRIC_AUDIO_SECONDS) throw Object.assign(new Error('This song is too large for offline lyrics on this device (limit: 8 minutes / 64 MB).'), { code: 'TOO_LONG' });
  let model;
  try {
    onStage?.('Loading bundled offline Whisper?'); onProgress?.(0.02);
    // Deliberately lazy: Expo Go must not initialize either native library.
    let runtime;
    let bundledWhisper;
    try {
      runtime = require('react-native-executorch/legacy');
      if (runtime.isAvailable === false || typeof runtime.initExecutorch !== 'function' || typeof runtime.SpeechToTextModule?.fromModelName !== 'function') {
        throw new Error('The legacy Whisper runtime is unavailable.');
      }
      // Use the same model contract and filenames as the EAS model setup hook.
      ({ bundledWhisper } = require('../assets/models'));
      if (!bundledWhisper) throw new Error('Whisper is not bundled.');
    } catch {
      unavailableMessage = UNAVAILABLE_MESSAGE;
      throw Object.assign(new Error(unavailableMessage), { code: 'OFFLINE_UNAVAILABLE' });
    }
    const { initExecutorch, SpeechToTextModule } = runtime;
    initExecutorch({ resourceFetcher: offlineModelFetcher });
    model = await SpeechToTextModule.fromModelName(bundledWhisper);
    checkCancelled();
    onStage?.('Decoding local audio?'); onProgress?.(0.08);
    const { OfflineAudioContext } = require('react-native-audio-api');
    // This decoder never opens a second output session or changes the music player.
    const decoder = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: TRANSCRIPTION_SAMPLE_RATE });
    const buffer = await decoder.decodeAudioData(uri);
    if (!buffer.length || buffer.duration > MAX_LYRIC_AUDIO_SECONDS) throw Object.assign(new Error('Offline lyrics support songs up to 8 minutes.'), { code: 'TOO_LONG' });
    const segments = [];
    const chunkSize = 28 * TRANSCRIPTION_SAMPLE_RATE;
    const { paths: [tokenizerPath] } = await offlineModelFetcher.fetch(null, bundledWhisper.tokenizerSource);
    const tokenizer = JSON.parse(await offlineModelFetcher.readAsString(tokenizerPath));
    let language;
    for (let start = 0; start < buffer.length; start += chunkSize) {
      checkCancelled();
      onStage?.('Generating offline lyrics? ' + Math.floor(start / buffer.sampleRate) + 's / ' + Math.ceil(buffer.duration) + 's');
      const pcm = monoChunk(buffer, start, chunkSize);
      if (!language) language = await detectWhisperLanguage(model, pcm, tokenizer);
      checkCancelled();
      const result = await model.transcribe(pcm, { verbose: true, ...(language ? { language } : {}) });
      if (result.text?.trim() && !Array.isArray(result.segments)) throw new Error('The offline model returned text without timestamps. No estimated timings were saved.');
      appendOfflineSegments(segments, result, start / TRANSCRIPTION_SAMPLE_RATE, pcm.length / TRANSCRIPTION_SAMPLE_RATE);
      if (result.language && result.language !== 'unknown') language = result.language;
      onProgress?.(0.1 + 0.85 * Math.min(1, (start + pcm.length) / buffer.length));
    }
    checkCancelled();
    onStage?.('Saving lyrics on this device?');
    await writeGeneratedLyrics(await lyricsCacheIdentity(track, libraryId), { segments, language: language || 'unknown', source: bundledWhisper.version, timingVersion: bundledWhisper.version, alignment: 'whisper-acoustic-offline' }, track.id, libraryId);
    onProgress?.(1);
    return segments;
  } catch (error) {
    if (/native module|TurboModule|install.*module|not.*install/i.test(error?.message || '')) {
      unavailableMessage = UNAVAILABLE_MESSAGE;
      throw Object.assign(new Error(unavailableMessage), { code: 'OFFLINE_UNAVAILABLE' });
    }
    throw error;
  } finally { model?.delete(); }
}
