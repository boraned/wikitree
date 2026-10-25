// All network traffic goes through one in-memory session: nothing fetched from Wikipedia
// (pages, images, HTTP cache) is written to disk. Only explicit downloads are stored.
import { session } from 'electron';

export const PARTITION = 'wikitree'; // no "persist:" prefix → memory only, gone when the app closes

let ses = null;
export function memorySession() {
  if (!ses) ses = session.fromPartition(PARTITION, { cache: true });
  return ses;
}

export const httpFetch = (url, options) => memorySession().fetch(url, options);
