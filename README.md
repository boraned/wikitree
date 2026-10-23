# WikiTree

Desktop app for building trees of Wikipedia articles and reading them in place.
Needs only an internet connection (for Wikipedia) — no server, no account.

## Use

- **Main menu**: create a project, or click one to open it.
- **Tree**: the project title is the top node. The green **+** under any node adds a child:
  a **Wiki** (search Wikipedia) or a **Header** (a label to group things).
  Click a wiki node to read it. Double-click a header/title to rename. Right-click for
  move / collapse / delete. Drag to pan, scroll to zoom, ⛶ to fit.
- **Reader**: the article without Wikipedia's clutter (no edit links, navboxes, citations,
  reference sections). **Back** is top-left. Clicking a **blue link** opens that page and adds it as a
  child of the current page. Green links are already children. Ctrl/middle-click a link to
  add it without leaving. Hover a link for a preview; click an image to enlarge.

## Run / build

```sh
npm install --include=dev   # once
npm start                   # run from source
npm run dist                # build dist/WikiTree-1.0.0.AppImage (single file, runs anywhere on Linux)
npm run install-desktop     # install the AppImage into the app launcher
```

`electron-builder --win` / `--mac` builds Windows/macOS installers from the same source.

## Data

- Projects: `~/.config/WikiTree/projects/*.json`
- Article cache (3 days, used offline): `~/.cache/wikitree/pages`
