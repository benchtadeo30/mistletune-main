import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { downloadLyricsForTrack, normalizeSpotifyTrackUrl } from './onlineLyrics';
import { saveLyrics } from './lyricsStorage';
import { importedSegments } from './syncedLyricsUtils';

export default function LyricsSearch({ track, libraryId, duration, onCancel, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [spotifyUrl, setSpotifyUrl] = useState('');
  const [allowLinkSearch, setAllowLinkSearch] = useState(false);
  const latest = useRef(null);
  useEffect(() => {
    latest.current = { track, libraryId, duration, onSaved, spotifyUrl };
  }, [duration, libraryId, onSaved, spotifyUrl, track]);

  const search = useCallback(async (signal) => {
    await Promise.resolve();
    if (signal.aborted) return;
    const current = latest.current;
    setLoading(true);
    setMessage('Searching online for lyrics…');
    try {
      const result = await downloadLyricsForTrack({ ...current.track, durationSeconds: current.track.durationSeconds || current.duration }, { signal, spotifyUrl: current.spotifyUrl });
      if (signal.aborted) return;
      if (!result) {
        setMessage('No source has a matching lyric record for this song yet. Check the title and artist tags, or try again later.');
        setAllowLinkSearch(true);
        return;
      }
      const saved = await saveLyrics(current.libraryId, current.track.id, result);
      if (!signal.aborted) {
        const hasWordTiming = Boolean(saved.segments?.some((segment) => segment.words?.length)
          || importedSegments(saved.lines || [], current.track?.durationSeconds || current.duration).some((segment) => segment.words?.length));
        current.onSaved(saved, { keepOpen: !hasWordTiming });
        if (!hasWordTiming) {
          setMessage('Lyrics were saved, but this match has no word timing. Paste the Spotify track link to retry for karaoke timing.');
          setAllowLinkSearch(true);
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        setMessage(error.message || 'Could not download lyrics. Check your internet connection.');
        setAllowLinkSearch(true);
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => { void search(controller.signal); }, 0);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt, search]);

  return <View style={styles.panel}>
    {loading ? <ActivityIndicator color="#f4d683" /> : null}
    <Text accessibilityRole="text" style={styles.message}>{message}</Text>
    {!loading ? <Pressable accessibilityRole="button" onPress={() => setAttempt((value) => value + 1)} style={styles.button}>
      <Text style={styles.buttonText}>Try again</Text>
    </Pressable> : null}
    {allowLinkSearch && !loading ? <>
      <Text style={styles.hint}>Or paste the Spotify track link to improve the match.</Text>
      <TextInput
        accessibilityLabel="Spotify track link"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={setSpotifyUrl}
        placeholder="https://open.spotify.com/track/..."
        placeholderTextColor="#b6c7b2"
        value={spotifyUrl}
        style={styles.input}
      />
      <Pressable accessibilityRole="button" disabled={!normalizeSpotifyTrackUrl(spotifyUrl)} onPress={() => setAttempt((value) => value + 1)} style={[styles.button, !normalizeSpotifyTrackUrl(spotifyUrl) && styles.disabledButton]}>
        <Text style={styles.buttonText}>Search Spotify link</Text>
      </Pressable>
    </> : null}
    <Pressable accessibilityRole="button" onPress={onCancel} style={styles.cancel}>
      <Text style={styles.cancelText}>Close</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  panel: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, paddingHorizontal: 12 },
  message: { color: '#fff5d7', textAlign: 'center', lineHeight: 22 },
  button: { minHeight: 44, minWidth: 130, borderRadius: 22, backgroundColor: '#f4d683', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18 },
  buttonText: { color: '#153f2e', fontWeight: '800' },
  cancel: { minHeight: 44, minWidth: 90, justifyContent: 'center', alignItems: 'center' },
  cancelText: { color: '#f0d586', fontWeight: '700' },
  hint: { color: '#fff5d7', textAlign: 'center', fontSize: 13 },
  input: { width: '100%', minHeight: 48, borderRadius: 12, paddingHorizontal: 14, color: '#fff5d7', backgroundColor: '#173c2d', borderWidth: 1, borderColor: '#c6aa55' },
  disabledButton: { opacity: 0.45 },
});
