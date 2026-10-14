import { randomUUID } from 'node:crypto';
import type { MediaSegment, OfflineDescriptor, PlayInfo, PlaybackRequest, PlaybackSession, ProgressReport, StreamTrack } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { jellyfin, secondsToTicks, ticksToSeconds, type JfMediaSource, type JfMediaStream } from '../clients/jellyfin';
import { settle } from '../lib/async';
import { JF_PREFIX, jfImage } from '../lib/images';
import { findLanguage, languageLabel } from '../lib/languages';
import { HttpError, buildQuery } from '../lib/upstream';
import { episodeLabel } from './cards';
import { libraryIndex } from './library';
import { t } from '../lib/i18n';

const SEGMENT_TYPES = new Set(['Intro', 'Outro', 'Recap', 'Preview', 'Commercial']);
/** Streaming limit when the viewer picked "Auto": everything on a home network. */
const LAN_BITRATE = 400_000_000;

export async function playInfo(user: SessionUser, itemId: string): Promise<PlayInfo> {
  const item = await jellyfin.item(user.token, user.id, itemId);
  const [index, segments, siblings] = await Promise.all([
    settle(libraryIndex(user), undefined),
    settle(jellyfin.segments(user.token, itemId), { Items: [] }),
    item.Type === 'Episode' && item.SeriesId
      ? settle(jellyfin.episodes(user.token, user.id, item.SeriesId, { startItemId: item.Id, limit: 2 }), undefined)
      : Promise.resolve(undefined),
  ]);
  const next = siblings?.Items.find((ep) => ep.Id !== item.Id);
  const titleOwner = item.Type === 'Episode' ? item.SeriesId : item.Id;
  const entry = titleOwner ? index?.byId.get(titleOwner) : undefined;

  return {
    itemId,
    type: item.Type === 'Movie' || item.Type === 'Episode' ? item.Type : 'Other',
    title: item.Name,
    seriesTitle: item.SeriesName,
    seasonNumber: item.ParentIndexNumber,
    episodeNumber: item.IndexNumber,
    backdrop:
      jfImage(item.Id, 'Backdrop', item.BackdropImageTags?.[0], { maxWidth: 1920 }) ??
      jfImage(item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags?.[0], { maxWidth: 1920 }),
    resumeSeconds: ticksToSeconds(item.UserData?.PlaybackPositionTicks) || undefined,
    durationSeconds: ticksToSeconds(item.RunTimeTicks) || undefined,
    nextItemId: next?.Id,
    nextTitle: next ? [episodeLabel(next), next.Name].filter(Boolean).join(' · ') : undefined,
    detailHref: entry?.tmdbId ? `/title/${entry.mediaType}/${entry.tmdbId}` : titleOwner ? `/title/jf/${titleOwner}` : undefined,
    segments: segments.Items.filter((s) => SEGMENT_TYPES.has(s.Type)).map(
      (s): MediaSegment => ({ type: s.Type as MediaSegment['type'], start: ticksToSeconds(s.StartTicks), end: ticksToSeconds(s.EndTicks) }),
    ),
  };
}

/** Our proxy injects auth from the session cookie; strip tokens Jellyfin baked into URLs. */
function proxied(url: string): string {
  const [path, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  params.delete('ApiKey');
  params.delete('api_key');
  const qs = params.toString();
  return `${JF_PREFIX}${path.startsWith('/') ? '' : '/'}${path}${qs ? `?${qs}` : ''}`;
}

function trackLabel(s: JfMediaStream): string {
  const lang = languageLabel(s.Language);
  const english = findLanguage(s.Language)?.name;
  const sameAsLanguage = s.Title === lang || s.Title === english;
  const extra = [s.Title && !sameAsLanguage ? s.Title : undefined, s.IsForced ? t('Forced') : undefined].filter(Boolean);
  return [lang ?? s.DisplayTitle ?? t('Track {n}', { n: s.Index }), ...extra].join(' · ');
}

function tracks(itemId: string, source: JfMediaSource) {
  const streams = source.MediaStreams ?? [];
  const audioTracks: StreamTrack[] = streams
    .filter((s) => s.Type === 'Audio')
    .map((s) => {
      const label = trackLabel(s);
      const channels = s.Channels ? (s.Channels > 2 ? `${s.Channels - 1}.1` : s.Channels === 2 ? t('Stereo') : t('Mono')) : undefined;
      // Skip "(Stereo)" when the track's own name already says so.
      return { index: s.Index, label: channels && !label.toLowerCase().includes(channels.toLowerCase()) ? `${label} (${channels})` : label, s };
    })
    .map(({ index, label, s }) => ({
      index,
      label,
      code: findLanguage(s.Language)?.code ?? s.Language,
      codec: s.Codec,
      default: s.IsDefault || undefined,
    }));
  const subtitleTracks: StreamTrack[] = streams
    .filter((s) => s.Type === 'Subtitle')
    .map((s) => {
      const text = s.IsTextSubtitleStream !== false && !/pgs|dvd|dvb|vobsub/i.test(s.Codec ?? '');
      return {
        index: s.Index,
        label: trackLabel(s),
        code: findLanguage(s.Language)?.code ?? s.Language,
        codec: s.Codec,
        default: s.IsDefault || undefined,
        forced: s.IsForced || undefined,
        external: s.IsExternal || undefined,
        vttUrl: text
          ? s.DeliveryMethod === 'External' && s.DeliveryUrl
            ? proxied(s.DeliveryUrl)
            : `${JF_PREFIX}/Videos/${itemId}/${source.Id}/Subtitles/${s.Index}/0/Stream.vtt`
          : undefined,
        burnIn: !text || undefined,
      };
    });
  return { audioTracks, subtitleTracks };
}

/**
 * When the default audio track is one this device can't play (DTS, TrueHD, AC3
 * in a browser), the Pi has to convert the sound. Many files also carry a
 * track in the same language that plays as-is (AAC, Opus, FLAC…): use that
 * one instead and the Pi has nothing to do. Commentary tracks don't count.
 */
export function playableAudioAlternative(streams: JfMediaStream[], defaultIndex: number | undefined, playable: Set<string>) {
  const audio = streams.filter((s) => s.Type === 'Audio');
  const current = audio.find((s) => s.Index === defaultIndex) ?? audio.find((s) => s.IsDefault) ?? audio[0];
  if (!current || playable.has((current.Codec ?? '').toLowerCase())) return undefined;
  const language = findLanguage(current.Language)?.code ?? current.Language;
  return audio
    .filter((s) => s !== current && playable.has((s.Codec ?? '').toLowerCase()))
    .filter((s) => (findLanguage(s.Language)?.code ?? s.Language) === language)
    .filter((s) => !/commentary|director/i.test(`${s.Title ?? ''} ${s.DisplayTitle ?? ''}`))
    .sort((a, b) => (b.Channels ?? 2) - (a.Channels ?? 2))[0];
}

/** Audio codecs the device profile says it plays as-is. */
function profileAudio(profile: unknown): Set<string> {
  const direct = (profile as { DirectPlayProfiles?: { Type?: string; AudioCodec?: string }[] })?.DirectPlayProfiles ?? [];
  return new Set(direct.filter((p) => p.Type === 'Video').flatMap((p) => (p.AudioCodec ?? '').toLowerCase().split(',').filter(Boolean)));
}

function reasonsOf(source: JfMediaSource): string[] {
  const raw = source.TranscodeReasons;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw) return raw.split(',');
  const fromUrl = source.TranscodingUrl?.match(/TranscodeReasons=([^&]+)/i)?.[1];
  return fromUrl ? decodeURIComponent(fromUrl).split(',') : [];
}

export async function startPlayback(user: SessionUser, itemId: string, body: PlaybackRequest): Promise<PlaybackSession> {
  if (!body?.deviceProfile) throw new HttpError(400, 'deviceProfile is required');
  const allowDirectPlay = body.allowDirectPlay !== false;
  const ask = (audioStreamIndex: number | undefined) =>
    jellyfin.playbackInfo(user.token, itemId, {
      UserId: user.id,
      DeviceProfile: body.deviceProfile,
      // Home network: high enough that even 4K remuxes play untouched instead of being re-encoded.
      MaxStreamingBitrate: body.maxBitrate || LAN_BITRATE,
      StartTimeTicks: secondsToTicks(body.startSeconds ?? 0),
      AudioStreamIndex: audioStreamIndex,
      // -1 = none: never let Jellyfin pick picture subtitles on its own (burning them in re-encodes the whole film).
      SubtitleStreamIndex: body.subtitleStreamIndex ?? -1,
      MediaSourceId: body.mediaSourceId,
      EnableDirectPlay: allowDirectPlay,
      EnableDirectStream: true,
      EnableTranscoding: true,
      AllowVideoStreamCopy: true,
      AllowAudioStreamCopy: true,
      AutoOpenLiveStream: true,
    });
  let info = await ask(body.audioStreamIndex);
  if (info.ErrorCode) throw new HttpError(415, t("Jellyfin can't play this here ({code})", { code: info.ErrorCode }));
  let source = info.MediaSources.find((s) => s.Id === body.mediaSourceId) ?? info.MediaSources[0];
  if (!source) throw new HttpError(404, t('No playable file found'));

  // Nobody chose an audio track and the default one needs converting: try a same-language track that plays as-is.
  if (body.audioStreamIndex === undefined && !(allowDirectPlay && source.SupportsDirectPlay) && reasonsOf(source).some((r) => /^Audio/i.test(r))) {
    const better = playableAudioAlternative(source.MediaStreams ?? [], source.DefaultAudioStreamIndex, profileAudio(body.deviceProfile));
    if (better) {
      const retry = await ask(better.Index);
      const again = retry.MediaSources.find((s) => s.Id === source!.Id) ?? retry.MediaSources[0];
      if (!retry.ErrorCode && again) {
        info = retry;
        source = { ...again, DefaultAudioStreamIndex: better.Index };
      }
    }
  }

  let method: PlaybackSession['method'];
  let url: string;
  const reasons = reasonsOf(source);
  if (allowDirectPlay && source.SupportsDirectPlay) {
    method = 'DirectPlay';
    url = proxied(`/Videos/${itemId}/stream?static=true&mediaSourceId=${source.Id}&playSessionId=${info.PlaySessionId}`);
  } else if (source.TranscodingUrl) {
    // Container/audio-only reasons mean Jellyfin copies the video and just repackages (cheap on a Pi).
    method = reasons.length && reasons.every((r) => /^(ContainerNotSupported|Audio|SecondaryAudio|StreamCount)/i.test(r.trim()))
      ? 'DirectStream'
      : 'Transcode';
    url = proxied(source.TranscodingUrl);
  } else if (source.SupportsDirectStream) {
    method = 'DirectStream';
    url = proxied(`/Videos/${itemId}/stream.${source.Container ?? 'mp4'}?static=true&mediaSourceId=${source.Id}&playSessionId=${info.PlaySessionId}`);
  } else {
    throw new HttpError(415, t("This file can't be played in this app yet"));
  }

  return {
    itemId,
    mediaSourceId: source.Id,
    playSessionId: info.PlaySessionId,
    method,
    url,
    isHls: /\.m3u8/i.test(url),
    durationSeconds: ticksToSeconds(source.RunTimeTicks) || undefined,
    ...tracks(itemId, source),
    audioStreamIndex: body.audioStreamIndex ?? source.DefaultAudioStreamIndex,
    subtitleStreamIndex: body.subtitleStreamIndex ?? source.DefaultSubtitleStreamIndex,
    transcodeReasons: reasons,
  };
}

export async function reportProgress(user: SessionUser, report: ProgressReport) {
  if (!report?.itemId || !report.playSessionId) throw new HttpError(400, 'itemId and playSessionId are required');
  await jellyfin.reportPlayback(user.token, report.event, {
    ItemId: report.itemId,
    MediaSourceId: report.mediaSourceId,
    PlaySessionId: report.playSessionId,
    PositionTicks: secondsToTicks(report.positionSeconds ?? 0),
    IsPaused: Boolean(report.isPaused),
    PlayMethod: report.method,
    AudioStreamIndex: report.audioStreamIndex,
    SubtitleStreamIndex: report.subtitleStreamIndex,
    CanSeek: true,
  });
}

// ---------- Offline downloads (desktop and iPhone/iPad apps) ----------

/**
 * Which app is downloading: Chromium (desktop) plays MKV; Apple devices need MP4 with
 * H.264/HEVC (Dolby sound fine); Android's web view needs MP4 with AAC/MP3/Opus/FLAC sound.
 * `original`: the app plays downloads with mpv, so the file is saved exactly as it is.
 */
export type OfflineTarget = 'desktop' | 'apple' | 'mp4' | 'original';

const PLAYABLE: Record<OfflineTarget, { audio: Set<string>; containers: string[]; video?: Set<string> }> = {
  desktop: { audio: new Set(['aac', 'mp3', 'opus', 'flac', 'vorbis']), containers: ['mkv', 'matroska', 'mp4', 'm4v', 'mov', 'webm'] },
  apple: { audio: new Set(['aac', 'mp3', 'ac3', 'eac3', 'alac']), containers: ['mp4', 'm4v', 'mov'], video: new Set(['h264', 'hevc']) },
  mp4: { audio: new Set(['aac', 'mp3', 'opus', 'flac']), containers: ['mp4', 'm4v', 'mov'], video: new Set(['h264', 'hevc']) },
  original: { audio: new Set(), containers: [] },
};
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

/**
 * What to download for offline viewing. The original file when the app can play
 * it as-is; otherwise the same video with the audio converted to AAC by
 * Jellyfin on the way (AC3/DTS have no sound in the app). Respects Jellyfin's
 * per-user "Allow media downloading".
 */
export async function offlineInfo(user: SessionUser, itemId: string, target: OfflineTarget = 'desktop'): Promise<OfflineDescriptor> {
  if (!user.canDownload) throw new HttpError(403, t('Your Jellyfin account isn\'t allowed to download. An admin can turn on "Allow media downloading" for you in Jellyfin.'));
  const [item, info] = await Promise.all([jellyfin.item(user.token, user.id, itemId), playInfo(user, itemId)]);
  if (item.Type !== 'Movie' && item.Type !== 'Episode') throw new HttpError(400, t('Only movies and episodes can be downloaded'));
  const source = item.MediaSources?.[0];
  if (!source) throw new HttpError(404, t('No file to download'));

  const streams = source.MediaStreams ?? item.MediaStreams ?? [];
  const playable = PLAYABLE[target];
  const defaultAudio = streams.find((s) => s.Type === 'Audio' && s.IsDefault) ?? streams.find((s) => s.Type === 'Audio');
  // A same-language track that plays as-is beats converting the default one (no work for the Pi).
  const keep = target === 'original';
  const alternative = keep ? undefined : playableAudioAlternative(streams, defaultAudio?.Index, playable.audio);
  const audio = alternative ?? defaultAudio;
  const video = streams.find((s) => s.Type === 'Video');
  const container = (source.Container ?? '').toLowerCase();
  const videoCodec = (video?.Codec ?? '').toLowerCase();
  const original =
    keep ||
    (!alternative &&
    (!audio || playable.audio.has((audio.Codec ?? '').toLowerCase())) &&
    (!playable.video || playable.video.has(videoCodec)) &&
    playable.containers.some((c) => container.split(',').includes(c)));
  const apple = target === 'apple' || target === 'mp4'; // MP4 with H.264/HEVC for both Apple and Android
  const ext = original ? (container.split(',')[0] === 'matroska' ? 'mkv' : container.split(',')[0] || 'mkv') : apple ? 'mp4' : 'mkv';

  const label = episodeLabel(item);
  const name =
    item.Type === 'Episode'
      ? `${item.SeriesName ?? 'Episode'} ${label ? label.replace(':', '') : ''} ${item.Name}`
      : `${item.Name}${item.ProductionYear ? ` (${item.ProductionYear})` : ''}`;

  const url = original
    ? `${JF_PREFIX}/Items/${itemId}/Download`
    : `${JF_PREFIX}/Videos/${itemId}/stream.${ext}${buildQuery({
        static: false,
        mediaSourceId: source.Id,
        deviceId: 'netfish-offline',
        playSessionId: randomUUID().replace(/-/g, ''),
        // Apple: keep H.264/HEVC as they are, anything else becomes H.264 (slow on a Pi).
        videoCodec: apple ? (playable.video!.has(videoCodec) ? videoCodec : 'h264') : video?.Codec ?? 'h264',
        allowVideoStreamCopy: true,
        // The chosen track as-is when it plays here, otherwise converted to AAC.
        audioCodec: alternative ? (alternative.Codec ?? 'aac').toLowerCase() : 'aac',
        allowAudioStreamCopy: Boolean(alternative),
        audioStreamIndex: audio?.Index,
        maxAudioChannels: 6,
        audioBitRate: 384000,
        copyTimestamps: true,
      })}`;

  const duration = ticksToSeconds(source.RunTimeTicks ?? item.RunTimeTicks) || undefined;
  const estimate = source.Bitrate && duration ? Math.round((source.Bitrate / 8) * duration) : undefined;

  return {
    itemId,
    kind: item.Type,
    title: item.Name,
    seriesId: item.SeriesId,
    seriesTitle: item.SeriesName,
    seasonNumber: item.ParentIndexNumber,
    episodeNumber: item.IndexNumber,
    subtitle: item.Type === 'Episode' ? [label, item.Name].filter(Boolean).join(' · ') : item.ProductionYear ? String(item.ProductionYear) : undefined,
    fileName: `${safeName(name)}.${ext}`,
    url,
    size: original ? source.Size : estimate,
    converted: !original,
    poster:
      item.Type === 'Episode'
        ? jfImage(item.SeriesId, 'Primary', item.SeriesPrimaryImageTag, { maxHeight: 480 })
        : jfImage(item.Id, 'Primary', item.ImageTags?.Primary, { maxHeight: 480 }),
    backdrop: info.backdrop,
    durationSeconds: duration,
    // Text subtitles as files beside the video. An original file already holds its own
    // tracks, so then only the separate ones (e.g. fetched by Bazarr) are needed.
    subtitles: streams
      .filter((s) => s.Type === 'Subtitle' && s.IsTextSubtitleStream !== false && !/pgs|dvd|dvb|vobsub/i.test(s.Codec ?? ''))
      .filter((s) => !keep || s.IsExternal)
      .map((s) => ({
        label: trackLabel(s),
        code: findLanguage(s.Language)?.code ?? s.Language,
        url: `${JF_PREFIX}/Videos/${itemId}/${source.Id}/Subtitles/${s.Index}/0/Stream.vtt`,
      })),
    detailHref: info.detailHref,
  };
}
