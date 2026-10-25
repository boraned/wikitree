# Changelog

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
