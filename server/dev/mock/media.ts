import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A 3-minute test video with two audio tracks (English = 440 Hz tone,
 * Spanish = 660 Hz tone, so switching is audible) plus HLS renditions for the
 * "transcode" path. Generated once with the local ffmpeg.
 */

export const MEDIA_DIR = path.resolve(__dirname, '../media');
export const SAMPLE = path.join(MEDIA_DIR, 'sample.mp4');
export const DURATION_SECONDS = 180;

function run(args: string[]) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

/** Like a Blu-ray rip: MKV with Dolby Digital 5.1 and DTS sound, which browsers can't play. */
export const SAMPLE_DOLBY = path.join(MEDIA_DIR, 'sample-dolby.mkv');

function ensureDolby() {
  if (fs.existsSync(SAMPLE_DOLBY)) return;
  console.log('[mock] generating the Dolby/DTS sample (one-time)…');
  run([
    '-i', SAMPLE, '-map', '0:v:0', '-map', '0:a:0', '-map', '0:a:0',
    '-c:v', 'copy', '-c:a:0', 'ac3', '-ac:a:0', '6', '-b:a:0', '384k', '-c:a:1', 'dca', '-strict', '-2', '-ac:a:1', '2',
    '-metadata:s:a:0', 'language=eng', '-metadata:s:a:0', 'title=Dolby Digital 5.1',
    '-metadata:s:a:1', 'language=eng', '-metadata:s:a:1', 'title=DTS',
    SAMPLE_DOLBY,
  ]);
}

export function ensureMedia(): boolean {
  if (fs.existsSync(path.join(MEDIA_DIR, 'hls-2', 'index.m3u8'))) {
    ensureDolby();
    return true;
  }
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    console.warn('[mock] ffmpeg not found — playback will not work in the mock.');
    return false;
  }
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  console.log('[mock] generating sample video (one-time)…');
  run([
    '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=24:duration=${DURATION_SECONDS}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${DURATION_SECONDS}`,
    '-f', 'lavfi', '-i', `sine=frequency=660:duration=${DURATION_SECONDS}`,
    '-map', '0:v', '-map', '1:a', '-map', '2:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-pix_fmt', 'yuv420p', '-g', '48',
    '-c:a', 'aac', '-b:a', '64k',
    '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=spa',
    '-movflags', '+faststart', SAMPLE,
  ]);
  // HLS renditions keyed by Jellyfin-style stream index (1 = English, 2 = Spanish).
  for (const [index, audio] of [[1, 0], [2, 1]] as const) {
    const dir = path.join(MEDIA_DIR, `hls-${index}`);
    fs.mkdirSync(dir, { recursive: true });
    run([
      '-i', SAMPLE, '-map', '0:v:0', '-map', `0:a:${audio}`, '-c', 'copy',
      '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod',
      '-hls_segment_filename', path.join(dir, 'seg%03d.ts'), path.join(dir, 'index.m3u8'),
    ]);
  }
  ensureDolby();
  return true;
}

export function subtitleVtt(language: string): string {
  const lines: string[] = ['WEBVTT', ''];
  const text: Record<string, string[]> = {
    en: ['The tide is turning.', 'Hold the line!', 'Something moved down there.', 'Back to the boat, now.'],
    es: ['La marea está cambiando.', '¡Aguanta!', 'Algo se movió ahí abajo.', 'Vuelve al barco, ya.'],
    fr: ['La marée tourne.', 'Tenez bon !', "Quelque chose a bougé là-dessous.", 'Retour au bateau, vite.'],
  };
  const phrases = text[language] ?? text.en;
  for (let t = 4, i = 0; t < DURATION_SECONDS; t += 8, i++) {
    const fmt = (s: number) => `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.000`;
    lines.push(`${fmt(t)} --> ${fmt(t + 5)}`, phrases[i % phrases.length], '');
  }
  return lines.join('\n');
}
