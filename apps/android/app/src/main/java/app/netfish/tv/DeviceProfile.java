package app.netfish.tv;

import android.media.MediaCodecInfo;
import android.media.MediaCodecList;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/**
 * What this TV plays as-is, in Jellyfin's terms. Video codecs come from the
 * device's real decoders (so an older Fire TV Stick without AV1 or 10-bit HEVC
 * gets those converted); sound is decoded by FFmpeg inside the app, so every
 * common format plays. Jellyfin then sends files untouched whenever it can.
 */
final class DeviceProfile {
    private DeviceProfile() {}

    private static final String AUDIO = "aac,mp3,mp2,ac3,eac3,dts,dca,truehd,mlp,flac,alac,opus,vorbis,pcm_s16le,pcm_s24le";
    private static final String CONTAINERS = "mkv,webm,mp4,m4v,mov,3gp,ts,m2ts,mts,mpegts,ogv,avi";
    private static final String[] SUBTITLES = {"srt", "subrip", "ass", "ssa", "vtt", "webvtt", "pgs", "pgssub", "dvdsub", "dvbsub", "mov_text"};
    private static final String[] TEXT_SUBTITLES = {"srt", "subrip", "ass", "ssa", "vtt", "webvtt"};

    static String build() {
        Set<String> video = new LinkedHashSet<>();
        boolean hevc10 = false;
        for (MediaCodecInfo codec : new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()) {
            if (codec.isEncoder()) continue;
            for (String type : codec.getSupportedTypes()) {
                switch (type.toLowerCase(Locale.ROOT)) {
                    case "video/avc": video.add("h264"); break;
                    case "video/hevc":
                        video.add("hevc");
                        for (MediaCodecInfo.CodecProfileLevel level : codec.getCapabilitiesForType(type).profileLevels) {
                            if (level.profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10
                                    || level.profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10) hevc10 = true;
                        }
                        break;
                    case "video/av01": video.add("av1"); break;
                    case "video/x-vnd.on2.vp9": video.add("vp9"); break;
                    case "video/x-vnd.on2.vp8": video.add("vp8"); break;
                    case "video/mpeg2": video.add("mpeg2video"); break;
                    case "video/mp4v-es": video.add("mpeg4"); break;
                    default: break;
                }
            }
        }
        if (video.isEmpty()) video.add("h264");
        String videoCodecs = String.join(",", video);

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
                    .put("VideoCodec", video.contains("hevc") ? "hevc,h264" : "h264")
                    .put("AudioCodec", "aac,ac3,eac3,mp3")
                    .put("MaxAudioChannels", "8")
                    .put("MinSegments", 1)
                    .put("BreakOnNonKeyFrames", true)));

            JSONArray codecProfiles = new JSONArray();
            if (video.contains("hevc") && !hevc10) {
                // No 10-bit HEVC decoder: those files need converting, 8-bit ones don't.
                codecProfiles.put(new JSONObject().put("Type", "Video").put("Codec", "hevc").put("Conditions", new JSONArray()
                        .put(new JSONObject().put("Condition", "LessThanEqual").put("Property", "VideoBitDepth").put("Value", "8").put("IsRequired", false))));
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
