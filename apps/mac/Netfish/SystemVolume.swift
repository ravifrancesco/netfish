import AudioToolbox
import CoreAudio
import Foundation

/// The Mac's output volume, the one the volume keys and Control Centre change: the player's
/// slider follows it and sets it, and mpv plays at full volume. It follows the default output
/// (headphones plugged in, AirPods connected…). Some outputs have no volume of their own (some
/// HDMI and digital ones): then `state` is nil and the player keeps its own volume.
@MainActor
final class SystemVolume {
    static let shared = SystemVolume()

    /// Told when the volume, the mute or the output changes.
    var onChange: (() -> Void)?

    private var device = AudioObjectID(kAudioObjectUnknown)
    private var watched: [AudioObjectPropertyAddress] = []
    private let changed: AudioObjectPropertyListenerBlock
    private let outputChanged: AudioObjectPropertyListenerBlock

    private static func address(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioDevicePropertyScopeOutput) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    }
    private static let volume = address(kAudioHardwareServiceDeviceProperty_VirtualMainVolume)
    private static let mute = address(kAudioDevicePropertyMute)
    private static let output = address(kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal)

    private init() {
        weak var me: SystemVolume?
        changed = { _, _ in MainActor.assumeIsolated { me?.onChange?() } }
        outputChanged = { _, _ in
            MainActor.assumeIsolated {
                me?.follow()
                me?.onChange?()
            }
        }
        me = self
        var address = Self.output
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, .main, outputChanged)
        follow()
    }

    /// Listens to the default output's volume and mute (and no longer to the last one's).
    private func follow() {
        for var address in watched { AudioObjectRemovePropertyListenerBlock(device, &address, .main, changed) }
        watched = []
        var id = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var address = Self.output
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &id) == noErr else {
            device = AudioObjectID(kAudioObjectUnknown)
            return
        }
        device = id
        for property in [Self.volume, Self.mute] {
            var address = property
            if AudioObjectHasProperty(device, &address), AudioObjectAddPropertyListenerBlock(device, &address, .main, changed) == noErr {
                watched.append(property)
            }
        }
    }

    private func settable(_ property: AudioObjectPropertyAddress) -> Bool {
        var address = property
        var ok: DarwinBoolean = false
        return device != kAudioObjectUnknown && AudioObjectHasProperty(device, &address)
            && AudioObjectIsPropertySettable(device, &address, &ok) == noErr && ok.boolValue
    }

    /// The volume (0 to 1) and whether it's muted; nil when this output's volume can't be set.
    var state: (volume: Double, muted: Bool)? {
        guard settable(Self.volume) else { return nil }
        var address = Self.volume
        var level = Float32(0)
        var size = UInt32(MemoryLayout<Float32>.size)
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &level) == noErr else { return nil }
        var muted = UInt32(0)
        var muteAddress = Self.mute
        size = UInt32(MemoryLayout<UInt32>.size)
        if AudioObjectHasProperty(device, &muteAddress) { _ = AudioObjectGetPropertyData(device, &muteAddress, 0, nil, &size, &muted) }
        return (Double(level), muted != 0)
    }

    func set(volume: Double) {
        guard settable(Self.volume) else { return }
        var address = Self.volume
        var level = Float32(min(1, max(0, volume)))
        _ = AudioObjectSetPropertyData(device, &address, 0, nil, UInt32(MemoryLayout<Float32>.size), &level)
    }

    func set(muted: Bool) {
        guard settable(Self.mute) else { return }
        var address = Self.mute
        var value = UInt32(muted ? 1 : 0)
        _ = AudioObjectSetPropertyData(device, &address, 0, nil, UInt32(MemoryLayout<UInt32>.size), &value)
    }

    /// For the page: `available`, and the volume and mute when it is.
    var json: [String: Any] {
        guard let state else { return ["available": false] }
        return ["available": true, "volume": state.volume, "muted": state.muted]
    }
}
