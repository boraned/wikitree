# WikiTree

Desktop app (Linux, Windows, macOS) for building trees of Wikipedia articles and reading them in place.
Needs only an internet connection for Wikipedia — no server, no account. Saved articles work offline.

## Use

- **Main menu**: the green **+** starts a project. Its first node is either a Wikipedia article
  (search, any of 30 languages) or a header. Click a project to open it.
- **Tree**: the green **+** under any node adds a child (article or header).
  Drag a node to move it with everything below it; drop it onto another node to attach it there.
  Nodes that get too close slide apart. Double-click a header to rename it. Right-click for collapse / delete.
  Drag the background to pan, scroll to zoom. Top bar: save all offline, arrange, fit.
- **Reader**: the article without Wikipedia's clutter (edit links, navboxes, citations, reference /
  see-also / external-link sections). **Back** is top-left. A **blue link** opens that page and adds it as a
  child of the current page; green links are already children. Ctrl/middle-click adds without leaving.
  The ↓ button saves the article and its images for offline reading.

## Data and multiple windows

Stored in the OS's per-user app data folder (`~/.config/WikiTree`, `%APPDATA%\WikiTree`,
`~/Library/Application Support/WikiTree`):

- `projects/<id>/project.json` — the tree
- `projects/<id>/pages/`, `projects/<id>/media/` — articles saved for offline reading
- `cache/` — recently opened articles (3 days)

Every change (adding, moving, renaming, collapsing…) is written immediately with an atomic replace.
Each window works on its own copy loaded when the project opens; whichever window changes something
last overwrites the file. Set `WIKITREE_HOME` to use a different data folder (e.g. a portable one).

## Run / build

```sh
npm install --include=dev   # once
npm start                   # run from source
npm run dist:linux          # dist/WikiTree-<v>-linux-x86_64.AppImage   (single file)
npm run dist:win            # dist/WikiTree-<v>-windows-portable.exe    (single file, no install)
npm run dist:mac            # universal .dmg + .zip — must run on a Mac
npm run install-desktop     # Linux: add the AppImage to the app launcher
```

`.github/workflows/build.yml` builds all three on native runners (push a `v*` tag or run it manually).
