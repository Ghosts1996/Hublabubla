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
let queue = [...tracks, ...imported];
let current = null, shuffle = false, repeat = false, playRequest = 0;
let remoteResults = [], remoteSearchRequest = 0;
  const allTracks = () => queue;
  function remoteTrack(item) {
    return {id:`archive-${item.identifier}`, title:item.title || item.identifier || 'Без названия', artist:Array.isArray(item.creator)?item.creator.join(', '):(item.creator || 'Internet Archive'), album:'Открытая библиотека · Internet Archive', cover:'gradient-5', time:'—', sourceId:item.identifier, openSource:true};
  }
  async function findArchiveAudio(identifier) {
    const response = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
    if (!response.ok) throw new Error('Не удалось получить аудиофайл');
    const data = await response.json();
    const file = (data.files || []).find(f => /\.(mp3|ogg|oga|m4a|wav)$/i.test(f.name || '') && !/sample|thumb|preview/i.test(f.name || ''));
    if (!file) throw new Error('В результате нет открытого аудиофайла');
    return `https://archive.org/download/${encodeURIComponent(identifier)}/${file.name.split('/').map(encodeURIComponent).join('/')}`;
  }
  async function searchArchive(query) {
    const request = ++remoteSearchRequest;
    if (!query.trim()) { remoteResults=[]; return route(); }
    try {
      const params = new URLSearchParams({q:`(${query.trim()}) AND mediatype:audio`, 'fl[]':'identifier,title,creator', rows:'20', page:'1', output:'json'});
      const response = await fetch(`https://archive.org/advancedsearch.php?${params}`);
      if (!response.ok) throw new Error('Сервис поиска недоступен');
      const data = await response.json();
      if (request !== remoteSearchRequest) return;
      remoteResults=(data.response?.docs || []).map(remoteTrack); renderSearch(input.value);
    } catch(error) { if(request===remoteSearchRequest) { remoteResults=[]; renderSearch(input.value,error.message); } }
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
  const found = [...local, ...remoteResults.filter(r=>!local.some(t=>t.id===r.id))];
  const remoteRows = remoteResults.length ? `<div class="track-list">${remoteResults.map((t,i)=>`<div class="track"><span class="track-num">${String(i+1).padStart(2,'0')}</span>${cover(t,true)}<button class="track-info" data-archive="${escapeHTML(t.id)}"><div class="track-name">${escapeHTML(t.title)}</div><div class="track-author">${escapeHTML(t.artist)} · ${escapeHTML(t.album)}</div></button><span class="track-time">♫</span><span></span></div>`).join('')}</div>` : '';
  view.innerHTML = `<section class="hero compact"><div><div class="eyebrow">ПОИСК · КОЛЛЕКЦИЯ И ОТКРЫТЫЙ АРХИВ</div><h1>${query?escapeHTML(query):'Найди свой звук.'}</h1><p>В коллекции: ${local.length} · в открытом архиве: ${remoteResults.length}</p>${error?`<p role="status">${escapeHTML(error)}</p>`:''}</div></section><section class="section">${local.length?rows(local):''}${remoteRows}${!local.length&&!remoteResults.length?`<div class="empty"><strong>${query?'Ищем в открытом аудиоархиве…':'Введи название трека или исполнителя'}</strong>Поиск доступен по Internet Archive; каталог не включает все коммерческие релизы.</div>`:''}</section>`;
}
function route() {
  const page = location.hash.slice(1)||'discover';
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===page));
  $('.sidebar').classList.remove('open');
  if (page==='imports') renderImports();
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
  current=track; audio.src=track.src;
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
  queue.push(...list); imported.push(...list.filter(t=>!t.local));
  if(favorite) liked=[...new Set([...liked,...list.map(t=>t.id)])];
  save('vibe-imported',imported); save('vibe-liked',liked); updateCounts(); toast(`Добавлено: ${list.length}`);
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
function renderImports() {
  view.innerHTML=`<section class="hero compact"><div><div class="eyebrow">ТВОЯ МУЗЫКА РЯДОМ</div><h1>Наполни свой<br><span>мир звуком.</span></h1><p>Локальные файлы, прямые аудиоссылки и импорт метаданных.</p></div></section><section class="section"><div class="import-grid"><article class="import-card"><div class="import-icon">↥</div><h3>Файлы с устройства</h3><p>Выбирай сразу несколько файлов. Аудио не отправляется на сервер. После закрытия страницы файлы нужно выбрать снова. Поддержка форматов зависит от браузера.</p><button id="fileBtn">Выбрать музыку</button><input id="fileInput" type="file" accept="audio/*,.flac,.mp3,.wav,.ogg,.m4a" multiple hidden></article><article class="import-card"><div class="import-icon">↗</div><h3>Прямые аудиоссылки</h3><p>Одна HTTPS-ссылка на файл в каждой строке. Страницы Spotify/VK/Яндекс не являются аудиофайлами и здесь не воспроизводятся.</p><label for="bulkLinks">Ссылки на аудио</label><textarea id="bulkLinks" rows="4" placeholder="https://example.com/music.mp3"></textarea><button id="bulkBtn">Добавить в избранное</button></article><article class="import-card"><div class="import-icon">▤</div><h3>Импорт CSV</h3><p>Колонки title,artist,album,url. Если url пустой, импортируются только метаданные. Кавычки и запятые в названиях поддерживаются.</p><button id="csvBtn">Открыть CSV</button><input id="csvInput" type="file" accept=".csv,text/csv" hidden><button id="exportBtn">Экспорт коллекции</button></article><article class="import-card"><div class="import-icon">♫</div><h3>Тексты песен</h3><p>Поиск на сайте Genius. Для текущего трека запрос заполнится автоматически. Встроенные тексты через API требуют отдельного backend.</p><button id="lyricsBtn">Найти в Genius ↗</button></article></div></section>`;
  $('#fileBtn').onclick=()=>$('#fileInput').click();
  $('#fileInput').onchange=e=>add([...e.target.files].map(f=>({...entry(f.name.replace(/\.[^.]+$/,''),'Локальный файл','С устройства',URL.createObjectURL(f)),local:true,cover:'gradient-7'})));
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
  $('#lyricsBtn').onclick=()=>{
    const query=prompt('Исполнитель и название',current?`${current.artist} ${current.title}`:'');
    if(query)window.open(`https://genius.com/search?q=${encodeURIComponent(query)}`,'_blank','noopener,noreferrer');
  };
}
function decodeSafe(s) { try{return decodeURIComponent(s);}catch{return s;} }
view.addEventListener('click',async e=>{
  const playButton=e.target.closest('[data-play]'), likeButton=e.target.closest('[data-like]'), archiveButton=e.target.closest('[data-archive]');
  if(playButton)play(playButton.dataset.play); if(likeButton)like(likeButton.dataset.like);
  if(archiveButton){const track=remoteResults.find(t=>t.id===archiveButton.dataset.archive);if(!track)return;try{track.src=await findArchiveAudio(track.sourceId);if(!queue.some(t=>t.id===track.id)){queue.push(track);save('vibe-imported',queue.filter(t=>!tracks.some(x=>x.id===t.id)));}await play(track.id);}catch(error){toast(error.message || 'Не удалось открыть трек');}}
});
let searchTimer;
input.oninput=()=>{if(location.hash!=='#search')location.hash='search';renderSearch(input.value);clearTimeout(searchTimer);if(input.value.trim().length>=2){searchTimer=setTimeout(()=>searchArchive(input.value.trim()),450);}else{remoteSearchRequest++;remoteResults=[];}};
window.addEventListener('hashchange',route);
$('#playBtn').onclick=async()=>{
  if(!current) return move(1);
  if(audio.paused){try{await audio.play();}catch{toast('Не удалось воспроизвести аудио');}}else audio.pause();
};
$('#nextBtn').onclick=()=>move(1); $('#prevBtn').onclick=()=>move(-1);
$('#shuffleBtn').onclick=()=>{shuffle=!shuffle;$('#shuffleBtn').setAttribute('aria-pressed',shuffle);toast(shuffle?'Перемешивание включено':'Перемешивание выключено');};
$('#repeatBtn').onclick=()=>{repeat=!repeat;audio.loop=repeat;$('#repeatBtn').setAttribute('aria-pressed',repeat);};
audio.volume=Number($('#volume').value);$('#volume').oninput=e=>audio.volume=Number(e.target.value);
audio.onplay=()=>{$('#playBtn').textContent='Ⅱ';$('#playBtn').setAttribute('aria-label','Пауза');document.body.classList.add('playing');};
audio.onpause=()=>{$('#playBtn').textContent='▶';$('#playBtn').setAttribute('aria-label','Воспроизвести');document.body.classList.remove('playing');};
audio.onerror=()=>toast('Источник недоступен или формат не поддерживается браузером');
audio.ontimeupdate=()=>{$('#progress').value=audio.duration?audio.currentTime/audio.duration*100:0;$('#currentTime').textContent=fmt(audio.currentTime);$('#duration').textContent=fmt(audio.duration);};
$('#progress').oninput=e=>{if(Number.isFinite(audio.duration))audio.currentTime=Number(e.target.value)/100*audio.duration;};
audio.onended=()=>{if(!repeat)move(1);};
$('#playerLike').onclick=()=>{if(current)like(current.id);};
$('#queueBtn').onclick=()=>location.hash='queue';
$('.mobile-menu').onclick=()=>$('.sidebar').classList.toggle('open');
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();input.focus();}});
route();
