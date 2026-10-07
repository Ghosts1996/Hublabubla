const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBatchMatcher } = require('../smart-import-batch.js');

const matcher = createBatchMatcher({
  concurrency: 2,
  search: async track => {
    await new Promise(resolve => setTimeout(resolve, track.title === 'slow' ? 10 : 1));
    if (track.title === 'missing') return null;
    if (track.title === 'failed') throw new Error('Источник недоступен');
    return { id: track.title };
  }
});

test('пакетный matcher дедуплицирует и сохраняет порядок результатов', async () => {
  const results = await matcher([
    { title: 'first', artist: 'artist' },
    { title: 'missing', artist: 'artist' },
    { title: 'first', artist: 'artist' },
    { title: 'failed', artist: 'artist' }
  ]);

  assert.deepEqual(results.map(item => item.status), ['matched', 'missing', 'failed']);
  assert.equal(results[0].match.id, 'first');
});

test('пакетный matcher поддерживает отмену', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    matcher([{ title: 'track', artist: 'artist' }], controller.signal),
    error => error.name === 'AbortError'
  );
});
