[Italiano](it/README.md)

# Installing Netfish

Netfish has two parts:

1. **The server**, which runs next to Jellyfin (usually on a Raspberry Pi with Portainer). You set it up once: **[Server guide](server.md)**.
2. **The apps** you watch on. Every app just needs your server's address (for example `192.168.1.50`); the interface, your account and your settings all come from the server.

| Device | Guide | How hard |
|---|---|---|
| Any web browser | Open `http://<your-server>:7777` | Nothing to install |
| Mac (Apple silicon) | [Mac](mac.md) | Easy |
| Windows 10/11 | [Windows](windows.md) | Easy |
| Android phone or tablet | [Android](android.md) | Easy |
| Amazon Fire TV / Fire Stick, Android TV, Google TV | [Fire TV & Android TV](fire-tv.md) | A few settings to change once |
| iPhone & iPad | [iPhone & iPad](iphone-ipad.md) | Needs a Mac, or use the browser version |
| Samsung TV (2022 or newer) | [Samsung TV](samsung-tv.md) | Needs a computer and some patience |

All downloads are on the [Releases page](https://github.com/ravifrancesco/netfish/releases/latest). The links in these guides always give the newest version.

**Finding your server's address:** it's the address you open Netfish at in a browser. On the Pi, `hostname -I` prints it (the first number, like `192.168.1.50`). Netfish adds the port `:7777` by itself.
