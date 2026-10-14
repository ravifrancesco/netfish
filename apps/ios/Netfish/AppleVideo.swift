import AVFoundation
import AVKit
import UIKit
import VideoToolbox

/// The film, drawn by Apple's player underneath the (transparent) Netfish page,
/// the way the Mac app does it with mpv: Netfish's own player controls on top,
/// AVPlayer below (hardware decoding, picture in picture, AirPlay). The page
/// shows the subtitles itself, since AVPlayer can't take subtitle files.
final class AppleVideo: NSObject {
    /// State changes for the page: time, duration, pause, buffering, loaded, ended.
    var onState: (([String: Any]) -> Void)?
    let view = PlayerSurface()

    private let player = AVPlayer()
    private var timeObserver: Any?
    private var statusObservation: NSKeyValueObservation?
    private var itemObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var pictureInPicture: AVPictureInPictureController?
    private var loaded = false
    private var start: Double = 0

    override init() {
        super.init()
        view.playerLayer.player = player
        view.playerLayer.videoGravity = .resizeAspect
        view.backgroundColor = .black
        view.isHidden = true
        player.allowsExternalPlayback = true
        statusObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            DispatchQueue.main.async { self?.statusChanged(player.timeControlStatus) }
        }
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main) { [weak self] time in
            self?.tick(time)
        }
        if AVPictureInPictureController.isPictureInPictureSupported() {
            pictureInPicture = AVPictureInPictureController(playerLayer: view.playerLayer)
            // Leaving the app mid-film keeps it playing in a small window.
            pictureInPicture?.canStartPictureInPictureAutomaticallyFromInline = true
        }
    }

    // ---------- From the page ----------

    func load(url: URL, start: Double, cookies: [HTTPCookie]) {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        let asset = AVURLAsset(url: url, options: [AVURLAssetHTTPCookiesKey: cookies])
        let item = AVPlayerItem(asset: asset)
        loaded = false
        self.start = start
        itemObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            DispatchQueue.main.async { self?.itemStatusChanged(item) }
        }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            self?.onState?(["ended": true, "finished": true])
        }
        player.replaceCurrentItem(with: item)
        view.isHidden = false
    }

    func command(_ name: String, _ value: Any?) {
        switch name {
        case "play": player.play()
        case "pause": player.pause()
        case "seek":
            if let seconds = (value as? NSNumber)?.doubleValue { player.seek(to: CMTime(seconds: max(0, seconds), preferredTimescale: 600)) }
        case "volume":
            if let level = (value as? NSNumber)?.floatValue { player.volume = level }
        case "mute": player.isMuted = (value as? Bool) == true
        case "stop": stop()
        default: break // tracks and subtitles are handled by the page and the server
        }
    }

    func stop() {
        player.pause()
        player.replaceCurrentItem(with: nil)
        itemObservation = nil
        loaded = false
        view.isHidden = true
    }

    // ---------- To the page ----------

    private func itemStatusChanged(_ item: AVPlayerItem) {
        switch item.status {
        case .readyToPlay where !loaded:
            loaded = true
            let begin = { [weak self] in
                guard let self else { return }
                self.player.play()
                let duration = item.duration.seconds
                self.onState?(["loaded": true, "pause": false, "duration": duration.isFinite ? duration : NSNull()])
            }
            if start > 0 {
                player.seek(to: CMTime(seconds: start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { _ in
                    DispatchQueue.main.async(execute: begin)
                }
            } else {
                begin()
            }
        case .failed:
            onState?(["ended": true, "error": item.error?.localizedDescription ?? "This video couldn't play here"])
        default:
            break
        }
    }

    private func statusChanged(_ status: AVPlayer.TimeControlStatus) {
        guard loaded else { return }
        switch status {
        case .paused: onState?(["pause": true, "paused-for-cache": false])
        case .playing: onState?(["pause": false, "paused-for-cache": false])
        case .waitingToPlayAtSpecifiedRate: onState?(["paused-for-cache": true])
        @unknown default: break
        }
    }

    private func tick(_ time: CMTime) {
        guard loaded, let item = player.currentItem, time.seconds.isFinite else { return }
        var state: [String: Any] = ["time-pos": time.seconds]
        if let range = item.loadedTimeRanges.last?.timeRangeValue, range.end.seconds.isFinite { state["demuxer-cache-time"] = range.end.seconds }
        if item.duration.seconds.isFinite { state["duration"] = item.duration.seconds }
        onState?(state)
    }

    // ---------- What it plays ----------

    /// What AVPlayer plays as-is. MKV gets rewrapped by the server (light work) and
    /// DTS/TrueHD sound converted; Dolby (AC3/E-AC3) and HEVC play directly.
    static var profile: [String: Any] {
        var video = ["h264", "hevc"]
        if VTIsHardwareDecodeSupported(kCMVideoCodecType_AV1) { video.append("av1") }
        let audio = "aac,ac3,eac3,mp3,alac,flac"
        return [
            "Name": "Netfish for iPhone & iPad",
            "MaxStreamingBitrate": 120_000_000,
            "MaxStaticBitrate": 120_000_000,
            "MusicStreamingTranscodingBitrate": 384_000,
            "DirectPlayProfiles": [["Type": "Video", "Container": "mp4,m4v,mov", "VideoCodec": video.joined(separator: ","), "AudioCodec": audio]],
            "TranscodingProfiles": [[
                "Container": "mp4", "Type": "Video", "Protocol": "hls", "Context": "Streaming",
                "VideoCodec": video.reversed().joined(separator: ","), "AudioCodec": audio, "MaxAudioChannels": "8",
                "MinSegments": 2, "BreakOnNonKeyFrames": true,
            ]],
            "ContainerProfiles": [],
            "CodecProfiles": [],
            // Text subtitles: the page shows them. Picture subtitles: drawn into the video by the server.
            "SubtitleProfiles": ["vtt", "webvtt", "srt", "subrip", "ass", "ssa", "mov_text"].map { ["Format": $0, "Method": "External"] }
                + ["pgs", "pgssub", "dvdsub", "dvbsub", "vobsub"].map { ["Format": $0, "Method": "Encode"] },
        ]
    }
}

/// A view whose layer is the player's picture.
final class PlayerSurface: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}
