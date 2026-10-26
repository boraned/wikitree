# Third-party notices

WikiTree's own code is MIT-licensed (see `LICENSE`). It bundles or uses:

| What | Where | License |
| --- | --- | --- |
| Inter (font) | `src/renderer/assets/fonts/inter*.woff2` | SIL Open Font License 1.1 — `src/renderer/assets/fonts/LICENSE-Inter.txt` |
| Libertinus Serif (font) | `src/renderer/assets/fonts/libertinus*.woff2` | SIL Open Font License 1.1 — `src/renderer/assets/fonts/LICENSE-Libertinus.txt` |
| Wikipedia globe logo | `src/renderer/assets/img/wikipedia-globe.svg`, `build/icon.png` | © Wikimedia Foundation, CC BY-SA 3.0. The logo and the name "Wikipedia" are trademarks of the Wikimedia Foundation; use is subject to the [Wikimedia trademark policy](https://foundation.wikimedia.org/wiki/Policy:Trademark_policy). |
| Wikipedia article text and media | fetched at run time | Text: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) (credited under every article). Images: individual licences listed on their Wikimedia Commons pages. |
| Electron | runtime | MIT |

WikiTree is an independent project. It is not affiliated with or endorsed by the Wikimedia Foundation.
## marked

The Markdown reader includes marked v18.1.1 (MIT License), vendored under `src/renderer/assets/vendor/`.
Copyright (c) 2011–2026 MarkedJS and Christopher Jeffrey.

## highlight.js

Source-code viewing bundles highlight.js v11.12.0, including its 193 language grammars (BSD 3-Clause).
The license is included at `src/renderer/assets/vendor/highlight.LICENSE`.
The browser bundle and language catalog are rebuilt with `npm run build:highlighter` using esbuild (MIT, build-time only).

## docx-preview and JSZip

Word documents are rendered with docx-preview v0.4.1 (Apache License 2.0) and JSZip v3.10.2 (MIT, from its
MIT-or-GPLv3 dual licence), bundled offline into `src/renderer/assets/vendor/docx-preview.esm.js`.
Licences: `src/renderer/assets/vendor/docx-preview.LICENSE`, `src/renderer/assets/vendor/jszip.LICENSE.md`.
Rebuild with `npm run build:docx`.
