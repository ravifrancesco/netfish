package app.netfish.tv;

import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * What this device plays as-is, in Jellyfin's terms. Video codecs come from the
 * device's real decoders (so an older Fire TV Stick without AV1 or 10-bit HEVC
 * gets those converted), up to the largest picture they take; AV1 and VP9 only
 * with a decoder in the chip (a TV box's processor stutters through them; a
 * phone's copes up to 1080p). Sound is decoded by FFmpeg inside the app, so every
 * common format plays. Jellyfin then sends files untouched whenever it can.
 */
final class DeviceProfile {
    private DeviceProfile() {}

    private static final String AUDIO = "aac,mp3,mp2,ac3,eac3,dts,dca,truehd,mlp,flac,alac,opus,vorbis,pcm_s16le,pcm_s24le";
    private static final String CONTAINERS = "mkv,webm,mp4,m4v,mov,3gp,ts,m2ts,mts,mpegts,ogv,avi";
    private static final String[] SUBTITLES = {"srt", "subrip", "ass", "ssa", "vtt", "webvtt", "pgs", "pgssub", "dvdsub", "dvbsub", "mov_text"};
    private static final String[] TEXT_SUBTITLES = {"srt", "subrip", "ass", "ssa", "vtt", "webvtt"};

    /** Jellyfin's name for each kind of video Android decodes. */
    private static String codecOf(String type) {
        switch (type.toLowerCase(Locale.ROOT)) {
            case "video/avc": return "h264";
            case "video/hevc": return "hevc";
            case "video/av01": return "av1";
            case "video/x-vnd.on2.vp9": return "vp9";
            case "video/x-vnd.on2.vp8": return "vp8";
            case "video/mpeg2": return "mpeg2video";
            case "video/mp4v-es": return "mpeg4";
            default: return null;
        }
    }

    /** Decoded by the processor, not the chip: Android's own decoders, FFmpeg's, or ones Android says are. */
    private static boolean software(MediaCodecInfo codec) {
        String name = codec.getName().toLowerCase(Locale.ROOT);
        if (name.contains("v4l2")) return false; // a Raspberry Pi's chip
        if (name.startsWith("omx.google.") || name.startsWith("c2.android.") || name.contains("ffmpeg")) return true;
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && codec.isSoftwareOnly();
    }

    /** What a codec's decoders take: in the chip or not, the largest picture side, 10-bit (HEVC). */
    private static final class Decoders {
        boolean hardware;
        int largest;
        boolean tenBit;
    }

    /** `tv`: a TV or TV box, whose processor is too slow for AV1 and VP9 on its own. */
    static String build(boolean tv) {
        Map<String, Decoders> found = new LinkedHashMap<>();
        for (MediaCodecInfo codec : new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()) {
            if (codec.isEncoder()) continue;
            for (String type : codec.getSupportedTypes()) {
                String name = codecOf(type);
                if (name == null) continue;
                MediaCodecInfo.CodecCapabilities caps = codec.getCapabilitiesForType(type);
                boolean chip = !software(codec);
                Decoders d = found.computeIfAbsent(name, k -> new Decoders());
                // The chip's decoders say what plays smoothly; the processor's only if there's no chip one.
                if (chip && !d.hardware) {
                    d.hardware = true;
                    d.largest = 0;
                    d.tenBit = false;
                }
                if (chip != d.hardware) continue;
                MediaCodecInfo.VideoCapabilities v = caps.getVideoCapabilities();
                if (v != null) d.largest = Math.max(d.largest, Math.max(v.getSupportedWidths().getUpper(), v.getSupportedHeights().getUpper()));
                for (MediaCodecInfo.CodecProfileLevel level : caps.profileLevels) {
                    if (level.profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10
                            || level.profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10) d.tenBit = true;
                }
            }
        }
        // AV1 and VP9 by the processor alone: never on a TV, up to 1080p on a phone or tablet.
        for (String heavy : new String[] {"av1", "vp9"}) {
            Decoders d = found.get(heavy);
            if (d == null || d.hardware) continue;
            if (tv) found.remove(heavy);
            else d.largest = d.largest == 0 ? 1920 : Math.min(d.largest, 1920);
        }
        if (found.isEmpty()) found.put("h264", new Decoders());
        String videoCodecs = String.join(",", found.keySet());

        try {
            JSONObject profile = new JSONObject()
                    .put("Name", "Netfish TV (ExoPlayer)")
                    .put("MaxStreamingBitrate", 400_000_000)
                    .put("MaxStaticBitrate", 400_000_000)
                    .put("MusicStreamingTranscodingBitrate", 384_000);

            profile.put("DirectPlayProfiles", new JSONArray()
                    .put(new JSONObject().put("Type", "Video").put("Container", CONTAINERS).put("VideoCodec", videoCodecs).put("AudioCodec", AUDIO))
                    .put(new JSONObject().put("Type", "Audio")));

            profile.put("TranscodingProfiles", new JSONArray().put(new JSONObject()
                    .put("Container", "ts")
                    .put("Type", "Video")
                    .put("Protocol", "hls")
                    .put("Context", "Streaming")
                    .put("VideoCodec", found.containsKey("hevc") ? "hevc,h264" : "h264")
                    .put("AudioCodec", "aac,ac3,eac3,mp3")
                    .put("MaxAudioChannels", "8")
                    .put("MinSegments", 1)
                    .put("BreakOnNonKeyFrames", true)));

            JSONArray codecProfiles = new JSONArray();
            for (Map.Entry<String, Decoders> entry : found.entrySet()) {
                JSONArray conditions = new JSONArray();
                Decoders d = entry.getValue();
                // Bigger pictures than the decoders take (a Raspberry Pi's 4K H.264): converted to fit.
                if (d.largest > 0) {
                    for (String side : new String[] {"Width", "Height"}) {
                        conditions.put(new JSONObject().put("Condition", "LessThanEqual").put("Property", side).put("Value", String.valueOf(d.largest)).put("IsRequired", false));
                    }
                }
                // No 10-bit HEVC decoder: those files need converting, 8-bit ones don't.
                if (entry.getKey().equals("hevc") && !d.tenBit) {
                    conditions.put(new JSONObject().put("Condition", "LessThanEqual").put("Property", "VideoBitDepth").put("Value", "8").put("IsRequired", false));
                }
                if (conditions.length() > 0) codecProfiles.put(new JSONObject().put("Type", "Video").put("Codec", entry.getKey()).put("Conditions", conditions));
            }
            profile.put("CodecProfiles", codecProfiles);
            profile.put("ContainerProfiles", new JSONArray());

            JSONArray subtitles = new JSONArray();
            for (String format : SUBTITLES) subtitles.put(new JSONObject().put("Format", format).put("Method", "Embed"));
            for (String format : TEXT_SUBTITLES) subtitles.put(new JSONObject().put("Format", format).put("Method", "External"));
            profile.put("SubtitleProfiles", subtitles);
            return profile.toString();
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }
}
