[Italiano](it/iphone-ipad.md)

# iPhone & iPad

Apple only lets apps outside the App Store onto an iPhone through a Mac, or through tools that do the same job. Pick one:

| | Web app on the Home Screen | Install with Xcode | AltStore / SideStore |
|---|---|---|---|
| Needs | Safari | A Mac with Xcode, a cable | A computer once, then nothing |
| Cost | Free | Free (or $99/year, see below) | Free |
| Lasts | Forever | 7 days, then plug in and reinstall | Renews itself every 7 days |
| Downloads for offline viewing | No | Yes | Yes |
| Picture in picture, AirPlay | Yes | Yes | Yes |

Films play with Apple's player in all three. MP4 and HEVC play as-is; MKV files are repackaged by your server on the fly (light work), and DTS/TrueHD sound is converted.

<img src="../screenshots/phone.jpg" alt="Netfish on a phone" width="300">

## Option 1: Web app on the Home Screen (simplest)

1. Open **Safari** and go to your server, e.g. `http://192.168.1.50:7777`. Sign in.
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Open Netfish from its icon. It opens full screen, like an app.

## Option 2: Install with Xcode (free Apple ID)

You need a Mac. It takes about 30 minutes the first time, mostly downloading Xcode.

1. **Get Xcode** from the Mac App Store. Open it once, agree to the licence, and let it install its components. When it asks which platforms to add, include **iOS**.
2. **Add your Apple ID:** Xcode → **Settings** → **Accounts** → **+** → **Apple ID**, and sign in.
3. **Get the Netfish project:** on the [GitHub page](https://github.com/ravifrancesco/netfish), click **Code → Download ZIP** and unzip it (or `git clone https://github.com/ravifrancesco/netfish`). Open `apps/ios/Netfish.xcodeproj` (double-click it).
4. **Choose your team:**
   1. In Xcode's left sidebar, click the blue **Netfish** icon at the top.
   2. Under **TARGETS**, click **Netfish**.
   3. Open the **Signing & Capabilities** tab and tick **Automatically manage signing**.
   4. Under **Team**, choose **"Your Name (Personal Team)"**.

   If it says the bundle identifier isn't available, change `app.netfish.ios` to something of your own, like `com.yourname.netfish`.
5. **Connect the iPhone** with a cable, unlock it and tap **Trust** when it asks about the computer.
6. **Turn on Developer Mode on the iPhone:** **Settings → Privacy & Security**, scroll to the very bottom, tap **Developer Mode**, switch it on, and tap **Restart**. After the restart, unlock it and tap **Turn On**.
   If Developer Mode isn't listed, keep the iPhone plugged in, open Xcode's **Window → Devices and Simulators** (⇧⌘2) so Xcode sees the phone, then reopen Settings.
7. **Install:** at the top of Xcode's window, choose your iPhone as the destination and click **▶ Run** (⌘R). The first build takes a minute or two.
8. **Trust the app:** the first time, the iPhone refuses to open it. Go to **Settings → General → VPN & Device Management**, tap your Apple ID under *Developer App*, and tap **Trust**.
9. Open **Netfish**, allow it to find devices on your **local network**, and enter your server's address.

**Every 7 days** (free Apple ID): the app stops opening. Plug the iPhone in and press **▶ Run** in Xcode again; your downloads and sign-in are kept. A paid [Apple Developer account](https://developer.apple.com/programs/) ($99/year) makes each install last a year and lets you use TestFlight instead of a cable.

## Option 3: AltStore or SideStore

[AltStore](https://altstore.io) and [SideStore](https://sidestore.io) are free community tools that install apps with your own Apple ID and renew them automatically, so you don't have to reinstall every week. They aren't made by Apple or Netfish.

1. Set up AltStore (needs a computer running AltServer on your Wi-Fi) or SideStore (works on the phone alone after setup) by following their own guides.
2. On the iPhone, download **[Netfish-ios.ipa](https://github.com/ravifrancesco/netfish/releases/latest/download/Netfish-ios.ipa)**.
3. Open it with AltStore/SideStore (Share → AltStore/SideStore, or **+** in the app and pick the file). It signs and installs Netfish.
4. Do steps 6, 8 and 9 of option 2 (Developer Mode, Trust, server address) if asked.

## Problems

- **"Unable to verify app" / "Untrusted developer":** do step 8 of option 2.
- **The app opens but can't reach the server:** check **Settings → Netfish → Local Network** is on, and the iPhone is on the same Wi-Fi as the server.
- **The app stopped opening after a week:** the free Apple ID's 7 days are up. Reinstall it (option 2, step 7), or use option 3.
