import { readGeneratedLyrics } from './generatedLyricsCache';
import { loadLyrics } from './lyricsStorage';
import { getOfflineLyricsStatus, transcribeOffline } from './offlineLyrics';
import { getServerStatus, transcribeViaServer } from './serverTranscription';

/** Prepare lyrics locally when available, otherwise use the configured LAN server. */
export async function batchTranscribeTracks(tracks, libraryId, onProgress = () => {}, cancelToken = null) {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return { total: 0, processed: 0, skipped: 0, errors: 0 };
  }

  const total = tracks.length;
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  let engineStatus;
  let useServer = false;

  for (let i = 0; i < total; i++) {
    if (cancelToken?.cancelled) break;

    const track = tracks[i];
    const trackNum = i + 1;
    const title = track.title || track.name || `Song ${trackNum}`;

    try {
      const manual = await loadLyrics(libraryId, track.id);
      if (manual && !manual.generated) {
        skipped++;
        onProgress({ stage: 'transcribing', current: trackNum, total, track, progress: 1, message: `Lyrics already saved for "${title}" (${trackNum}/${total})` });
        continue;
      }
      const cached = await readGeneratedLyrics(track, libraryId);
      if (cached) {
        skipped++;
        onProgress({ stage: 'transcribing', current: trackNum, total, track, progress: 1, message: `Lyrics already ready for "${title}" (${trackNum}/${total})` });
        continue;
      }
    } catch { /* Continue and try local Whisper. */ }

    engineStatus ??= await getOfflineLyricsStatus();
    if (!engineStatus.ready) {
      const serverStatus = await getServerStatus();
      if (serverStatus.ready) {
        useServer = true;
        engineStatus = serverStatus;
      } else {
        const message = `${engineStatus.message} ${serverStatus.message}`;
        onProgress({ stage: 'notice', message });
        return { total, processed, skipped: skipped + total - i, errors, unavailable: true, message };
      }
    }
    onProgress({
      stage: 'transcribing', current: trackNum, total, track, progress: 0,
      message: `${useServer ? 'Preparing lyrics on your computer' : 'Generating offline lyrics'} for "${title}" (${trackNum}/${total})...`,
    });

    try {
      const transcribe = useServer ? transcribeViaServer : transcribeOffline;
      await transcribe(track, {
        cancelToken,
        libraryId,
        onStage: (stage) => onProgress({ stage: 'transcribing', current: trackNum, total, track, progress: 0.1, message: `${stage || 'Getting lyrics'} for "${title}" (${trackNum}/${total})...` }),
        onProgress: (progress) => onProgress({ stage: 'transcribing', current: trackNum, total, track, progress, message: `${useServer ? 'Preparing lyrics' : 'Getting lyrics'} for "${title}" (${Math.round(progress * 100)}%)` }),
      });
      processed++;
    } catch (error) {
      if (error?.code === 'CANCELLED' || cancelToken?.cancelled) break;
      if (error?.code === 'TOO_LONG') {
        skipped++;
        onProgress({ stage: 'transcribing', current: trackNum, total, track, progress: 1, message: `"${title}" was skipped (${useServer ? 'server' : 'offline device'} duration limit).` });
        continue;
      }
      // An unsupported build must not retry loading native code for every song.
      if (error?.code === 'OFFLINE_UNAVAILABLE') {
        skipped += (total - i);
        onProgress({ stage: 'notice', message: error.message });
        return { total, processed, skipped, errors, unavailable: true, message: error.message };
      }
      errors++;
      onProgress({ stage: 'transcribing', current: trackNum, total, track, progress: 1, message: `Could not prepare lyrics for "${title}": ${error?.message || error}` });
      console.warn(`Could not prepare lyrics for "${title}":`, error?.message || error);
    }
  }

  return { total, processed, skipped, errors };
}
