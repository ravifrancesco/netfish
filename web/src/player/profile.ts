/**
 * Tells Jellyfin what this browser can play natively, so it serves files
 * untouched when possible and only repackages (cheap) or transcodes (expensive
 * on a Pi) when it must. Built from real capability checks, not guesses.
 */

import { tizenVersion } from '../lib/tv';

function can(type: string): boolean {
  const ms = (window as { MediaSource?: { isTypeSupported(t: string): boolean } }).MediaSource;
  if (ms?.isTypeSupported(type)) return true;
  return document.createElement('video').canPlayType(type) !== '';
}

export function buildDeviceProfile(maxBitrate: number) {
  const tizen = tizenVersion();
  if (tizen) return samsungProfile(tizen, maxBitrate);
  const video = ['h264'];
  if (can('video/mp4; codecs="hvc1.1.6.L120.90"') || can('video/mp4; codecs="hev1.1.6.L120.90"')) video.push('hevc');
  if (can('video/mp4; codecs="av01.0.08M.08"')) video.push('av1');
  const vp9 = can('video/mp4; codecs="vp09.00.10.08"');
  if (vp9) video.push('vp9');

  const audio = ['aac', 'mp3'];
  if (can('audio/mp4; codecs="opus"')) audio.push('opus');
  if (can('audio/mp4; codecs="flac"')) audio.push('flac');
  if (can('audio/mp4; codecs="ac-3"')) audio.push('ac3');
  if (can('audio/mp4; codecs="ec-3"')) audio.push('eac3');

  const webmVideo = ['vp8', ...(vp9 ? ['vp9'] : []), ...(video.includes('av1') ? ['av1'] : [])];

  // Chromium (Chrome, Edge, the desktop app) plays MKV natively even though it's not
  // "official" — tested: H.264/HEVC with AAC/FLAC/Opus work. Declaring it means most
  // Radarr/Sonarr downloads play straight off the disk with zero work for the Pi.
  // AC3/DTS aren't in the audio list, so those files still get their audio converted.
  const mkv = document.createElement('video').canPlayType('video/x-matroska') !== '';

  return {
    Name: 'Netfish Web',
    // "Auto" means a home network: high enough that 4K remuxes play untouched rather than re-encoded.
    MaxStreamingBitrate: maxBitrate || 400_000_000,
    MaxStaticBitrate: 400_000_000,
    MusicStreamingTranscodingBitrate: 384_000,
    DirectPlayProfiles: [
      { Container: 'mp4,m4v', Type: 'Video', VideoCodec: video.join(','), AudioCodec: audio.join(',') },
      ...(mkv ? [{ Container: 'mkv', Type: 'Video', VideoCodec: video.join(','), AudioCodec: audio.join(',') }] : []),
      { Container: 'webm', Type: 'Video', VideoCodec: webmVideo.join(','), AudioCodec: 'vorbis,opus' },
      { Container: 'mp3,aac,m4a,flac,webm,ogg', Type: 'Audio' },
    ],
    TranscodingProfiles: [
      {
        // fMP4 HLS: lets Jellyfin copy H.264/HEVC/AV1 video untouched out of MKVs.
        Container: 'mp4',
        Type: 'Video',
        Protocol: 'hls',
        Context: 'Streaming',
        VideoCodec: video.filter((c) => c !== 'vp9').join(','),
        AudioCodec: audio.join(','),
        MaxAudioChannels: '6',
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
      },
      {
        Container: 'ts',
        Type: 'Video',
        Protocol: 'hls',
        Context: 'Streaming',
        VideoCodec: 'h264',
        AudioCodec: 'aac,mp3',
        MaxAudioChannels: '2',
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
      },
    ],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: [
      { Format: 'vtt', Method: 'External' },
      { Format: 'srt', Method: 'External' },
      { Format: 'subrip', Method: 'External' },
      { Format: 'ass', Method: 'External' },
      { Format: 'ssa', Method: 'External' },
      { Format: 'mov_text', Method: 'External' },
      { Format: 'pgssub', Method: 'Encode' },
      { Format: 'dvdsub', Method: 'Encode' },
      { Format: 'dvbsub', Method: 'Encode' },
    ],
  };
}

const SUBTITLES = [
  { Format: 'vtt', Method: 'External' },
  { Format: 'srt', Method: 'External' },
  { Format: 'subrip', Method: 'External' },
  { Format: 'ass', Method: 'External' },
  { Format: 'ssa', Method: 'External' },
  { Format: 'mov_text', Method: 'External' },
  { Format: 'pgssub', Method: 'Encode' },
  { Format: 'dvdsub', Method: 'Encode' },
  { Format: 'dvbsub', Method: 'Encode' },
];

/**
 * Samsung TVs: their player decodes far more than the browser admits to (MKV,
 * HEVC, Dolby), so this lists what the TV really plays, like Jellyfin's Samsung
 * app does. DTS only on TVs before 2018 (Tizen 4 dropped it), AV1 from 2020.
 * FLAC inside films is left out: Samsung plays it out of sync.
 */
function samsungProfile(version: number, maxBitrate: number) {
  const video = ['h264', 'hevc', 'mpeg2video', 'vc1', 'vp9', ...(version >= 5.5 ? ['av1'] : [])];
  const audio = ['aac', 'mp3', 'ac3', 'eac3', 'mp2', 'pcm_s16le', 'pcm_s24le', 'vorbis', ...(version < 4 ? ['dts'] : [])];
  return {
    Name: 'Netfish on Samsung TV',
    MaxStreamingBitrate: maxBitrate || 400_000_000,
    MaxStaticBitrate: 400_000_000,
    MusicStreamingTranscodingBitrate: 384_000,
    DirectPlayProfiles: [
      { Container: 'mp4,m4v,mkv,mov,ts,mpegts,m2ts,webm', Type: 'Video', VideoCodec: video.join(','), AudioCodec: [...audio, 'opus'].join(',') },
      { Container: 'mp3,aac,m4a,flac,webm,ogg,wav', Type: 'Audio' },
    ],
    TranscodingProfiles: [
      ...(version >= 5
        ? [{ Container: 'mp4', Type: 'Video', Protocol: 'hls', Context: 'Streaming', VideoCodec: 'hevc,h264', AudioCodec: 'aac,ac3,eac3', MaxAudioChannels: '6', MinSegments: 1, BreakOnNonKeyFrames: true }]
        : []),
      { Container: 'ts', Type: 'Video', Protocol: 'hls', Context: 'Streaming', VideoCodec: 'h264,hevc', AudioCodec: 'aac,ac3,eac3', MaxAudioChannels: '6', MinSegments: 1, BreakOnNonKeyFrames: true },
    ],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: SUBTITLES,
  };
}
