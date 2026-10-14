[Italiano](it/samsung-tv.md)

# Samsung TV

Netfish runs on Samsung TVs from **2022 or newer** (Tizen 6.5 and later). On older TVs the app opens but tells you the TV's browser is too old.

Samsung only lets you install apps outside its store in **Developer Mode**, with a computer on the same network. You do this once; after that Netfish updates itself through your server, except for the rare new app version.

How it works: the Netfish app on the TV is a small starter. It asks for your server's address once, then opens Netfish in TV mode. Films play with the TV's own player, which handles MKV, HEVC and Dolby sound itself, so your server just sends the file.

**You need:** the TV and a computer (Mac, Windows or Linux) on the same network, and the file **[Netfish-samsung.wgt](https://github.com/ravifrancesco/netfish/releases/latest/download/Netfish-samsung.wgt)** downloaded on the computer.

![Netfish in TV mode](../screenshots/tv.jpg)

## Step 1: Developer Mode on the TV (both methods)

1. On the computer, find its address:
   - **Mac:** System Settings → Wi-Fi (or Network) → Details → IP address.
   - **Windows:** Settings → Network & internet → your connection → IPv4 address.
2. On the TV, open **Apps** (the Apps panel from the Home menu).
3. With the remote, type **1 2 3 4 5**. On remotes without numbers, use the on-screen number pad that appears. A *Developer Mode* window opens.
4. Switch **Developer mode** to **On**, enter the computer's address as **Host PC IP**, and press **OK**.
5. Restart the TV: hold the power button until the Samsung logo appears again.

If the window doesn't open, make sure the TV is signed in to a Samsung account and you're in the Apps panel itself (not the Home bar).

## Step 2, method A: TizenBrew Installer (easier)

[TizenBrew](https://github.com/reisxd/TizenBrew) is a free community tool that installs apps on Samsung TVs without Samsung's developer software. It isn't made by Samsung or by Netfish.

1. Download **TizenBrew Installer Desktop** for your computer from its [releases page](https://github.com/reisxd/TizenBrewInstaller/releases). On a Mac or Linux you may need to allow it to run (Mac: right-click → Open).
2. Open it. It finds the TV (it must be in Developer Mode with your computer's address, step 1).
3. On Tizen 7 or newer TVs (2023 onwards) it asks you to sign in with a Samsung account, which it uses to create the certificate Samsung requires. That's normal.
4. Choose to install an app from a file (WGT), pick **Netfish-samsung.wgt**, and install.
5. Netfish appears in the TV's **Apps**. Open it and enter your server's address.

If the installer can't install the file, use method B: it always works.

## Step 2, method B: Tizen Studio (Samsung's official tools)

1. Install **[Tizen Studio](https://developer.tizen.org/development/tizen-studio/download)** (the version with the IDE is simplest).
2. Open **Package Manager** (from Tizen Studio's Tools menu or its install folder). Under **Extension SDK**, install **Samsung Certificate Extension** and **TV Extensions** (any version).
3. **Connect to the TV:** Tools → **Device Manager** → **Remote Device Manager** → **+**, enter the TV's address (on the TV: Settings → General → Network → Network status → IP settings), and switch **Connection** on. The TV appears in Device Manager.
4. **Make a Samsung certificate** (Samsung requires one per TV): Tools → **Certificate Manager** → **+** → **Samsung** → **TV** → name it `Netfish`.
   - Author certificate: create a new one (any name and password) and sign in with your Samsung account when asked.
   - Distributor certificate: **Public** privilege. Your TV's **DUID** is filled in automatically because the TV is connected; if not, add it from Device Manager.
5. **Sign and install**, in a terminal (Mac: Terminal; Windows: Command Prompt). The `tizen` command is in Tizen Studio's `tools/ide/bin` folder:
   ```bash
   mkdir netfish && cd netfish
   unzip ../Netfish-samsung.wgt
   tizen package -t wgt -s Netfish -- .
   sdb devices
   tizen install -n Netfish.wgt -t <TV name shown by sdb devices> -- .
   ```
   On Windows, unzip the `.wgt` by renaming it to `.zip` first.
6. Netfish appears in the TV's **Apps**. Open it and enter your server's address.

## Using it

- **Arrows** move, **OK** selects, **Back** closes menus and goes back; Back on the home screen closes Netfish.
- **Play/Pause** and the other media keys work in the player.
- To switch to a different server, press **▲** while "Opening Netfish at …" shows when the app starts.
- You can switch Developer Mode off again afterwards; Netfish stays installed.

## Updating

Most updates arrive through your server. When a release notes a new **Netfish-samsung.wgt**, install it again the same way (step 2). Your server address is kept.

## Problems

- **"Can't reach …":** check the address (try it in a browser on your phone), and that the TV and the server are on the same network.
- **Installation refused / certificate error:** the certificate must be made for *this* TV (its DUID). Recreate the distributor certificate with the TV connected.
- **"This TV's web browser is older than Netfish needs":** the TV is from before 2022. **Try anyway** may work partly; a computer or Fire TV Stick is the better option for that TV.
