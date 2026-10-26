# Changelog

## 2.1.0

- Right-click a node → **Remove from Parent Node** detaches it and its branch as a separate top-level tree,
  in place. The change is saved and recorded in history.
- Removed **Larger node / Smaller node** from the right-click menu. A− / A+ still resize all nodes, and
  images, web pages and attachments keep their corner resize handle.

## 2.0.0

- The add-node picker's sections are icons: Wikipedia (W), a new web search (magnifier), Header (a node
  with text) and Attach file (paperclip).
- Web search (DuckDuckGo) adds any page as a node. Pasting or typing a link opens that page directly.
  Pages run with JavaScript in Chromium, sandboxed from the app, in the in-memory session.
- Every node type is live on the overview: web pages, PDFs, Word, Markdown, text, source, video and audio.
  Click to interact, Esc or click elsewhere to release. Every preview and image can be rescaled from its
  corner and made fullscreen. The enlarged view shows the same live content.
- Removed the separate Play button on videos; players use their own controls and never autoplay.
- Reader top bar: the Back button is gone. Top left shows the parent and the current page, and arrows run
  from the current page above its children and down to each one. The tree button returns to the overview.
- Fixed: the iPad web-app test still counted 40 attachment samples after Word samples were added.

## 1.9.0

- Images in the tree can be rescaled by dragging the corner handle that appears on hover (from a quarter
  of their size up to 8×). The size is saved and neighbouring nodes move aside.
- Word documents (DOCX, DOCM, DOTX, DOTM) open in the app as pages on a dark background, like PDFs,
  including formatting, tables and embedded pictures. Rendering is offline and read-only: macros, embedded
  HTML, comments and tracked changes are not shown, and links do nothing. Damaged files fall back to the
  byte inspector.

## 1.8.0

- New users start with an example project, **Tree**: a perfect binary tree of 1,023 Wikipedia articles
  (10 levels, 512 leaves) taken from the top of the 5,000-article reality outline, with its full build
  history. It opens on its first five levels; Expand all shows every article. It is added once, only when
  there are no projects, and does not come back after being deleted.
- Removed the iOS web-app package from releases.

## 1.7.0

- Accept arbitrary attachments, including unknown extensions and files the native viewer cannot decode.
  Show their full filename with “Unsupported file” and open a safe read-only inspector on click.
- Added Hex, Binary, ASCII, Decimal, Octal, Text and Source views with bounded 16 KiB paging.
  UTF-8 characters remain intact across text-page boundaries.
- Bundled offline syntax highlighting for 193 language grammars, filename detection and manual language selection.
- Videos no longer autoplay or loop in the tree. Click to enlarge, play explicitly and enter/exit fullscreen;
  GIFs continue animating automatically. Images and audio can also open in the enlarged viewer.
- Added source and packaged-desktop coverage for opaque files, source highlighting, media controls and fullscreen.

## 1.6.5

- Use one supported-format catalog for desktop import, the picker and the PWA.
- Validate image/media decoding, UTF-8 text and PDF boundaries before storing attachments; reject
  unsupported codecs, damaged samples and mixed selections containing unsupported files.
- Removed OGV/Theora: its audio could play while the video remained blank.
- Added real fixtures and app-level coverage for all 27 supported suffixes, document rendering,
  media playback and rejected inputs, including checks that rejected files leave no stored copies.

## 1.6.4

- Arrange and node sizing separate independent trees and reserve space for scaled node controls.
- Layout changes no longer animate enlarged nodes through their neighbours.
- Added a bottom-centre toggle to reveal or close the bottom controls.
- Expand all and Shrink all preserve zoom and pan instead of calling Fit.

## 1.6.3

- Removed the zoom-out floor; Fit can frame the entire tree at any scale.
- Added independent whole-tree and per-node sizing for text, images and controls, saved with the project.
- Dropping the main root under another node promotes its highest ancestor to the project root and title,
  including cycle-safe rerooting when the target is already in the same tree.

## 1.6.2

- Added Expand all and Shrink all controls; a node's Expand action reveals five generations.
- Moved History to the bottom-right tree controls and kept the theme toggle on the main menu only.

## 1.6.1

- The Wikipedia and Header sections of the add-node picker are the same size as the Attach file section;
  search results scroll inside it.

## 1.6.0

- Sun/moon button in the top-right corner switches between dark (default) and light appearance; the choice is remembered.
- The desktop app now keeps the same project history as the web app: every save is a named revision
  (*Added: X under Y*, *Moved: X under Y*), with previews and restore from the log icon.
- Snapshots are size-based instead of every 50 revisions, so a 5,000-node history stays a few times the project's size.
- Project cards can show a chosen set of up to six pictures.
- Files and images of deleted nodes stay in the project while a revision still uses them, so restores are complete.
- Fixed: history rows no longer show "null", and "Load older" sits below the list.

## 1.5.0

- Right-clicking empty tree space creates a separate, unconnected top-level node at that position.
- Independent roots can be positioned, arranged, deleted and reattached without changing the project's main root.

## 1.4.0

- The PWA's green project-download button exports a `.wt` archive with project JSON, attachments, offline pages/media and full history.
- Added an Obsidian Markdown-outline export beside the `.wt` project archive option.
- Added a top-right history log with compact per-save changes, periodic full snapshots and restore.
- History deltas compress repeated child-order changes to keep large project archives smaller.

## 1.3.0

- Added an installable iPhone/iPad web app built from the same UI, with a home-screen icon and safe-area layout.
- Projects, file attachments and explicit Wikipedia downloads persist locally in browser storage; the app shell and saved content work offline.
- Web projects export to a compressed `.wt` bundle containing the project, attachment/offline data and full change history; the history log previews and restores snapshots.
- Added an HTTPS static-host build and GitHub Pages deployment workflow.

## 1.2.0

- Attach local images, animated GIFs, video, audio, PDFs, Markdown and text files to nodes. Attachments
  are copied into each project for offline access; documents open in the app and media previews in the tree.
- Multi-file picker supports click-to-browse and drag-and-drop; attached files can be the first node.

## 1.1.0

- Nodes can be dragged anywhere; dropping one onto another node re-attaches it with its whole branch.
- Nodes that get too close glide apart; **Arrange** lays the tree out again.
- Projects start from a big **+** card; the first node is an article or a header.
- Wikipedia search in 30 languages; right-to-left articles; per-language clean-up of reference,
  "see also" and external-link sections.
- Download articles (with images) for offline reading, one at a time or the whole project. The download
  button is green when there is something to download, otherwise normal colour and not clickable.
- Search and the reader say when there is no internet connection.
- Nothing from Wikipedia stays on disk unless downloaded: articles you read are kept in memory only, and
  caches left by older versions are removed.
- In-app confirmation dialogs; headers grow to fit their text.
- Every change is saved immediately; each window edits its own copy (last change wins);
  the last change is saved even when the window closes.
- Attribution under every article (Wikipedia, CC BY-SA 4.0).
- Builds: Linux AppImage, Windows portable `.exe`, macOS universal `.dmg` (via CI).
- Projects from 1.0 are migrated automatically.

## 1.0.0

- First version: projects as trees of Wikipedia articles and headers, in-app reader without
  Wikipedia's page clutter, blue links become child nodes, link previews.
