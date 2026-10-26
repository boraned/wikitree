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
- **Offline when you choose** — download an article (or the whole project) with its images and read it without
  internet. Nothing else is kept: articles you only read are held in memory and gone when the app closes.
- **Always saved** — every change is written to disk immediately.

| | |
| --- | --- |
| ![Main menu](docs/screenshots/home.png) | ![Search](docs/screenshots/picker.png) |
| ![Reader](docs/screenshots/reader.png) | |

## Download

Get the latest build from [Releases](https://github.com/boraned/wikitree/releases/latest):

| OS | File | How to open |
| --- | --- | --- |
| Windows | `WikiTree-<version>-Windows-x64.exe` | Double-click — no install. Unsigned, so SmartScreen may ask: *More info → Run anyway*. |
| macOS (M1–M4) | `WikiTree-<version>-macOS-AppleSilicon.zip` | Unzip, move *WikiTree* to Applications, open it. The first time macOS blocks it: *System Settings → Privacy & Security → Open Anyway*. |
| macOS (Intel) | `WikiTree-<version>-macOS-Intel.zip` | Same as above. |
| Linux | `WikiTree-<version>-Linux-x64.AppImage` | Make it executable (`chmod +x`) and run it. Some distros need `libfuse2`. |

Each is a single file with everything included; it only needs an internet connection for Wikipedia. WikiTree currently has no iOS release.

## Use

- **Main menu** — the green **+** card starts a project. The picker's four icon sections are **W** (Wikipedia:
  search, pick a language), **🔍** (search the web, or paste a link to add that page straight away), the
  **header** node, and the **paperclip** (attach files). Click a project card to open it.
  On first launch the menu holds an example, **Tree**: 1,023 Wikipedia articles in a perfect binary tree,
  with the history of how it was built. Delete it like any other project; it is not added again.
- **Tree** — **+** under a node adds a child. Right-click empty space to add a disconnected top-level node
  at that position. Drag a node to move its branch; drop it on another node to attach it there.
  Double-click a header to rename it; right-click a node for its menu.
  Drag the background to pan, scroll to zoom without a zoom-out floor. **A− / A+** resize all nodes
  independently of zoom. Right-click a node and choose **Remove from Parent Node** to detach it, with its
  branch, as a separate tree right where it is.
  The bottom-centre chevron reveals or hides the bottom controls. **Expand all / Shrink all** control
  visibility without changing zoom or pan; a node's **Expand** opens five generations.
  Arrange and node sizing keep separate trees and scaled node buttons from overlapping.
  Dropping the main root under another node makes that node's highest ancestor the new project root and title.
  Top bar: download all · arrange · fit. History is at the bottom right.
- **History** — the log icon lists every saved change (*Added: Atom under Matter*, *Moved: …*), previews the
  project at any revision and restores it; the restore is itself a new revision.
- **Light / dark** — the sun/moon button on the main menu switches the appearance; dark is the default.
- **Reader** — top left shows the parent, then the current page; to its right, arrows lead down to each of
  the page's children. Click any of them to go there. The tree button (top right) returns to the overview.
  Blue links open and become children; green links are already children.
  Ctrl / middle-click adds a link without leaving the page. ↓ downloads the article for offline reading.
- **Download button** — green when there is something to download; normal colour and not clickable when
  everything is downloaded (✓) or there is no internet.

## Where data lives

The OS's per-user app folder: `~/.config/WikiTree` (Linux), `%APPDATA%\WikiTree` (Windows),
`~/Library/Application Support/WikiTree` (macOS).

```
projects/<id>/project.json   the tree
projects/<id>/history/       change log (log.jsonl) and occasional full snapshots
projects/<id>/pages/         downloaded articles
projects/<id>/media/         their images
projects/<id>/files/         attached files
settings.json                last search language, light/dark
```

Nothing from Wikipedia is stored unless you download it. Pages and images you read are kept in memory
while the app runs; Chromium's own session files go to a temporary folder that is removed when the app
quits (any leftovers from a crash are removed on the next start).

Each change is written with an atomic replace. Several windows can be open at once: each edits its own
copy, and the window that changes something last overwrites the file. Set `WIKITREE_HOME` to keep the
data somewhere else (for example next to a portable copy).

### Attach files to the tree

Use the **File** tab in the add-node picker, then drop files into the middle or click to browse. Several
files may be attached at once. They are copied into the project, so they remain offline and still work
if the originals are moved or deleted. Files may also be the first (top) node of a new project.

- Images appear directly in the tree without title cards. They keep their full aspect ratio and are scaled
  only to fit the canvas (up to 1000 × 760 display pixels); the source file stays at its original resolution.
  Animated GIFs remain animated.
- **Everything is viewable on the overview.** Web pages, PDFs, Word documents, Markdown, text, source code,
  video and audio show live inside their node. Click a node's content to use it (scroll, play, type); click
  outside or press Esc to go back to moving the canvas. Each node has a fullscreen button and an open-large
  button, and a corner handle to rescale it (a quarter of its size up to 8×). Sizes are saved and nearby
  nodes move aside.
- Videos never play by themselves; use the player's own controls. GIFs keep animating automatically.
- **Web pages** load through Chromium with JavaScript on, in a sandboxed frame with their own origin: they
  cannot reach WikiTree or your files, and anything they store is gone when the app closes. Sites that
  forbid being shown in a frame are shown anyway. Camera, microphone, location and notifications are refused.
  Web search uses DuckDuckGo.
- PDFs, Markdown, and plain text (TXT, CSV, JSON, LOG) open in the in-app document reader.
- Word documents (DOCX, DOCM, DOTX, DOTM) open as pages, like a PDF, with their text formatting, tables
  and pictures. Macros never run and links are inert. Older binary `.doc`, `.rtf` and `.odt` files are
  accepted as unsupported files and open in the byte inspector.
- Source files (including C, C++, Java, Python, Rust, JavaScript and TypeScript) open with offline
  syntax highlighting from 193 bundled language grammars; the language can also be selected manually.
- Any other file is accepted with its full filename and **Unsupported file** underneath. Click to inspect
  its bytes as Hex, Binary, ASCII, Decimal, Octal, Text or Source. Inspection is read-only: files are not executed.
  Large text and binary files use bounded 16 KiB pages rather than loading the entire attachment.
- Supported images: PNG, JPG/JPEG, GIF, WebP, AVIF, SVG, BMP. Video: MP4, M4V, WebM, MOV.
  Audio: MP3, WAV, OGG/OGA, M4A, AAC, FLAC, OPUS. Documents: PDF, DOCX/DOCM/DOTX/DOTM, MD/Markdown, UTF-8 TXT, CSV, JSON, LOG.
  Individual files are limited to 2 GB. Image/media decoding is checked to choose the appropriate viewer;
  unsupported codecs, damaged samples and unrecognized formats fall back to byte inspection without losing their bytes.
  Unreadable selections, directories and files larger than 2 GB are still rejected.

## Development

Requires Node.js 20+. Attachment tests generate real fixtures using FFmpeg and ImageMagick (`magick` or `convert`).

```sh
npm install --include=dev
npm start                 # run from source
npm test                  # end-to-end tests against the real app (needs internet)
npm run test:offline      # + the same app with networking removed (Linux: unshare)
npm run screenshots       # regenerate docs/screenshots
npm run dist:linux        # AppImage   → dist/
npm run dist:win          # portable .exe → dist/
npm run dist:mac          # universal .dmg/.zip (run on a Mac)
npm run release           # all four release files → releases/ (on Linux; Mac apps ad-hoc signed)
```

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds all three platforms on native
runners and publishes a GitHub Release.

```
src/
  main/                    Electron main process
    index.js               window, wikitree:// protocol, menu, IPC
    projects.js            project files (create, save, delete, migrate)
    wikipedia.js           search, summaries, article HTML, namespaces (in-memory cache)
    offline.js             downloading articles + images for offline reading
    http.js                in-memory network session (nothing cached on disk)
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
