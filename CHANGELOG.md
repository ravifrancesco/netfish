# Changelog

Every version of Netfish, newest first. Each one says what's new, what changed and what was fixed, and **what to update**:

- **Server:** update the container in Portainer (Stacks → netfish → Update the stack, with *Re-pull image* on). Every app picks the change up from the server, with nothing to install.
- **Apps:** the apps named need their new version as well. The Mac, Windows and Android apps (Fire TV too) offer it in Settings when it matters.

Install files for every version are on [Releases](https://github.com/ravifrancesco/netfish/releases).

## 0.7.38 (2026-10-23)

### Changed
- **Netfish's own channel: no breaks over five minutes.** Its day is now built block by block (the morning, one o'clock, the sitcoms, the cartoons, nine o'clock, late night), each filled back to back. The programmes are chosen so their lengths add up to the block, and what's left (a few minutes at most) is shared out between them.
  - The shows keep their place and order every day, so they're on at about the same time; a few minutes either way now, rather than leaving a hole.
  - Where the library has nothing that fits the rest of a block, the next one starts that much early, never with a long wait.
- **New titles fill what the library can't.** Where Netfish's guide had nothing that fit, New titles look for something whose length does (a film for a long stretch, a short show for a short one) and put it right there; it downloads in time like the others. These come first and aren't counted in the week's.
- **Start over resets everything again, New titles included**, as before 0.7.35: the channels from scratch (no ✨), New titles waiting or downloading deleted (kept ones stay), and what was picked forgotten, so the same ones may be picked again. Then press **Start**.

### Fixed
- **New titles: "Up to date: nothing new right now" for good.** Everything ever picked was never picked again, including titles deleted before they downloaded (by Start over, a channel's ✨ off, the kids' clean-up); after a few changes nothing was left near the top of the lists. Those can be picked again now, and it looks further down the lists when the first pages are used up. When nothing fits, Settings and the log say so.

### Update
- **Server.**

## 0.7.37 (2026-10-23)

### New
- **Channels are for grown-ups, unless you want a Kids channel.** By default nothing made for children is on any channel or among New titles: kids' shows (Kids genre, or rated TV-Y or TV-Y7, or TV-G cartoons) and family films (Family or Kids, or rated G). They stay in the library to watch as before, just not on channels.
  - **Settings → Channels → Kids channel** turns on a **Kids** channel: children's shows, with a family film now and then. With ✨ it gets New titles of that kind, and only it does. Turned off, the channel goes, and its New titles with it.
  - **Cartoons** is grown-up animation now. The automatic line-up no longer makes a "Family films" channel.
- **New titles made for children, picked for a channel that isn't the Kids one, are deleted** (Paw Patrol for Cartoons, say), downloaded or not. The log says so.

### Update
- **Server.** The guide is made again without them after the update.

## 0.7.36 (2026-10-23)

### Changed
- **Start catches up the next days, so the guide is complete straight away.** Instead of three hours of downloading whatever the hours, Start now:
  - picks the whole week's New titles at once, the first of them for the coming days (from a few hours on), not days ahead as usual;
  - downloads everything that's on in the next days (as many days as *Download ahead* says) straight away, whatever the download hours;
  - leaves the rest to the usual schedule: each title its days ahead, in the download hours.
  - `FRESH_RUSH_HOURS` in the stack now sets how far it catches up, in hours (0: no catching up).

### Update
- **Server.**

## 0.7.35 (2026-10-23)

### New
- **A Start button for the channels.** Setting up (choosing the ✨ channels, how many a week, the hours) no longer starts anything by itself. When it's all set, press **Start** (Settings → Channels): it makes the guide again, picks the New titles, and downloads what's due straight away, whatever the download hours, for the next three hours. Turning New titles on, or *Start over with automatic channels*, waits for Start again. **Pause** stops new picks and downloads without deleting anything. Set up before this version: it keeps running, nothing to press.

### Fixed
- **Start over lost every channel's ✨, and with it their New titles.** Channels made from the same thing as before (Netfish's own included) keep their ✨ and their new titles; only those of channels that go are deleted.
- **One channel could take the whole week of New titles** (when it was the only one with ✨ left, or the others found nothing). Each channel now takes at most its share.
- **Netfish's own picked mostly cartoons** after 0.7.34. What its timetable lacks is now every third pick, in turn, and it starts with a film, a documentary and a sitcom as before.
- The guide is made again for the latest timetable after the update (0.7.33 and 0.7.34 needed *Rebuild the guide* for that).

### Update
- **Server.**

## 0.7.34 (2026-10-23)

### Fixed
- **Netfish's own channel: no more empty evenings (and afternoons) with a smaller library.**
  - The shows' own times get their shows first, before anything fills in. A filler earlier in the day can no longer take a cartoon that 6pm needs.
  - The evening takes other animation (anime) when there are too few grown-up cartoons, and the sitcoms take leftover animation.
  - A time no show is left for gets a film, or a show that fits, instead of staying empty.
  - With two dramas or fewer, one goes after one o'clock's documentary (else that hour had nothing) and the mornings get more films.
  - Films are chosen to fill the stretch they're in (six hours: three of about two), not just one after the other.
- With a single documentary series (on at one o'clock all week), Sunday's 9pm is a documentary film, not that series again.

### New
- **New titles fill what the guide lacks.** When Netfish's own timetable has fewer grown-up cartoons, sitcoms or dramas than times for them (under four), every other new title it picks is one of those, the scarcest first.
- **Just started, downloaded straight away.** For three hours after *Start over with automatic channels*, or after turning New titles on, what's due downloads whatever the download hours, so the guide fills with the real thing. Settings shows those as starting straight away. (`FRESH_RUSH_HOURS` in the stack changes the three hours; 0 turns it off.)

### Update
- **Server.**

## 0.7.33 (2026-10-23)

### Fixed
- **Long empty gaps on Netfish's own channel.** When a show ran late (a guide made again mid-morning, or a drama longer than its hour), the next show's time was left empty, up to an hour. Now it still goes on if it's over by the time after it, or something that fits takes its time.
- **Dramas with long episodes pushed the next show out every day.** The dramas' times are now as long as nearly all their episodes (an hour, or longer). Fewer of them fit before 1pm, so mornings keep about four hours of films.
- **New titles: "Done for this week" with nothing in the list.** Titles taken off before they downloaded (by Start over, by a channel no longer taking new titles, by an admin, or with no download found) still counted toward the week. Now only ones still there, or downloaded, count, so *Check now* picks again.

### Update
- **Server.**

## 0.7.32 (2026-10-23)

### New
- **Netfish's own channel runs a timetable: each show at its own time, every day.** It works like a real channel's line-up (and like the "time slots" of Tunarr and ErsatzTV):
  - **Every show has a time of day:** dramas an hour each up to 13:00 (up to three, and one at 14:00 on weekdays), sitcoms from 15:00 and grown-up cartoons from 18:00 (every 45 minutes for half-hour shows), and short late-night shows from 23:00. If Friends is at 16:30, it's at 16:30 every day, two episodes back to back.
  - **A new line-up every Monday:** each show keeps its time for the week (or until it's all been on), then the next one in turn takes it. Where it left off, it carries on next time.
  - **New things first:** a New title takes a time of its own from its first day on the channel. A show new in your library gets one the next day.
  - **Films fill the stretches in between** (the morning, after 1pm, after 9pm, overnight), with the breaks **shared out evenly** instead of one long wait before the next show.
  - 13:00 is a documentary (a film at the weekend). 21:00 is the film, or the documentary on Tuesday and Sunday (now two episodes when they fit). On weekdays the 21:00 film is one that ends close to 23:00, when the late-night shows start.
  - Still nothing twice in a day. A show only gets its time when it's on: if the film before runs well over, that show skips the night rather than starting late.

### Fixed
- **Start over with automatic channels seemed to do nothing for a while.** The button now says *Starting over…* with a spinner, and says when it's done. The new guide is made straight away, so it's there when you open it.

### Update
- **Server.** The guide is made again for the new timetable after the update.

## 0.7.31 (2026-10-23)

### New
- **Netfish's own channel: a new day, with nothing on twice.** From six in the morning to six the next, a show is on once (a short one, under about 40 minutes, for two episodes back to back) and a film once: no more The Simpsons in the morning and again in the evening. Its slots:
  - **Morning:** films, dramas and thrillers, taking turns. Each starts on the quarter hour (10:00, 10:45, 11:30), so there can be a break of up to 15 minutes in between. Rather than repeat something or use up the sitcoms and cartoons early, it takes a longer break before 1pm or 3pm ("Coming up at 13:00").
  - **1pm:** a documentary (a film at the weekend).
  - **3pm to 6pm:** sitcoms. **6pm to 9pm:** grown-up cartoons, opening with the longest-running one.
  - **9pm:** a film or a documentary (the best films on Friday and Saturday). **Then:** late-night shows that haven't been on, and a late film some nights.
  - Nothing made for children (that's the Cartoons channel). The guide is made again for the new day.
- **New things first on Netfish's own.** A New title in its slot; then what's arrived in the library in the last two weeks, before anything else.
- **New titles a week: one number in all, shared out.** *New titles a week* is now the total for every ✨ channel together, not each one's. Netfish's own channel takes about half and the others share the rest, each in turn. What you had set per channel now counts as the total, so you may want to raise it.
- **Netfish's own picks New titles of every kind:** films, documentaries, sitcoms and grown-up cartoons, well liked and not in your library yet. Its new films go on at **9pm on a Friday or Saturday**.

### Changed
- **Settings → Channels → New titles:** the note under *Which release* is gone for the "smallest" choices.
- **The log** now says when a picked New title will really start downloading (inside the download hours).

### Update
- **Server.**

## 0.7.30 (2026-10-22)

### New
- **New titles get Netfish's own quality profiles, with no upgrades.** With *Which release* on one of *The smallest at…*, Netfish makes a profile in Radarr and in Sonarr and adds New titles with it:
  - **Netfish - New titles 720p** (720p, then 1080p), **Netfish - New titles 1080p** (1080p, then 720p) and **Netfish - New titles 4K** (4K, then 1080p, then 720p). Never a remux or a disc image.
  - **Upgrades are off**, so Radarr and Sonarr don't swap the small release Netfish picked for a bigger one later (their RSS sync would, with an *Any* profile).
  - It puts a profile right if someone changes it, and never touches yours. The *Film quality* and *Show quality* menus are only there for *Radarr's and Sonarr's choice* now.
- **Kept New titles move to your own profile.** When someone keeps a New title (or requests it in Seerr), it becomes the household's: Netfish moves it in Radarr/Sonarr to the profile your own titles use (the one Seerr adds requests with, else the one most of your library has), so it upgrades like the rest.
- **New titles: several at once.** *At the same time* (1–5, 2 by default) says how many download together. One a check starts, so indexers don't get a burst of searches.

### Fixed
- **A New title nobody could find a download for held up the rest.** One still *Looking for a download…* a quarter of an hour after it was added no longer takes a turn: the next one starts, and it keeps being looked for.
- **A restart just after adding a New title could lose it.** Netfish noted a title added to Radarr/Sonarr only at the end of its check; restarted in those seconds, it found the title there "added by someone else" and dropped it, leaving it in Radarr/Sonarr for good. It now notes it straight away, and a title carrying Netfish's tag there is taken as its own.

### Update
- **Server.**

## 0.7.29 (2026-10-22)

### New
- **A log you can read in Portainer** (Containers → netfish → Logs). One line for each thing that happened, in the household's time:

  ```
  2026-10-22 23:22:35  info   playback     Sam started "Reef Break" on Fire TV: plays as it is · audio English [aac]
  2026-10-22 23:26:01  info   new titles   Grabbed "Brine.2024.1080p.BluRay.x264-WAL" for "Brine" (7.1 GB, Bluray-1080p, 17 seeders)
  ```

  - **Who did what:** sign-ins (and wrong passwords, with the address they came from), sign-outs, what someone started (on which app or the Chromecast, whether it plays as it is or the server converts it, and why), where they stopped, requests, cancelled requests, deleting from disk (and the space freed), downloading again, choosing another version, Watch together rooms, and admins' changes to channels, connections and settings.
  - **What the server did by itself:** New titles picked (for which channel, when they download and air), added to Radarr or Sonarr, the release grabbed (or why none was), searching again, downloaded, deleted after airing, kept, dropped (and why), and what holds them back in the download hours (disk, space). A New title that misses its slot. A newer Netfish out.
  - **What went wrong:** a service that failed (Radarr, Sonarr, Seerr…) and for what, and anything unexpected, with where it happened.
  - The server's own messages are in the same format (no more JSON lines). Never passwords, keys or tokens. `LOG_LEVEL` (debug, info, warn, error) still sets how much.
- **New titles: the smallest at 720p, or at 4K.** *Which release* now offers *The smallest at 720p*, *at 1080p* (the default) and *at 4K*, besides *Radarr's and Sonarr's choice*. Each takes the nearest resolution when there's none at the one chosen.

### Changed
- **New titles: when each will really start downloading.** The list said the earliest a title may start ("downloads Wed 11:12 PM"), even when that was outside the download hours or already past. It now says when it will start: the first download hours from then (*Downloads Fri 02:00 AM*), or *In line to download* when it's due now and waits for the one ahead of it.
- **Settings → New titles: no *Lately* list.** What happened to each New title is in the log now, with more detail.

### Update
- **Server.**

## 0.7.28 (2026-10-22)

### Changed
- **New titles: the smallest release at 1080p.** They're on for a few days and then deleted, so Netfish now picks their release itself instead of leaving it to Radarr and Sonarr, which go for the best their quality profile allows (with *Any*, a 40 GB 4K season).
  - It adds the title without letting Radarr/Sonarr grab, looks at what they find (the list Interactive Search shows), and grabs the **smallest 1080p release they'd take**: not turned down by the profile, at least 1 GB (no samples or fakes), with people sharing it (3 seeders or more first). No 1080p: the smallest 720p. A show: its first season as one download. If there's no whole season out there, Sonarr gets the episodes as it would.
  - Found nothing it would take (indexers busy, nothing out yet): it looks again every half hour, one title per check, as before.
  - **Settings → New titles → Which release**: *The smallest at 1080p* (new default) or *Radarr's and Sonarr's choice* (as before). Film and show quality still decide what they'd take.

### Update
- **Server.**

## 0.7.27 (2026-10-22)

### Fixed
- **New titles: a search that found nothing was never tried again.** When Netfish adds a New title, Radarr or Sonarr search for it once. If that search found nothing it would take, which is common when several are added together and Prowlarr's indexers turn the burst away ("429 Too Many Requests", "API Request Limit reached"), nothing searched again: after 12 hours the title was dropped, though releases were there all along.
  - Now Netfish asks Radarr (the film) or Sonarr (the first season) to **search again every half hour** until something is grabbed, or the 12 hours are up.
  - **One title per check at most** (checks are every 10 minutes), the one waiting longest, so it never sends a burst of searches itself.
  - *Download now* also searches again for the one airing first.
- **"Downloading, 0%" while nothing was grabbed.** A New title added to Radarr/Sonarr with nothing grabbed yet now says **Looking for a download…**, with no progress bar. *Downloading, n%* means a release is really on its way.

### Update
- **Server.**

## 0.7.26 (2026-10-22)

### Fixed
- **New titles didn't download by themselves.** A New title's download time was worked out from its slot in the guide ("downloads 2 days before it's on"). That slot moves whenever the guide is made again from some point on: when something is deleted from the library, when the next New title is placed, when one misses its slot. So the download kept being "not yet", until the slot settled during the day, too close to air for the next download hours, and the title missed it. Meanwhile the guide filled up with New titles that never came, with 0 B used and nothing in Radarr or Sonarr.
  - Now the download time is fixed when the title is picked: your *Download ahead* days before the earliest it can be on. The guide only ever puts it there or later, so it always has that many nights of download hours before it airs, however the guide moves.
  - It downloads even before it's in the guide. In Settings it says *Downloads Sun 04:25 · not in the guide yet* until it has a slot.
  - The first one picked for a channel is due straight away (its earliest slot is exactly that many days on), so it starts in the next download hours.

### Update
- **Server.**

## 0.7.25 (2026-10-22)

### New
- **Settings → Channels → New titles: *Download now*.** Starts straight away every New title whose download time has passed (and any kept one), whatever the download hours and more than one at a time, and lets ones paused outside the hours carry on. The button says how many (*Download 2 now*), and afterwards what started and what couldn't, with the reason (disk nearly full, no space left, or what Radarr or Sonarr said). What it starts isn't paused again outside the hours. The space limits still hold.
- **Settings → Channels: *Rebuild the guide*.** Makes every channel's schedule again from now, keeping your channels and settings (unlike *Start over with automatic channels*). What's on now carries on; everything after it is picked again, New titles placed again too, and their download times follow.

### Update
- **Server.**

## 0.7.24 (2026-10-22)

### Changed
- **Channel guide: New titles you don't have yet say *Keep*, not *Request*.** Opening a programme that was brought in for a channel offers *Keep* (it stays in the library once it's here), the same as the *Keep* button in the channel player. Once kept, it says *Kept*.

### New
- **Channel guide: *More info* for New titles not downloaded yet.** Their window had only TMDB's description. It now has *More info*, to the title's own page (trailer, cast, ratings), like any title outside the library. An episode of a new show goes to the show.
- **Settings → Channels → New titles: why nothing is downloading, and what happened lately.**
  - Outside the download hours the section said only "Outside download hours", which hid what stops them at night. It now adds what the last check *inside* the hours found: that it started one, that one was still downloading, that nothing was due yet, that the disk was nearly full, or that the title couldn't be added to Radarr or Sonarr.
  - A new **Lately** list shows what happened to each New title: started downloading, couldn't be added (with what Radarr or Sonarr said), already in Radarr or Sonarr, nothing found to download in 12 hours (so it was dropped), or bigger than the space left. Until now these happened without a trace, so a title could quietly disappear from the plan.

### Update
- **Server.**

## 0.7.23 (2026-10-22)

### Changed
- **Watch together: ending a room takes everyone out of it.** When the host presses *End for everyone* (or the room closes), each player leaves the room by itself, the same as pressing *Leave*: the room pill goes, the room's link drops from the address and the film carries on from where it is. A note says *Room ended. Still playing for you.* for a few seconds. Before, everyone stayed in a room that no longer existed, with a "Room ended" pill, until they left it themselves. You can start a new room from the player straight away.

### Update
- **Server.**

## 0.7.22 (2026-10-20)

### Changed
- **Forced subtitles count as "Off" in the player's menu.** Some files carry a *forced* subtitle track next to the full one: it only shows signs and lines in another language. Jellyfin turns it on by itself when subtitles are off or set to *Only when the audio isn't my language* and the film is in your language. The menu then ticked "English · Forced", which looked as if subtitles had been set to forced. Now, as on Netflix:
  - **"Off" is ticked** while only the forced track is showing, and the forced track isn't listed separately (unless it's the only one in its language).
  - **Choosing "Off"** keeps the forced track on (signs and other-language lines still show), matching what you get when a film starts.
  - The same in films, episodes and channels, on every device, and in the subtitles list on a phone used as a remote.
  - Checked against Jellyfin 12.2: with *Only when the audio isn't my language*, a film in English starts with its forced English track, and a film in Italian with the full English one.

### Fixed
- **A deleted show could stay in Shows.** When a show's files are deleted, Jellyfin keeps listing it while its folder is still there (Sonarr leaves it, often with subtitles inside). Netfish only left such a show out when it knew the show was deleted: deleted all at once through Netfish, or unmonitored with a deletion in Sonarr's history. Otherwise the show stayed in Shows, with a page offering *Request* and nothing to play. Now Netfish also asks Jellyfin which shows have no episodes left (one request, its own count) and leaves those out of Shows, Home and search, however the files went. Checked against Jellyfin 12.2: a show counts 0 episodes as soon as its files are gone, with the folder and a leftover subtitle still there.
- **"Forced" said twice** ("English · Forced · Forced") for forced tracks whose own name is "Forced".

### Update
- **Server.**

## 0.7.21 (2026-10-20)

### Fixed
- **Channel guide on TVs: a programme's window didn't fit the screen.** Opening a programme still to come showed its picture across the whole window, and the rest (when it's on, the episode, the description) was cut off below with no way to scroll with the remote. On TVs the window is now wide, with the picture on the left and the details beside it, so it fits a Fire TV or Samsung screen.
  - **Long descriptions:** down on the remote scrolls the text first, then moves to the buttons; up scrolls back. The picture stays where it is while the text moves. This works in any window on a TV with more to read than fits.
  - **Down when a window opens** now goes to its buttons (*Watch channel now*, *More info*), not up to the close button. Back still closes it.
  - The window's picture also lost some stray padding it picked up from the Settings footer, which happened to share its name.

### Update
- **Server.**

## 0.7.20 (2026-10-20)

### Fixed
- **Chromecast: films that need converting didn't play.** The Chromecast can't sign in, so Netfish gives it links carrying a pass for that one film. With Jellyfin 12 two things broke it:
  - Jellyfin 12 writes the film's id with dashes in its stream links, which the pass check didn't recognise, so even the first playlist was refused.
  - Jellyfin rebuilds the links inside its playlists without the pass, so the Chromecast was refused everything after the first.

  The pass now sits in the link's path (`/jellyfin/cast/…/videos/…`), so every link inside Jellyfin's playlists carries it, and ids are compared with or without dashes. Checked against Jellyfin 12.2: playlists, segments and subtitles all open with the pass alone. Films the Chromecast plays as they are (MP4) worked before and still do.
- **Channel guide on TVs (Fire TV, Android TV, Samsung).**
  - **Programmes were too narrow.** On a Fire TV screen the guide fit three hours across, so a half-hour episode was a sliver with no room for its name. On TVs it now shows an hour and a half, like on a phone: half an hour is about a quarter of a Fire TV screen.
  - **After going right, left didn't go back.** The focused programme opens out over the next ones so its whole name shows, and pressing left measured from that opened-out card, landing on a later programme each time. Left and right now step through programmes at their own size: right then left brings you back to where you started, even after the guide has scrolled.
  - **Up went to the top bar instead of Now / Tonight / Tomorrow.** From a programme further right the nearest thing above was the search button or the menu. Leaving the guide upwards now always goes to the selected day tab, and from there up again to the top bar.
  - **Up or down from a long film** went to whatever sat above the film's middle, which could be off the screen. It now moves to the row above or below within what's on screen.

### Update
- **Server.**

## 0.7.19 (2026-10-20)

### Fixed
- **Switching the audio language in a browser or on a TV did nothing.** The menu showed your pick, but the sound stayed in Jellyfin's own choice: your preferred or last-remembered language. Jellyfin only applies the audio and subtitle track asked for when the request also names the file's version, and Netfish never did, so Jellyfin quietly picked its own. Netfish now names it, and the track you pick is the one you hear. Checked in a browser against Jellyfin 12.2 with MP4, MKV and AC3 files, English to Italian and back, measuring what actually plays.
- The same oversight meant Netfish's "never burn picture subtitles into the film" request was ignored too. Jellyfin could re-encode a whole film to draw subtitles you hadn't asked for. Now it's honoured.

### Update
- **Server.**

## 0.7.18 (2026-10-20)

### Fixed
- **Samsung and LG TVs play streams with the TV's own player,** as Jellyfin's own apps do. When a film has to come as a stream, Netfish used a web player library (hls.js) on TVs, which may not decode the Dolby sound (AC3, E-AC3) and HEVC the TV's profile promises. That happens for another audio language than the file's main one (common since 0.7.16), or anything Jellyfin converts. So switching the language could leave the film not playing. The TV's own player decodes them, just as it does for files it plays as they are. Checked against Jellyfin 12.2 here, but not on a real TV.

### Update
- **Server.**

## 0.7.17 (2026-10-20)

### Fixed
- **Skip intro did nothing when clicked or tapped** (Mac, iPhone, browsers, everywhere). The controls bar along the bottom reaches up behind the button, invisibly, and caught the click. The **Next episode** card had the same problem. Both now sit above it.
- **Subtitles with Jellyfin 12, on Samsung TVs and in browsers.** Jellyfin 12 hands a subtitle out in its own format (SRT) whenever the device can take that format, where it used to send WebVTT. The TV page and browsers draw only WebVTT, so subtitles didn't appear. Netfish now always asks Jellyfin for WebVTT, and reads SRT-style times too, just in case. Found by running Jellyfin 12.2 itself against Netfish.

### Changed
- **Trailers: English and your profile's language only.** The switch offers just those two (your profile's language from **Settings → Playback on this device**, when there's a trailer in it). 0.7.16 also always added Italian; that's gone, as is the film's own language and the device's.

### Update
- **Server.**

## 0.7.16 (2026-10-20)

### New
- **A Discover tab (optional).** An admin can turn it on in **Settings → Discover**. Home then shows only what's in the library, ready to play, with its big picture, Continue Watching, new arrivals and the library's share of picks and trending. A **Discover** tab right after Home gets the rest: titles to request from Top picks, Trending, Popular, Because you watched…, Coming soon and your requests, with a big picture of something to request. It's off by default; turned off, Home is as before. On phones the tab bar gains Discover too.

### Fixed
- **Audio in your language on desktop browsers and TVs.** A browser or TV plays only a file's main audio track. When your Jellyfin language (or the track you picked) was another one, you heard the main track anyway; Android and the Mac/Windows apps were fine because their players switch tracks. Netfish now asks Jellyfin for the film repackaged with your track. That's light work: the picture is copied as it is. Channels too.
- **Chromecast: "The Chromecast couldn't play this"** for films that need converting. Netfish now tells the Chromecast the stream's format (HLS in MPEG-TS segments), which Google's player needs, and if it still refuses a film the message adds the Chromecast's own error number.
- **The trailer language switch** now always offers English and Italian when a title has trailers in them. Before, a desktop in English often had only English to offer, so the switch didn't appear. Your preferred language is in **Settings → Playback on this device**.

### Update
- **Server**, and the **Android** app for the Chromecast fix.

## 0.7.15 (2026-10-19)

### New
- **Search shows what's already on the server.** In search results, a director's or actor's films in a search, and their own pages, titles on the server carry an **In library** chip. Elsewhere the poster says *Requested*, *On its way*, *Partial* or how far a download has got. Movies and Shows don't get the chip, since everything there is on the server.

### Changed
- **Watch together has the two fish everywhere:** the *Just you* / *2 watching* chip in the player, the player's Watch together button, Watch together in a title's ⋯ menu, and the little pills that say who pressed play, paused or skipped. Before, these showed a generic people icon while Home's row had the fish.
- **The two fish are outlines** instead of filled shapes, everywhere including Home's row. The front fish cuts the lines of the one behind it, so the pair reads clearly on any background, a film's picture included. They swim in the chip, since the room is live, and stay still in buttons. In a title's ⋯ menu and among the player's buttons they're white like the icons beside them; elsewhere they keep the accent colour.
- **Shorter, plainer text** outside Settings. Instructions people don't need once they've used something are gone: the Watch together panel's explanation, the hint under *Play on*, the note in the subtitles sheet, the season picker's line, and *Download more from…* on the downloads page. Other messages are shorter, for example *Downloading to this Mac.*, *Requested Dune.*, *Waiting for approval*, *Your library is empty.*, *Removes it from this iPhone only.* and *You're offline · Your downloads still play.*
- **Your requests on Home leaves out titles deleted from disk.** After an admin deletes something, Seerr may call it *processing* again, so it looked like it was on its way. In Activity's request list it now says *Not on disk*.

### Fixed
- **Watch together listed you twice** after you left the film for a moment, reloaded, or the app reopened the page: your earlier visit stayed as *Away* for two minutes. A device coming back to a room now keeps its place. The panel lists each person once, even on two devices; the chip counts people, not devices; and *joined*/*left* pills are about people, not devices.

### Update
- **Server.** The downloads page's shorter text needs the **Mac, Windows, iPhone/iPad and Android** apps' next version.

## 0.7.14 (2026-10-19)

### New
- **Scrubbing previews in downloads.** When Jellyfin has made preview pictures for a title, the app saves them with the download and the downloads player shows them while you scrub, with no connection. They add a few MB to a download. Titles downloaded before this version need downloading again to get them.

### Documentation
- This changelog, in much more detail. Each release on GitHub now opens with its own entry from here.
- The README covers Chromecast, scrubbing previews, the TV remote's timeline and the Jellyfin settings that audio and subtitles now follow.

### Update
- **Server**, and the **Mac, Windows, iPhone/iPad and Android** apps to keep previews with downloads.

## 0.7.13 (2026-10-19)

### New
- **Chromecast** (Android app on phones and tablets with Google Play services). While a film or episode plays, the player's *Play on* button lists the Chromecasts on your network, under any Netfish screens. Pick one and the film carries on there from the same spot.
  - The phone becomes the remote: play and pause, ±10 s, the timeline, volume, subtitles and audio. A different audio track restarts the stream there from the same spot. Android's notification has play and pause too.
  - **Stop casting** in the same menu brings the film back to the phone, from where the Chromecast got to. If the Chromecast drops the connection, the phone carries on by itself.
  - The phone screen may sleep while casting.
  - It uses Google's standard Chromecast player. Files it plays as they are (H.264 up to 1080p in MP4, VP8/VP9 in WebM) are sent untouched; Jellyfin converts anything else to H.264 and AAC. Subtitles go as WebVTT files.
  - The Chromecast can't sign in, so Netfish gives it links that carry a token. The token opens only that film's files and expires after 12 hours. The Chromecast must be able to reach the server address the app uses (its LAN address, not `localhost`).
  - Casting stays out of Watch together rooms and Play on TV, where the room runs the player.
- **Scrubbing previews.** Hovering over or dragging the timeline, or scrubbing with a TV remote, shows a frame from that moment above it. They come from Jellyfin's own trickplay pictures (Jellyfin 10.9 or later): turn on *trickplay image extraction* in each library's settings in Jellyfin and let its *Generate Trickplay Images* task make them. Titles without them show the time as before.
- **TV: the timeline scrubs with the remote.** Move up onto the timeline (just above the buttons). Left and right move along it, in steps that grow while you hold: 10 s, then 30 s, then a minute. OK jumps there, or it jumps by itself after a moment.
- **TV: Back asks before closing.** On Netfish's first page, Back shows *Press Back again to close Netfish*. Only a second press within three seconds closes it.
- **Your audio and subtitle languages in Settings → Playback on this device.** Your preferred audio language, the subtitle mode (Default, Always, Only forced, None, Smart) and the subtitle language, which are your Jellyfin settings. Changing them here changes them in Jellyfin and in its own apps.

### Changed
- **Audio and subtitles follow Jellyfin.** A film or episode starts with the tracks Jellyfin's own apps would pick: your Jellyfin settings, and what Jellyfin remembers you chose for that title or show. Picking subtitles while watching makes them your default from then on, in Jellyfin too. Turning them off sets *Only forced*.
- **TV: a bigger interface.** On Full HD and 4K TVs Netfish lays itself out for a 1280-pixel screen and scales that up, so cards, text and buttons are about 1.5× bigger.
- **Channels: documentaries take turns.** Netfish's own channel picks a documentary for every other new title, as intended.
- **Not on disk:** films not on disk can be marked watched (and unwatched) from their page, as shows could. Jellyfin forgets a film once its file is gone, so Netfish keeps the mark per person and hands it to Jellyfin once the film is back. Deleting a film or a whole show notes first who had watched it.
- The section at the end of Movies and Shows is headed just *Not on disk*.

### Fixed
- **Signing in on one device signed you out on others.** With the server on plain http (a home address like `http://192.168.1.50:7777`), the random-id function browsers offer only on https wasn't there. So every browser and app gave Jellyfin the same device name, and Jellyfin ends a person's older session on the same device. Each device now gets its own id. After updating, sign in once more on each device.
- **Samsung TV subtitles didn't show.** The first time a film's subtitles are asked for, Jellyfin pulls them out of the file, which on a Raspberry Pi can take over 30 seconds. Netfish gave up at 30 seconds. It now waits up to 5 minutes for subtitles, and the TV tries again (four times, 5 seconds apart) if the first attempt fails.
- **TV: Back did nothing on a title page.** A hidden menu on title pages counted as an open one, so Back kept trying to close it.
- **A show in both Shows and Not on disk.** When all of a show's files are deleted (in Netfish or in Sonarr), Sonarr leaves its folder, and Jellyfin keeps listing an empty show. That show is now only under *Not on disk*, with its page saying so. It no longer appears as playable on Home or in search. The other way round, a title Jellyfin really has episodes or a file of never shows as *Not on disk*, even when Radarr's or Sonarr's record says it was deleted.

### Update
- **Server**, and the **Android** app for Chromecast. Everything else comes from the server, including the Samsung TV and Fire TV changes.

## 0.7.12 (2026-10-18)

### Changed
- **Movies and Shows: no *Not on disk* tab.** Titles deleted from disk come at the end of the list, apart and greyed out, in the same sort order as the rest. They still open to their page, which says when they were deleted and offers *Download again*.
- **Not on disk follows Radarr and Sonarr.** A title counts as not on disk when Radarr or Sonarr still has it, unmonitored (so it isn't coming back by itself), without files, and with a file deletion in its history. That holds wherever it was deleted: Netfish, Radarr's or Sonarr's own pages, or another tool. A file replaced by a better one doesn't count. For what Netfish deleted itself, it adds who deleted it and the space freed.
- What comes back drops off the list: on disk again, monitored again (on its way back), or removed from Radarr/Sonarr. A show with some seasons left stays in the library.
- **Settings → Storage** counts films and shows not on disk apart, each linking straight to them.

### Update
- **Server.**

## 0.7.11 (2026-10-18)

### New
- **Mac and Windows: the player's volume is the computer's own.** The volume keys move the player's slider and the slider moves the computer's volume (mpv stays at full volume). The speaker button mutes the computer.
- **Subtitles you choose become the default**, for films and channels alike (shown in Settings).

### Changed
- **Channels: the break scene is much lighter.** It costs about a third of the computer's time it did: its moving parts animate on the graphics chip, and the light rays hold still while waiting. The *Live* dot pulses without repainting the page.
- **Mac in full screen:** Back, the top bar and the channel controls no longer leave room for the hidden window buttons.

### Fixed
- **Channels in the apps:** subtitles chosen for a programme were sometimes lost. They're now switched once the programme has loaded.

### Update
- **Server**, and the **Mac** and **Windows** apps for the volume.

## 0.7.10 (2026-10-18)

### New
- **Guide: request a new title still to come** from its card, even before it has downloaded. It airs as planned, joins the library once it's here, and isn't deleted after airing.
- The card of a new title not downloaded yet says what it's about.
- **Settings → Channels:** new titles someone requested say who, and can't be removed.

### Changed
- **Channels:** static only when changing channel. The next programme on the same channel comes in from black.

### Update
- **Server.**

## 0.7.9 (2026-10-18)

### Changed
- **New titles for Netfish's own channel: every other one a nature documentary,** and only much-liked ones (TMDB 8 and up for a series, 7.5 for a film). A series' first season goes to the weekday one o'clock slot and plays from the first episode, one a weekday; a film goes to the documentary nights. Crime, war, history, music, reality and news documentaries aren't picked.

### Fixed
- Each channel's turn is now a count of what it has picked. It counted some twice, so Netfish's documentary turns hardly ever came.

### Update
- **Server.**

## 0.7.8 (2026-10-18)

### Changed
- **Mac, iPhone, Android and Windows apps: when the server can't be reached** (no internet, or away from home), the app opens on its offline page, even with nothing downloaded. Before, it asked for the server's address as if that were wrong. It keeps trying and says when the server is back; *Change server…* is there for a server that has really moved. With nothing downloaded, it says just that.

### Update
- **Mac, iPhone/iPad, Android and Windows** apps.

## 0.7.7 (2026-10-17)

### Changed
- **Channels guide:** it ends on one straight edge. A programme running past the guide's last hour stops there, and the guide ends sooner if a channel's schedule does, so no channel stops short of the others.
- **The top bar** goes Home, Channels, Movies, Shows, Activity (on phones: Home, Movies, Shows, Search, Activity).

### Update
- **Server.**

## 0.7.6 (2026-10-17)

### Changed
- **Channels guide:** the column of channels stays on top of everything that scrolls under it (an opened card, the line at *Now*), in one unbroken strip. A card opened with the mouse closes as the guide scrolls. The times along the top scroll with the guide, so *Now* and its line move as one.
- **Settings:** Devices sits right under the app's own updates.
- Pages load with the fish in the middle of the screen, Home and title pages included.

### Update
- **Server.**

## 0.7.5 (2026-10-17)

### Changed
- **Channels guide:** the current minute is one line, from *Now* at the top down through every channel. Programmes on now keep their green edge but lose the progress bar, which didn't match the line for programmes that began before the guide does. The sentence above the guide is gone.

### Update
- **Server.**

## 0.7.4 (2026-10-17)

### New
- **Channels guide: what's been on.** The stretch before now fills with what has been on since the guide's half hour, greyed out (the guide asks the server up to three hours back for it).
- **Settings, for admins: a note when a newer Netfish is out** than the server runs (checked against GitHub's latest release after starting and every six hours), with how to update the container in Portainer. The account button gets a dot.

### Changed
- **Channels guide:** programmes show only their title. Hovered, or with the remote on them, they open out with the time and episode. One on now, opened, is solid, so what it opens over no longer shows through.
- **New titles for channels download in the order they air:** the earliest title first, a show's episodes from the first, a whole season front to back, all behind everyone's own downloads.

### Update
- **Server.**

## 0.7.3 (2026-10-16)

### Changed
- **Channels guide: one line of time** from now to three days ahead that scrolls sideways (a swipe, a touchpad). *Now*, *Tonight*, *Tomorrow* and the day after glide straight there, and the tab follows where you are. On a TV the remote goes programme by programme, and past the edge the guide moves on a good way. A long programme's name stays at the guide's left edge while it scrolls past.
- In the guide, titles stay on one line. One that doesn't fit opens out on hover (or with the remote on it), with no tooltip first.
- **A programme still to come opens a card:** when, on which channel, the episode and what it's about, with *Watch channel N now* and *More info*. One on now tunes in, as does the channel.

### Fixed
- Changing channel in the Mac, iPhone and Android apps flashed the last channel's picture after the static. It now stays on static until the new programme is really playing.

### Update
- **Server.**

## 0.7.2 (2026-10-16)

### New
- **SuggestArr** (2.11 or newer), optional in Settings → Connections. What it requested from each person's viewing becomes a row on their Home (*Because you watched…*), and its requests are marked in Activity (with whose viewing, for admins). Admins see its jobs and can run them now.
- **Activity: download details.** Each download also shows Radarr's or Sonarr's custom formats and score, the indexer and the download client. Admins see everything and pick in Settings → Downloads what everyone else sees.
- **Trailers in your language:** they start in the language your Jellyfin audio setting asks for (else the app's, else English), with a switch under the video to the other languages the title has a trailer in.

### Changed
- **Home:** the big picture up top is always something in the library, never one to request, and a show there gets *Play* too (its next episode).
- **Netfish's own channel keeps a day like a network's:**
  - Category slots: cartoons from six, comedy reruns from nine, a film at one on weekends, the line-up at half six, the film at nine, late-night comedy, a late film, reruns.
  - Every slot has several shows to take turns, borrowed from the next kind when the library has few, and no show plays more than two episodes in a row.
  - It's for grown-ups: children's shows (rated TV-Y, TV-Y7, TV-G) stay on the Cartoons channel, and there are no animated or family films.
  - Documentaries at one on weekdays (a series in order), and *Love, Death & Robots* and *Smiling Friends* late at night.
  - When nothing short enough fits before half six or nine, the slot starts a few minutes early instead of waiting.
- Netfish's own channel is always channel 1. It can't be renamed, hidden, moved or removed; only whether it gets new titles changes.
- **Channels guide:** it starts at the half hour with a line at the current minute. Titles take two lines, and a short slot opens out over its neighbours on hover (a first tap on tablets).
- Changing channel shows static until the picture plays, not a still of what's coming.
- **The channel list fits phones** both ways up (a sheet above the controls, or a panel on the right when sideways), and scrolling it no longer changes channel.
- **TVs ask who's watching again** after ten minutes away.

### Fixed
- **Samsung TVs:** the app starts (its scripts and styles are now separate files, as the TV requires), subtitles show, and Back works on every remote.
- **Android:** the server and sign-in pages are centred and don't zoom.
- *Try another release* asks Radarr or Sonarr to look again itself, so it works after picking a version by hand.
- Leaving a channel stops counting as watching it straight away, and the guide catches up.

### Update
- **Server**, and the **Samsung TV** app.

## 0.7.1 (2026-10-16)

### Changed
- **Channels:** changing channel looks like the rest of the controls: up, the channel, down. The channel's name (or the remote's OK) lists every channel with what's on, to pick one. *Watch from here* is gone.
- Channels skip episodes Jellyfin knows of but has no file for, and a programme that won't play gets a second try before the break says it can't play here.
- **Settings → Channels → New titles:** *Check now* says what it found (or that nothing's new).

### Fixed
- **Who's watching?:** someone whose sign-in has run out (signed out elsewhere, or a new password) stays in the picker and is asked for their password, instead of disappearing, and nobody else gets signed out. Switching checks the sign-in with Jellyfin there and then. Picking someone when Netfish opens on the profiles page goes on to Home.

### Update
- **Server.**

## 0.7.0 (2026-10-15)

### New
- **Channels: your library as TV**, turned on by an admin. Settings → Channels starts with a line-up made from the library: Netfish, cartoons, sitcoms, drama & thrillers, new arrivals and more.
  - Each channel plays around the clock for everyone at the same minute, with no pausing. Change channel with up/down, numbers or a swipe.
  - Between programmes there's a short break with the fish (a net, bubbles, a shoal), then a look at what's next with a countdown. *Next* shows in the corner in the last minute and a half.
  - A guide on Channels and an *On now* row on Home; the guide looks up to three days ahead.
- **Netfish's own channel keeps a timetable like a network's:** cartoons in the morning, sitcoms in the afternoon, The Simpsons at half six, Family Guy after, a film at nine (the best films at the weekend, documentaries on Tuesdays and Sundays), then late-night comedy and reruns. Short shows come in twos, and no film comes back within a week.
- **New titles for channels** (optional). For the channels picked, Netfish chooses well-liked films and first seasons nobody here has.
  - They go in the guide a week ahead, marked *New*, and download 1 to 7 days before they air (through Radarr/Sonarr, tagged `netfish-channel`).
  - They stay out of everyone's library and Activity, and are deleted after they air.
  - All within the space, free disk, download hours, speed and number per channel each week the admin sets. One not downloaded in time gives its slot to the library.
  - Anyone watching can **Keep** one (it joins the library), and nothing someone requested or chose to watch is ever deleted.
- Default channel names follow each viewer's language.

### Changed
- Watch together: the two fish are bigger, one in front of the other.

### Update
- **Server.**

## 0.6.3 (2026-10-15)

### New
- **Downloads play in Netfish's own player,** online or not: the same controls, keys, *Audio and Subtitles* menu and look as everything else, minus what needs the server (Watch together, Play on, other languages). The player is one piece shared by streaming and downloads, built into every app. On the Mac, iPhone and Windows you can switch audio tracks, and downloaded episodes offer the next one.
- **Update notices:** when an app itself has something worth installing, Netfish says so on that device (never for changes that come from the server).
  - The Mac, Windows and Android apps update in one click; Android from 0.6.3 on, through the system installer (Fire TV too).
  - An iPhone installed from a Mac warns a couple of days before it stops opening, and Settings shows the date.
- **Settings → Devices** (admins): every Netfish open right now, its app and version, and whether it should update. The Samsung TV app now says its version.

### Fixed
- **Android:** links to other sites (IMDb, What's new) open in the browser.
- **Phones:** a tap that brings back the player's controls no longer also pauses the film.

### Update
- **Server**, and every app (Mac, Windows, iPhone/iPad, Android, Samsung TV).

## 0.6.2 (2026-10-15)

### Changed
- **Opening the apps away from home:** a quick check (4 seconds at most) finds out whether the server answers, with the fish swimming meanwhile, then shows Netfish, offline mode (your downloads) or setup. No more black screen while the web view gives up on its own.
- **Offline mode** keeps asking the server every 15 seconds and says when it's back, with a *Reconnect* button. It never switches by itself, in case a film is playing. *Try again* checks first and stays put if the server still doesn't answer.
- **The fish around the app,** small and quiet: on loading pages and in the player, on empty screens, a fish out of water on errors, bubbles when a download finishes, two fish swimming together on Home's Watch together row, and in the offline banner.

### Update
- **Server**, and the **Mac, Windows, iPhone/iPad and Android** apps.

## 0.6.1 (2026-10-15)

### New
- **Cancel request** on a title's page, for whoever asked for it or an admin, while nothing is downloading or on disk.

### Fixed
- **Stop for good** really takes a request back. With nothing on disk, the title leaves Radarr/Sonarr and its request is cleared in Seerr, so it reads *not requested* again (before, Seerr set it back to *looking for a good release* a few minutes later). A copy already on disk is kept; Radarr just stops looking for a better one.

### Update
- **Server.**

## 0.6.0 (2026-10-15)

### New
- **Downloads play from the device:** Play (on a title, in Continue Watching, on an episode) opens the app's own player on the downloaded copy, from where the server says you got to. Where you stop reaches the server even when watched with no connection (sent the next time the app is online), so Continue Watching and *watched* stay right.
- **Offline mode:** when the server can't be reached (at launch or while using the app), the apps show your downloads first, with your last Home below, greyed out (anything downloaded stays playable), and *Try again*.
- **The round download button:** the ring fills as the download comes in (with the percentage), the arrow turns accent when it's done, and it offers to play or delete the download (or show or cancel it while downloading).

### Fixed
- Download progress lagged in the Mac, iPhone and iPad apps (it only updated when the download paused). Android checks twice as often.
- The Download button didn't show in the Android phone app.

### Update
- **Server**, and the **Mac, Windows, iPhone/iPad and Android** apps.

## 0.5.1 (2026-10-15)

### New
- **A cast button next to your profile picture,** like YouTube: connect to the TV (or any device with Netfish open) and every Play plays there, with your phone as the remote. *This device* plays here again. It disconnects by itself if the TV goes away.
- **Watch together from the player:** the people icon turns what you're watching into a room without reloading the film.

### Changed
- **Title pages:** Play, Trailer and round icons (watched, download, and ⋯ with Watch together, Versions and Delete from disk) instead of a row of buttons.
- Mac builds go to `~/Library/Caches`, so Spotlight shows only the installed Netfish; releases keep only the current version's files locally.
- README: new screenshots, including Watch together and the phone remote.

### Fixed
- Each page change opened another live connection to the server, and after a few the app couldn't load anything for a while (since 0.4.1).
- A picture coming from the browser's cache could stay invisible.
- Handing a film over from the player sent it to the TV twice.

### Update
- **Server.**

## 0.5.0 (2026-10-15)

### New
- **Play on TV:** send a film or episode to any device with Netfish open (your own, and the household's TVs), from its page or from the player mid-film. That device plays it and your phone becomes the remote: play/pause, ±10 s, seeking, audio and subtitles, stop, or *Watch here instead*. A bar at the bottom brings the remote back while you browse. Name each device in Settings → Playback on this device.

### Changed
- Watch together: the top-bar pill shows how many rooms are open when there's more than one.
- **iPhone, iPad and Android apps:** no more pinch or double-tap zoom.
- README: the feature list is grouped and much shorter to read.

### Fixed
- **Settings → Storage fits on a phone:** rows no longer run outside the box, titles wrap instead of being cut, and clean-up sizes sit under the title.

### Update
- **Server**, and the **iPhone/iPad** and **Android** apps (for zoom).

## 0.4.1 (2026-10-14)

### New
- **Watch together shows up live for everyone:**
  - a *Watch together* row on Home, with cards showing who's in the room, Live or Paused, and how far along it is;
  - a pill in the top bar with the rooms;
  - *… is watching this together · Join* on the title's page.

  Rooms appear and disappear without reloading (a live list over server-sent events).

### Changed
- Settings → Desktop app: *Auto-update* is a switch, like the other rows.

### Fixed
- Home: a long title in a short window ran under the top bar, and the first row covered the hero's buttons.
- **Server:** a video stream the viewer abandoned (seeking, closing the player) could crash the server.

### Update
- **Server.**

## 0.4.0 (2026-10-14)

### New
- **Watch together:** start a room from any film or episode. Others on the server join from Home, a notification or an invite link, and play, pause, skipping and the next episode stay in step on every device (server-sent events, with drift correction).
- **Who's watching?:** several people signed in on one device (the living-room TV), switching with a click, each with an optional 4-digit PIN.
- **Ready to watch:** a Home row, and notifications in the Mac, Windows and Android apps (or the browser), when something you requested arrives.
- **Mark as watched:** a film, an episode or a season; remove anything from Continue Watching.
- **Settings → Storage suggests what could go:** finished long ago, or never started in a year, with sizes, to delete in one go or keep for good.
- **Mac and Windows: *Update Netfish by itself*** downloads new versions in the background and installs them when you quit.

### Fixed
- The Mac build failed (or passed) at random: with `pipefail`, `grep -q` stopping at the first match could make the command before it fail.

### Update
- **Server**, and the **Mac** and **Windows** apps.

## 0.3.0 (2026-10-14)

### New
- **Stop a download** from Activity or a title's page: for good, or throw this release away and let Radarr/Sonarr find another (admins, and whoever requested it).
- **Delete from disk** (admins): a movie or chosen seasons, through Radarr/Sonarr. The title stays in the library as *Not on disk* and comes back with *Download again*.
- **Settings → Storage:** free space per disk, what movies and shows take, and the biggest titles.
- **Sort the library by length** (shortest or longest first), with lengths on the posters.
- **The Mac and Windows apps update themselves:** a note on Home when a new version is out, and Settings → Desktop app → Update downloads it, installs it and reopens Netfish. Releases include `Netfish-mac.zip` for this.

### Fixed
- Fire TV: a square TV icon with the logo and "netfish".

### Update
- **Server**, and the **Mac** and **Windows** apps.

## 0.2.2 (2026-10-14)

### Fixed
- **Mac:** opens again on macOS 15. The bundled libmpv listed its library search path twice, which macOS 15 refuses to load; the build now removes duplicates and fails if any remain.
- **Fire TV:** a square TV icon with the logo and "netfish", since Fire TV squeezes the icon of apps installed outside its store into a square.

### Update
- The **Mac** and **Android** apps.

## 0.2.1 (2026-10-14)

### New
- **Not out yet, said plainly:** when Radarr reports a film as not available (only in cinemas, or not out yet) or a show hasn't started, title pages, Activity and Versions say so, with the date it should arrive. Radarr's "not available" rejections read plainly.

### Changed
- **Fire TV / Android TV:** the app's tile is the full banner with the logo and "netfish".
- **TV mode:** the focused person in a cast row gets a ring around their photo instead of a clipped box around the whole column.

### Update
- **Server**, and the **Android** app.

## 0.2.0 (2026-10-14)

### New
- **Italian everywhere:** the web app, server messages, every native app and the install guides.
- **Samsung TV (Tizen) app,** and step-by-step install guides for every device.
- **Search by director or actor,** with a page for every person; names on title pages link there.
- **Free recommendations:** *Top picks* blend TMDB with each person's favourite genres, directors and actors and what's popular on the server. New rows: *Popular on this server*, *More from (director)* and *Because you like (actor)*.
- **Trakt** (optional) for the whole server: scrobbling, history import and recommendations (needs Trakt VIP).
- README screenshots and gallery.

### Fixed
- **Mac:** bundles libmpv and runs on macOS 15 (it crashed on Sequoia).
- **Windows:** native player hosting fixes, and a bundled Vulkan loader.

### Update
- **Server** and every app.

## 0.1.0 (2026-10-14)

The first version: a Netflix-style front end for a home media stack (Jellyfin, Seerr, Radarr, Sonarr, Bazarr, qBittorrent). It's a TypeScript server for the Pi (Portainer) with its web interface, plus native apps that play films themselves so the server sends files untouched:

- **Mac:** a Swift app, with mpv drawing the film underneath the web interface.
- **Windows:** a C# app, with mpv under WebView2.
- **iPhone & iPad:** a Swift app with Apple's player and offline downloads.
- **Android** (phones, tablets, Fire TV, Android TV): ExoPlayer with Jellyfin's FFmpeg audio decoders, TV mode, and downloads on phones.
