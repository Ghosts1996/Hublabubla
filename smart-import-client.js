'use strict';
(function (root) {
  const terminal = new Set(['completed', 'partially_completed', 'failed', 'cancelled']);
  const statuses = new Set(['queued', 'resolving', 'matching', 'saving', ...terminal]);
  function abortError() { return new DOMException('Ожидание импорта отменено', 'AbortError'); }
  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(abortError());
      const finish = () => { if (signal) signal.removeEventListener('abort', cancel); resolve(); };
      const timer = setTimeout(finish, ms);
      const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(abortError()); };
      if (signal) signal.addEventListener('abort', cancel, { once: true });
    });
  }
  function createImportClient({ baseUrl, fetchImpl = root.fetch, token = async () => null,
    requestTimeoutMs = 15000, pollIntervalMs = 1000, maxPolls = 300 }) {
    const base = new URL(baseUrl);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
      throw new Error('Backend должен использовать HTTPS без учётных данных в URL');
    }
    const prefix = base.pathname.replace(/\/+$/, '');
    const endpoint = path => new URL(`${prefix}${path}`, base.origin);
    async function request(path, method, body, signal) {
      if (signal && signal.aborted) throw abortError();
      const controller = new AbortController();
      const cancel = () => controller.abort();
      if (signal) signal.addEventListener('abort', cancel, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeoutMs);
      try {
        const accessToken = await token();
        if (controller.signal.aborted) throw abortError();
        const response = await fetchImpl(endpoint(path), {
          method, signal: controller.signal,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {})
        });
        if (!response.ok) throw new Error(`Ошибка сервиса импорта (HTTP ${response.status})`);
        const json = await response.json();
        if (!json || !json.data || typeof json.data !== 'object') throw new Error('Некорректный ответ сервиса импорта');
        return json.data;
      } catch (error) {
        if (timedOut && !(signal && signal.aborted)) throw new Error('Сервис импорта не ответил вовремя');
        throw error;
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', cancel);
      }
    }
    function validateJob(job, id) {
      if (job.job_id !== id || !statuses.has(job.status) ||
          !Number.isInteger(job.total) || !Number.isInteger(job.processed) ||
          job.total < 0 || job.processed < 0 || job.processed > job.total ||
          !Array.isArray(job.items) || job.items.some(item => !item || typeof item !== 'object' ||
            typeof item.title !== 'string' || typeof item.artist !== 'string' ||
            !['added', 'already_exists', 'missing', 'unavailable', 'failed'].includes(item.status))) {
        throw new Error('Некорректное состояние импорта');
      }
      return job;
    }
    async function run(url, { signal, onProgress = () => {} } = {}) {
      const parser = root.VibeSmartImport || (typeof require === 'function' ? require('./smart-import.js') : null);
      const parsed = parser.parseImportUrl(url);
      const created = await request('/api/v1/import-jobs', 'POST', { url: parsed.originalUrl, target: 'favorites' }, signal);
      if (typeof created.job_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(created.job_id)) {
        throw new Error('Сервис не вернул идентификатор импорта');
      }
      for (let count = 0; count < maxPolls; count++) {
        const job = validateJob(await request(`/api/v1/import-jobs/${created.job_id}`, 'GET', null, signal), created.job_id);
        if (signal && signal.aborted) throw abortError();
        onProgress(job);
        if (terminal.has(job.status)) return job;
        await delay(pollIntervalMs, signal);
      }
      throw new Error('Ожидание завершено. Импорт может продолжаться на сервере');
    }
    return Object.freeze({ run });
  }
  const api = Object.freeze({ createImportClient });
  root.VibeSmartImportClient = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
