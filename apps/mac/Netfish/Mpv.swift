import AppKit
import OpenGL.GL3

/// mpv, embedded the way Jellyfin Media Player and IINA do it: libmpv decodes
/// (with the Mac's hardware decoder) and draws each frame into an OpenGL layer
/// that sits *under* the transparent web page, so Netfish's own player
/// controls float on top of the picture. It plays practically every format,
/// so the server just sends the file.
final class MpvPlayer {
    /// Called on the main thread with what changed: time, duration, paused, buffering, volume…
    var onState: (([String: Any]) -> Void)?
    /// Called on the main thread when a file finishes (`finished`: reached the end) or fails.
    var onEnd: ((_ finished: Bool, _ error: String?) -> Void)?

    private let mpv: OpaquePointer
    private var render: OpaquePointer?
    private let events = DispatchQueue(label: "app.netfish.mpv-events")
    fileprivate weak var layer: MpvLayer?
    private var pendingExternal: [String] = []
    private var pendingSubtitle: String?
    private var loaded = false
    private var pendingLoad: (() -> Void)?

    init() {
        mpv = mpv_create()
        // A player inside an app: no mpv window, no config files, no mpv on-screen controls or keys.
        for (name, value) in [
            ("vo", "libmpv"), ("hwdec", "auto-safe"), ("config", "no"), ("load-scripts", "no"), ("osc", "no"),
            ("input-default-bindings", "no"), ("input-vo-keyboard", "no"), ("terminal", "no"), ("msg-level", "all=warn"),
            ("idle", "yes"), ("keep-open", "no"), ("cache", "yes"), ("demuxer-max-bytes", "150MiB"),
            ("sub-font-size", "46"), ("sub-border-size", "2.4"), ("sub-margin-y", "60"),
        ] {
            mpv_set_option_string(mpv, name, value)
        }
        mpv_initialize(mpv)
        for (id, name, format) in [
            (1, "time-pos", MPV_FORMAT_DOUBLE), (2, "duration", MPV_FORMAT_DOUBLE), (3, "pause", MPV_FORMAT_FLAG),
            (4, "paused-for-cache", MPV_FORMAT_FLAG), (5, "volume", MPV_FORMAT_DOUBLE), (6, "mute", MPV_FORMAT_FLAG),
            (7, "demuxer-cache-time", MPV_FORMAT_DOUBLE), (8, "seeking", MPV_FORMAT_FLAG),
            (9, "aid", MPV_FORMAT_INT64), (10, "sid", MPV_FORMAT_INT64), (11, "audio-codec-name", MPV_FORMAT_STRING),
        ] as [(UInt64, String, mpv_format)] {
            mpv_observe_property(mpv, id, name, format)
        }
        mpv_set_wakeup_callback(mpv, { context in
            let me = Unmanaged<MpvPlayer>.fromOpaque(context!).takeUnretainedValue()
            me.events.async { me.drainEvents() }
        }, Unmanaged.passUnretained(self).toOpaque())
    }

    // ---------- Commands ----------

    func command(_ args: [String]) {
        var cargs = args.map { strdup($0) } + [nil]
        defer { cargs.forEach { free($0) } }
        cargs.withUnsafeMutableBufferPointer { buffer in
            buffer.baseAddress!.withMemoryRebound(to: UnsafePointer<CChar>?.self, capacity: buffer.count) { _ = mpv_command(mpv, $0) }
        }
    }

    func set(_ name: String, _ value: String) {
        mpv_set_property_string(mpv, name, value)
    }

    /// Open a file/stream. `cookie`: the Netfish session, sent with every request (video and subtitle files).
    func load(url: String, start: Double, cookie: String, audio: Int?, subtitle: String, external: [String]) {
        // mpv only shows video if the drawing surface exists when the file opens.
        guard render != nil else {
            pendingLoad = { [weak self] in self?.load(url: url, start: start, cookie: cookie, audio: audio, subtitle: subtitle, external: external) }
            layer?.setNeedsDisplay()
            return
        }
        set("http-header-fields", "Cookie: \(cookie)")
        set("pause", "no")
        pendingExternal = external
        pendingSubtitle = subtitle
        loaded = false
        var options = ["start=\(max(0, start))"]
        if let audio { options.append("aid=\(audio)") }
        options.append(subtitle == "no" || !external.isEmpty ? "sid=no" : "sid=\(subtitle)")
        command(["loadfile", url, "replace", "-1", options.joined(separator: ",")])
    }

    func stop() {
        command(["stop"])
    }

    // ---------- Events (on the events queue) ----------

    private func drainEvents() {
        while true {
            guard let event = mpv_wait_event(mpv, 0)?.pointee, event.event_id != MPV_EVENT_NONE else { return }
            switch event.event_id {
            case MPV_EVENT_PROPERTY_CHANGE:
                guard let property = event.data?.assumingMemoryBound(to: mpv_event_property.self).pointee else { continue }
                let name = String(cString: property.name)
                var value: Any = NSNull()
                if property.format == MPV_FORMAT_DOUBLE, let data = property.data { value = data.assumingMemoryBound(to: Double.self).pointee }
                if property.format == MPV_FORMAT_FLAG, let data = property.data { value = data.assumingMemoryBound(to: CInt.self).pointee != 0 }
                if property.format == MPV_FORMAT_INT64, let data = property.data { value = Int(data.assumingMemoryBound(to: Int64.self).pointee) }
                if property.format == MPV_FORMAT_STRING, let data = property.data, let text = data.assumingMemoryBound(to: UnsafePointer<CChar>?.self).pointee {
                    value = String(cString: text)
                }
                DispatchQueue.main.async { self.onState?([name: value]) }
            case MPV_EVENT_FILE_LOADED:
                // Subtitle files that sit next to the video, then the chosen subtitle.
                let external = pendingExternal
                let subtitle = pendingSubtitle ?? "no"
                pendingExternal = []
                loaded = true
                // The page may have started listening after mpv's first updates: tell it where things stand.
                var paused: CInt = 0
                mpv_get_property(mpv, "pause", MPV_FORMAT_FLAG, &paused)
                DispatchQueue.main.async {
                    for url in external { self.command(["sub-add", url, "auto"]) }
                    if !external.isEmpty { self.set("sid", subtitle) }
                    self.onState?(["loaded": true, "pause": paused != 0])
                }
            case MPV_EVENT_END_FILE:
                guard let end = event.data?.assumingMemoryBound(to: mpv_event_end_file.self).pointee else { continue }
                if end.reason == MPV_END_FILE_REASON_EOF {
                    DispatchQueue.main.async { self.onEnd?(true, nil) }
                } else if end.reason == MPV_END_FILE_REASON_ERROR {
                    let message = String(cString: mpv_error_string(end.error))
                    DispatchQueue.main.async { self.onEnd?(false, message) }
                }
            case MPV_EVENT_SHUTDOWN:
                return
            default:
                continue
            }
        }
    }

    // ---------- Drawing (main thread, GL context current) ----------

    fileprivate func createRenderContext() {
        guard render == nil else { return }
        var initParams = mpv_opengl_init_params(get_proc_address: mpvGetProcAddress, get_proc_address_ctx: nil)
        let api = UnsafeMutableRawPointer(mutating: MpvPlayer.openglApi)
        withUnsafeMutablePointer(to: &initParams) { initPointer in
            var params = [
                mpv_render_param(type: MPV_RENDER_PARAM_API_TYPE, data: api),
                mpv_render_param(type: MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, data: UnsafeMutableRawPointer(initPointer)),
                mpv_render_param(),
            ]
            mpv_render_context_create(&render, mpv, &params)
        }
        mpv_render_context_set_update_callback(render, { context in
            let me = Unmanaged<MpvPlayer>.fromOpaque(context!).takeUnretainedValue()
            DispatchQueue.main.async {
                guard let render = me.render else { return }
                let flags = mpv_render_context_update(render)
                if MpvLayer.debug { MpvLayer.updates += 1; if MpvLayer.updates % 48 == 1 { print("mpv update flags=\(flags) layer=\(me.layer != nil)"); fflush(stdout) } }
                if flags & UInt64(MPV_RENDER_UPDATE_FRAME.rawValue) != 0 { me.layer?.setNeedsDisplay() }
            }
        }, Unmanaged.passUnretained(self).toOpaque())
        if let load = pendingLoad {
            pendingLoad = nil
            DispatchQueue.main.async(execute: load)
        }
    }

    private static let openglApi = UnsafePointer(strdup("opengl")!)

    fileprivate func draw(fbo: GLint, width: GLint, height: GLint) {
        guard let render else { return }
        var target = mpv_opengl_fbo(fbo: Int32(fbo), w: width, h: height, internal_format: 0)
        var flip: CInt = 1
        withUnsafeMutablePointer(to: &target) { targetPointer in
            withUnsafeMutablePointer(to: &flip) { flipPointer in
                var params = [
                    mpv_render_param(type: MPV_RENDER_PARAM_OPENGL_FBO, data: UnsafeMutableRawPointer(targetPointer)),
                    mpv_render_param(type: MPV_RENDER_PARAM_FLIP_Y, data: UnsafeMutableRawPointer(flipPointer)),
                    mpv_render_param(),
                ]
                mpv_render_context_render(render, &params)
            }
        }
    }

    func shutdown() {
        if let render {
            mpv_render_context_set_update_callback(render, nil, nil)
            mpv_render_context_free(render)
        }
        render = nil
        mpv_terminate_destroy(mpv)
    }
}

private func mpvGetProcAddress(_ context: UnsafeMutableRawPointer?, _ name: UnsafePointer<CChar>?) -> UnsafeMutableRawPointer? {
    guard let name else { return nil }
    let symbol = CFStringCreateWithCString(kCFAllocatorDefault, name, CFStringBuiltInEncodings.ASCII.rawValue)
    let bundle = CFBundleGetBundleWithIdentifier("com.apple.opengl" as CFString)
    return CFBundleGetFunctionPointerForName(bundle, symbol)
}

/// The layer mpv draws into. Black when nothing plays.
final class MpvLayer: CAOpenGLLayer {
    private let player: MpvPlayer
    static let debug = ProcessInfo.processInfo.environment["NETFISH_MPV_DEBUG"] != nil
    static var updates = 0
    private var frames = 0

    init(player: MpvPlayer) {
        self.player = player
        super.init()
        isAsynchronous = false
        needsDisplayOnBoundsChange = true
        backgroundColor = NSColor.black.cgColor
        player.layer = self
    }

    override init(layer: Any) {
        player = (layer as! MpvLayer).player
        super.init(layer: layer)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func copyCGLPixelFormat(forDisplayMask mask: UInt32) -> CGLPixelFormatObj {
        let attributes: [CGLPixelFormatAttribute] = [
            kCGLPFAOpenGLProfile, CGLPixelFormatAttribute(UInt32(kCGLOGLPVersion_3_2_Core.rawValue)),
            kCGLPFADoubleBuffer, kCGLPFAAccelerated, kCGLPFAAllowOfflineRenderers, kCGLPFASupportsAutomaticGraphicsSwitching,
            CGLPixelFormatAttribute(0),
        ]
        var format: CGLPixelFormatObj?
        var count: GLint = 0
        CGLChoosePixelFormat(attributes, &format, &count)
        return format!
    }

    override func copyCGLContext(forPixelFormat format: CGLPixelFormatObj) -> CGLContextObj {
        let context = super.copyCGLContext(forPixelFormat: format)
        CGLSetCurrentContext(context)
        player.createRenderContext()
        if MpvLayer.debug { print("mpv gl context ready"); fflush(stdout) }
        return context
    }

    override func canDraw(inCGLContext context: CGLContextObj, pixelFormat: CGLPixelFormatObj, forLayerTime t: CFTimeInterval, displayTime ts: UnsafePointer<CVTimeStamp>?) -> Bool {
        true
    }

    override func draw(inCGLContext context: CGLContextObj, pixelFormat: CGLPixelFormatObj, forLayerTime t: CFTimeInterval, displayTime ts: UnsafePointer<CVTimeStamp>?) {
        var fbo: GLint = 0
        glGetIntegerv(GLenum(GL_DRAW_FRAMEBUFFER_BINDING), &fbo)
        var viewport: [GLint] = [0, 0, 0, 0]
        glGetIntegerv(GLenum(GL_VIEWPORT), &viewport)
        glClearColor(0, 0, 0, 1)
        glClear(GLbitfield(GL_COLOR_BUFFER_BIT))
        player.draw(fbo: fbo, width: viewport[2], height: viewport[3])
        if MpvLayer.debug {
            // NETFISH_MPV_DEBUG=1: proof of life (frame count, size, centre pixel) for self-tests.
            frames += 1
            if frames % 48 == 1 {
                var pixel: [UInt8] = [0, 0, 0, 0]
                glBindFramebuffer(GLenum(GL_READ_FRAMEBUFFER), GLuint(fbo))
                glReadPixels(viewport[2] / 2, viewport[3] / 2, 1, 1, GLenum(GL_RGBA), GLenum(GL_UNSIGNED_BYTE), &pixel)
                print("mpv frames=\(frames) fbo=\(fbo) size=\(viewport[2])x\(viewport[3]) centre=rgb(\(pixel[0]),\(pixel[1]),\(pixel[2]))")
                fflush(stdout)
            }
        }
        super.draw(inCGLContext: context, pixelFormat: pixelFormat, forLayerTime: t, displayTime: ts)
    }
}

/// A view backed by the mpv layer, sized with the window.
final class MpvView: NSView {
    init(player: MpvPlayer) {
        super.init(frame: .zero)
        let layer = MpvLayer(player: player)
        self.layer = layer
        wantsLayer = true
        layerContentsRedrawPolicy = .duringViewResize
        autoresizingMask = [.width, .height]
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        layer?.contentsScale = window?.backingScaleFactor ?? 2
    }
}
