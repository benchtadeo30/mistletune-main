const { withAndroidManifest } = require('expo/config-plugins');

const AUDIO_CONTROLS_SERVICE = 'expo.modules.audio.service.AudioControlsService';
const VIDEO_PLAYBACK_SERVICE = 'expo.modules.video.playbackService.ExpoVideoPlaybackService';

module.exports = function withAudioStopOnTask(config) {
  return withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (!application) throw new Error('Android manifest has no application entry.');

    if (!application.service) application.service = [];
    let service = application.service.find(
      (entry) => entry.$?.['android:name'] === AUDIO_CONTROLS_SERVICE,
    );
    if (!service) {
      service = {
        $: {
          'android:name': AUDIO_CONTROLS_SERVICE,
          'android:exported': 'false',
          'android:foregroundServiceType': 'mediaPlayback',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'androidx.media3.session.MediaSessionService' } }],
          },
        ],
      };
      application.service.push(service);
    }

    delete service.$['android:stopWithTask'];
    service.$['android:stopWithTask'] = 'false';

    let videoService = application.service?.find(
      (entry) => entry.$?.['android:name'] === VIDEO_PLAYBACK_SERVICE,
    );
    if (!videoService) {
      videoService = {
        $: {
          'android:name': VIDEO_PLAYBACK_SERVICE,
          'android:exported': 'false',
          'android:foregroundServiceType': 'mediaPlayback',
          'android:stopWithTask': 'true',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'androidx.media3.session.MediaSessionService' } }],
          },
        ],
      };
      application.service.push(videoService);
    } else {
      videoService.$['android:stopWithTask'] = 'true';
    }
    return modConfig;
  });
};
