let adminToken=localStorage.getItem('djToken')||'';
let controlQueue=[];
let spotifyPlayer=null;
let spotifyDeviceId=null;
let spotifyReadyPromise=null;
let spotifyAdvanceLock=false;
let currentSpotifyQueueId=null;
let spotifyAutoplayBlocked=false;
let spotifyLastError='';
let lastState=null;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
async function api(url,opt={}){const r=await fetch(url,{...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});let d={};try{d=await r.json()}catch{}if(!r.ok)throw Error(d.error||'Fehler');return d}
function go(id){const el=$('#'+id);if(el)el.scrollIntoView({behavior:'smooth'});}
document.querySelectorAll('[data-section]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.section)));
$('#controlRoomBtn').addEventListener('click',()=>{if(adminToken)openControl();else openModal('loginModal')});
function openModal(id){const m=$('#'+id);if(m)m.hidden=false} function closeModal(id){const m=$('#'+id);if(m)m.hidden=true}
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.close)));
document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.hidden=true}));
$('#detailsBtn').addEventListener('click',()=>openModal('detailsModal'));
$('#djPassword').addEventListener('keydown',e=>{if(e.key==='Enter')$('#loginBtn').click()});
$('#loginBtn').addEventListener('click',async()=>{try{const d=await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:$('#djPassword').value})});adminToken=d.token;localStorage.setItem('djToken',adminToken);$('#djPassword').value='';$('#loginMsg').textContent='';closeModal('loginModal');openControl();await loadControlQueue();await updateSpotifyStatus()}catch(e){$('#loginMsg').textContent='❌ '+e.message}});
$('#logoutBtn').addEventListener('click',async()=>{try{if(adminToken)await api('/api/admin/logout',{method:'POST',headers:{Authorization:'Bearer '+adminToken}})}catch{}adminToken='';localStorage.removeItem('djToken');spotifyPlayer?.disconnect();spotifyPlayer=null;spotifyDeviceId=null;closeModal('controlModal')});
function openControl(){openModal('controlModal');loadControlQueue();updateSpotifyStatus()}
let pendingRequest=null;
$('#searchForm').addEventListener('submit',async e=>{e.preventDefault();const title=$('#title').value.trim(),artist=$('#artist').value.trim();if(!title&&!artist)return;$('#results').innerHTML='<p class="muted">Spotify wird durchsucht…</p>';try{const d=await api('/api/search?q='+encodeURIComponent([title,artist].filter(Boolean).join(' ')));if(!d.tracks.length){$('#results').innerHTML='<p class="muted">Kein Treffer gefunden.</p>';return}$('#results').innerHTML=d.tracks.map(t=>`<div class="result"><div class="resultInfo">${t.image?`<img src="${esc(t.image)}" alt="">`:''}<div><strong>${esc(t.title)}</strong><small>${esc(t.artist)}</small></div></div><button type="button" data-spotify-id="${esc(t.id)}" data-title="${esc(t.title)}" data-artist="${esc(t.artist)}">WUNSCH</button></div>`).join('');document.querySelectorAll('#results button[data-spotify-id]').forEach(b=>b.onclick=()=>sendWish({title:b.dataset.title,artist:b.dataset.artist,spotifyId:b.dataset.spotifyId}))}catch(e){$('#results').innerHTML='<p class="message">❌ '+esc(e.message)+'</p>'}});
async function sendWish(w){try{await api('/api/wishes',{method:'POST',body:JSON.stringify(w)});$('#msg').textContent='✓ Wunsch wurde in die Warteschlange gesetzt.';$('#results').innerHTML='';$('#title').value='';$('#artist').value='';loadWishes()}catch(e){$('#msg').textContent='❌ '+e.message}}
function renderPublic(w){const box=$('#publicWishes');const active=w.filter(x=>['pending','accepted'].includes(x.status));box.innerHTML=active.length?active.map((x,i)=>`<div class="queueItem"><span class="number">${i+1}</span><div class="wishText"><strong>${esc(x.title)}</strong><small>${esc(x.artist)}</small><span class="status">${x.status==='accepted'?'ALS NÄCHSTES':'WARTET'}${x.birthday?' · BIRTHDAY':''}</span></div></div>`).join(''):'<p class="muted">Noch keine Wünsche in der Warteschlange.</p>'}
async function loadWishes(){try{renderPublic(await api('/api/wishes'))}catch{$('#publicWishes').innerHTML='<p class="muted">Warteschlange momentan nicht erreichbar.</p>'}}
$('#refreshQueue').addEventListener('click',loadWishes);
$('#startBirthdayRoom').addEventListener('click',async()=>{const name=$('#birthdayRoomName').value.trim();if(!name){$('#birthdayRoomMsg').textContent='Bitte gib einen Namen ein.';return}try{await api('/api/wishes',{method:'POST',body:JSON.stringify({title:'Happy Birthday '+name,artist:'Birthday Room',sourceUrl:'/birthday.mp3'})});$('#birthdayRoomMsg').textContent='✓ Birthday-Song wurde in die Warteschlange gesetzt!';$('#birthdayRoomName').value='';loadWishes()}catch(e){$('#birthdayRoomMsg').textContent='❌ '+e.message}});

async function loadControlQueue(){if(!adminToken)return;try{const d=await api('/api/admin/queue',{headers:{Authorization:'Bearer '+adminToken}});controlQueue=d.queue||[];renderControlQueue();updateNow(d.live?.nowPlaying)}catch(e){if(e.message==='Nicht angemeldet'){adminToken='';localStorage.removeItem('djToken');closeModal('controlModal')}}}
function updateNow(live){const title=live?.title||'Gerade läuft keine Musik',artist=live?.artist||'DJ BREEZE ist bereit';$('#controlNowPlaying').textContent=title;$('#controlNowArtist').textContent=artist;$('#homeNow').textContent=title;$('#homeNowArtist').textContent=artist}
function updateRecord(track){const cover=$('#recordCover'),title=$('#recordTitle'),artist=$('#recordArtist');if(!cover||!title||!artist)return;if(track){const image=track.album?.images?.[0]?.url||'';title.textContent=track.name||'HEV';artist.textContent=(track.artists||[]).map(a=>a.name).join(', ')||'WUNSCHBOX';if(image){cover.src=image;cover.hidden=false}else cover.hidden=true}else{cover.hidden=true;title.textContent='HEV';artist.textContent='WUNSCHBOX'}}
function renderControlQueue(){const box=$('#controlQueueList');const arr=controlQueue.filter(x=>['pending','accepted'].includes(x.status));box.innerHTML=arr.length?arr.map((x,i)=>`<div class="controlItem"><span class="number">${i+1}</span><div class="wishText"><strong>${esc(x.title)}</strong><small>${esc(x.artist)}</small><span class="status">${x.status==='accepted'?'AKZEPTIERT':'WARTET'}${x.spotifyId?' · SPOTIFY':' · AUDIO'}</span></div><div class="actions"><button class="ok" data-act="play" data-id="${x.id}">▶</button><button data-act="up" data-id="${x.id}">↑</button><button data-act="down" data-id="${x.id}">↓</button><button class="bad" data-act="reject" data-id="${x.id}">✕</button><button class="bad" data-act="ban" data-id="${x.id}">🚫</button></div></div>`).join(''):'<p class="muted">Warteschlange ist leer.</p>'}
$('#controlQueueList').addEventListener('click',async e=>{const b=e.target.closest('button[data-act]');if(!b)return;const id=b.dataset.id,act=b.dataset.act;try{if(act==='play')await playQueue(id);else if(act==='ban')await banQueueSong(id);else{const action={up:'moveUp',down:'moveDown',reject:'rejected'}[act];await queuePatch(id,action)}await loadControlQueue();await loadWishes()}catch(err){alert(err.message)}});
async function queuePatch(id,action){await api('/api/admin/queue/'+id,{method:'PATCH',headers:{Authorization:'Bearer '+adminToken},body:JSON.stringify({action})})}
async function banQueueSong(id){const x=controlQueue.find(q=>q.id===id);if(!x)return;await api('/api/admin/ban',{method:'POST',headers:{Authorization:'Bearer '+adminToken},body:JSON.stringify({title:x.title,artist:x.artist})})}

async function updateSpotifyStatus(){const btn=$('#spotifyConnectBtn'),status=$('#spotifyStatus');if(!btn)return;try{const d=await api('/api/admin/spotify/status',{headers:{Authorization:'Bearer '+adminToken}});if(!d.configured){btn.hidden=false;btn.disabled=true;btn.textContent='SPOTIFY NICHT EINGERICHTET';status.textContent='Render-Variablen fehlen.';return}if(d.connected){if(d.product&&d.product!=='premium'){btn.hidden=false;btn.disabled=false;btn.textContent='SPOTIFY-KONTO WECHSELN ↗';status.textContent='Spotify Premium ist für Browser-Wiedergabe erforderlich.';$('#spotifyDevice').textContent='Kein Premium-Konto verbunden';return}btn.hidden=true;status.textContent=`✓ SPOTIFY VERBUNDEN${d.displayName?' · '+d.displayName:''}`;await initSpotifyPlayer()}else{btn.hidden=false;btn.disabled=false;btn.textContent='SPOTIFY VERBINDEN ↗';status.textContent='Spotify muss im Control Room verbunden werden.'}}catch(e){status.textContent='Spotify-Status konnte nicht geladen werden.'}}
$('#spotifyConnectBtn').addEventListener('click',async()=>{try{const d=await api('/auth/spotify/login',{method:'POST',headers:{Authorization:'Bearer '+adminToken}});window.location.href=d.url}catch(e){alert(e.message)}});

function initSpotifyPlayer(){if(spotifyReadyPromise)return spotifyReadyPromise;spotifyReadyPromise=new Promise((resolve,reject)=>{window.__spotifyResolve=resolve;window.__spotifyReject=reject;const s=document.createElement('script');s.src='https://sdk.scdn.co/spotify-player.js';s.async=true;s.onerror=()=>reject(new Error('Spotify Player SDK konnte nicht geladen werden.'));document.head.appendChild(s);});return spotifyReadyPromise}
window.onSpotifyWebPlaybackSDKReady=()=>{
  spotifyPlayer=new Spotify.Player({name:'Herner Eisdisco – Control Room',volume:0.9,enableMediaSession:true,getOAuthToken:async cb=>{try{const d=await api('/api/admin/spotify/token',{headers:{Authorization:'Bearer '+adminToken}});cb(d.access_token)}catch{cb('')}}});
  spotifyPlayer.addListener('ready',async({device_id})=>{spotifyDeviceId=device_id;spotifyLastError='';$('#spotifyDevice').textContent='Browser-Player bereit – PLAY drücken';try{const d=await api('/api/admin/spotify/token',{headers:{Authorization:'Bearer '+adminToken}});await fetch('https://api.spotify.com/v1/me/player',{method:'PUT',headers:{Authorization:'Bearer '+d.access_token,'Content-Type':'application/json'},body:JSON.stringify({device_ids:[device_id],play:false})})}catch{}window.__spotifyResolve?.(true);});
  spotifyPlayer.addListener('not_ready',()=>{spotifyDeviceId=null;spotifyLastError='Browser-Player offline';$('#spotifyDevice').textContent=spotifyLastError});
  spotifyPlayer.addListener('initialization_error',({message})=>{console.error(message);spotifyLastError='Player-Fehler: '+message;$('#spotifyDevice').textContent=spotifyLastError;window.__spotifyReject?.(new Error(spotifyLastError))});
  spotifyPlayer.addListener('authentication_error',({message})=>{console.error(message);spotifyLastError='Spotify-Anmeldung abgelaufen';$('#spotifyDevice').textContent=spotifyLastError});
  spotifyPlayer.addListener('account_error',({message})=>{console.error(message);spotifyLastError='Spotify Premium erforderlich';$('#spotifyDevice').textContent=spotifyLastError});
  spotifyPlayer.addListener('playback_error',({message})=>{console.error(message);spotifyLastError='Wiedergabefehler: '+message;$('#spotifyDevice').textContent=spotifyLastError});
  spotifyPlayer.addListener('autoplay_failed',()=>{spotifyAutoplayBlocked=true;spotifyLastError='Browser blockiert Autoplay – START/PLAY erneut anklicken.';$('#spotifyDevice').textContent=spotifyLastError});
  spotifyPlayer.addListener('player_state_changed',state=>{lastState=state;recordEl?.classList.toggle('playing',!!state&&!state.paused);if(state?.track_window?.current_track){const t=state.track_window.current_track;updateRecord(t);$('#controlNowPlaying').textContent=t.name;$('#controlNowArtist').textContent=t.artists.map(a=>a.name).join(', ');$('#homeNow').textContent=t.name;$('#homeNowArtist').textContent=t.artists.map(a=>a.name).join(', ')}else updateRecord(null)});
  spotifyPlayer.connect();
};

async function ensureSpotifyPlayer(){
  if(!spotifyReadyPromise)initSpotifyPlayer();
  await spotifyReadyPromise;
  if(spotifyLastError&&/Premium|Anmeldung|Player-Fehler/.test(spotifyLastError))throw new Error(spotifyLastError);
  if(!spotifyPlayer||!spotifyDeviceId)throw new Error('Spotify Browser-Player ist noch nicht bereit. Öffne den Control Room neu und drücke START.');
  // Must be called from a real click/tap whenever possible so browser audio is unlocked.
  try{await spotifyPlayer.activateElement();spotifyAutoplayBlocked=false}catch(e){console.warn('activateElement failed',e)}
  return spotifyDeviceId;
}
function waitForSpotifyTrack(spotifyId,timeoutMs=9000){
  return new Promise((resolve,reject)=>{
    const started=Date.now();
    const timer=setInterval(()=>{
      const t=lastState?.track_window?.current_track;
      const id=t?.id||t?.uri?.split(':').pop();
      if(id===spotifyId && lastState && !lastState.paused){clearInterval(timer);resolve(true);return}
      if(spotifyAutoplayBlocked){clearInterval(timer);reject(new Error('Der Browser hat Spotify-Autoplay blockiert. Klicke START/PLAY noch einmal.'));return}
      if(Date.now()-started>=timeoutMs){clearInterval(timer);reject(new Error('Spotify hat den Song angefordert, aber der Browser-Player hat die Wiedergabe nicht bestätigt. Prüfe Spotify Premium und die Windows-Audioausgabe und drücke PLAY erneut.'))}
    },200);
  });
}
async function playQueue(id){
  const x=controlQueue.find(q=>q.id===id);if(!x)return;
  if(x.spotifyId){
    const device=await ensureSpotifyPlayer();
    spotifyAutoplayBlocked=false;spotifyLastError='';$('#spotifyDevice').textContent='Song wird gestartet…';
    await api('/api/admin/spotify/play',{method:'POST',headers:{Authorization:'Bearer '+adminToken},body:JSON.stringify({spotifyId:x.spotifyId,deviceId:device})});
    try{await waitForSpotifyTrack(x.spotifyId)}catch(e){$('#spotifyDevice').textContent=e.message;throw e}
    $('#spotifyDevice').textContent='▶ Browser-Player spielt';
    currentSpotifyQueueId=x.id;
    await queuePatch(id,'accepted');
    await api('/api/admin/live',{method:'PATCH',headers:{Authorization:'Bearer '+adminToken},body:JSON.stringify({nowPlaying:{title:x.title,artist:x.artist}})});
    return;
  }
  const audio=$('#browserAudio');if(!x.sourceUrl)throw new Error('Für diesen Wunsch gibt es keine abspielbare Quelle.');updateRecord({name:x.title,artists:[{name:x.artist}],album:{images:[]}});audio.src=x.sourceUrl;await audio.play();currentSpotifyQueueId=x.id;await queuePatch(id,'accepted');await api('/api/admin/live',{method:'PATCH',headers:{Authorization:'Bearer '+adminToken},body:JSON.stringify({nowPlaying:{title:x.title,artist:x.artist}})});
}
async function playNextInQueue(){if(spotifyAdvanceLock)return;spotifyAdvanceLock=true;try{if(currentSpotifyQueueId){await queuePatch(currentSpotifyQueueId,'done')}await loadControlQueue();const next=controlQueue.find(x=>['accepted','pending'].includes(x.status)&&(x.spotifyId||x.sourceUrl));if(next){currentSpotifyQueueId=next.id;await playQueue(next.id)}else{currentSpotifyQueueId=null;await api('/api/admin/live',{method:'PATCH',headers:{Authorization:'Bearer '+adminToken},body:JSON.stringify({nowPlaying:null})})}}finally{spotifyAdvanceLock=false}}
$('#browserAudio').addEventListener('play',()=>recordEl?.classList.add('playing'));$('#browserAudio').addEventListener('pause',()=>recordEl?.classList.remove('playing'));$('#browserAudio').addEventListener('ended',playNextInQueue);
$('#startQueueBtn').addEventListener('click',async()=>{try{if(spotifyPlayer)try{await spotifyPlayer.activateElement()}catch{}await loadControlQueue();const next=controlQueue.find(x=>['accepted','pending'].includes(x.status)&&(x.spotifyId||x.sourceUrl));if(!next)throw new Error('Die Warteschlange ist leer.');await playQueue(next.id)}catch(e){alert(e.message)}});
$('#refreshControlQueue').addEventListener('click',loadControlQueue);
$('#banBtn').addEventListener('click',async()=>{const title=$('#banTitle').value.trim(),artist=$('#banArtist').value.trim();if(!title)return;try{await api('/api/admin/ban',{method:'POST',headers:{Authorization:'Bearer '+adminToken},body:JSON.stringify({title,artist})});$('#banTitle').value='';$('#banArtist').value='';await loadControlQueue();await loadWishes()}catch(e){alert(e.message)}});
$('#pauseSpotify').addEventListener('click',async()=>{try{await api('/api/admin/spotify/pause',{method:'POST',headers:{Authorization:'Bearer '+adminToken}})}catch(e){alert(e.message)}});
$('#nextSpotify').addEventListener('click',playNextInQueue);

// Interactive vinyl: drag the tonearm with mouse/touch. The record animation follows playback.
const recordEl=$('#record'),tonearmEl=$('#tonearm');
let tonearmAngle=19,tonearmDragging=false;
function setTonearm(angle,user=true){
  tonearmAngle=Math.max(-18,Math.min(34,angle));
  if(tonearmEl)tonearmEl.style.transform=`rotate(${tonearmAngle}deg)`;
  if(!user)return;
  if(tonearmAngle>8){recordEl?.classList.add('playing');if(spotifyPlayer&&lastState?.paused)spotifyPlayer.resume().catch(()=>{});}
  else{recordEl?.classList.remove('playing');if(spotifyPlayer&&!lastState?.paused)spotifyPlayer.pause().catch(()=>{});}
}
if(tonearmEl){
  tonearmEl.addEventListener('pointerdown',e=>{tonearmDragging=true;tonearmEl.classList.add('dragging');tonearmEl.setPointerCapture?.(e.pointerId);e.preventDefault()});
  tonearmEl.addEventListener('pointermove',e=>{if(!tonearmDragging)return;const r=tonearmEl.getBoundingClientRect();const cx=r.left+r.width*.88,cy=r.top+r.height*.08;setTonearm(Math.atan2(e.clientY-cy,e.clientX-cx)*180/Math.PI)});
  tonearmEl.addEventListener('pointerup',e=>{tonearmDragging=false;tonearmEl.classList.remove('dragging');tonearmEl.releasePointerCapture?.(e.pointerId)});
  tonearmEl.addEventListener('pointercancel',()=>{tonearmDragging=false;tonearmEl.classList.remove('dragging')});
}
recordEl?.addEventListener('click',async()=>{try{await ensureSpotifyPlayer();await spotifyPlayer.activateElement();await spotifyPlayer.togglePlay()}catch(e){alert(e.message)}});
async function loadLive(){try{updateNow(await api('/api/live'))}catch{}}
loadWishes();loadLive();
if(new URLSearchParams(location.search).get('spotify')==='connected'){setTimeout(()=>{if(adminToken)openControl()},300);history.replaceState({},'',location.pathname)}
setInterval(()=>{loadWishes();loadLive();if(!$('#controlModal').hidden&&adminToken)loadControlQueue()},5000);
// Detect end of a Spotify track in the browser and advance the DJ queue.
setInterval(async()=>{if(!spotifyPlayer||!lastState||spotifyAdvanceLock||!currentSpotifyQueueId)return;const duration=lastState.duration||0,pos=lastState.position||0;if(duration>0&&!lastState.paused&&pos>=duration-1200)await playNextInQueue()},500);
