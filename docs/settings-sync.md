# Settings sync

Hydra syncs your settings across devices through your own Google Drive, using
the same Google sign-in as cloud saves (Settings → Integrations → Cloud saves).
Once signed in, it is on by default; turn it off per device under
**Sync settings (Google Drive)**.

## What syncs

- Debrid tokens (Real-Debrid, Premiumize, AllDebrid, TorBox), the GG.deals key
  and the RetroAchievements username and web API key
- Download sources (each device refetches their contents)
- Themes, including which one is active
- Language, notification, achievement, library, download display, extraction,
  tracker and screenshot preferences
- Library collections
- Favourites and pins (the latest change wins)
- Playtime: each device keeps its own time per game and shows its own time
  plus the other devices', so time played on several devices adds up. A
  device shares its time when a game closes.
- Custom artwork (icon, logo, hero, cover). Pictures you pick from your files
  are stored once in Drive under `hydra/artwork/`; SteamGridDB picks sync as
  their link. The latest change wins.

Folders, Wine/Proton paths, startup behaviour, Big Picture, MangoHud/GameMode,
the network interface and the speed limit stay on each device. The list lives in
`src/main/services/settings-sync/synced-keys.ts`; anything not listed stays local.

## How it works

- Drive file: `hydra/settings.json` in the Cloud Save Manager folder.
- Every value carries the time and device of its last change. The newest change
  wins per setting, so edits to different settings on two devices both survive.
  Removed download sources and themes are kept as tombstones so they don't come
  back from another device.
- On a device that never synced, the cloud wins for everything.
- Hydra syncs on launch, after sign-in, a few seconds after you change a
  setting, a source or a theme, and every 15 minutes.
- API keys are sealed with AES-256-GCM. The key is random and stored in Drive at
  `hydra/sync-key`, so any device signed in to the same Google account can read
  them without a passphrase. Anyone with full access to that Google account can
  too.
- Locally, API keys are kept out of the plain preferences and encrypted with the
  OS keychain (Electron `safeStorage`).
