import AVFoundation
import MediaPlayer
import UIKit

/// The player's up-and-down swipes: the screen's brightness and the volume, 0 to 1. The screen
/// gets its own brightness back when the film stops or Netfish goes to the background.
@MainActor
enum Levels {
    /// The brightness before the first swipe changed it.
    private static var before: CGFloat?
    /// iOS lets an app set the volume only through a volume slider: this one, kept out of sight
    /// (while it's there, the system doesn't draw its own volume over the film either).
    private static let volumeView = MPVolumeView(frame: CGRect(x: -100, y: -100, width: 10, height: 10))

    private static func screen(_ view: UIView) -> UIScreen? { view.window?.windowScene?.screen }

    static func current(_ view: UIView) -> [String: Double] {
        if volumeView.superview == nil { view.addSubview(volumeView) }
        return [
            "brightness": Double(screen(view)?.brightness ?? 0.5),
            "volume": Double(AVAudioSession.sharedInstance().outputVolume),
        ]
    }

    static func set(_ which: String, _ level: Double, in view: UIView) {
        let value = min(1, max(0, level))
        switch which {
        case "brightness":
            guard let screen = screen(view) else { return }
            if before == nil { before = screen.brightness }
            screen.brightness = CGFloat(value)
        case "volume":
            if volumeView.superview == nil { view.addSubview(volumeView) }
            volumeView.subviews.compactMap { $0 as? UISlider }.first?.setValue(Float(value), animated: false)
        default: break
        }
    }

    /// The screen's own brightness back.
    static func restore(_ view: UIView) {
        guard let before else { return }
        screen(view)?.brightness = before
        Self.before = nil
    }
}
