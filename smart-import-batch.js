'use strict';

(function (root) {
  function createBatchMatcher(options) {
    const smartImport = root.VibeSmartImport || (typeof require === 'function' ? require('./smart-import.js') : null);
    if (!smartImport) throw new Error('Модуль нормализации импорта не подключён');
    const search = options && options.search;
    const concurrency = Math.max(1, Math.min(Number(options && options.concurrency) || 3, 8));
    if (typeof search !== 'function') throw new TypeError('Нужна функция поиска трека');

    return async function matchAll(rawTracks, signal) {
      const tracks = smartImport.deduplicateTracks(rawTracks);
      const results = new Array(tracks.length);
      let nextIndex = 0;

      const worker = async () => {
        while (true) {
          if (signal && signal.aborted) throw new DOMException('Импорт отменён', 'AbortError');
          const index = nextIndex++;
          if (index >= tracks.length) return;
          const track = tracks[index];
          try {
            const match = await search(track, signal);
            results[index] = {
              track,
              status: match ? 'matched' : 'missing',
              match: match || null
            };
          } catch (error) {
            if (error && error.name === 'AbortError') throw error;
            results[index] = {
              track,
              status: 'failed',
              match: null,
              error: error instanceof Error ? error.message : 'Ошибка поиска'
            };
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(concurrency, tracks.length) }, worker));
      return results;
    };
  }

  const api = Object.freeze({ createBatchMatcher });
  root.VibeSmartImportBatch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
