/**
 * Jellyfin's transcode reasons in plain words: why the server is doing work
 * for this video, and what (if anything) you can do about it.
 */

const REASONS: Record<string, string> = {
  ContainerNotSupported: "This device can't open the file's container, so it's rewrapped (light work).",
  VideoCodecNotSupported: "This device can't decode the video format, so the server re-encodes it (heavy on a Pi).",
  VideoProfileNotSupported: "The video uses a profile this device can't decode, so the server re-encodes it (heavy).",
  VideoLevelNotSupported: "The video's level is too high for this device, so the server re-encodes it (heavy).",
  VideoBitDepthNotSupported: "This device can't show 10-bit video, so the server re-encodes it (heavy).",
  VideoRangeTypeNotSupported: "HDR or Dolby Vision isn't supported here, so the server converts the picture (very heavy).",
  VideoResolutionNotSupported: "The resolution is too high for this device, so the server scales it down (heavy).",
  VideoFramerateNotSupported: "The frame rate isn't supported here, so the server re-encodes it (heavy).",
  RefFramesNotSupported: "The video's encoding settings aren't supported here, so the server re-encodes it (heavy).",
  InterlacedVideoNotSupported: "The video is interlaced, so the server de-interlaces it (heavy).",
  AnamorphicVideoNotSupported: "The video has non-square pixels, so the server re-encodes it (heavy).",
  VideoBitrateNotSupported: 'The video is above your streaming quality setting, so the server shrinks it (heavy).',
  ContainerBitrateExceedsLimit: 'The file is above your streaming quality setting, so the server shrinks it (heavy).',
  SubtitleCodecNotSupported: 'The chosen subtitles are pictures, so the server draws them into the video (heavy). Text subtitles avoid this.',
  AudioCodecNotSupported: "This device can't play the sound format (e.g. DTS, TrueHD, AC3), so only the sound is converted (light).",
  AudioChannelsNotSupported: 'The sound has more channels than this device takes, so it is mixed down (light).',
  AudioBitrateNotSupported: 'The sound bitrate is too high here, so it is converted (light).',
  AudioProfileNotSupported: "The sound uses a profile this device can't play, so it is converted (light).",
  AudioSampleRateNotSupported: "The sound's sample rate isn't supported, so it is converted (light).",
  AudioBitDepthNotSupported: "The sound's bit depth isn't supported, so it is converted (light).",
  SecondaryAudioNotSupported: 'Another audio track was picked, so the file is rewrapped with that one (light).',
  AudioIsExternal: 'The chosen sound is a separate file, so it is mixed in (light).',
  DirectPlayError: "This device couldn't play the file directly, so the server stepped in.",
  UnknownVideoStreamInfo: "The server doesn't know enough about the video to send it as-is.",
  UnknownAudioStreamInfo: "The server doesn't know enough about the sound to send it as-is.",
  StreamCountExceedsLimit: 'The file has more tracks than this device handles, so it is rewrapped (light).',
};

export function explainReasons(reasons: string[]): string[] {
  const seen = new Set<string>();
  return reasons
    .map((r) => REASONS[r.trim()] ?? `Server note: ${r.trim()}`)
    .filter((text) => !seen.has(text) && seen.add(text));
}

/** True when the server is re-encoding the picture, the part that loads a Raspberry Pi. */
export const isHeavy = (reasons: string[]) => reasons.some((r) => /^(Video|Subtitle|ContainerBitrate|Interlaced|Anamorphic|RefFrames)/.test(r.trim()));
