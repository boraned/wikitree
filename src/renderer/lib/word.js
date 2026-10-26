// Word documents (.docx/.docm/.dotx/.dotm) rendered as pages in the app, offline. Read-only: macros never run,
// links are inert, embedded HTML chunks, comments and tracked changes are not rendered.
let renderer;
const load = () => renderer ||= import('../assets/vendor/docx-preview.esm.js');

const OPTIONS = {
  className: 'docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true,
  renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
  renderAltChunks: false, renderComments: false, renderChanges: false, useBase64URL: true, experimental: false,
};

/** Parses the document without displaying it; throws for anything that isn't a readable Word file. */
export async function validateWord(blob) {
  const { parseAsync } = await load();
  const doc = await parseAsync(blob, OPTIONS);
  if (!doc?.documentPart?.body) throw new Error('Not a Word document');
}

export async function renderWord(container, blob) {
  const { renderAsync } = await load();
  // Separate holders: the renderer empties the body container, which would also drop styles kept inside it.
  const styles = document.createElement('div');
  styles.className = 'word-styles';
  const pages = document.createElement('div');
  pages.className = 'word-pages';
  container.replaceChildren(styles, pages);
  await renderAsync(blob, pages, styles, OPTIONS);
  // The app routes with location.hash, so even internal bookmark links would navigate away.
  for (const a of container.querySelectorAll('a[href]')) a.removeAttribute('href');
  for (const el of container.querySelectorAll('script, iframe, object, embed')) el.remove();
  return container.querySelectorAll('section.docx').length;
}
