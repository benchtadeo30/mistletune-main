# MistleTunes

A local music player built with Expo and React Native.

## Start the app

```bash
npm install
npx expo start
```

## Lyrics

Music imports add songs only. To get lyrics, open a song's Lyrics screen and tap Download; MistleTunes then searches online lyrics sources for that song. Lyrics can also be imported from an LRC or text file.

Synced lyrics follow playback. Word-by-word highlighting uses source timestamps when available and estimates word positions for line-timed lyrics. Online lookup needs an internet connection, while saved lyrics remain on the device.

## Checks

```bash
npm run lint
npx tsc --noEmit -p themes/tsconfig.json
```
