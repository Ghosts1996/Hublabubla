const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('smart-import.js', 'utf8');
const context = vm.createContext({ URL });
vm.runInContext(source, context);
const smartImport = context.VibeSmartImport;

test('распознаёт официальный Spotify playlist URL', () => {
  assert.deepEqual(
    smartImport.parseImportUrl('https://open.spotify.com/playlist/abc123?si=test'),
    {
      originalUrl: 'https://open.spotify.com/playlist/abc123?si=test',
      source: 'spotify',
      resourceType: 'playlist',
      resourceId: 'abc123'
    }
  );
});

test('распознаёт URL альбома Яндекс Музыки', () => {
  const parsed = smartImport.parseImportUrl('https://music.yandex.ru/album/987654');
  assert.equal(parsed.source, 'yandex');
  assert.equal(parsed.resourceType, 'album');
  assert.equal(parsed.resourceId, '987654');
});

test('отклоняет небезопасные и неподдерживаемые ссылки', () => {
  assert.throws(() => smartImport.parseImportUrl('http://open.spotify.com/playlist/x'), /HTTPS/);
  assert.throws(() => smartImport.parseImportUrl('https://example.com/playlist/x'), /не поддерживается/);
  assert.throws(() => smartImport.parseImportUrl('https://open.spotify.com/track/x'), /альбом или плейлист/);
});

test('нормализует и дедуплицирует треки по ISRC и metadata', () => {
  const result = smartImport.deduplicateTracks([
    { title: ' Song [Official Video] ', artist: 'Artist', isrc: 'us-a1' },
    { title: 'Song', artist: 'Artist', isrc: 'US-A1' },
    { title: 'Other (prod. someone)', artist: 'Artist' },
    { title: 'Other', artist: 'Artist' }
  ]);

  assert.equal(result.length, 2);
  assert.equal(result[0].key, 'isrc:US-A1');
  assert.equal(result[1].title, 'Other');
});
