const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createImportClient } = require('../smart-import-client.js');
const url = 'https://open.spotify.com/playlist/abc';
function client(responses, options = {}) {
  return createImportClient({ baseUrl: 'https://api.example.test', pollIntervalMs: 1,
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: responses.shift() }) }), ...options });
}
test('создаёт импорт и передаёт прогресс до завершения', async () => {
  const progress = [];
  const result = await client([
    { job_id: 'job_1' },
    { job_id: 'job_1', status: 'matching', total: 2, processed: 1, items: [] },
    { job_id: 'job_1', status: 'completed', total: 2, processed: 2, items: [] }
  ]).run(url, { onProgress: job => progress.push(job.processed) });
  assert.equal(result.status, 'completed');
  assert.deepEqual(progress, [1, 2]);
});
test('ошибка сервера не превращается в успешный импорт', async () => {
  const result = await client([{ job_id: 'j' },
    { job_id: 'j', status: 'failed', total: 0, processed: 0, items: [] }]).run(url);
  assert.equal(result.status, 'failed');
});
test('отклоняет некорректный ответ и ограничивает polling', async () => {
  await assert.rejects(client([{ job_id: '../bad' }]).run(url), /идентификатор/);
  await assert.rejects(client([{ job_id: 'j' },
    { job_id: 'j', status: 'matching', total: 1, processed: 2, items: [] }]).run(url), /состояние/);
  await assert.rejects(client([{ job_id: 'j' },
    { job_id: 'j', status: 'queued', total: 0, processed: 0, items: [] }], { maxPolls: 1 }).run(url), /Ожидание завершено/);
});
test('отмена до создания не отправляет запрос', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client([]).run(url, { signal: controller.signal }), { name: 'AbortError' });
});
test('таймаут прерывает HTTP-запрос', async () => {
  const api = client([], { requestTimeoutMs: 5, fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Отмена', 'AbortError')), { once: true });
  }) });
  await assert.rejects(api.run(url), /не ответил вовремя/);
});
