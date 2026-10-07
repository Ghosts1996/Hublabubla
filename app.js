'use strict';
const $ = s => document.querySelector(s);
const audio = $('#audio');
const view = $('#view');
const input = $('#searchInput');
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function load(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key)); return Array.isArray(value) ? value : fallback; }
  catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { toast('Браузер не разрешает сохранение. Коллекция доступна в текущем сеансе.'); }
}
const tracks = [
  {id:'demo-1', title:'Neon Drift', artist:'Vibe Synth', album:'Встроенное демо · 24 сек', cover:'gradient-1', time:'0:24', demo:0},
  {id:'demo-2', title:'Ocean Pulse', artist:'Vibe Synth', album:'Встроенное демо · 24 сек', cover:'gradient-4', time:'0:24', demo:1},
  {id:'demo-3', title:'Golden Hour', artist:'Vibe Synth', album:'Встроенное демо · 24 сек', cover:'gradient-3', time:'0:24', demo:2}
];
let imported = load('vibe-imported', []).filter(t => t && typeof t.id === 'string').map(t => ({...t, cover:'gradient-6', src:safeAudio(t.src)}));
let liked = load('vibe-liked', []);
let history = load('vibe-history', []);
let queue = [...tracks, ...imported];
let current = null, shuffle = false, repeat = false, playRequest = 0;
let remoteResults = [], remoteSearchRequest = 0, archiveController = null;
let searchLoading = false;
const searchCache = new Map();
const pendingAudio = new Map();
const lyricsCache = new Map();
let lyricsRequest = 0, lyricsController;
function resetLyrics() {
  lyricsRequest++; lyricsController?.abort();
  $('#lyricsPanel').hidden=true;
  $('#fullLyrics').setAttribute('aria-expanded','false');
  $('#lyricsText').textContent=''; $('#lyricsStatus').textContent='';
}
$('#fullLyrics').onclick=async()=>{
  const panel=$('#lyricsPanel');
  if(!panel.hidden){resetLyrics();return;}
  if(!current){toast('Сначала выбери трек');return;}
  const track=current, request=++lyricsRequest;
  lyricsController?.abort();
  lyricsController=typeof AbortController==='function'?new AbortController():null;
  panel.hidden=false;$('#fullLyrics').setAttribute('aria-expanded','true');
  $('#lyricsStatus').textContent='Ищем текст…';$('#lyricsText').textContent='';
  try {
    const key=JSON.stringify([track.artist,track.title]);
    let data=lyricsCache.get(key);
    if(!data){
      const params=new URLSearchParams({artist_name:track.artist,track_name:track.title});
      data=await fetchJSON(`https://lrclib.net/api/get?${params}`,{signal:lyricsController?.signal});
      lyricsCache.set(key,data);if(lyricsCache.size>30)lyricsCache.delete(lyricsCache.keys().next().value);
    }
    if(request!==lyricsRequest||current!==track)return;
    const text=data.plainLyrics || String(data.syncedLyrics||'').replace(/\[\d+:\d+(?:\.\d+)?\]/g,'');
    $('#lyricsText').textContent=text;
    $('#lyricsStatus').textContent=data.instrumental?'Инструментальная композиция':text?'':'Текст для этой записи не найден';
  }catch(error){if(request===lyricsRequest&&error.name!=='AbortError')$('#lyricsStatus').textContent=`Не удалось загрузить текст: ${error.message}`;}
};
  const fullPlayer = $('#fullPlayer');
  const syncPlayer = () => {
    if (!current) return;
    $('#fullTitle').textContent = current.title; $('#fullArtist').textContent = current.artist;
    $('#fullCover').className = `full-cover ${current.cover}`;
    $('#fullLike').textContent = liked.includes(current.id) ? '♥ В любимом' : '♡ Любимое';
    $('#fullPlay').textContent = audio.paused ? '▶' : 'Ⅱ';
  };
  const allTracks = () => queue;
  function remoteTrack(item) {
    return {id:`archive-${item.identifier}`, title:item.title || item.identifier || 'Без названия', artist:Array.isArray(item.creator)?item.creator.join(', '):(item.creator || 'Internet Archive'), album:'Открытая библиотека · Internet Archive', cover:'gradient-5', time:'—', sourceId:item.identifier, openSource:true};
  }
  async function fetchJSON(url, {signal, timeout=12000}={}) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const abort = () => controller?.abort();
    let timer;
    try {
      if (signal?.aborted) { const error=new Error('Cancelled'); error.name='AbortError'; throw error; }
      signal?.addEventListener('abort', abort, {once:true});
      return await Promise.race([
        (async()=>{const response=await fetch(url, controller ? {signal:controller.signal} : {});if(!response.ok)throw new Error(response.status===404?'Не найдено':'Источник временно недоступен');return response.json();})(),
        new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('Источник не ответил. Попробуй снова.');error.name='TimeoutError';reject(error);abort();},timeout);})
      ]);
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function findArchiveAudio(identifier) {
    const data = await fetchJSON(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
    const file = (data.files || []).find(f => /\.(mp3|ogg|oga|m4a|wav)$/i.test(f.name || '') && !/sample|thumb|preview/i.test(f.name || ''));
    if (!file) throw new Error('В результате нет открытого аудиофайла');
    return `https://archive.org/download/${encodeURIComponent(identifier)}/${file.name.split('/').map(encodeURIComponent).join('/')}`;
  }
  async function searchArchive(query) {
    const request = ++remoteSearchRequest;
      if (archiveController) archiveController.abort();
      archiveController = typeof AbortController === 'function' ? new AbortController() : null;
    if (!query.trim()) { remoteResults=[]; return route(); }
    const normalized = query.trim().toLowerCase();
    if (searchCache.has(normalized)) { searchLoading=false; remoteResults = searchCache.get(normalized); renderSearch(input.value); return; }
    searchLoading=true;
    try {
      const params = new URLSearchParams({q:`${query.trim().split(/\s+/).map(word=>'"'+word.replace(/["\\]/g,'')+'"').join(' AND ')} AND mediatype:audio`, 'fl[]':'identifier,title,creator', rows:'20', page:'1', output:'json'});
      const data = await fetchJSON(`https://archive.org/advancedsearch.php?${params}`, {signal:archiveController?.signal});
      if (request !== remoteSearchRequest) return;
      searchLoading=false;
      remoteResults=(data.response?.docs || []).map(remoteTrack);
      searchCache.set(normalized, remoteResults);
      if (searchCache.size > 20) searchCache.delete(searchCache.keys().next().value);
      renderSearch(input.value);
    } catch(error) { if (error.name === 'AbortError') return; if(request===remoteSearchRequest) { searchLoading=false; remoteResults=[]; renderSearch(input.value,error.message); } }
  }
  async function materializeRemote(track) {
    if (!track.src) {
      let pending=pendingAudio.get(track.sourceId);
      if(!pending){pending=findArchiveAudio(track.sourceId);pendingAudio.set(track.sourceId,pending);}
      try{track.src=await pending;}finally{if(pendingAudio.get(track.sourceId)===pending)pendingAudio.delete(track.sourceId);}
    }
    if (!queue.some(t=>t.id===track.id)) { queue.push(track); imported.push(track); save('vibe-imported', imported); }
    return track;
  }
  function safeAudio(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; }
  catch { return ''; }
}
function fmt(seconds) { return Number.isFinite(seconds) ? `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}` : '0:00'; }
let toastTimer;
function toast(message) {
  $('#toast').textContent = message; $('#toast').classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4000);
}
// Original generated demo audio: no network requests or misleading artist credits.
function demoAudio(index) {
  const rate = 22050, length = rate * 24;
  const buffer = new ArrayBuffer(44 + length * 2), data = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((c,i) => data.setUint8(offset+i,c.charCodeAt(0)));
  text(0,'RIFF'); data.setUint32(4,36+length*2,true); text(8,'WAVE'); text(12,'fmt ');
  data.setUint32(16,16,true); data.setUint16(20,1,true); data.setUint16(22,1,true);
  data.setUint32(24,rate,true); data.setUint32(28,rate*2,true); data.setUint16(32,2,true); data.setUint16(34,16,true);
  text(36,'data'); data.setUint32(40,length*2,true);
  const notes = [[220,261.63,329.63,293.66],[174.61,220,261.63,196],[261.63,329.63,392,349.23]][index];
  for (let i=0; i<length; i++) {
    const t=i/rate, beat=t%0.5, f=notes[Math.floor(t/3)%4];
    const pad=(Math.sin(2*Math.PI*f*t)+0.4*Math.sin(2*Math.PI*f*1.5*t))*0.13;
    const pluck=Math.sin(2*Math.PI*f*2*t)*Math.exp(-beat*12)*0.16;
    const kick=Math.sin(2*Math.PI*65*beat)*Math.exp(-beat*22)*0.22;
    const fade=Math.min(1,t/0.5,(24-t)/1.5);
    data.setInt16(44+i*2,Math.round((pad+pluck+kick)*fade*32767),true);
  }
  return URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));
}
function cover(t, small=false) {
  return `<div class="${small?'track-cover':'cover'} ${escapeHTML(t.cover)}"><span>✦</span>${small?'':`<button class="play-float" data-play="${escapeHTML(t.id)}" aria-label="Слушать ${escapeHTML(t.title)}">▶</button>`}</div>`;
}
function trackRow(t,i) {
  return `<div class="track ${current?.id===t.id?'current-track':''}"><span class="track-num">${String(i+1).padStart(2,'0')}</span>${cover(t,true)}<button class="track-info" data-play="${escapeHTML(t.id)}"><div class="track-name">${escapeHTML(t.title)}</div><div class="track-author">${escapeHTML(t.artist)} · ${escapeHTML(t.album)}</div></button><span class="track-time">${escapeHTML(t.time||'—')}</span><button class="track-like ${liked.includes(t.id)?'liked':''}" data-like="${escapeHTML(t.id)}" aria-label="Избранное" aria-pressed="${liked.includes(t.id)}">${liked.includes(t.id)?'♥':'♡'}</button></div>`;
}
function rows(list) { return list.length ? `<div class="track-list">${list.map(trackRow).join('')}</div>` : '<div class="empty"><strong>Здесь начинается твоя коллекция</strong>Добавь файлы в разделе «Добавить музыку».</div>'; }
function renderDiscover() {
  view.innerHTML = `<section class="hero"><div><div class="eyebrow">ТВОЯ ЛИЧНАЯ МУЗЫКАЛЬНАЯ ВСЕЛЕННАЯ</div><h1>Поймай<br><span>свой ритм.</span></h1><p>Без подписок. Без лишнего шума. Только ты и музыка.</p><div class="hero-actions"><button class="primary" data-play="demo-1">▶ Слушать демо</button><a class="secondary" href="#imports">↥ Добавить музыку</a></div><small class="hero-note">Три оригинальных синтезированных демо работают офлайн</small></div><div class="hero-art" aria-hidden="true"><div class="vinyl"><div class="vinyl-label">vibe<br><small>SIDE A / 33 RPM</small></div></div><div class="art-caption">YOUR SOUND. YOUR SPACE.</div></div></section><section class="section"><div class="section-head"><h2>Звук на пробу</h2><span class="section-tag">VIBE ORIGINALS</span></div><div class="cards">${tracks.map(t=>`<article class="card">${cover(t)}<div class="card-title">${escapeHTML(t.title)}</div><div class="card-subtitle">${escapeHTML(t.artist)} · офлайн-демо</div></article>`).join('')}</div></section><section class="section"><div class="section-head"><h2>Твоя коллекция</h2><a class="see-all" href="#library">Все треки →</a></div>${rows(queue.filter(t=>t.demo===undefined).slice(-5))}</section>`;
}
function renderSearch(query='', error='') {
  const local = allTracks().filter(t => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(query.toLowerCase()));
  
  const remoteOnly = remoteResults.filter(r => !local.some(t => t.id === r.id));
    const remoteRows = remoteOnly.length ? `<div class="track-list">${remoteOnly.map((t,i)=>`<div class="track"><span class="track-num">${String(i+1).padStart(2,'0')}</span>${cover(t,true)}<button class="track-info" data-archive-play="${escapeHTML(t.id)}"><div class="track-name">${escapeHTML(t.title)}</div><div class="track-author">${escapeHTML(t.artist)} · ${escapeHTML(t.album)}</div></button><span class="track-time">♫</span><button class="track-like ${liked.includes(t.id)?'liked':''}" data-archive-like="${escapeHTML(t.id)}" aria-label="Добавить в избранное" aria-pressed="${liked.includes(t.id)}">${liked.includes(t.id)?'♥':'♡'}</button><button class="track-download" data-archive-download="${escapeHTML(t.id)}" aria-label="Скачать трек">⇩</button></div>`).join('')}</div>` : '';
  view.innerHTML = `<section class="hero compact"><div><div class="eyebrow">ПОИСК · КОЛЛЕКЦИЯ И ОТКРЫТЫЙ АРХИВ</div><h1>${query?escapeHTML(query):'Найди свой звук.'}</h1><p>В коллекции: ${local.length} · в открытом архиве: ${remoteOnly.length}</p>${error?`<p role="status">${escapeHTML(error)}</p>`:''}</div></section><section class="section">${local.length?rows(local):''}${remoteRows}${!local.length&&!remoteOnly.length?`<div class="empty"><strong>${query?(searchLoading?'Ищем в открытом аудиоархиве…':error?'Поиск недоступен — попробуй снова':'Ничего не найдено'):'Введи название трека или исполнителя'}</strong>Поиск доступен по Internet Archive; каталог не включает все коммерческие релизы.</div>`:''}</section>`;
}
function renderWave() {
  const recent = history.map(id => allTracks().find(t => t.id === id)).filter(Boolean);
  const likedTracks = allTracks().filter(t => liked.includes(t.id));
  const picks = [...new Map([...recent, ...likedTracks, ...tracks].map(t => [t.id, t])).values()].slice(0, 12);
  view.innerHTML = `<section class="hero compact"><div><div class="eyebrow">ПЕРСОНАЛЬНАЯ ЛЕНТА</div><h1>Моя<br><span>волна.</span></h1><p>Музыка собрана из твоих прослушиваний и любимых треков — без случайного шума.</p></div></section><section class="section"><div class="section-head"><h2>Для тебя сегодня</h2><span class="section-tag">VIBE MIX</span></div>${rows(picks)}</section>`;
}
function route() {
  const page = location.hash.slice(1)||'discover';
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===page));
  $('.sidebar').classList.remove('open');
  if (page==='imports') renderImports();
  else if(page==='wave') renderWave();
  else if(page==='search') renderSearch(input.value);
  else if(['library','queue','liked'].includes(page)) {
    const list=page==='liked'?allTracks().filter(t=>liked.includes(t.id)):queue;
    view.innerHTML=`<section class="hero compact"><div><div class="eyebrow">ЛИЧНОЕ ПРОСТРАНСТВО</div><h1>${{library:'Моя музыка',queue:'Очередь',liked:'Любимые треки'}[page]}</h1><p>${list.length} треков · твой звук, твои правила</p></div></section><section class="section">${rows(list)}</section>`;
  } else renderDiscover();
  updateCounts();
}
function updateCounts() {
  $('#likedCount').textContent=allTracks().filter(t=>liked.includes(t.id)).length;
  $('#queueCount').textContent=queue.length;
  $('#playerLike').classList.toggle('liked',!!current && liked.includes(current.id));
  $('#playerLike').textContent=current && liked.includes(current.id)?'♥':'♡';
  $('#playerLike').setAttribute('aria-pressed',!!current && liked.includes(current.id));
}
function like(id) {
  liked=liked.includes(id)?liked.filter(v=>v!==id):[...liked,id]; save('vibe-liked',liked); route();
}
async function play(id) {
  const track=allTracks().find(t=>String(t.id)===String(id));
  if(!track) return;
  if(!track.src && track.demo!==undefined) track.src=demoAudio(track.demo);
  if(!track.src) { toast('Это метаданные, не аудиофайл. Добавь локальный файл или прямую HTTPS-ссылку.'); return; }
  const request=++playRequest;
  if(current?.id!==track.id) resetLyrics();
  current=track; history=[track.id,...history.filter(id=>id!==track.id)].slice(0,30); save('vibe-history',history); audio.src=track.src;
  $('#playerTitle').textContent=track.title; $('#playerArtist').textContent=track.artist;
  $('#playerCover').className=`mini-cover ${track.cover}`; updateCounts();
  try { await audio.play(); } catch { if(request===playRequest) toast('Не удалось воспроизвести. Проверь формат файла или доступность ссылки.'); }
}
function move(direction) {
  const playable=queue.filter(t=>t.src || t.demo!==undefined);
  if(!playable.length) return toast('Добавь аудиофайлы');
  const i=playable.findIndex(t=>t.id===current?.id);
  const others=playable.filter(t=>t.id!==current?.id);
  const next=shuffle && others.length ? others[Math.floor(Math.random()*others.length)] : playable[(i+direction+playable.length)%playable.length];
  play(next.id);
}
function add(list, favorite=false) {
  const known=new Set(queue.map(track=>track.id));
    const fresh=list.filter(track=>{if(known.has(track.id))return false;known.add(track.id);return true;});
    if(!fresh.length)return toast('Эти треки уже добавлены');
    queue.push(...fresh); imported.push(...fresh.filter(t=>!t.local));
  if(favorite) liked=[...new Set([...liked,...fresh.map(t=>t.id)])];
  save('vibe-imported',imported); save('vibe-liked',liked); updateCounts(); toast(`Добавлено: ${fresh.length}`);
}
function entry(title,artist,album,src='') { return {id:crypto.randomUUID ? crypto.randomUUID() : `track-${Date.now()}-${Math.random()}`,title,artist,album,src,cover:'gradient-6',time:'—'}; }
// RFC-style quoted fields, commas and line breaks; no HTML interpretation.
function parseCSV(text) {
  const rows=[]; let row=[], field='', quoted=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted && text[i+1]==='"') {field+='"';i++;} else quoted=!quoted; }
    else if(c===',' && !quoted) {row.push(field);field='';}
    else if((c==='\n'||c==='\r') && !quoted) {if(c==='\r' && text[i+1]==='\n') i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted) throw new Error('Незакрытая кавычка в CSV');
  row.push(field);if(row.some(v=>v.trim()))rows.push(row);
  return rows;
}
let activeImportController=null;
window.addEventListener('hashchange',()=>{ if(activeImportController) activeImportController.abort(); });
function renderImports() {
  view.innerHTML=`<section class="hero compact"><div><div class="eyebrow">ТВОЯ МУЗЫКА РЯДОМ</div><h1>Наполни свой<br><span>мир звуком.</span></h1><p>Локальные файлы, прямые аудиоссылки и импорт метаданных.</p></div></section><section class="section"><div class="import-grid"><article class="import-card"><div class="import-icon">↥</div><h3>Файлы с устройства</h3><p>Выбирай сразу несколько файлов. Аудио не отправляется на сервер. После закрытия страницы файлы нужно выбрать снова. Поддержка форматов зависит от браузера.</p><button id="fileBtn">Выбрать музыку</button><input id="fileInput" type="file" accept="audio/*,.flac,.mp3,.wav,.ogg,.m4a" multiple hidden></article><article class="import-card"><div class="import-icon">↗</div><h3>Прямые аудиоссылки</h3><p>Одна HTTPS-ссылка на файл в каждой строке. Страницы Spotify/VK/Яндекс не являются аудиофайлами и здесь не воспроизводятся.</p><label for="bulkLinks">Ссылки на аудио</label><textarea id="bulkLinks" rows="4" placeholder="https://example.com/music.mp3"></textarea><button id="bulkBtn">Добавить в избранное</button></article><article class="import-card"><div class="import-icon">▤</div><h3>Импорт CSV</h3><p>Колонки title,artist,album,url. Если url пустой, импортируются только метаданные. Кавычки и запятые в названиях поддерживаются.</p><button id="csvBtn">Открыть CSV</button><input id="csvInput" type="file" accept=".csv,text/csv" hidden><button id="exportBtn">Экспорт коллекции</button></article><article class="import-card"><div class="import-icon">⇄</div><h3>Умный импорт</h3><p>Вставь официальную ссылку на альбом или плейлист. Backend получит треклист через API, сопоставит треки и добавит найденные позиции в избранное.</p><label for="smartImportUrl">Ссылка на альбом или плейлист</label><input id="smartImportUrl" type="url" placeholder="https://open.spotify.com/playlist/..." autocomplete="off"><button id="smartImportBtn">Проверить / импортировать</button><button id="smartImportCancel" hidden>Остановить ожидание</button><progress id="smartImportProgress" hidden max="1" aria-label="Прогресс импорта"></progress><p id="smartImportStatus" class="import-status" role="status"></p><div id="smartImportSummary"></div></article><article class="import-card"><div class="import-icon">♫</div><h3>Тексты песен</h3><p>Текст откроется прямо в полноэкранном плеере, без перехода на сайты.</p><button id="lyricsBtn">Показать текст</button></article></div></section>`;
  $('#fileBtn').onclick=()=>$('#fileInput').click();
  $('#fileInput').onchange=e=>add([...e.target.files].map(f=>({...entry(f.name.replace(/\.[^.]+$/,''),'Локальный файл','С устройства',URL.createObjectURL(f)),local:true,cover:'gradient-7'})));
  $('#smartImportBtn').onclick=async()=>{
    if(activeImportController) return;
    const status=$('#smartImportStatus'), button=$('#smartImportBtn');
    const cancel=$('#smartImportCancel'), progress=$('#smartImportProgress'), summary=$('#smartImportSummary');
    const url=$('#smartImportUrl').value;
    let controller;
    try {
      const parsed=VibeSmartImport.parseImportUrl(url);
      summary.textContent='';
      if(!window.VIBE_CONFIG?.importBackendUrl) {
        status.textContent=`Ссылка распознана: ${parsed.source === 'spotify' ? 'Spotify' : parsed.source === 'yandex' ? 'Яндекс Музыка' : 'VK'}. Сервис импорта ещё не подключён.`;
        status.className='import-status';
        return;
      }
      const client=VibeSmartImportClient.createImportClient({baseUrl:window.VIBE_CONFIG.importBackendUrl,
        token:window.VIBE_CONFIG.getAccessToken || (async()=>null)});
      controller=new AbortController(); activeImportController=controller;
      button.disabled=true; cancel.hidden=false; progress.hidden=false; progress.removeAttribute('value');
      cancel.onclick=()=>controller.abort();
      status.className='import-status'; status.textContent='Получаем треклист…';
      const job=await client.run(url,{signal:controller.signal,onProgress:job=>{
        if(!status.isConnected) return;
        progress.max=Math.max(1,job.total); progress.value=job.processed;
        status.textContent=`Синхронизируем медиатеку: ${job.processed} из ${job.total}`;
      }});
      if(!status.isConnected) return;
      if(job.status==='failed') throw new Error('Сервис не смог завершить импорт');
      if(job.status==='cancelled') {status.textContent='Импорт отменён на сервере';return;}
      const playable=job.items.filter(item=>['added','already_exists'].includes(item.status) &&
        typeof item.canonical_track_id==='string' && typeof item.title==='string' &&
        typeof item.artist==='string' && safeAudio(item.audio_url));
      const existing=new Set(allTracks().map(track=>track.id));
      const fresh=playable.filter(item=>{
        if(existing.has(item.canonical_track_id)) return false;
        existing.add(item.canonical_track_id); return true;
      }).map(item=>({...entry(item.title,item.artist,'Умный импорт',safeAudio(item.audio_url)),id:item.canonical_track_id}));
      if(fresh.length) add(fresh,true);
      liked=[...new Set([...liked,...playable.map(item=>item.canonical_track_id)])];
      save('vibe-liked',liked); updateCounts();
      status.textContent=`Синхронизировано доступных аудиозаписей: ${playable.length}. Новых в коллекции: ${fresh.length}.`;
      const missing=job.items.filter(item=>!playable.includes(item));
      summary.innerHTML=missing.length ? `<details><summary>Требуют проверки: ${missing.length}</summary>${missing.map(item=>`<p>${escapeHTML(item.artist)} — ${escapeHTML(item.title)} <button data-alternative="${escapeHTML(`${item.artist||''} ${item.title||''}`)}">Найти альтернативу</button></p>`).join('')}</details>` : '';
      summary.querySelectorAll('[data-alternative]').forEach(btn=>btn.onclick=()=>{input.value=btn.dataset.alternative;location.hash='search';input.dispatchEvent(new Event('input'));});
    } catch(error) {
      status.textContent=error.name==='AbortError' ? 'Ожидание остановлено. Задание может продолжаться на сервере.' : error.message;
      status.className='import-status error';
    } finally {
      if(activeImportController===controller) activeImportController=null;
      button.disabled=false; cancel.hidden=true; progress.hidden=true;
    }
  };
  $('#bulkBtn').onclick=()=>{
    const links=$('#bulkLinks').value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
    const valid=links.map(safeAudio).filter(Boolean);
    if(!valid.length) return toast('Нужны прямые HTTPS-ссылки на аудио');
    add(valid.map(url=>entry(decodeSafe(new URL(url).pathname.split('/').pop())||'Аудио по ссылке','Внешний источник','По ссылке',url)),true);
    $('#bulkLinks').value=''; if(valid.length<links.length) toast(`Добавлено: ${valid.length}. Некорректные ссылки пропущены.`);
  };
  $('#csvBtn').onclick=()=>$('#csvInput').click();
  $('#csvInput').onchange=async e=>{
    const file=e.target.files[0]; if(!file)return;
    if(file.size>2*1024*1024)return toast('CSV должен быть меньше 2 МБ');
    try {
      const rows=parseCSV(await file.text());
      const header=rows.shift()?.map(v=>v.trim().toLowerCase());
      if(!header || !['title','artist','album','url'].every(k=>header.includes(k)))throw new Error('Нужны колонки title,artist,album,url');
      const get=(row,k)=>row[header.indexOf(k)]?.trim()||'';
      add(rows.filter(r=>get(r,'title')).map(r=>entry(get(r,'title'),get(r,'artist')||'Неизвестный исполнитель',get(r,'album')||'Импорт',safeAudio(get(r,'url')))),true);
    }catch(error){toast(`Ошибка CSV: ${error.message}`);}
  };
  $('#exportBtn').onclick=()=>{
    const quote=s=>'"'+String(s||'').replace(/"/g,'""')+'"';
    const csv=['title,artist,album,url',...queue.filter(t=>t.demo===undefined).map(t=>[t.title,t.artist,t.album,t.local?'':t.src].map(quote).join(','))].join('\r\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='vibe-collection.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('#lyricsBtn').onclick=()=>{if(!current)return toast('Сначала выбери трек');$('#openPlayer').click();if($('#lyricsPanel').hidden)$('#fullLyrics').click();};
}
function decodeSafe(s) { try{return decodeURIComponent(s);}catch{return s;} }
view.addEventListener('click',async e=>{
  const playButton=e.target.closest('[data-play]'), likeButton=e.target.closest('[data-like]');
  const remotePlay=e.target.closest('[data-archive-play]'), remoteLike=e.target.closest('[data-archive-like]'), remoteDownload=e.target.closest('[data-archive-download]');
  if(playButton)play(playButton.dataset.play); if(likeButton)like(likeButton.dataset.like);
  const remoteId=remotePlay?.dataset.archivePlay || remoteLike?.dataset.archiveLike || remoteDownload?.dataset.archiveDownload;
  if(!remoteId)return;
  const track=remoteResults.find(t=>t.id===remoteId) || queue.find(t=>t.id===remoteId); if(!track)return;
  try {
    if(remoteLike){ await materializeRemote(track); liked=liked.includes(track.id)?liked.filter(id=>id!==track.id):[...liked,track.id]; save('vibe-liked',liked); renderSearch(input.value); updateCounts(); toast(liked.includes(track.id)?'Добавлено в избранное':'Удалено из избранного'); }
    else { await materializeRemote(track); if(remoteDownload){const link=document.createElement('a');link.href=track.src;link.download=`${track.artist} - ${track.title}.mp3`.replace(/[\\/:*?"<>|]/g,'_');link.target='_blank';link.rel='noopener';link.click();toast('Загрузка началась');} else await play(track.id); }
  } catch(error) { toast(error.message || 'Не удалось открыть трек'); }
});
let searchTimer;
input.oninput=()=>{
  clearTimeout(searchTimer);
  remoteSearchRequest++;
  archiveController?.abort();
  remoteResults=[]; searchLoading=!!input.value.trim();
  if(location.hash!=='#search')location.hash='search';
  renderSearch(input.value);
  if(input.value.trim().length>=2)searchTimer=setTimeout(()=>searchArchive(input.value.trim()),320);
};
window.addEventListener('hashchange',route);
$('#playBtn').onclick=async()=>{
  if(!current) return move(1);
  if(audio.paused){try{await audio.play();}catch{toast('Не удалось воспроизвести аудио');}}else audio.pause();
};
$('#nextBtn').onclick=()=>move(1); $('#prevBtn').onclick=()=>move(-1);
$('#shuffleBtn').onclick=()=>{shuffle=!shuffle;$('#shuffleBtn').setAttribute('aria-pressed',shuffle);toast(shuffle?'Перемешивание включено':'Перемешивание выключено');};
$('#repeatBtn').onclick=()=>{repeat=!repeat;audio.loop=repeat;$('#repeatBtn').setAttribute('aria-pressed',repeat);};
audio.volume=Number($('#volume').value);$('#volume').oninput=e=>audio.volume=Number(e.target.value);
audio.onplay=()=>{$('#playBtn').textContent='Ⅱ';$('#playBtn').setAttribute('aria-label','Пауза');document.body.classList.add('playing');syncPlayer();};
audio.onpause=()=>{$('#playBtn').textContent='▶';$('#playBtn').setAttribute('aria-label','Воспроизвести');document.body.classList.remove('playing');syncPlayer();};
audio.onerror=()=>toast('Источник недоступен или формат не поддерживается браузером');
audio.ontimeupdate=()=>{const percent=audio.duration?audio.currentTime/audio.duration*100:0;$('#progress').value=percent;$('#currentTime').textContent=fmt(audio.currentTime);$('#duration').textContent=fmt(audio.duration);$('#fullProgress').value=percent;$('#fullCurrent').textContent=fmt(audio.currentTime);$('#fullDuration').textContent=fmt(audio.duration);};
$('#progress').oninput=e=>{if(Number.isFinite(audio.duration))audio.currentTime=Number(e.target.value)/100*audio.duration;};
$('#fullProgress').oninput=e=>{if(Number.isFinite(audio.duration))audio.currentTime=Number(e.target.value)/100*audio.duration;};
let playerOpener;
const closeFullPlayer=()=>{fullPlayer.hidden=true;document.body.classList.remove('player-open');playerOpener?.focus();};
$('#openPlayer').onclick=()=>{playerOpener=document.activeElement;fullPlayer.hidden=false;document.body.classList.add('player-open');syncPlayer();$('#fullProgress').value=audio.duration?audio.currentTime/audio.duration*100:0;$('#closePlayer').focus();};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!fullPlayer.hidden)closeFullPlayer();});
$('#closePlayer').onclick=closeFullPlayer;
$('#fullPlay').onclick=()=>$('#playBtn').click();
$('#fullNext').onclick=()=>move(1); $('#fullPrev').onclick=()=>move(-1);
$('#fullShuffle').onclick=()=>$('#shuffleBtn').click(); $('#fullRepeat').onclick=()=>$('#repeatBtn').click();
$('#fullLike').onclick=()=>{if(current){like(current.id);syncPlayer();}};
$('#fullQueue').onclick=()=>{closeFullPlayer();location.hash='queue';};
audio.onended=()=>{if(!repeat)move(1);};
$('#playerLike').onclick=e=>{e.stopPropagation();if(current)like(current.id);};
$('#queueBtn').onclick=()=>location.hash='queue';
$('.mobile-menu').onclick=()=>$('.sidebar').classList.toggle('open');
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();input.focus();}});
route();
