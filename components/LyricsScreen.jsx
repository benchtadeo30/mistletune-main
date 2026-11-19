import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayback, usePlaybackTime } from './PlaybackContext';
import SongArtwork from './SongArtwork';
import { loadLyrics, removeLyrics } from './lyricsStorage';
import { deleteGeneratedLyrics } from './generatedLyricsCache';
import SyncedLyricsView from './SyncedLyricsView';
import { importedSegments } from './syncedLyricsUtils';
import { useThemeStyles } from '../themes/ThemeProvider';
import LyricsAttribution from './LyricsAttribution';
import LyricsSearch from './LyricsSearch';

const timeLabel = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export default function LyricsScreen({ onClose }) {
  const playback = usePlayback();
  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <LyricsContent key={`${playback.libraryId}:${playback.currentTrack?.id}`} {...playback} onClose={onClose} />
  </Modal>;
}

function LyricsContent({ currentTrack: track, libraryId, player, playing, togglePlayback, seekTo, lyricsRevision, onClose }) {
  const { currentTime, duration } = usePlaybackTime();
  const { styles, colors: COLORS } = useThemeStyles(createStyles, BASE_COLORS);
  const insets = useSafeAreaInsets();
  const [lyrics, setLyrics] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(null);
  const [searching, setSearching] = useState(false);
  const [editing, setEditing] = useState(false);
  const actionInProgress = useRef(false);
  const [seekWidth, setSeekWidth] = useState(0);
  const [previewPosition, setPreviewPosition] = useState(null);
  const mounted = useRef(true);
  const previewTimeout = useRef(null);
  const seekOrigin = useRef(null);
  const seekRequest = useRef(0);
  const displayedTime = previewPosition ?? currentTime;

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        if (!track || !libraryId) return;
        const manual = await loadLyrics(libraryId, track.id);
        const saved = manual && !manual.generated ? manual : null;
        if (mounted.current) { setLyrics(saved); setBusy(false); }
      } catch (err) { if (mounted.current) setError(err.message); }
      finally { if (mounted.current) setBusy(false); }
    })();
    return () => { mounted.current = false; clearTimeout(previewTimeout.current); };
  }, [libraryId, track, lyricsRevision]);

  useEffect(() => {
    if (previewPosition !== null && currentTime !== seekOrigin.current && Math.abs(currentTime - previewPosition) < 0.75) {
      const timeout = setTimeout(() => setPreviewPosition(null), 0);
      return () => clearTimeout(timeout);
    }
  }, [currentTime, previewPosition]);

  const seek = useCallback(async (seconds) => {
    const request = ++seekRequest.current;
    const target = Math.max(0, Math.min(duration || seconds, seconds));
    seekOrigin.current = currentTime;
    setPreviewPosition(target); // Highlight changes immediately, before native status returns.
    clearTimeout(previewTimeout.current);
    previewTimeout.current = setTimeout(() => { if (mounted.current) setPreviewPosition(null); }, 4000);
    try {
      await seekTo(target);
    } catch (err) {
      if (mounted.current) setError(err.message || 'Could not seek to this lyric.');
    } finally {
      if (mounted.current && request === seekRequest.current) {
        clearTimeout(previewTimeout.current);
        setPreviewPosition(null);
      }
    }
  }, [currentTime, duration, seekTo]);

  const remove = async () => {
    if (actionInProgress.current) return;
    actionInProgress.current = true;
    setEditing(true);
    try {
      await removeLyrics(libraryId, track.id);
      await deleteGeneratedLyrics(track, libraryId);
      if (mounted.current) setLyrics(null);
    } catch (err) { if (mounted.current) setError(err.message); }
    finally { actionInProgress.current = false; if (mounted.current) setEditing(false); }
  };

  const segments = useMemo(() => lyrics?.segments ?? (lyrics?.synced ? importedSegments(lyrics.lines, duration) : null), [lyrics, duration]);

  return <View style={[styles.screen, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
    <View style={styles.header}>
      <SongArtwork source={track?.artwork} style={styles.artwork} />
      <View style={styles.heading}><Text style={styles.title} numberOfLines={2}>{track?.title || 'Lyrics'}</Text><Text style={styles.artist}>{track?.artist || 'Unknown artist'}</Text></View>
      <Pressable accessibilityLabel="Close lyrics" onPress={onClose} hitSlop={12}><Ionicons name="close-circle" size={36} color="#fff5d7" /></Pressable>
    </View>
    <View style={styles.toolbar}>
      <Text style={styles.badge}><Ionicons name="musical-notes-outline" size={12} /> Lyrics</Text>
      {lyrics && <Pressable accessibilityRole="button" style={styles.toolbarButton} disabled={busy || editing} onPress={remove} accessibilityLabel="Remove lyrics"><Ionicons name="trash-outline" size={18} color="#e8d28a" /></Pressable>}
    </View>
    {error && <Text style={styles.error}>{error}</Text>}
    {searching ? <LyricsSearch track={track} libraryId={libraryId} duration={duration || track?.durationSeconds || 0}
      onCancel={() => setSearching(false)}
      onSaved={(saved, { keepOpen } = {}) => { setLyrics(saved); setError(null); if (!keepOpen) setSearching(false); }} />
      : busy || editing ? <View style={styles.empty}><ActivityIndicator color="#f4d683" /></View>
        : segments?.length ? <SyncedLyricsView segments={segments} player={player} currentTime={currentTime} previewPosition={previewPosition} onSeek={seek} attribution={lyrics?.attribution} />
          : lyrics?.lines?.length ? <ScrollView><Text style={styles.note}>These lyrics do not follow along with playback.</Text>{lyrics.lines.map((line, index) => <Text key={index} style={styles.plain}>{line.text}</Text>)}<LyricsAttribution attribution={lyrics?.attribution} /></ScrollView>
            : <View style={styles.empty}>
                <Ionicons name="musical-notes-outline" size={52} color="#efcf76" />
                <Text style={styles.emptyTitle}>No lyrics yet</Text>
                <Text style={styles.note}>No lyrics saved for this song.</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Download lyrics" disabled={!track || !libraryId}
                  onPress={() => setSearching(true)}
                  style={({ pressed }) => [styles.downloadButton, pressed && { opacity: 0.7 }, (!track || !libraryId) && { opacity: 0.5 }]}>
                  <Ionicons name="musical-notes-outline" size={18} color={COLORS.green} />
                  <Text style={styles.downloadButtonText}>Download lyrics</Text>
                </Pressable>
              </View>}
    {segments?.length > 0 && !segments.some((segment) => segment.words?.length) && <Text style={styles.disclaimer}>This source provided line timing only. Word highlighting requires lyrics with word timestamps.</Text>}
    <Pressable accessibilityRole="adjustable" accessibilityLabel="Song position" accessibilityValue={{ min: 0, max: duration, now: displayedTime }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={({ nativeEvent }) => seek(displayedTime + (nativeEvent.actionName === 'increment' ? 5 : -5))}
      onLayout={({ nativeEvent }) => setSeekWidth(nativeEvent.layout.width)}
      onPress={({ nativeEvent }) => { if (seekWidth && duration) seek(nativeEvent.locationX / seekWidth * duration); }} style={styles.seekTouch}>
      <View style={styles.seekTrack}><View style={[styles.seekFill, { width: `${Math.min(100, duration ? displayedTime / duration * 100 : 0)}%` }]} /></View>
    </Pressable>
    <View style={styles.times}><Text style={styles.time}>{timeLabel(displayedTime)}</Text><Text style={styles.time}>{timeLabel(duration)}</Text></View>
    <Pressable style={styles.play} onPress={togglePlayback} accessibilityLabel={playing ? 'Pause' : 'Play'}><Ionicons name={playing ? 'pause' : 'play'} size={32} color={COLORS.greenPanelAlt} /></Pressable>
  </View>;
}
const BASE_COLORS = {
  green: '#153f2e',
  greenPanelAlt: '#123e2d',
  moss: '#c9d8c2',
};

const createStyles = (colors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.green, paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 }, artwork: { width: 60, height: 60, borderRadius: 10 },
  heading: { flex: 1 }, title: { color: '#fff5d7', fontSize: 19, fontWeight: '800' }, artist: { color: colors.moss, marginTop: 4 },
  toolbarButton: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center' },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 18, marginTop: 20, marginBottom: 8 },
  badge: { flex: 1, color: '#d9c57e', fontSize: 12, fontWeight: '700' }, action: { color: '#f0d586', fontWeight: '700' },
  error: { color: '#ffbba7', paddingVertical: 12 }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  emptyTitle: { color: '#fff6d9', fontSize: 22, fontWeight: '800', textAlign: 'center' }, note: { color: colors.moss, lineHeight: 22, textAlign: 'center', paddingHorizontal: 12 },
  plain: { color: '#fff6d9', fontSize: 28, lineHeight: 42, fontWeight: '700', marginTop: 14 },
  disclaimer: { color: colors.moss, fontSize: 11, textAlign: 'center', marginVertical: 8 },
  seekTouch: { paddingVertical: 14 }, seekTrack: { height: 4, backgroundColor: colors.surfaceRaised, borderRadius: 2 }, seekFill: { height: 4, backgroundColor: '#fff4d2', borderRadius: 2 },
  times: { flexDirection: 'row', justifyContent: 'space-between' }, time: { color: '#ced6be', fontSize: 12 },
  play: { alignSelf: 'center', width: 68, height: 68, borderRadius: 34, backgroundColor: '#fff5d7', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  downloadButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, backgroundColor: '#f4d683', paddingHorizontal: 22, paddingVertical: 12, borderRadius: 24, marginTop: 6 },
  downloadButtonText: { color: colors.green, fontWeight: '800', fontSize: 15 },
});
