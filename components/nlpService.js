/**
 * On-Device NLP (Natural Language Processing) Music Recommendation Engine
 *
 * Runs 100% on-device in pure JavaScript with ZERO network calls, ZERO servers,
 * and ZERO API keys required.
 *
 * Features:
 *  - Sentiment & Mood detection (Happy/Upbeat, Calm/Acoustic, Sad/Melancholy, Christmas, Romantic, Workout)
 *  - Entity extraction (detects if user asked for a specific artist or title in their library)
 *  - Semantic keyword relevance scoring across tracks (title, artist, album)
 *  - Natural festive response generator formatted with [SONG: Title] tags
 *  - Streaming simulation callback for consistent UI animations
 */

const MOOD_TAXONOMY = {
  christmas: {
    label: 'festive Christmas',
    keywords: [
      'christmas', 'holiday', 'xmas', 'santa', 'winter', 'snow', 'cold', 'december',
      'festive', 'mistletoe', 'bell', 'tree', 'carol', 'cheer', 'reindeer', 'jingle',
      'noel', 'yule', 'wonderland', 'frosty', 'merry', 'claus', 'sleigh'
    ],
    greeting: '🎄 Ho ho ho! Getting into the holiday spirit? Here are festive tracks from your library to warm you up:',
    advice: 'Grab a mug of hot cocoa and enjoy the holiday melodies!',
  },
  happy: {
    label: 'upbeat & joyful',
    keywords: [
      'happy', 'party', 'dance', 'fun', 'upbeat', 'hype', 'energy', 'cheer', 'celebrate',
      'joy', 'excited', 'bounce', 'club', 'good mood', 'positive', 'groove', 'smile',
      'sunshine', 'alive', 'vibe', 'vibes', 'turn up', 'lit', 'pop', 'disco', 'shake',
      'summer', 'bright', 'jump', 'move', 'dynamite'
    ],
    greeting: '✨ Nothing beats good energy! Here are some upbeat tracks to keep your spirits flying high:',
    advice: 'Turn up the volume and let the positive vibes roll!',
  },
  calm: {
    label: 'chill & relaxing',
    keywords: [
      'chill', 'relax', 'calm', 'peace', 'peaceful', 'soft', 'slow', 'sleep', 'night',
      'bed', 'study', 'focus', 'acoustic', 'quiet', 'smooth', 'cozy', 'lazy', 'unwind',
      'meditate', 'rest', 'soothing', 'gentle', 'serene', 'piano', 'ambient', 'rain',
      'lofi', 'guitar', 'breeze', 'mellow'
    ],
    greeting: '☕ I feel you. Taking a breather is always a great idea. Here are soothing tunes to help you relax:',
    advice: 'Dim the lights, breathe easy, and let the soothing sounds wash over you.',
  },
  sad: {
    label: 'gentle & comforting',
    keywords: [
      'sad', 'cry', 'crying', 'heartbreak', 'broken', 'miss', 'alone', 'lonely', 'pain',
      'tears', 'hurt', 'melancholy', 'dark', 'depressed', 'down', 'blue', 'gloomy',
      'heartbroken', 'sorrow', 'tough day', 'rough day', 'bad day', 'cry', 'goodbye',
      'lost', 'teardrop', 'sorry', 'hurt', 'regret'
    ],
    greeting: '💙 Music is always here to heal and comfort. Here are deep, soulful songs for your mood:',
    advice: 'Remember that after every winter snow comes a warm spring. Take good care of yourself!',
  },
  romantic: {
    label: 'romantic & loving',
    keywords: [
      'love', 'romantic', 'crush', 'date', 'sweetheart', 'kiss', 'forever', 'sweet',
      'heart', 'passion', 'romance', 'lover', 'together', 'hug', 'warmth', 'couple',
      'darling', 'beloved', 'mine', 'baby', 'honey'
    ],
    greeting: '💖 Love is in the air! Here are sweet and romantic songs to set the mood:',
    advice: 'Perfect tunes for creating special memories with someone you cherish.',
  },
  workout: {
    label: 'high energy & powerful',
    keywords: [
      'workout', 'gym', 'run', 'running', 'hard', 'loud', 'bass', 'intense', 'pump',
      'beast', 'training', 'power', 'fast', 'heavy', 'drive', 'speed', 'lift', 'rock',
      'tiger', 'fight', 'warrior', 'fire', 'strong', 'beast', 'drop', 'push', 'hit'
    ],
    greeting: '🔥 Time to lock in! Here are high-octane tracks to give you that extra boost:',
    advice: 'Keep that momentum going — you got this!',
  },
};



/**
 * Tokenize and normalize input text into lowercase alphanumeric words
 */

function normalize(text) {
  return String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function podcastItemTitle(item) {
  const rawTitle = item.title || item.name || item.podcastTitle || 'Untitled podcast';
  return String(rawTitle).replace(/\.[a-z0-9]{2,5}$/i, '').trim() || 'Untitled podcast';
}
const STOP_WORDS = new Set('i me my our the a an all every entire whole local library collection music song songs track tracks podcast podcasts video videos episode episodes album albums record records playlist playlists artist artists please can could you show list give find search play recommend suggest want listen to for of in on from by have do what are is some any with and also how many total number'.split(' '));
function containsPhrase(text, phrase) {
  return phrase && (' ' + text + ' ').includes(' ' + phrase + ' ');
}

function makeAlbumCatalog(tracks, albums) {
  if (Array.isArray(albums) && albums.length) return albums.filter((album) => album?.title);
  const grouped = new Map();
  for (const track of tracks) {
    const title = String(track.album || '').trim();
    if (!title || title.toLowerCase() === 'singles') continue;
    const artist = String(track.albumArtist || track.artist || '').trim();
    const key = `${normalize(title)}\u0000${normalize(artist)}`;
    const album = grouped.get(key) || { id: key, title, artist, tracks: [] };
    album.tracks.push(track);
    grouped.set(key, album);
  }
  return [...grouped.values()];
}

function requestedTitle(message) {
  const quoted = String(message).match(/["“]([^"”]+)["”]/);
  if (quoted) return normalize(quoted[1]);
  return normalize(message)
    .replace(/^(?:(?:please|can you|could you|would you|i want to|i want|i would like to|i would like|listen to|play|find|search for|search|show me|give me|the song|a song|song|track|called|titled)\s+)+/, '')
    .replace(/\s+by\s+.+$/, '')
    .replace(/\s+please$/, '').trim();
}

/** Resolve requests against the complete local catalog, without inventing metadata. */
export async function chatWithNlp(userMessage, tracks = [], onToken = null, podcasts = [], history = [], albums = []) {
  let query = normalize(userMessage);
  // Follow-up requests such as "show all of them" retain the previous subject.
  if (/^(show |list |give me )?(all|more)( of them)?$/.test(query)) {
    const previous = [...history].reverse().find((message) => message.role === 'user');
    if (previous) query += ' ' + normalize(previous.content);
  }
  const wantsPodcasts = /\b(podcasts?|videos?|episodes?)\b/.test(query);
  const wantsMusic = /\b(music|songs?|tracks?)\b/.test(query);
  const both = wantsPodcasts && wantsMusic;
  const albumCatalog = makeAlbumCatalog(tracks, albums);
  const asksAlbums = /\b(albums?|records?|playlists?)\b/.test(query);
  const asksToPlay = /\b(play|start|listen)\b/.test(query);
  if (asksAlbums) {
    const namedAlbums = albumCatalog.filter((album) => containsPhrase(query, normalize(album.title)));
    const artistNames = [...new Set(albumCatalog.map((album) => normalize(album.artist)).filter((artist) =>
      artist && artist !== 'unknown artist' && containsPhrase(query, artist)))];
    const matchingAlbums = namedAlbums.length
      ? namedAlbums
      : artistNames.length ? albumCatalog.filter((album) => artistNames.includes(normalize(album.artist))) : albumCatalog;
    const countOnly = /\b(how many|count|total|number of)\b/.test(query);
    const songListRequest = !asksToPlay && /\b(show|list|which|what).*(songs?|tracks?)\b|\b(songs?|tracks?)\s+(?:in|from)\b/.test(query);
    let albumReply;
    if (!albumCatalog.length) {
      albumReply = 'There are no albums in your music library yet.';
    } else if (countOnly) {
      albumReply = `Your library has ${matchingAlbums.length} matching albums.`;
    } else if (asksToPlay && namedAlbums.length) {
      const selected = namedAlbums.slice(0, 5);
      albumReply = selected.length === 1
        ? `Tap this album to play it: [ALBUM: ${selected[0].title}]`
        : `Choose an album to play:\n\n${selected.map((album) => `[ALBUM: ${album.title}] by ${album.artist || 'Unknown artist'}`).join('\n')}`;
    } else if (songListRequest && namedAlbums.length) {
      const albumTracks = namedAlbums.flatMap((album) => album.tracks || []);
      albumReply = albumTracks.length
        ? `Songs in ${namedAlbums.map((album) => album.title).join(', ')}:\n\n${albumTracks.slice(0, 30).map((track) => `[SONG: ${track.title}] by ${track.artist || 'Unknown artist'}`).join('\n')}`
        : `I couldn't find songs in ${namedAlbums.map((album) => album.title).join(', ')}.`;
    } else {
      const selected = matchingAlbums.slice(0, 30);
      albumReply = selected.length
        ? `Your albums:\n\n${selected.map((album) => `[ALBUM: ${album.title}] by ${album.artist || 'Unknown artist'} (${(album.tracks || []).length} songs)`).join('\n')}`
        : 'I couldn’t find a matching album in your library.';
    }
    onToken?.(albumReply);
    return albumReply;
  }
  const catalog = [
    ...(!wantsPodcasts || both ? tracks.map((item) => ({ ...item, kind: 'song' })) : []),
    ...(wantsPodcasts ? podcasts.map((item) => ({
      ...item,
      title: podcastItemTitle(item),
      artist: item.artist || item.author || item.podcastTitle || '',
      description: item.description || item.podcastDescription || '',
      kind: 'podcast',
    })) : []),
  ];
  const all = /\b(all|every|entire|whole)\b/.test(query);
  const countOnly = /\b(how many|count|total|number of)\b/.test(query);
  const requestedCount = query.match(/\b(\d+)\s+(?:songs?|tracks?|podcasts?|episodes?|videos?)\b/);
  const limit = all || countOnly ? Infinity : requestedCount ? Math.max(1, Number(requestedCount[1])) : 5;
  const terms = query.split(' ').filter((term) => term && !STOP_WORDS.has(term) && !/^\d+$/.test(term));
  const moods = Object.values(MOOD_TAXONOMY).filter((mood) =>
    mood.keywords.some((keyword) => containsPhrase(query, normalize(keyword))));
  const fields = (item) => [item.title, item.artist, item.album, item.genre, item.description,
    item.author, item.name, item.podcastTitle, item.podcastDescription].map(normalize);
  const artists = [...new Set(catalog.map((item) => normalize(item.artist)).filter((artist) =>
    artist && artist !== 'unknown artist' && containsPhrase(query, artist)))];
  const matchingAlbumNames = [...new Set(catalog.map((item) => normalize(item.album)).filter((album) =>
    album && album !== 'unknown album' && containsPhrase(query, album)))];
  let matches = catalog.filter((item) => {
    if (artists.length && !artists.includes(normalize(item.artist))) return false;
    if (matchingAlbumNames.length && !matchingAlbumNames.includes(normalize(item.album))) return false;
    return true;
  });
  const titleQuery = requestedTitle(userMessage);
  const exactTitles = matches.filter((item) => normalize(item.title) === titleQuery);
  const mentionedTitles = matches.filter((item) => {
    const title = normalize(item.title);
    return title && containsPhrase(query, title) &&
      title.split(' ').some((word) => !STOP_WORDS.has(word));
  });
  // A specific title takes precedence over mood words such as love, happy or night.
  // Keep only the longest title phrase when titles overlap (Hello / Hello Again).
  const longestTitle = Math.max(0, ...mentionedTitles.map((item) => normalize(item.title).length));
  const directTitles = exactTitles.length ? exactTitles : mentionedTitles.filter((item) => normalize(item.title).length === longestTitle);
  const broadRequest = /\b(recommend|suggest|mood|feel|feeling)\b/.test(query) ||
    /\b(happy|sad|chill|relaxing|romantic|workout|christmas|calm|upbeat)\s+(music|songs|tracks)\b/.test(query);
  const specificTitle = !all && !countOnly && !broadRequest && !artists.length &&
    (!artists.length && !matchingAlbumNames.length || /\b(play|called|titled)\b/.test(query));
  if (directTitles.length && !all && !countOnly && !broadRequest) {
    matches = directTitles;
  } else if (specificTitle && titleQuery && !wantsPodcasts) {
    // Partial titles must match every meaningful word; one shared word is insufficient.
    const titleTerms = titleQuery.split(' ').filter((word) => !STOP_WORDS.has(word));
    matches = titleTerms.length ? matches.filter((item) =>
      titleTerms.every((word) => containsPhrase(normalize(item.title), word))) : [];
  } else if (!artists.length && !matchingAlbumNames.length && terms.length) {
    matches = matches.map((item) => {
      const metadata = fields(item);
      const overlap = terms.reduce((score, term) => score + metadata.reduce((sum, field, index) =>
        sum + (containsPhrase(field, term) ? (index === 0 ? 4 : 2) : 0), 0), 0);
      const moodScore = moods.reduce((score, mood) => score + mood.keywords.reduce((sum, keyword) =>
        sum + (metadata.some((field) => containsPhrase(field, normalize(keyword))) ? 2 : 0), 0), 0);
      return { item, score: overlap + moodScore };
    }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).map(({ item }) => item);
  }
  const label = both ? 'music and podcast items' : wantsPodcasts ? 'podcasts' : 'songs';
  let reply;
  if (/^(hi|hello|hey|good morning|good evening)$/.test(query)) {
    reply = "Hello! Your library has " + tracks.length + " songs and " + podcasts.length +
      " podcasts. Ask me to list all your music, find an artist or album, count your songs, or search your podcasts.";
  } else if (!catalog.length) {
    reply = "You have no " + label + " imported yet. Add them in the app's Settings, then ask me again.";
  } else if (!matches.length) {
    reply = "I couldn't find " + label + " matching that request in your local titles and metadata. Try a title, artist, album, or podcast topic. I can't infer audio content that isn't described in the metadata.";
  } else if (countOnly) {
    reply = "Your library has " + matches.length + " matching " + label + ".";
  } else {
    const selected = matches.slice(0, limit);
    const filtered = artists.length || matchingAlbumNames.length || terms.length;
    reply = "Showing " + selected.length + " of " + matches.length + (filtered ? " matching " : " ") + label + ":\n\n" +
      selected.map((item, index) => (index + 1) + ". [" + (item.kind === 'podcast' ? 'PODCAST' : 'SONG') +
        ": " + (item.title || 'Untitled') + "]" + (item.artist || item.author ? " by " + (item.artist || item.author) : '') +
        (item.album ? " (" + item.album + ")" : '')).join('\n');
    if (moods.length) reply += "\n\nThese matches use your library's titles and metadata.";
  }
  // Emit once: full-library lists should not incur a delay for every word.
  onToken?.(reply);
  return reply;
}
