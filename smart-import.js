'use strict';

// Безопасная классификация ссылок. Получение треклиста выполняется только backend
// через официальные API провайдера, а не через scraping закрытых страниц.
(function (root) {
  const SOURCE_RULES = [
    { source: 'spotify', hosts: ['open.spotify.com'], types: ['album', 'playlist'] },
    { source: 'yandex', hosts: ['music.yandex.ru', 'music.yandex.com'], types: ['album', 'playlist'] },
    { source: 'vk', hosts: ['vk.com', 'vk.ru'], types: ['playlist'] }
  ];

  function parseImportUrl(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) throw new Error('Ссылка не может быть пустой');

    let url;
    try { url = new URL(value); } catch { throw new Error('Некорректный URL'); }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('Нужна безопасная HTTPS-ссылка');
    }

    if (url.port && url.port !== '443') throw new Error('Нестандартный порт не поддерживается');
    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean);
    if (/^intl-[a-z-]+$/i.test(segments[0]) && host === 'open.spotify.com') segments.shift();
    const rule = SOURCE_RULES.find(item => item.hosts.includes(host));
    if (!rule) throw new Error('Источник не поддерживается');

    let type;
    let id;
    if (rule.source === 'yandex') {
      const typeIndex = segments.findIndex(item => item === 'album' || item === 'playlist');
      type = typeIndex >= 0 ? segments[typeIndex] : '';
      id = typeIndex >= 0 ? segments[typeIndex + 1] : '';
    } else {
      type = segments[0];
      id = segments[1];
    }

    if (!rule.types.includes(type) || !id) {
      throw new Error('Ссылка должна вести на альбом или плейлист');
    }

    return { originalUrl: value, source: rule.source, resourceType: type, resourceId: id };
  }

  function normalizeTrack(track) {
    const value = track || {};
    const clean = text => String(text || '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\([^)]*(prod\.?|remix|version|edit)[^)]*\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const title = clean(value.title);
    const artist = clean(value.artist);
    const isrc = String(value.isrc || '').trim().toUpperCase();
    return { ...value, title, artist, isrc, key: isrc ? `isrc:${isrc}` : `${artist.toLowerCase()}::${title.toLowerCase()}` };
  }

  function deduplicateTracks(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).map(normalizeTrack).filter(track => {
      if (!track.title || !track.artist || seen.has(track.key)) return false;
      seen.add(track.key);
      return true;
    });
  }

  root.VibeSmartImport = Object.freeze({ parseImportUrl, normalizeTrack, deduplicateTracks });
})(typeof window === 'undefined' ? globalThis : window);
