<p align="center">
  <img src="build/icon.png" width="96" alt="">
</p>

<h1 align="center">WikiTree</h1>

<p align="center">
  Build trees of Wikipedia articles and read them without leaving the app.<br>
  Desktop app for Linux, Windows and macOS. No account, no server — just Wikipedia.
</p>

<p align="center">
  <a href="https://github.com/boraned/wikitree/releases/latest">Download</a> ·
  <a href="#use">Use</a> ·
  <a href="#development">Development</a>
</p>

![Project tree](docs/screenshots/tree.png)

## Features

- **Trees of knowledge** — every project starts from one article or header; add children with the green **+**.
- **Read in place** — articles open inside the app without edit links, navboxes, citation markers,
  references, "see also" or external-link sections.
- **Links grow the tree** — clicking a blue link opens that article and adds it as a child of the one you're reading.
- **Free layout** — drag nodes anywhere; drop one onto another to re-attach it with its whole branch.
  Nodes that get too close glide apart.
- **30 languages** — search any of them; right-to-left languages are laid out correctly.
- **Offline** — save an article (or the whole project) with its images and read it without internet.
- **Always saved** — every change is written to disk immediately.

| | |
| --- | --- |
| ![Main menu](docs/screenshots/home.png) | ![Search](docs/screenshots/picker.png) |
| ![Reader](docs/screenshots/reader.png) | |

## Download

Get the latest build from [Releases](https://github.com/boraned/wikitree/releases/latest):

| OS | File | Notes |
| --- | --- | --- |
| Linux | `WikiTree-<version>-linux-x86_64.AppImage` | `chmod +x` it and run. |
| Windows | `WikiTree-<version>-windows-portable.exe` | Runs without installing. The build is unsigned, so SmartScreen may ask: *More info → Run anyway*. |
| macOS | `WikiTree-<version>-mac-universal.dmg` | Unsigned build: the first time, right-click the app → *Open*. |

## Use

- **Main menu** — the green **+** card starts a project. Choose *Wikipedia* (search, pick a language)
  or *Header*. Click a project card to open it.
- **Tree** — **+** under a node adds a child. Drag a node to move it with its branch; drop it on another
  node to attach it there. Double-click a header to rename it; right-click for collapse and delete.
  Drag the background to pan, scroll to zoom. Top bar: save all offline · arrange · fit.
- **Reader** — **Back** is top-left. Blue links open and become children; green links are already children.
  Ctrl / middle-click adds a link without leaving the page. ↓ saves the article for offline reading.

## Where data lives

The OS's per-user app folder: `~/.config/WikiTree` (Linux), `%APPDATA%\WikiTree` (Windows),
`~/Library/Application Support/WikiTree` (macOS).

```
projects/<id>/project.json   the tree
projects/<id>/pages/         articles saved for offline reading
projects/<id>/media/         their images
cache/                       recently opened articles (max 200 MB, least recently opened removed first)
```

Each change is written with an atomic replace. Several windows can be open at once: each edits its own
copy, and the window that changes something last overwrites the file. Set `WIKITREE_HOME` to keep the
data somewhere else (for example next to a portable copy).

## Development

Requires Node.js 20+.

```sh
npm install --include=dev
npm start                 # run from source
npm test                  # end-to-end tests against the real app (needs internet)
npm run test:offline      # + the same app with networking removed (Linux: unshare)
npm run screenshots       # regenerate docs/screenshots
npm run dist:linux        # AppImage   → dist/
npm run dist:win          # portable .exe → dist/
npm run dist:mac          # universal .dmg/.zip (run on a Mac)
```

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds all three platforms on native
runners and publishes a GitHub Release.

```
src/
  main/                    Electron main process
    index.js               window, wikitree:// protocol, menu, IPC
    projects.js            project files (create, save, delete, migrate)
    wikipedia.js           search, summaries, article HTML, namespaces, cache
    offline.js             saving articles + images for offline reading
    cache.js               size cap for the article cache
    paths.js               data folders, ids, atomic writes
    preload.cjs            the small API the UI is allowed to call
  renderer/                UI (plain ES modules, no framework, no build step)
    app.js                 router
    views/                 home, tree, reader
    lib/                   store (state + saving), clean (article clean-up), modal, api, dom
    styles/                app.css, article.css
    assets/                fonts, images
tests/                     end-to-end tests (playwright-core driving Electron)
scripts/                   screenshots, Linux desktop install
build/icon.png             app icon used by electron-builder
```

## Credits

Article text comes from [Wikipedia](https://www.wikipedia.org/) under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) and is credited under every article.
WikiTree is an independent project, not affiliated with or endorsed by the Wikimedia Foundation.
Fonts and other third-party material: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE) © Boran Omeroglu
