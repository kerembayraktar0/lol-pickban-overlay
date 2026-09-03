# LoL Pick/Ban Overlay

*(Türkçe sürüm: [README.tr.md](README.tr.md))*

A local broadcast overlay for **League of Legends** champion select (pick/ban),
built for use as an **OBS Browser Source**. It connects directly to the
running League Client (LCU API), so there's nothing to configure by hand:
team names, live picks, bans, the phase timer, and even the previous game(s)'
picks in a Bo3/Bo5 series are all pulled and displayed automatically.

It's made of two parts:
- A **Node.js backend** that talks to the League Client and serves the data
  over HTTP + WebSocket.
- A **static frontend** (plain HTML/CSS/JS) that OBS loads as a browser
  source, plus a small control panel for editing team info mid-broadcast.

## What it's for

If you're casting or recording a League of Legends match and want a clean,
animated pick/ban overlay (team logos, live bans, live picks with player
names, a countdown timer, and a "what was picked in the previous game(s)"
recap strip) without manually typing anything during the draft — this tool
watches the client for you and pushes the data straight into your stream.

## Folder structure

```
lol-pickban-overlay/
├── backend/
│   ├── package.json
│   ├── server.js            <- reads the LCU lockfile, polls champ select, serves the API + WebSocket
│   └── config.json           (created automatically on every run)
└── frontend/
    ├── index.html            <- the actual overlay, add this as your OBS Browser Source
    ├── style.css
    ├── script.js
    ├── i18n.js               <- shared Turkish/English text used by all pages
    ├── control.html          <- separate control panel for editing team name/logo/score/language
    ├── previous-picks.html   <- form for entering the previous game(s)' picks (Bo3/Bo5 only)
    └── previous-picks.js
```

## 1) Install

```bash
cd lol-pickban-overlay/backend
npm install
```

This installs `express`, `cors`, `axios`, and `ws`.

## 2) Start the backend

Open the League of Legends client (the main lobby screen is enough — it
doesn't need to be in champ select yet), then run:

```bash
npm start
# or: node server.js
```

The app always starts from a clean slate — nothing from a previous session
(team names, score, match number, previous picks) carries over. On every
launch it asks you a short series of questions in the terminal, in this order:

1. **Language** — `[1] Türkçe` or `[2] English`. Everything from this point
   on (terminal prompts, console logs, and every page the overlay serves) is
   shown in the language you pick.
2. **Blue/Red team name and logo URL** (optional — press Enter to skip the logo).
3. **Which game of the series this is** (`1`, `2`, `3`, ... — Bo3 by default).
4. **If it's game 2 or later:** each team's current win count (used as the
   scoreboard), and a browser tab opens automatically at
   `previous-picks.html` so you can enter the `(game number − 1) × 10`
   champions picked in the earlier game(s) — per team, per role
   (TOP/JUNGLE/MID/ADC/SUPPORT), with live champion-icon autocomplete.
   Once you save that form you can close the tab; the backend picks it up
   automatically and continues — no need to switch back to the terminal.
5. **Match label** (e.g. `GAME 2 / BO3`).

You should then see something like:

```
[LCU] Connected -> https://127.0.0.1:XXXXX
[HTTP] Overlay: http://localhost:5000/index.html
[HTTP] Control panel: http://localhost:5000/control.html
[WS]   Overlay data channel: ws://localhost:5001
```

> **Lockfile not found?** If League is installed somewhere non-standard,
> point the app at it with an environment variable before starting:
> - Windows (PowerShell): `$env:LOL_PATH="D:\Games\League of Legends"`
> - macOS: `export LOL_PATH="/Applications/League of Legends.app/Contents/LoL"`
>
> Then run `node server.js` again.

## 3) Add it to OBS

1. In OBS: **Sources → Add → Browser Source**.
2. URL: `http://localhost:5000/index.html`
3. Width: `1920`, Height: `1080`.
4. Leave **"Shutdown source when not visible"** **unchecked** (otherwise it
   reconnects the WebSocket every time you switch scenes).
5. The background is already transparent — no green screen needed.

## 4) Editing team info / score mid-broadcast

You don't need to restart the terminal to update the scoreboard between
games. Open `http://localhost:5000/control.html` in any browser (it doesn't
need to be added to OBS — just keep it open on the operator's machine),
adjust the team names, logos, score, match label, or language, and click
**Save**. The overlay updates instantly over the WebSocket connection.

## 5) How it works

- **Lockfile:** the League Client writes a `lockfile` to its install folder
  the moment it opens (`name:pid:port:password:protocol`). The backend reads
  this file to get the LCU API's port and password automatically — nothing
  to enter by hand.
- **Self-signed certificate:** the LCU API runs on `https://127.0.0.1:PORT`
  with a self-signed certificate that browsers reject outright. All requests
  to it are therefore made from the **backend** (Node.js, via `axios`, with
  certificate validation disabled), never from the browser — the frontend
  only ever talks to the backend's normal `http://` and `ws://` endpoints.
- **Polling:** the backend reads `/lol-champ-select/v1/session` once per
  second, normalizes it (bans, picks, player names, phase timer), and
  broadcasts it over WebSocket to every connected overlay/browser.
- **Images:** champion splash art and icons are proxied through the backend
  (`/champion-splash/:id`, `/champion-icon/:id`) so the browser never has to
  reach the LCU's HTTPS port directly. Pick cards try the icon first and
  fall back to splash art if that specific asset isn't available; a pick
  shows grayscale while it's only a hover/intent and switches to full color
  the moment it's locked in. Ban slots always show the icon.

## 6) Bilingual (Turkish / English)

Every user-facing surface — terminal prompts, backend console logs, the
overlay itself, the control panel, and the previous-picks form — follows the
language chosen at startup (or changed later from the control panel). All
translated strings live in one place: `frontend/i18n.js` for the frontend,
and the `STRINGS` object near the top of `backend/server.js` for the backend.

## 7) Notes and limitations

- LCU champ-select data comes back as `myTeam` / `theirTeam` from the
  perspective of the PC the backend is connected to; the overlay maps
  **Blue = myTeam, Red = theirTeam**. If your broadcast PC is connected as
  the red side, swap those labels in the `normalizeSession` function in
  `server.js`.
- The LCU API is unofficial and unsupported by Riot; asset paths can change
  with client updates. If splash art or icons stop loading after a patch,
  check the backend console for `[IMAGE]`/`[GÖRSEL]` warnings — they list
  every path that was tried for that champion ID.
- Due to Riot's own privacy rules, the LCU usually hides the **opponent
  team's** `summonerId` (reports it as `0`), so their real name can't be
  fetched — the overlay falls back to a generic label like "Red Player 1" in
  that case. This is a client-side restriction, not something this tool can
  work around. Names generally do come through in custom lobbies/practice
  tool.
- This runs entirely on `localhost`. If your streaming PC is a different
  machine from the one running League, run the backend on the League PC and
  point OBS's Browser Source at that machine's IP instead
  (e.g. `http://192.168.1.20:5000/index.html`), and update `WS_URL` in
  `frontend/script.js` to match.
