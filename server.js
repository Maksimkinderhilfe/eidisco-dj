const express=require('express');
const path=require('path');
const crypto=require('crypto');
const fs=require('fs');

const app=express();
const PORT=process.env.PORT||10000;
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'0000';
const SPOTIFY_CLIENT_ID=process.env.SPOTIFY_CLIENT_ID||'';
const SPOTIFY_CLIENT_SECRET=process.env.SPOTIFY_CLIENT_SECRET||'';
const SPOTIFY_REDIRECT_URI=process.env.SPOTIFY_REDIRECT_URI||'';
const SCOPES='streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';

app.use(express.json());
app.use(express.static(__dirname));

const DB=path.join(__dirname,'wishes.json');
const BANS=path.join(__dirname,'banned.json');
const QUEUE=path.join(__dirname,'queue.json');
const STATE=path.join(__dirname,'live.json');
const FEEDBACK=path.join(__dirname,'feedback.json');

let live=fs.existsSync(STATE)?JSON.parse(fs.readFileSync(STATE,'utf8')):{nowPlaying:null,announcement:'',announcementAt:0,birthday:null};
let feedback=fs.existsSync(FEEDBACK)?JSON.parse(fs.readFileSync(FEEDBACK,'utf8')):[];
let wishes=fs.existsSync(DB)?JSON.parse(fs.readFileSync(DB,'utf8')):[];
let banned=fs.existsSync(BANS)?JSON.parse(fs.readFileSync(BANS,'utf8')):[];
let queue=fs.existsSync(QUEUE)?JSON.parse(fs.readFileSync(QUEUE,'utf8')):[];

function write(file,data){fs.writeFileSync(file,JSON.stringify(data,null,2));}
const saveLive=()=>write(STATE,live), saveFeedback=()=>write(FEEDBACK,feedback), save=()=>write(DB,wishes), saveBans=()=>write(BANS,banned), saveQueue=()=>write(QUEUE,queue);
const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
const isBanned=(title,artist)=>banned.some(b=>b.titleKey===norm(title)&&(b.artistKey?b.artistKey===norm(artist):true));

// In-memory sessions. This is intentional for this private DJ control room; a Render restart requires logging in again.
const sessions=new Set();
const spotifySessions=new Map(); // adminToken -> {accessToken,refreshToken,expiresAt}
const oauthStates=new Map(); // state -> adminToken
let clientToken={accessToken:'',expiresAt:0};

function auth(req,res,next){
  const t=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!sessions.has(t)) return res.status(401).json({error:'Nicht angemeldet'});
  req.adminToken=t; next();
}
function spotifyConfigured(){return Boolean(SPOTIFY_CLIENT_ID&&SPOTIFY_CLIENT_SECRET&&SPOTIFY_REDIRECT_URI);}
function basicAuth(){return 'Basic '+Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');}

async function tokenRequest(body){
  const r=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{Authorization:basicAuth(),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.error_description||d.error||'Spotify Token-Fehler');
  return d;
}
async function getUserSpotifyToken(adminToken){
  const s=spotifySessions.get(adminToken);
  if(!s?.refreshToken) return null;
  if(s.accessToken && Date.now()<s.expiresAt-60000) return s.accessToken;
  const d=await tokenRequest({grant_type:'refresh_token',refresh_token:s.refreshToken});
  s.accessToken=d.access_token;
  s.expiresAt=Date.now()+(Number(d.expires_in||3600)*1000);
  if(d.refresh_token) s.refreshToken=d.refresh_token;
  return s.accessToken;
}
async function getClientToken(){
  if(clientToken.accessToken && Date.now()<clientToken.expiresAt-60000) return clientToken.accessToken;
  const d=await tokenRequest({grant_type:'client_credentials'});
  clientToken={accessToken:d.access_token,expiresAt:Date.now()+(Number(d.expires_in||3600)*1000)};
  return clientToken.accessToken;
}
async function spotifyFetch(url,token,options={}){
  const r=await fetch(url,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(options.headers||{})}});
  const text=await r.text();
  let d={}; try{d=text?JSON.parse(text):{}}catch{d={raw:text}};
  return {r,d};
}

app.get('/api/health',(req,res)=>res.json({ok:true,spotifyConfigured:spotifyConfigured()}));
app.get('/api/config',(req,res)=>res.json({spotifyConfigured:spotifyConfigured(),clientId:SPOTIFY_CLIENT_ID||null}));

app.post('/api/admin/login',(req,res)=>{
  if(req.body.password!==ADMIN_PASSWORD) return res.status(401).json({error:'Falsches Passwort'});
  const token=crypto.randomBytes(32).toString('hex'); sessions.add(token); res.json({token});
});
app.post('/api/admin/logout',auth,(req,res)=>{sessions.delete(req.adminToken);spotifySessions.delete(req.adminToken);res.json({ok:true})});

// Spotify OAuth: the DJ connects only inside the protected Control Room.
function spotifyAuthorizeUrl(adminToken){
  const state=crypto.randomBytes(24).toString('hex'); oauthStates.set(state,adminToken);
  const u=new URL('https://accounts.spotify.com/authorize');
  u.searchParams.set('response_type','code');
  u.searchParams.set('client_id',SPOTIFY_CLIENT_ID);
  u.searchParams.set('scope',SCOPES);
  u.searchParams.set('redirect_uri',SPOTIFY_REDIRECT_URI);
  u.searchParams.set('state',state);
  return u.toString();
}
app.post('/auth/spotify/login',auth,(req,res)=>{
  if(!spotifyConfigured()) return res.status(503).json({error:'Spotify ist auf Render noch nicht eingerichtet.'});
  res.json({url:spotifyAuthorizeUrl(req.adminToken)});
});
app.get('/auth/spotify/login',auth,(req,res)=>{
  if(!spotifyConfigured()) return res.status(503).send('Spotify ist auf Render noch nicht eingerichtet.');
  res.redirect(spotifyAuthorizeUrl(req.adminToken));
});
const spotifyCallback=async(req,res)=>{
  const {code,state,error}=req.query;
  const adminToken=state&&oauthStates.get(state);
  if(state) oauthStates.delete(state);
  if(!adminToken||!sessions.has(adminToken)) return res.status(400).send('Spotify-Anmeldung ist abgelaufen. Öffne den Control Room erneut.');
  if(error) return res.redirect('/?spotify_error='+encodeURIComponent(error));
  try{
    const d=await tokenRequest({grant_type:'authorization_code',code,redirect_uri:SPOTIFY_REDIRECT_URI});
    spotifySessions.set(adminToken,{accessToken:d.access_token,refreshToken:d.refresh_token,expiresAt:Date.now()+Number(d.expires_in||3600)*1000});
    res.redirect('/?spotify=connected');
  }catch(e){res.redirect('/?spotify_error='+encodeURIComponent(e.message));}
};
app.get('/auth/spotify/callback',spotifyCallback);
app.get('/callback',spotifyCallback);
app.get('/api/admin/spotify/status',auth,async(req,res)=>{
  const s=spotifySessions.get(req.adminToken);
  if(!s?.refreshToken) return res.json({connected:false,configured:spotifyConfigured()});
  try{
    const token=await getUserSpotifyToken(req.adminToken);
    const {r,d}=await spotifyFetch('https://api.spotify.com/v1/me',token);
    res.json({connected:r.ok,configured:spotifyConfigured(),product:d.product||null,displayName:d.display_name||null});
  }catch(e){res.json({connected:false,configured:spotifyConfigured(),error:e.message});}
});
app.get('/api/admin/spotify/token',auth,async(req,res)=>{
  try{const token=await getUserSpotifyToken(req.adminToken);if(!token)return res.status(401).json({error:'Spotify ist nicht verbunden'});res.json({access_token:token});}
  catch(e){res.status(401).json({error:e.message});}
});
app.post('/api/admin/spotify/play',auth,async(req,res)=>{
  try{
    const token=await getUserSpotifyToken(req.adminToken);
    if(!token)return res.status(401).json({error:'Spotify ist nicht verbunden'});
    const {spotifyId,deviceId}=req.body;
    if(!spotifyId||!deviceId)return res.status(400).json({error:'spotifyId und deviceId fehlen'});

    // First transfer playback to the browser SDK device WITHOUT starting an old context.
    const tr=await spotifyFetch('https://api.spotify.com/v1/me/player',token,{
      method:'PUT',
      body:JSON.stringify({device_ids:[deviceId],play:false})
    });
    if(!tr.r.ok && tr.r.status!==204){
      return res.status(tr.r.status).json({error:tr.d.error?.message||'Spotify-Gerät konnte nicht aktiviert werden'});
    }

    // Spotify Connect can need a brief moment before the transferred device accepts /play.
    await new Promise(r=>setTimeout(r,350));
    const p=await spotifyFetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,token,{
      method:'PUT',
      body:JSON.stringify({uris:[`spotify:track:${spotifyId}`],position_ms:0})
    });
    if(!p.r.ok && p.r.status!==204){
      let msg=p.d.error?.message||'Spotify konnte den Song nicht starten';
      if(p.r.status===404) msg='Spotify Browser-Player ist noch nicht als aktives Gerät verfügbar. Drücke im Control Room erneut PLAY.';
      if(p.r.status===403) msg='Spotify verweigert die Wiedergabe. Prüfe, ob das verbundene DJ-Konto Premium hat und Web Playback erlaubt ist.';
      return res.status(p.r.status).json({error:msg});
    }
    res.json({ok:true,spotifyId,deviceId});
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/admin/spotify/pause',auth,async(req,res)=>{
  try{const token=await getUserSpotifyToken(req.adminToken);if(!token)return res.status(401).json({error:'Spotify ist nicht verbunden'});const p=await spotifyFetch('https://api.spotify.com/v1/me/player/pause',token,{method:'PUT'});if(!p.r.ok&&p.r.status!==204)return res.status(p.r.status).json({error:p.d.error?.message||'Pause fehlgeschlagen'});res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/search',async(req,res)=>{
  if(!spotifyConfigured()) return res.status(503).json({error:'Spotify ist noch nicht eingerichtet. Setze SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET und SPOTIFY_REDIRECT_URI auf Render.'});
  const q=String(req.query.q||`${req.query.title||''} ${req.query.artist||''}`).trim(); if(!q)return res.json({tracks:[]});
  try{
    let token=null;
    // Public visitors use client-credentials search; if the DJ is connected, the same endpoint can still search.
    token=await getClientToken();
    const {r,d}=await spotifyFetch(`https://api.spotify.com/v1/search?type=track&limit=8&market=DE&q=${encodeURIComponent(q)}`,token);
    if(!r.ok)return res.status(r.status).json({error:d.error?.message||'Spotify-Suche fehlgeschlagen'});
    res.json({tracks:(d.tracks?.items||[]).map(t=>({id:t.id,title:t.name,artist:t.artists.map(a=>a.name).join(', '),album:t.album.name,image:t.album.images?.[0]?.url||'',uri:t.uri}))});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/wishes',(req,res)=>res.json(queue.filter(w=>['pending','accepted'].includes(w.status))));
app.post('/api/wishes',(req,res)=>{
  const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim();
  const now=Date.now();
  const recent=wishes.filter(w=>w.ip===ip&&w.createdAt>now-86400000&&w.status==='pending');
  if(recent.length>=3)return res.status(429).json({error:'Du hast bereits 3 offene Wünsche. Warte, bis einer erledigt wurde.'});
  const {title,artist,spotifyId,sourceUrl}=req.body;
  if(!title||!artist)return res.status(400).json({error:'Songtitel und Interpret erforderlich.'});
  if(isBanned(title,artist))return res.status(403).json({error:'Dieser Song wurde vom DJ gesperrt.'});
  const duplicate=queue.find(w=>norm(w.title)===norm(title)&&norm(w.artist)===norm(artist)&&w.status==='pending');
  if(duplicate){duplicate.votes=(duplicate.votes||1)+1;saveQueue();return res.json(duplicate)}
  const w={id:crypto.randomUUID(),title:String(title).slice(0,120),artist:String(artist).slice(0,120),spotifyId:spotifyId||null,sourceUrl:sourceUrl||null,ip,createdAt:now,status:'pending',votes:1};
  wishes.push(w);queue.push(w);save();saveQueue();res.status(201).json(w);
});

app.get('/api/admin/queue',auth,(req,res)=>res.json({queue,banned,live}));
app.patch('/api/admin/queue/:id',auth,(req,res)=>{const i=queue.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:'Nicht gefunden'});const {action,sourceUrl}=req.body;if(action==='moveUp'&&i>0){[queue[i-1],queue[i]]=[queue[i],queue[i-1]]}else if(action==='moveDown'&&i<queue.length-1){[queue[i+1],queue[i]]=[queue[i],queue[i+1]]}else if(action==='source'){queue[i].sourceUrl=String(sourceUrl||'').slice(0,1000)}else if(['accepted','rejected','done','remove'].includes(action)){queue[i].status=action}else return res.status(400).json({error:'Ungültige Aktion'});const orig=wishes.find(x=>x.id===queue[i].id);if(orig)orig.status=queue[i].status;save();saveQueue();res.json(queue[i])});
app.post('/api/admin/ban',auth,(req,res)=>{const title=String(req.body.title||'').trim(),artist=String(req.body.artist||'').trim();if(!title)return res.status(400).json({error:'Songtitel fehlt'});const b={id:crypto.randomUUID(),title,artist,titleKey:norm(title),artistKey:norm(artist)};if(!banned.some(x=>x.titleKey===b.titleKey&&x.artistKey===b.artistKey)){banned.push(b);saveBans()}queue.forEach(x=>{if(isBanned(x.title,x.artist)&&x.status==='pending')x.status='rejected'});saveQueue();res.json({ok:true,banned})});
app.delete('/api/admin/ban/:id',auth,(req,res)=>{banned=banned.filter(x=>x.id!==req.params.id);saveBans();res.json({ok:true,banned})});
app.post('/api/admin/birthday',auth,(req,res)=>{const name=String(req.body.name||'').trim();if(!name)return res.status(400).json({error:'Name fehlt'});const b={id:crypto.randomUUID(),title:`Happy Birthday ${name}`,artist:'Birthday Room',sourceUrl:'/birthday.mp3',createdAt:Date.now(),status:'accepted',votes:1,birthday:true};queue.push(b);saveQueue();res.json(b)});

app.get('/api/live',(req,res)=>res.json(live));
app.get('/api/announcements',(req,res)=>res.json(live.announcement?{text:live.announcement,at:live.announcementAt}:null));
app.post('/api/feedback',(req,res)=>{const type=String(req.body.type||'Feedback').slice(0,30),message=String(req.body.message||'').trim().slice(0,800);if(!message)return res.status(400).json({error:'Bitte schreib eine Nachricht.'});feedback.unshift({id:crypto.randomUUID(),type,message,createdAt:Date.now(),status:'new'});saveFeedback();res.status(201).json({ok:true})});
app.get('/api/admin/feedback',auth,(req,res)=>res.json(feedback));
app.patch('/api/admin/live',auth,(req,res)=>{const {nowPlaying,announcement,birthday}=req.body;if(nowPlaying!==undefined)live.nowPlaying=nowPlaying;if(announcement!==undefined){live.announcement=String(announcement).slice(0,300);live.announcementAt=Date.now()}if(birthday!==undefined)live.birthday=birthday&&birthday.active?{active:true,name:String(birthday.name||'').slice(0,80),age:birthday.age?String(birthday.age).slice(0,3):null,at:Date.now()}:null;saveLive();res.json(live)});
app.patch('/api/admin/feedback/:id',auth,(req,res)=>{const f=feedback.find(x=>x.id===req.params.id);if(!f)return res.status(404).json({error:'Nicht gefunden'});f.status=req.body.status||'read';saveFeedback();res.json({ok:true})});

app.listen(PORT,()=>console.log(`Herner Eisdisco Wunschbox läuft auf Port ${PORT}`));
