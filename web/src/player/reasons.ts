/**
 * Jellyfin's transcode reasons in plain words: why the server is doing work
 * for this video, and what (if anything) you can do about it.
 */

import { t } from '../i18n';

const REASONS: Record<string, string> = {
  ContainerNotSupported: t("This device can't open the file's container, so it's rewrapped (light work)."),
  VideoCodecNotSupported: t("This device can't decode the video format, so the server re-encodes it (heavy on a Pi)."),
  VideoProfileNotSupported: t("The video uses a profile this device can't decode, so the server re-encodes it (heavy)."),
  VideoLevelNotSupported: t("The video's level is too high for this device, so the server re-encodes it (heavy)."),
  VideoBitDepthNotSupported: t("This device can't show 10-bit video, so the server re-encodes it (heavy)."),
  VideoRangeTypeNotSupported: t("HDR or Dolby Vision isn't supported here, so the server converts the picture (very heavy)."),
  VideoResolutionNotSupported: t("The resolution is too high for this device, so the server scales it down (heavy)."),
  VideoFramerateNotSupported: t("The frame rate isn't supported here, so the server re-encodes it (heavy)."),
  RefFramesNotSupported: t("The video's encoding settings aren't supported here, so the server re-encodes it (heavy)."),
  InterlacedVideoNotSupported: t("The video is interlaced, so the server de-interlaces it (heavy)."),
  AnamorphicVideoNotSupported: t("The video has non-square pixels, so the server re-encodes it (heavy)."),
  VideoBitrateNotSupported: t('The video is above your streaming quality setting, so the server shrinks it (heavy).'),
  ContainerBitrateExceedsLimit: t('The file is above your streaming quality setting, so the server shrinks it (heavy).'),
  SubtitleCodecNotSupported: t('The chosen subtitles are pictures, so the server draws them into the video (heavy). Text subtitles avoid this.'),
  AudioCodecNotSupported: t("This device can't play the sound format (e.g. DTS, TrueHD, AC3), so only the sound is converted (light)."),
  AudioChannelsNotSupported: t('The sound has more channels than this device takes, so it is mixed down (light).'),
  AudioBitrateNotSupported: t('The sound bitrate is too high here, so it is converted (light).'),
  AudioProfileNotSupported: t("The sound uses a profile this device can't play, so it is converted (light)."),
  AudioSampleRateNotSupported: t("The sound's sample rate isn't supported, so it is converted (light)."),
  AudioBitDepthNotSupported: t("The sound's bit depth isn't supported, so it is converted (light)."),
  SecondaryAudioNotSupported: t('Another audio track was picked, so the file is rewrapped with that one (light).'),
  AudioIsExternal: t('The chosen sound is a separate file, so it is mixed in (light).'),
  DirectPlayError: t("This device couldn't play the file directly, so the server stepped in."),
  UnknownVideoStreamInfo: t("The server doesn't know enough about the video to send it as-is."),
  UnknownAudioStreamInfo: t("The server doesn't know enough about the sound to send it as-is."),
  StreamCountExceedsLimit: t('The file has more tracks than this device handles, so it is rewrapped (light).'),
};

export function explainReasons(reasons: string[]): string[] {
  const seen = new Set<string>();
  return reasons
    .map((r) => REASONS[r.trim()] ?? t('Server note: {reason}', { reason: r.trim() }))
    .filter((text) => !seen.has(text) && seen.add(text));
}

/** True when the server is re-encoding the picture, the part that loads a Raspberry Pi. */
export const isHeavy = (reasons: string[]) => reasons.some((r) => /^(Video|Subtitle|ContainerBitrate|Interlaced|Anamorphic|RefFrames)/.test(r.trim()));
