# Downloaded lyrics and timing

- Music imports, folder changes and rescans add songs only; they do not fetch or generate lyrics.
- Tap Download in a song's Lyrics screen to look up and save online lyrics for that song. Importing an `.lrc` or `.txt` file remains available.
- Downloads check Spicy Lyrics first, then LiriQo, LyricsDB and lrc.red for word-timed lyrics, LRCLIB for word-timed, line-synced or plain lyrics, and lyrics.ovh / Lyrist as text fallbacks. The screen stores the source used with the lyrics.
- When a source supplies word timestamps, the app uses them. For line-timed lyrics, the app estimates word highlights by spreading each line's timed interval across its words, weighted by approximate syllable count and punctuation. These estimates are approximate and may not match the vocals exactly.
- Spicy Lyrics is queried by an existing Spotify track URL/ID when available, otherwise by exact title, artist, album, and duration match. Its syllable sync is grouped into words; line-only results use the app's estimated word highlighting. Required provider/contributor credits appear at the end of lyrics, and saved results expire after 30 days.
- LyricsDB can provide syllable segments as well as complete words; syllable segments are joined into a word using the source's explicit word-boundary spaces while preserving its supplied start and end times. Fuzzy results below the match-score threshold are rejected.
- LiriQo results use the source's normalized timestamps and are saved locally. Its provider availability and timing level vary by song; the search falls back when no native word timing is returned.
- If title/artist lookup misses, the user can paste an `open.spotify.com/track/...` link to retry Spotify-ID-based lookups.
- Plain text remains untimed. Earlier / Later adjusts the per-song offset. Tap a timed line to seek.
- Lookup needs internet access. Saved lyrics are available offline.
- Previously saved lyrics and legacy generated caches remain readable; transcription engines have been removed.
