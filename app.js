'use strict';
/* ---------- log běhu ---------- */
const LOG=[];const LOGMAX=400;const T0=Date.now();
function log(level,msg,data){
  let d='';if(data!==undefined){try{d=typeof data==='string'?data:JSON.stringify(data,(k,v)=>v instanceof Blob?`Blob(${v.type},${Math.round(v.size/1024)}kB)`:v instanceof Error?{name:v.name,message:v.message,stack:String(v.stack||'').split('\n').slice(0,4).join(' | ')}:v)}catch(e){d=String(data)}}
  const t=new Date();const line=`${t.toTimeString().slice(0,8)}.${String(t.getMilliseconds()).padStart(3,'0')} +${((t-T0)/1000).toFixed(1)}s ${level} ${msg}${d?' '+d.slice(0,600):''}`;
  LOG.push(line);if(LOG.length>LOGMAX)LOG.splice(0,LOG.length-LOGMAX);
  try{localStorage.setItem('uctenky-log',JSON.stringify(LOG.slice(-200)))}catch(e){}
}
const errInfo=e=>e==null?null:e instanceof Error?{name:e.name,message:e.message,stack:String(e.stack||'').split('\n').slice(0,4).join(' | ')}:typeof e==='object'?{...Object.fromEntries(['name','code','message','msg','type','reason'].filter(k=>e[k]!=null).map(k=>[k,String(e[k])])),ctor:e.constructor&&e.constructor.name}:{value:String(e)};
try{const prev=JSON.parse(localStorage.getItem('uctenky-log')||'[]');if(prev.length){LOG.push(...prev.slice(-100));LOG.push('----- nové spuštění -----')}}catch(e){}
addEventListener('error',e=>log('CHYBA','window.onerror',{msg:e.message,src:(e.filename||'').slice(-40),line:e.lineno,col:e.colno,err:errInfo(e.error)}));
addEventListener('unhandledrejection',e=>log('CHYBA','nezachycený promise',errInfo(e.reason)));
log('INFO','start',{ua:navigator.userAgent,lang:navigator.language,online:navigator.onLine,scr:`${screen.width}x${screen.height}@${devicePixelRatio}`,mem:navigator.deviceMemory,inClaude:!!(window.claude&&window.claude.use),url:location.origin+location.pathname});
{
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kc=n=>(Math.round(n)||0).toLocaleString('cs-CZ')+' Kč';
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const fmtD=d=>{if(!d)return'';const [y,m,dd]=d.split('-');return `${+dd}. ${+m}. ${y}`};
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const num=v=>Math.max(0,parseInt(String(v).replace(/\D/g,''))||0);
const plur=(n,a,b,c)=>n===1?a:n>=2&&n<=4?b:c;
const APP_VER=49;
const DEF_PRICES=[55,35,40,30,28,25,20,18];

/* ---------- IndexedDB ---------- */
let idb;
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open('uctenky',1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('receipts',{keyPath:'id'});d.createObjectStore('photos',{keyPath:'id'});d.createObjectStore('kv')};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
const tx=(store,mode,fn)=>new Promise((res,rej)=>{const t=idb.transaction(store,mode);const s=t.objectStore(store);const out=fn(s);t.oncomplete=()=>res(out&&out.result!==undefined?out.result:out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error)});
const getAll=store=>new Promise((res,rej)=>{const r=idb.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
let memMode=false;const memPhotos=new Map();
function goMem(e){log('VAROV','úložiště selhalo → paměťový režim',errInfo(e));if(memMode)return;memMode=true;toast('Úložiště tu není dostupné – data platí do zavření stránky.',true);render()}
async function getPhotoRec(key){
  if(memPhotos.has(key))return{id:key,blob:memPhotos.get(key)};
  if(!idb)return undefined;
  const r=await getOneRaw('photos',key);if(!r)return undefined;
  try{
    if(r.buf){const blob=new Blob([r.buf],{type:r.type||'image/jpeg'});memPhotos.set(key,blob);return{id:key,blob}}
    if(r.blob){const buf=await r.blob.arrayBuffer();const blob=new Blob([buf],{type:r.blob.type||'image/jpeg'});memPhotos.set(key,blob);
      tx('photos','readwrite',s=>s.put({id:key,buf,type:blob.type})).catch(()=>{});log('INFO','fotka převedena na nový formát',key);return{id:key,blob}}
  }catch(e){log('CHYBA','uloženou fotku nejde přečíst (Safari)',{key,...errInfo(e)})}
  return undefined;
}
const getOne=(store,key)=>store==='photos'?getPhotoRec(key):getOneRaw(store,key);
const getOneRaw=(store,key)=>memMode&&!idb?Promise.resolve(undefined):new Promise((res,rej)=>{const r=idb.transaction(store).objectStore(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});

let receipts=[],settings={email:'',prices:DEF_PRICES,aiKey:'',aiModel:'',issuer:'',issuerInfo:'',payPrefix:'',payNext:1,signature:'',eetMode:'off',eetMojeUrl:'https://eet.gov.cz',eetUrl:'',eetToken:'',eetJednotka:'',eetPokl:'',eetOvereni:false};
let hwSamples=[];const saveHw=()=>memMode?Promise.resolve():tx('kv','readwrite',s=>s.put(hwSamples,'hw')).catch(e=>goMem(e));
let claudeAI=null,claudeMax=0,claudeDl=null,claudeMcp=null;const isOAI=()=>settings.provider==='oai';const extAI=()=>isOAI()?!!(settings.oaiKey&&settings.oaiModel&&settings.oaiUrl):!!settings.aiKey;const hasAI=()=>!!(claudeAI||extAI());
const allKeys=()=>[settings.aiKey,...String(settings.aiKeys2||'').split(/[\s,;]+/)].map(s=>(s||'').trim()).filter((s,i,a)=>s&&a.indexOf(s)===i);
function curKey(){const k=allKeys();const d=new Date().toISOString().slice(0,10);if(settings.keyDay!==d){settings.keyDay=d;settings.keyIdx=0}return k[Math.min(settings.keyIdx||0,k.length-1)]||settings.aiKey}
const DEF_MODELS=['gemini-3.8-flash','gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-2.5-flash'];
let debtSel='',view='list',curId=null,curPhoto=0,filter='open',query='',person='';
const photoURLs=new Map();
async function urlFor(pid){if(!pid)return'';if(photoURLs.has(pid))return photoURLs.get(pid);const p=await getOne('photos',pid);if(!p)return'';const u=URL.createObjectURL(p.blob);photoURLs.set(pid,u);return u}
async function preloadURLs(){for(const r of receipts)for(const p of r.photos||[])await urlFor(p.id)}
const pu=p=>p?photoURLs.get(p.id)||'':'';

const saveT=new Map();
function save(r){if(r&&r.rows)syncR(r);r.updatedAt=Date.now();if(memMode)return;clearTimeout(saveT.get(r.id));saveT.set(r.id,setTimeout(()=>tx('receipts','readwrite',s=>s.put(JSON.parse(JSON.stringify(r)))).catch(e=>goMem(e)),250))}
function keyBackup(){try{if(settings.aiKey){localStorage.setItem('uctenky-key',JSON.stringify({k:settings.aiKey,m:settings.aiModel||''}))}else localStorage.removeItem('uctenky-key')}catch(e){log('VAROV','záloha klíče selhala',errInfo(e))}}
function saveSettings(){keyBackup();if(memMode)return Promise.resolve();return tx('kv','readwrite',s=>s.put(settings,'settings')).catch(e=>goMem(e))}

/* ---------- derived ---------- */
const rowsOf=r=>r.rows||[];
const totR=r=>rowsOf(r).reduce((a,x)=>[a[0]+(+x.c||0),a[1]+(+x.p||0)*(+x.c||0)],[0,0]);
const flagsR=r=>rowsOf(r).filter(x=>x.q).length;
const getR=id=>receipts.find(r=>r.id===id);
/* platby: r.payments[] ; r.payment = poslední platba (odkaz) ; stav dopočítaný */
const pays=r=>r.payments||(r.payments=r.payment?[r.payment]:[]);
const paidR=r=>pays(r).reduce((a,p)=>a+(+p.amount||0),0);
const dueR=r=>r.writtenOff?0:Math.max(0,totR(r)[1]-paidR(r));
const stateR=r=>{const t=totR(r)[1],pd=paidR(r);if(r.writtenOff||(t>0&&pd>=t))return 'paid';if(pd>0)return 'partial';return 'open'};
function syncR(r){pays(r);r.payment=r.payments[r.payments.length-1]||null;r.status=stateR(r);return r}
const personOf=r=>(r.name||'').trim()||'Bez jména';
const pcfg=n=>((settings.people||{})[n])||{};
const limitOf=n=>+pcfg(n).limit||+settings.debtLimit||0;
function debtOf(n){const list=receipts.filter(r=>personOf(r)===n&&dueR(r)>0).sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.createdAt||0)-(b.createdAt||0));
  const due=list.reduce((a,r)=>a+dueR(r),0);const oldest=list[0]&&list[0].date;const days=oldest?Math.floor((Date.now()-new Date(oldest+'T12:00'))/864e5):0;
  const lim=limitOf(n),maxd=+settings.debtDays||0;const over=(lim&&due>lim)||(maxd&&due>0&&days>maxd);
  const allPays=receipts.filter(r=>personOf(r)===n).flatMap(r=>pays(r).map(p=>({...p,rid:r.id})));const last=allPays.sort((a,b)=>(b.issuedAt||0)-(a.issuedAt||0))[0];
  return{name:n,due,list,oldest,days,lim,over,last}}
const debtors=()=>[...new Set(receipts.map(personOf))].map(debtOf).filter(d=>d.due>0).sort((a,b)=>b.due-a.due);
const debtBadge=n=>{const d=debtOf(n);return d.due?` · ${d.over?'⚠ ':''}dluh ${kc(d.due)}`:''};
const names=()=>{const m={};receipts.forEach(r=>{const n=(r.name||'').trim();if(n)m[n]=(m[n]||0)+1});return Object.keys(m).sort((a,b)=>m[b]-m[a]||a.localeCompare(b,'cs'))};
const byFilter=r=>(filter==='all'||(filter==='open'?stateR(r)!=='paid':stateR(r)==='paid'))&&(!person||(r.name||'').trim()===person);

let toastT;
function toast(msg,err){let t=$('toast');if(!t){t=document.createElement('div');t.id='toast';t.setAttribute('role','status');t.style.cssText='position:fixed;left:50%;bottom:calc(150px + env(safe-area-inset-bottom));transform:translateX(-50%);color:#fff;padding:10px 16px;border-radius:12px;z-index:20;font-size:15px;max-width:90vw;text-align:center';document.body.append(t)}t.textContent=msg;t.style.background=err?'#a3121f':'#151826';t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,3000)}

/* ---------- Vrátit (undo) ---------- */
let undoSnap=null,undoT;
function snap(list,msg){undoSnap={items:list.filter(Boolean).map(r=>({id:r.id,json:JSON.stringify(r),existed:true})),msg};}
function snapAll(msg){undoSnap={all:JSON.stringify(receipts),msg}}
function offerUndo(msg){if(!undoSnap)return;(document.querySelector('dialog[open]')||document.body).appendChild($('undo'));$('undot').textContent=msg||undoSnap.msg||'Hotovo';$('undo').hidden=false;clearTimeout(undoT);undoT=setTimeout(()=>{$('undo').hidden=true;undoSnap=null},7000)}
function doUndo(){const u=undoSnap;if(!u)return;
  if(u.all){const old=JSON.parse(u.all);const ids=new Set(old.map(r=>r.id));receipts.filter(r=>!ids.has(r.id)).forEach(r=>{try{tx('receipts','readwrite',s=>s.delete(r.id))}catch(e){}});receipts=old.map(syncR);receipts.forEach(r=>save(r))}
  else u.items.forEach(it=>{const o=syncR(JSON.parse(it.json));const k=receipts.findIndex(r=>r.id===it.id);if(k>=0)receipts[k]=o;else receipts.push(o);save(o)});
  undoSnap=null;$('undo').hidden=true;log('UI','vráceno');render();toast('Vráceno ↶')}
$('undob').onclick=doUndo;
/* ochrana proti dvojitému ťuknutí */
let lastTap={el:null,t:0};
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const now=Date.now();
  if(b===lastTap.el&&now-lastTap.t<350&&!/^[+\-−]|\+1|\+5/.test(b.textContent.trim())){e.stopPropagation();e.preventDefault();return}lastTap={el:b,t:now}},true);

/* ---------- render ---------- */
const app=$('app');
function render(){log('UI','pohled '+view+(view==='detail'?' '+curId:''));
  document.querySelectorAll('[data-nav]').forEach(b=>b.setAttribute('aria-current',b.dataset.nav===(view==='detail'?'list':view==='person'?'debts':view)?'page':'false'));
  const nd=debtors().filter(d=>d.over).length;const bd=$('navdebt');if(bd){bd.hidden=!nd;bd.textContent=nd}
  $('fab').hidden=true;
  ({list:renderList,detail:renderDetail,summary:renderSummary,settings:renderSettings,debts:renderDebts,person:renderPerson})[view]();
}
const offlineBar=()=>(memMode?'<div class="offline" style="background:#fde2e4;color:#8a0d18">Úložiště v tomto prohlížeči není dostupné. Appka funguje, ale data zmizí po zavření stránky. V plné verzi (odkaz z GitHubu) se ukládají do telefonu.</div>':'')+(navigator.onLine?'':'<div class="offline">Jsi offline. Vše funguje a ukládá se do telefonu.</div>');
function heroHTML(label,q,t,warn){return `<section class="hero" aria-live="polite"><div><div class="lbl">${label}</div><div class="big">${kc(t)}</div></div><div><div class="lbl" style="text-align:right">kusů</div><div class="qty">${q}</div></div>${warn?`<div class="warn">${warn}</div>`:''}</section>`}
const nameChips=()=>names().length?`<div class="chips" role="group" aria-label="Podle jména" style="margin-bottom:10px"><button data-person="" aria-pressed="${!person}">Všichni</button>${names().map(n=>{const d=debtOf(n);return `<button data-person="${esc(n)}" aria-pressed="${person===n}"${d.over?' style="border-color:var(--red)"':''}>${esc(n)}${d.due?` <small style="color:${d.over?'var(--red)':'var(--mute)'}">${kc(d.due)}</small>`:''}</button>`}).join('')}</div>`:'';
const statusChips=()=>`<div class="chips" role="group" aria-label="Filtr">${[['open','Nezaplacené'],['paid','Zaplacené'],['all','Vše']].map(([k,l])=>`<button data-filter="${k}" aria-pressed="${filter===k}">${l}</button>`).join('')}</div>`;
function renderList(){
  const open=receipts.filter(r=>stateR(r)!=='paid'&&(!person||(r.name||'').trim()===person));
  let q=0,t=0,fl=0;open.forEach(r=>{const s=totR(r);q+=s[0];t+=dueR(r);fl+=flagsR(r)});
  const qs=query.trim().toLowerCase();
  const list=receipts.filter(r=>byFilter(r)&&(!qs||(`${r.name} ${r.note||''} ${fmtD(r.date)}`).toLowerCase().includes(qs)))
    .sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.createdAt||0)-(a.createdAt||0));
  const ep=eetPending();
  app.innerHTML=`${offlineBar()}${ep.length?`<div class="offline" style="background:#fde2e4;color:#8a0d18">EET: ${ep.length} ${plur(ep.length,'platba čeká','platby čekají','plateb čeká')} na odeslání.${ep.some(x=>Date.now()-x.p.eet.created>40*3600e3)?' Blíží se zákonná lhůta 48 hodin!':''} Odesílám automaticky, jakmile to půjde.</div>`:''}<h1>Účtenky</h1>
  ${heroHTML(`${person?esc(person)+' – dluží':'Nezaplaceno celkem'} (${open.length} ${plur(open.length,'účtenka','účtenky','účtenek')})`,q,t,fl?`<span>Ke kontrole: ${fl} ${plur(fl,'sporné místo','sporná místa','sporných míst')}.</span>`:'')}
  <label class="camcard"><input type="file" accept="image/*" capture="environment" id="camq"><span class="camico" aria-hidden="true"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="4"/></svg></span><span><b>Vyfotit účtenku</b><br><span class="note2" style="color:inherit;opacity:.85">${hasAI()?'AI ji hned přečte':'Pak spočítáš čárky'}</span></span></label>
  <div class="actions" style="margin-top:8px"><label class="btn" style="position:relative;flex:1">Z galerie<input type="file" accept="image/*" id="galq" style="position:absolute;inset:0;opacity:0"></label><button style="flex:1" data-a="manual">Bez fotky</button></div>
  <div class="bar">${statusChips()}<input class="search" type="search" id="q" placeholder="Hledat…" value="${esc(query)}" aria-label="Hledat"></div>
  ${nameChips()}
  <div class="list">${list.length?list.map(cardHTML).join(''):`<div class="empty">${receipts.length?'Nic neodpovídá filtru.':'Zatím tu nejsou žádné účtenky.<br>Klepni nahoře na <b>Vyfotit účtenku</b>.'}</div>`}</div>`;
}
function cardHTML(r){
  const s=totR(r),f=flagsR(r),ph=pu((r.photos||[])[0]);
  return `<button class="rc" data-open="${esc(r.id)}">
    <span class="th" style="${ph?`background-image:url('${ph}')`:''}">${ph?'':'bez fotky'}</span>
    <span><b>${esc(r.name||'Bez jména')}</b><span class="meta">${esc(fmtD(r.date))} · ${s[0]} ks${r.note?' · '+esc(r.note):''}</span><br>
      ${(st=>st==='paid'?`<span class="tag t-paid">${r.writtenOff&&paidR(r)<s[1]?'Odepsáno':'Zaplaceno'}</span>`:st==='partial'?`<span class="tag t-q">Částečně · zbývá ${kc(dueR(r))}</span>`:'<span class="tag t-open">Nezaplaceno</span>')(stateR(r))}${f?`<span class="tag t-q">${f} ke kontrole</span>`:''}${r.sentAt?`<span class="tag t-sent">Odesláno</span>`:''}${pays(r).some(p=>p.eet&&!/ok/.test(p.eet.state))?`<span class="tag t-q">EET čeká</span>`:''}</span>
    <span class="amt">${kc(s[1])}</span></button>`;
}
/* porovnání skupin z 1. a 2. počítání – které se liší */
function seeDiff(x){const A=x.ga||[],B=x.gb||[];const a=new Set(),b=new Set();if(!B.length)return{a,b};const used=new Set();
  A.forEach((g,k)=>{let best=-1,bd=1;B.forEach((h,m)=>{if(used.has(m))return;const d=Math.abs(h[0]-g[0]);if(d<bd){bd=d;best=m}});
    if(best<0||bd>.06){a.add(k)}else{used.add(best);if(B[best][1]!==g[1]){a.add(k);b.add(best)}}});
  B.forEach((h,m)=>{if(!used.has(m))b.add(m)});return{a,b}}
function seeHTML(x){const A=x.ga||[],B=x.gb||[];if(!A.length&&!(x.bad||[]).length)return'';const d=seeDiff(x);
  const chips=(G,set,cls)=>G.map((g,k)=>`<span class="sc ${cls}${set.has(k)?' dif':''}">${g[1]}</span>`).join('<i>+</i>');
  const sum=G=>G.reduce((s,g)=>s+g[1],0);
  let h='';
  const two=B.length&&(d.a.size||d.b.size||sum(A)!==sum(B));
  const line=(lbl,G,set,cls)=>{const s=sum(G);const on=s===+x.c;return two?`<button class="seel${on?' on':''}" data-alt="${s}"><b>${lbl}</b><span class="scs">${chips(G,set,cls)}</span><span class="ss">= ${s}${on?' ✓':''}</span></button>`:`<div class="seel"><b>${lbl}</b><span class="scs">${chips(G,set,cls)}</span><span class="ss">= ${s}</span></div>`};
  if(A.length)h+=line('AI vidí',A,d.a,'a');
  if(two)h+=line('Kontrola',B,d.b,'b')+`<div class="note2">Počítání se liší v <b style="color:var(--red)">červeně orámované</b> skupině – na fotce je označená. Klepni na řádek, který sedí, nebo uprav počet dole.</div>`;
  (x.bad||[]).forEach((z,k)=>h+=`<div class="seeq"><span class="qn">${k+1}</span>${esc(z[1]||'nejasné místo')}</div>`);
  return h}
function svgPhoto(r,pi,vb,mode,selIdx,extra){
  const p=(r.photos||[])[pi];if(!p)return'';
  const H=(p.h&&p.w)?p.h/p.w:1.4;
  const rect=(b,cls,i)=>`<rect class="${cls}" ${i!=null?`data-i="${i}"`:''} x="${b[0]}" y="${b[1]*H}" width="${Math.max(0,b[2]-b[0])}" height="${Math.max(0,(b[3]-b[1])*H)}" rx=".006"/>`;
  let inner='';
  rowsOf(r).forEach((x,i)=>{if(!x.box||(x.ph||0)!==pi)return;
    if(mode==='all'||(mode==='one'&&i===selIdx)){inner+=rect(x.box,'b'+(x.q?' q':'')+(i===selIdx?' sel':''),mode==='all'?i:null);if(mode==='all'){if(x.pbox)inner+=rect(x.pbox,'pb');const lbl=`${x.p} × ${x.c} = ${(x.p*x.c).toLocaleString('cs-CZ')} Kč`;const fs=Math.max(.014,Math.min(.021,(x.box[3]-x.box[1])*H*.28));const tw=lbl.length*fs*.56+.01;
        const lx=Math.min(x.box[0]+.004,1-tw-.004),ly=x.box[1]*H+.004;inner+=`<g class="lbl${x.q?' q':''}"><rect x="${lx}" y="${ly}" width="${tw}" height="${fs*1.3}" rx="${fs*.25}"/><text x="${lx+.005}" y="${ly+fs*.98}" style="font-size:${fs}px">${esc(lbl)}</text></g>`}}
    if(i===selIdx)(x.spots||[]).forEach(s=>inner+=rect(s,'s'));
    if(i===selIdx&&x.pbox)inner+=rect(x.pbox,'pb');
    if(i===selIdx&&mode==='one'&&x.pts&&x.pts.length){const R=Math.max(.0035,Math.min(.007,(x.box[3]-x.box[1])*H*.05));x.pts.forEach((p,k)=>{inner+=`<circle class="pt" cx="${p[0]}" cy="${p[1]*H}" r="${R}"/>`+((k+1)%5===0||k===x.pts.length-1?`<text class="ptn" x="${p[0]}" y="${p[1]*H+R*4.2}" style="font-size:${R*3}px">${k+1}</text>`:'')})}
    if(i===selIdx&&mode==='one'&&x.box&&(x.ga||x.bad)){const bh=(x.box[3]-x.box[1])*H,ty=x.box[1]*H,by=x.box[3]*H,fs=Math.max(.016,Math.min(.034,bh*.3));
      const diff=seeDiff(x);
      (x.ga||[]).forEach((g,k)=>{inner+=`<g class="gA${diff.a.has(k)?' dif':''}"><line x1="${g[0]}" y1="${ty}" x2="${g[0]}" y2="${by}"/><rect x="${g[0]-fs*.62}" y="${ty-fs*1.25}" width="${fs*1.24}" height="${fs*1.15}" rx="${fs*.25}"/><text x="${g[0]}" y="${ty-fs*.67}" style="font-size:${fs*.85}px">${g[1]}</text></g>`});
      (x.gb||[]).forEach((g,k)=>{if(!diff.b.has(k))return;inner+=`<g class="gB"><rect x="${g[0]-fs*.62}" y="${by+fs*.1}" width="${fs*1.24}" height="${fs*1.15}" rx="${fs*.25}"/><text x="${g[0]}" y="${by+fs*.68}" style="font-size:${fs*.85}px">${g[1]}</text></g>`});
      (x.bad||[]).forEach((z,k)=>{const cy=(ty+by)/2,R=Math.max(bh*.62,.025);inner+=`<g class="gQ"><circle cx="${z[0]}" cy="${cy}" r="${R}"/><circle class="gQn" cx="${z[0]+R*.8}" cy="${cy-R*.8}" r="${fs*.55}"/><text x="${z[0]+R*.8}" y="${cy-R*.8}" style="font-size:${fs*.7}px">${k+1}</text></g>`})}
  });
  if(extra)inner+=rect(extra,'nw');
  const v=vb||[0,0,1,H];
  return `<svg class="phs${mode==='mark'?' mark':''}" viewBox="${v.join(' ')}" data-h="${H}" role="img" aria-label="Fotka účtenky"><image href="${pu(p)}" x="0" y="0" width="1" height="${H}" preserveAspectRatio="none"/>${inner}</svg>`;
}
function eetLine(r,p,pi){p=p||r.payment;const ee=p&&p.eet;if(!ee)return'';const pa=pi!=null?` data-pi="${pi}"`:'';
  if(ee.state==='ok')return `<br>EET${ee.test?' (test)':''}: POK ${esc(ee.pok)}`;
  if(ee.state==='manual-ok')return '<br>Zaevidováno v MOJE EET';
  if(ee.state==='manual')return `<br><span style="color:var(--red)">Zaevidovat v MOJE EET</span> <button class="mini" data-a="moje"${pa}>Otevřít</button>`;
  const late=Date.now()-ee.created>40*3600e3;
  return `<br><span style="color:var(--red)">EET ${ee.state==='error'?'chyba':'čeká na odeslání'}${ee.lastError?' – '+esc(ee.lastError):''}${late?' · blíží se lhůta 48 h!':''}</span> <button class="mini" data-a="eetsend"${pa}>Odeslat teď</button>`}
function rowHTML(x,i){
  return `<div class="row${x.q?' q':''}" data-i="${i}">
   <label class="price"><input inputmode="numeric" data-f="p" value="${esc(x.p)}" aria-label="Cena">Kč</label>
   <div class="sub">${kc((+x.p||0)*(+x.c||0))}</div>
   <div class="cnt"><button data-a="-" aria-label="Ubrat kus">−</button><input inputmode="numeric" data-f="c" value="${esc(x.c)}" aria-label="Počet kusů"><button data-a="+" aria-label="Přidat kus">+1</button></div>
   ${x.q||x.note?`<div class="note" style="grid-column:1/-1">${esc(x.note||'Sporný řádek – zkontroluj')}</div>`:''}
   <div class="rowact"><button class="show" data-a="show">${x.box?'🔍 Ukázat':'🔍 Počítat'}</button>${x.q?`<button class="pri" data-a="ok">Sedí ✓</button>`:''}<button class="mini ghost del" data-a="del" aria-label="Smazat řádek">Smazat</button></div>
  </div>`;
}
function renderDetail(){
  const r=getR(curId);if(!r){view='list';return render()}
  const s=totR(r),f=flagsR(r),photos=r.photos||[];
  if(curPhoto>=photos.length)curPhoto=0;
  const others=names().filter(n=>n!==(r.name||'').trim()).slice(0,8);
  app.innerHTML=`${offlineBar()}<div class="bar" style="margin-top:0"><button class="ghost" data-a="back">‹ Zpět</button></div>
  ${heroHTML(esc(r.name||'Účtenka'),s[0],s[1],f?`<span>Ke kontrole: ${f} ${plur(f,'sporné místo','sporná místa','sporných míst')}.</span><button data-a="walk">Projít sporná místa ›</button>`:'')}
  <div class="card" style="margin-top:12px"><div class="pad grid2">
    <div style="grid-column:1/-1"><label class="f" for="rn">Uložit pod jménem</label><input id="rn" data-r="name" list="nl" autocomplete="off" value="${esc(r.name||'')}" placeholder="Napiš jméno, např. Aleš" style="font-size:18px;font-weight:700"><datalist id="nl">${names().map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
      ${others.length?`<div class="chips" style="margin-top:6px">${others.map(n=>`<button class="mini" data-setname="${esc(n)}">${esc(n)}</button>`).join('')}</div>`:''}</div>
    <div><label class="f" for="rd">Datum</label><input id="rd" type="date" data-r="date" value="${esc(r.date||'')}"></div>
    <div><label class="f">Stav</label><div style="min-height:44px;display:flex;align-items:center;font-weight:700;color:${stateR(r)==='paid'?'var(--ok)':stateR(r)==='partial'?'var(--hiink)':'var(--pen)'}">${stateR(r)==='paid'?(r.writtenOff&&paidR(r)<s[1]?'Odepsáno':'Zaplaceno'):stateR(r)==='partial'?'Částečně zaplaceno':'Nezaplaceno'}</div></div>
    <div style="grid-column:1/-1"><label class="f" for="rno">Poznámka</label><input id="rno" data-r="note" value="${esc(r.note||'')}" placeholder="Např. hospoda U Lípy"></div>
  </div>${(()=>{const dbt=debtOf(personOf(r));return r.name&&dbt.due>dueR(r)?`<p class="note2 pad" style="padding-top:0;color:${dbt.over?'var(--red)':'var(--mute)'}">${dbt.over?'⚠ ':''}${esc(r.name)} dluží celkem ${kc(dbt.due)} z ${dbt.list.length} ${plur(dbt.list.length,'účtenky','účtenek','účtenek')}${dbt.lim?` (limit ${kc(dbt.lim)})`:''}. <button class="mini" data-person-debt="${esc(personOf(r))}">Dluhy</button></p>`:''})()}${r.sentAt?`<p class="note2 pad" style="padding-top:0">Připraveno k odeslání ${esc(new Date(r.sentAt).toLocaleString('cs-CZ'))}${r.sentTo?' pro '+esc(r.sentTo):''}</p>`:''}</div>

  <div class="card"><div class="head"><b>Platby</b><span>zaplaceno ${kc(paidR(r))} z ${kc(s[1])}</span></div>
    ${pays(r).length?pays(r).map((p,i)=>`<div class="row" style="grid-template-columns:minmax(0,1fr) auto auto"><div><b>${kc(p.amount)}</b> <span class="note2">${esc(fmtD(p.date))} · ${esc(p.method)} · č. ${esc(p.no)}${p.group?' · společná platba dluhu':''}</span>${eetLine(r,p,i)}</div><button class="mini" data-a="payedit" data-pi="${i}">Doklad</button><button class="mini ghost" data-a="paydel" data-pi="${i}">Smazat</button></div>`).join(''):'<p class="pad note2">Zatím žádná platba.</p>'}
    <div class="pad"><div class="actions">${dueR(r)>0?`<button class="pri" data-a="pay" style="flex:1;min-height:52px">Zaplatit – zbývá ${kc(dueR(r))}</button><button data-a="paypart" style="flex:1;min-height:52px">Zaplaceno částečně…</button>`:`<span style="color:var(--ok);font-weight:700">Zaplaceno celé ✓</span>`}</div>
    ${dueR(r)>0&&paidR(r)>0?`<button class="mini ghost" data-a="writeoff" style="margin-top:6px">Odepsat zbytek ${kc(dueR(r))}</button>`:''}${r.writtenOff?'<button class="mini ghost" data-a="unwrite" style="margin-top:6px">Zrušit odepsání</button>':''}</div>
  </div>

  <div class="card"><div class="head"><b>Fotky účtenky</b><span class="note2">${photos.length?'klepni na fotku':'zatím žádná'}</span></div>
    <div class="photos">
      ${photos.map((p,i)=>`<button class="ph" data-photo="${i}" aria-current="${i===curPhoto}" style="background-image:url('${pu(p)}')" aria-label="Fotka ${i+1}"></button>`).join('')}
      <label class="add">Vyfotit<input type="file" accept="image/*" capture="environment" data-up="cam"></label>
      <label class="add">Z galerie<input type="file" accept="image/*" multiple data-up="gal"></label>
    </div>
    ${photos.length?'':'<p class="note2 pad" style="padding-top:0">Tip pro přesné čtení: fotit kolmo shora, při dobrém světle a bez stínu, účtenku narovnat a nechat vyplnit celý snímek. Dlouhou účtenku vyfoť po částech.</p>'}
    ${photos.length?`<div class="pad" style="padding-top:0">
      <details open><summary style="min-height:44px;display:flex;align-items:center;font-weight:600">Fotka s řádky (klepni na rámeček)</summary>${svgPhoto(r,curPhoto,null,'all',-1)}</details>
      <div class="actions" style="margin-top:8px">${rowsOf(r).some(x=>x.box&&(x.ph||0)===curPhoto)?`<button data-a="localall"${settings.readMode==='local'?' class="pri"':''}>📱 Spočítat v telefonu (bez AI)</button>`:''}${settings.readMode==='local'?'':hasAI()?`<button class="pri" data-a="ai" ${navigator.onLine?'':'disabled'}>${r.pendingAI?'Čeká na internet – přečíst teď':'Přečíst čárky z fotky (AI)'}</button>`:`<button class="ghost" data-nav-go="settings">Zapnout čtení čárek přes AI</button>`}<button class="mini ghost" data-a="delphoto" style="margin-left:auto;color:var(--red)">Smazat fotku</button></div>
      ${settings.readMode==='local'?'<p class="note2">Bez AI: dole klepni na cenu, na fotce táhni prstem přes její čárky (bez ceny) – appka je spočítá a pod každou dá tečku.</p>':''}${hasAI()&&!navigator.onLine?'<p class="note2">Čtení přes AI potřebuje internet. Počítat ručně jde i offline.</p>':''}
    </div>`:''}
  </div>

  <div class="card"><div class="head"><b>Řádky</b><span>${s[0]} ks · <span class="sum">${kc(s[1])}</span></span></div>
    ${rowsOf(r).length?rowsOf(r).map(rowHTML).join(''):'<p class="pad note2">Zatím žádné řádky. Přidej řádek podle ceny níže a čárky spočítej tlačítkem Počítat.</p>'}
    <div class="note2" style="padding:12px 12px 0">Přidat řádek s cenou:</div>
    <div class="prices">${(settings.prices||DEF_PRICES).map(p=>`<button data-addp="${esc(p)}">${esc(p)} Kč</button>`).join('')}<button data-addp="0">Jiná…</button></div>
  </div>

  <div class="actions"><button data-a="mail" style="flex:1">✉ Odeslat e-mailem</button></div>
  <details class="more"><summary>Další možnosti</summary>
    <div class="actions"><button data-a="copy">Kopírovat text</button></div>
    <div class="danger-zone"><button class="danger" data-a="delr">Smazat celou účtenku</button></div>
  </details>`;
}
/* ---------- dluhy ---------- */
function renderDebts(){
  const ds=debtors();const tot=ds.reduce((a,d)=>a+d.due,0);const ov=ds.filter(d=>d.over);
  app.innerHTML=`${offlineBar()}<h1>Dluhy</h1>
  <section class="hero"><div><div class="lbl">Dluží celkem (${ds.length} ${plur(ds.length,'člověk','lidé','lidí')})</div><div class="big">${kc(tot)}</div></div><div></div>${ov.length?`<div class="warn"><span>⚠ ${ov.length} ${plur(ov.length,'člověk překročil','lidé překročili','lidí překročilo')} limit${settings.debtDays?' nebo dluží déle než '+settings.debtDays+' dní':''}.</span></div>`:''}</section>
  <div class="list" style="margin-top:12px">${ds.length?ds.map(d=>`<button class="rc" data-person-debt="${esc(d.name)}" style="grid-template-columns:minmax(0,1fr) auto${d.over?';border-color:var(--red);border-width:2px':''}">
    <span><b>${d.over?'⚠ ':''}${esc(d.name)}</b><span class="meta">${d.list.length} ${plur(d.list.length,'účtenka','účtenky','účtenek')} · nejstarší ${esc(fmtD(d.oldest))} (${d.days} ${plur(d.days,'den','dny','dní')})${d.last?' · naposledy platil(a) '+esc(fmtD(d.last.date)):''}</span>
    ${d.lim?`<div style="height:6px;border-radius:3px;background:var(--line);margin-top:6px;overflow:hidden"><div style="height:100%;width:${Math.min(100,Math.round(d.due/d.lim*100))}%;background:${d.over?'var(--red)':'var(--pen)'}"></div></div><span class="meta">limit ${kc(d.lim)}</span>`:''}</span>
    <span class="amt" style="${d.over?'color:var(--red)':''}">${kc(d.due)}</span></button>`).join(''):'<div class="empty">Nikdo nic nedluží 🎉</div>'}</div>
  <p class="note2" style="margin-top:12px">Limit dluhu a počet dní nastavíš v Nastavení → Hlídání dluhů, nebo zvlášť u každého člověka.</p>`;
}
function renderPerson(){
  const n=debtSel;const d=debtOf(n);const c=pcfg(n);
  const hist=receipts.filter(r=>personOf(r)===n).flatMap(r=>pays(r).map(p=>({...p,r}))).sort((a,b)=>(b.issuedAt||0)-(a.issuedAt||0));
  const seen=new Set();const hl=hist.filter(p=>{const k=p.group||p.no+p.issuedAt;if(seen.has(k))return false;seen.add(k);return true}).slice(0,30);
  const all=receipts.filter(r=>personOf(r)===n);const spent=all.reduce((a,r)=>a+totR(r)[1],0);
  app.innerHTML=`${offlineBar()}<div class="bar" style="margin-top:0"><button class="ghost" data-nav-go="debts">‹ Dluhy</button></div>
  <section class="hero"${d.over?' style="background:#a3121f"':''}><div><div class="lbl">${esc(n)} dluží</div><div class="big">${kc(d.due)}</div></div><div><div class="lbl" style="text-align:right">účtenek</div><div class="qty">${d.list.length}</div></div>
   <div class="warn"><span>${d.lim?`Limit ${kc(d.lim)}${d.due>d.lim?' – PŘEKROČEN o '+kc(d.due-d.lim):''}. `:''}${d.oldest?`Nejstarší dluh ${d.days} ${plur(d.days,'den','dny','dní')}.`:''} Celkem utraceno ${kc(spent)}.</span></div></section>
  <div class="actions" style="margin-top:12px">${d.due?`<button class="pri" data-a="paydebt" style="flex:1;min-height:56px;font-size:17px">Zaplatit dluh</button><button data-a="remind" style="flex:1;min-height:56px">Připomenout dluh</button>`:''}<button data-a="newfor" style="flex:1;min-height:56px">+ Nová účtenka</button></div>
  <div class="card" style="margin-top:12px"><div class="head"><b>Nezaplacené účtenky</b><span class="note2">platba se odečte od nejstarší</span></div>
   ${d.list.length?d.list.map(r=>`<button class="rc" data-open="${esc(r.id)}" style="border:0;border-bottom:1px dashed var(--line);border-radius:0;grid-template-columns:minmax(0,1fr) auto"><span><b>${esc(fmtD(r.date))}</b><span class="meta">${r.note?esc(r.note)+' · ':''}útrata ${kc(totR(r)[1])}${paidR(r)?' · zaplaceno '+kc(paidR(r)):''}</span></span><span class="amt">${kc(dueR(r))}</span></button>`).join(''):'<p class="pad note2">Žádné.</p>'}</div>
  <div class="card"><div class="head"><b>Historie plateb</b></div>
   ${hl.length?hl.map(p=>`<div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div><b>${kc(p.group?p.groupTotal:p.amount)}</b> <span class="note2">${esc(fmtD(p.date))} · ${esc(p.method)} · č. ${esc(p.no)}${p.group?' · dluh':''}</span></div><button class="mini" data-open="${esc(p.r.id)}">Účtenka</button></div>`).join(''):'<p class="pad note2">Zatím žádné platby.</p>'}</div>
  <div class="card"><div class="pad">
   <b>Kontakt a limit</b>
   <div class="grid2"><div><label class="f" for="pe">E-mail</label><input id="pe" type="email" value="${esc(c.email||'')}"></div><div><label class="f" for="pt">Telefon</label><input id="pt" type="tel" value="${esc(c.phone||'')}"></div>
   <div><label class="f" for="pl">Limit dluhu (Kč)</label><input id="pl" inputmode="numeric" value="${esc(c.limit||'')}" placeholder="${settings.debtLimit?'výchozí '+settings.debtLimit:'bez limitu'}"></div>
   <div><label class="f" for="pn">Poznámka</label><input id="pn" value="${esc(c.note||'')}"></div></div>
   <div class="actions" style="margin-top:10px"><button class="pri" data-a="saveperson">Uložit</button><button data-a="copystmt">Kopírovat výpis dluhu</button></div>
  </div></div>`;
}
function debtStatement(n){const d=debtOf(n);return [`Ahoj ${n},`,'',`evidujeme u tebe nezaplacenou útratu ${kc(d.due)}:`,...d.list.map(r=>`- ${fmtD(r.date)}${r.note?' ('+r.note+')':''}: útrata ${kc(totR(r)[1])}${paidR(r)?', zaplaceno '+kc(paidR(r)):''}, zbývá ${kc(dueR(r))}`),'',`Celkem k zaplacení: ${kc(d.due)}`,'','Díky!',settings.issuer||''].join('\n')}
function openReminder(n,afterPay){const c=pcfg(n);const d=debtOf(n);
  if(!d.due&&afterPay){openMail(receipts.filter(r=>personOf(r)===n).slice(-1),true);return}
  openMail(d.list,false,debtStatement(n),`Připomínka – nezaplacená útrata ${kc(d.due)}`,c.email);
  $('msms').hidden=!c.phone;$('msms').dataset.phone=c.phone||'';}
function payDebt(n){const d=debtOf(n);if(!d.due)return;openPay({isGroup:true,name:n,list:d.list,due:d.due,rows:[]})}
function byPrice(list){const m={};list.forEach(r=>rowsOf(r).forEach(x=>{const p=+x.p||0;m[p]=(m[p]||0)+(+x.c||0)}));return Object.keys(m).map(Number).filter(p=>m[p]).sort((a,b)=>b-a).map(p=>[p,m[p]])}
function renderSummary(){
  const list=receipts.filter(byFilter);
  const people={};list.forEach(r=>{const k=personOf(r);const s=totR(r);people[k]=people[k]||[0,0,0];people[k][0]+=s[0];people[k][1]+=s[1];people[k][2]++});
  const bp=byPrice(list);let q=0,t=0;bp.forEach(([p,c])=>{q+=c;t+=p*c});
  app.innerHTML=`${offlineBar()}<h1>Souhrn${person?' – '+esc(person):''}</h1>
  <div style="margin-bottom:8px">${statusChips()}</div>${nameChips()}
  ${heroHTML(`${list.length} ${plur(list.length,'účtenka','účtenky','účtenek')}`,q,t,'')}
  <div class="card" style="margin-top:12px"><div class="head"><b>Podle jména</b></div><table><thead><tr><th>Jméno</th><th>Účtenek</th><th>Kusů</th><th>Částka</th></tr></thead><tbody>
   ${Object.entries(people).sort((a,b)=>b[1][1]-a[1][1]).map(([k,v])=>`<tr><td><button class="ghost mini" data-person-go="${esc(k)}">${esc(k)}</button></td><td>${v[2]}</td><td>${v[0]}</td><td class="kal">${kc(v[1])}</td></tr>`).join('')||'<tr><td colspan="4">Nic tu není.</td></tr>'}</tbody></table></div>
  <div class="card"><div class="head"><b>Podle ceny</b></div><table><thead><tr><th>Cena</th><th>Kusů</th><th>Částka</th></tr></thead><tbody>
   ${bp.map(([p,c])=>`<tr><td class="kal">${p} Kč</td><td>${c}</td><td>${kc(p*c)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Celkem</td><td>${q}</td><td>${kc(t)}</td></tr></tfoot></table></div>
  <div class="actions"><button class="pri" data-a="mailsum" ${list.length?'':'disabled'}>Odeslat souhrn e-mailem</button><button data-a="copysum">Kopírovat souhrn</button></div>`;
}
async function storageInfo(){try{const e=await navigator.storage.estimate();return `Zabráno ${(e.usage/1048576).toFixed(1)} MB z ${(e.quota/1048576).toFixed(0)} MB.`}catch(e){return''}}
function renderSettings(){
  app.innerHTML=`${offlineBar()}<h1>Nastavení</h1>
  <div class="card"><div class="pad">
    <label class="f" for="se">Výchozí e-mail pro odesílání</label><input id="se" type="email" value="${esc(settings.email||'')}" placeholder="jmeno@example.cz">
    <label class="f" for="sp">Ceny na rychlá tlačítka (oddělené čárkou)</label><input id="sp" value="${esc((settings.prices||DEF_PRICES).join(', '))}">
    <div class="actions" style="margin-top:10px"><button class="pri" data-a="saveset">Uložit</button></div>
  </div></div>
  <div class="card"><div class="pad">
    <h2 style="margin:0 0 6px">Ručně psané ceny</h2>
    <p class="note2">Ceny výše slouží i jako <b>ceník pro AI</b>. Cenu mimo ceník AI označí jako spornou a nabídne ti správnou. Když u přečteného řádku opravíš cenu, appka se zeptá „Pamatovat si to?“ a uloží pravidlo i ukázku písma.</p>
    <label class="f" for="shw">Jak se tu píše (poznámka pro AI)</label>
    <textarea id="shw" rows="3" placeholder="např. Pětku píšeme jako T, 55 vypadá jako TT. Čárky pod řádkem bez ceny patří k ceně nad nimi.">${esc(settings.hwNote||'')}</textarea>
    <label class="f">Pravidla oprav (AI přečte → správně)</label>
    <div class="fixes">${(settings.priceFix||[]).map((f,k)=>`<div class="fixrow"><b>${esc(f.from)}</b> → <b>${esc(f.to)} Kč</b><button class="mini danger" data-a="delfix" data-k="${k}">Smazat</button></div>`).join('')||'<p class="note2">Zatím žádná.</p>'}</div>
    <div class="fixrow"><input id="fxf" inputmode="numeric" placeholder="AI čte" style="width:6em"> → <input id="fxt" inputmode="numeric" placeholder="správně" style="width:6em"> Kč <button data-a="addfix">Přidat</button></div>
    <label class="f">Vzory písma (posílají se AI jako ukázka)</label>
    <div class="hwgrid">${hwSamples.map(s=>`<div class="hw"><img src="data:image/jpeg;base64,${s.img}" alt="vzor ${esc(s.price)}"><label>Je to <input inputmode="numeric" data-hwp="${esc(s.id)}" value="${esc(s.price)}"> Kč</label><button class="mini danger" data-a="delhw" data-k="${esc(s.id)}">Smazat</button></div>`).join('')||'<p class="note2">Zatím žádné – vzniknou při opravě ceny u přečteného řádku.</p>'}</div>
  </div></div>
  <div class="card"><div class="pad">
    <label class="chk" style="font-size:18px;font-weight:700"><input type="checkbox" id="sbig" ${settings.big!==false?'checked':''} style="width:28px;min-height:28px"> Velká tlačítka pro obsluhu</label>
    <p class="note2">Větší písmo, větší mezery a tlačítko „Vrátit“ po každém kroku.</p>
  </div></div>
  <div class="card"><div class="pad">
    <b>Hlídání dluhů</b>
    <div class="grid2"><div><label class="f" for="sdl">Výchozí limit dluhu (Kč)</label><input id="sdl" inputmode="numeric" value="${esc(settings.debtLimit||'')}" placeholder="bez limitu"></div><div><label class="f" for="sdd">Upozornit po (dnech)</label><input id="sdd" inputmode="numeric" value="${esc(settings.debtDays||'')}" placeholder="nehlídat"></div></div>
    <p class="note2">Kdo limit překročí nebo dluží déle, svítí červeně v Dluzích a u jména. Limit jde nastavit i zvlášť u každého člověka.</p>
    <div class="actions"><button class="pri" data-a="savedebt">Uložit</button></div>
  </div></div>
  <div class="card"><div class="pad">
    <b>Doklady o zaplacení</b>
    <label class="f" for="si">Vystavuje (jméno nebo provozovna)</label><input id="si" value="${esc(settings.issuer||'')}" placeholder="Např. Hospoda U Lípy / Zdeněk Novák">
    <label class="f" for="sii">Adresa, IČO apod. (nepovinné, každý údaj na nový řádek)</label><textarea id="sii" placeholder="Náměstí 1, Dobřany&#10;IČO 12345678">${esc(settings.issuerInfo||'')}</textarea>
    <div class="grid2"><div><label class="f" for="spp">Předpona čísla</label><input id="spp" value="${esc(settings.payPrefix||'')}" placeholder="${new Date().getFullYear()}-"></div><div><label class="f" for="spn">Další číslo</label><input id="spn" inputmode="numeric" value="${esc(settings.payNext||1)}"></div></div>
    <div class="actions" style="margin-top:10px"><button class="pri" data-a="saveissuer">Uložit</button>${settings.signature?'<button class="danger" data-a="delsig">Smazat uložený podpis</button>':''}</div>
  </div></div>
  <div class="card"><div class="pad">
    <b>EET 2.0 (evidence tržeb)</b>
    <p class="note2">Týká se jen toho, kdo platbu přijímá jako podnikatel. Platby převodem na účet se neevidují.</p>
    <label class="f" for="em">Režim</label>
    <select id="em"><option value="off"${settings.eetMode==='off'?' selected':''}>Vypnuto – appku používají hosté / netýká se mě</option><option value="moje"${settings.eetMode==='moje'?' selected':''}>MOJE EET – malý provoz bez pokladny (ručně ve státní aplikaci)</option><option value="server"${settings.eetMode==='server'?' selected':''}>Automaticky přes vlastní EET server (certifikát)</option></select>
    ${settings.eetMode==='moje'?`<label class="f" for="emu">Adresa aplikace MOJE EET</label><input id="emu" value="${esc(settings.eetMojeUrl||'https://eet.gov.cz')}"><p class="note2">Po potvrzení platby appka zkopíruje částku a otevře MOJE EET, kde tržbu zaevidueš.</p>`:`<input id="emu" type="hidden" value="${esc(settings.eetMojeUrl||'')}">`}
    ${settings.eetMode==='server'?`
    <label class="f" for="eu">Adresa EET serveru</label><input id="eu" inputmode="url" value="${esc(settings.eetUrl||'')}" placeholder="https://moje-eet-brana.onrender.com">
    <label class="f" for="et">Token serveru</label><input id="et" type="password" value="${esc(settings.eetToken||'')}">
    <div class="grid2"><div><label class="f" for="ej">ID evidenční jednotky</label><input id="ej" inputmode="numeric" value="${esc(settings.eetJednotka||'')}" placeholder="z DIS+"></div><div><label class="f" for="ep">ID pokladny (tento telefon)</label><input id="ep" value="${esc(settings.eetPokl||'')}"></div></div>
    <label class="chk"><input type="checkbox" id="eo" ${settings.eetOvereni?'checked':''}> Ověřovací režim (jen kontrola dat, nic se neeviduje)</label>
    <div class="actions"><button data-a="testeet">Otestovat spojení</button></div><p class="status" id="est"></p>`:
    `<input id="eu" type="hidden" value="${esc(settings.eetUrl||'')}"><input id="et" type="hidden" value="${esc(settings.eetToken||'')}"><input id="ej" type="hidden" value="${esc(settings.eetJednotka||'')}"><input id="ep" type="hidden" value="${esc(settings.eetPokl||'')}"><input id="eo" type="checkbox" hidden ${settings.eetOvereni?'checked':''}>`}
    <div class="actions" style="margin-top:10px"><button class="pri" data-a="saveeet">Uložit EET</button></div>
  </div></div>
  <div class="card"><div class="pad">
    <b>Čtení čárek (AI nebo v telefonu)</b>
    ${claudeAI?'<p class="status ok">Běží v Claude: čárky čte Claude přes tvůj účet, klíč není potřeba. Pokud níže vložíš klíč Gemini, použije se ten.</p>':''}
    <label class="f" for="sprov">Kdo čte fotky</label>
    <select id="sprov"><option value="gemini"${isOAI()?'':' selected'}>Google Gemini (bezplatný klíč)</option><option value="oai"${isOAI()?' selected':''}>Jiný poskytovatel AI (OpenAI-kompatibilní)</option></select>
    ${isOAI()?`<div class="oai">
      <p class="note2">Zadej adresu, klíč a model, který umí číst obrázky. Ne každý poskytovatel dovolí volání přímo z prohlížeče – použij Vyzkoušet.</p>
      <label class="f" for="soprs">Předvolba</label><select id="soprs"><option value="">— vyber —</option><option value="https://openrouter.ai/api/v1">OpenRouter</option><option value="https://api.mistral.ai/v1">Mistral</option><option value="https://api.groq.com/openai/v1">Groq</option><option value="https://api.openai.com/v1">OpenAI</option></select>
      <label class="f" for="sourl">Adresa (base URL)</label><input id="sourl" value="${esc(settings.oaiUrl||'')}" placeholder="https://…/v1">
      <label class="f" for="sokey">Klíč</label><input id="sokey" type="password" autocomplete="off" value="${esc(settings.oaiKey||'')}">
      <label class="f" for="somod">Model (s podporou obrázků)</label><input id="somod" value="${esc(settings.oaiModel||'')}" placeholder="název modelu u poskytovatele">
      <div class="actions" style="margin-top:10px"><button class="pri" data-a="saveoai">Uložit</button><button data-a="testoai">Vyzkoušet</button></div><p class="status" id="ost"></p></div>`:''}
    <div ${isOAI()?'hidden':''}>
    <p class="note2"><b>Google Gemini (zdarma)</b> – pro verzi mimo Claude (GitHub, kolega).</p>
    <p class="note2">Bezplatný klíč získáš na <b>aistudio.google.com</b> → Get API key → Create API key (stačí Google účet). Klíč se uloží jen v tomto telefonu.</p>
    <label class="f" for="sk">API klíč</label><input id="sk" type="password" autocomplete="off" value="${esc(settings.aiKey||'')}" placeholder="AIza…">
    <p class="note2" style="margin:6px 0 0">${settings.aiKey?(memMode?'<b style="color:var(--red)">⚠ Klíč platí jen do zavření – telefon nedovolil ukládat. Nejsi v anonymním okně Safari?</b>':'<b style="color:var(--ok)">✓ Klíč je uložený v telefonu</b>'):'Klíč se uloží hned po vložení.'} Na iPhonu má aplikace z ikony na ploše <b>vlastní</b> úložiště, oddělené od Safari – klíč vlož v appce spuštěné z ikony.</p>
    <label class="f" for="sk2">Záložní klíče Gemini (jeden na řádek)</label>
    <textarea id="sk2" rows="2" placeholder="další klíč z jiného Google účtu/projektu">${esc(settings.aiKeys2||'')}</textarea>
    <p class="note2" style="margin:2px 0 8px">Když jeden klíč vyčerpá denní limit, appka sama přepne na další.${allKeys().length>1?` Dnes používá klíč č. ${Math.min((settings.keyIdx||0),allKeys().length-1)+1} z ${allKeys().length}.`:''}</p>
    </div>
    <label class="f" for="srm">Způsob čtení</label>
    <select id="srm"><option value="fast"${!settings.readMode||settings.readMode==='fast'?' selected':''}>Rychlé – 2 dotazy (najít + spočítat ve výřezech), doporučeno</option><option value="exact"${settings.readMode==='exact'?' selected':''}>Důkladné – přepočet a kontrola úplnosti, 3–5 dotazů, pomalé</option><option value="local"${settings.readMode==='local'?' selected':''}>Bez AI – v telefonu: řádek označíš prstem, čárky spočítá telefon (offline, bez limitu)</option></select>
    <p class="note2" style="margin:2px 0 8px">U rychlého čtení appka nejasná místa jen označí žlutě a projdeš je při kontrole.</p>
    <label class="chk" style="margin-top:10px"><input type="checkbox" id="sfree" ${freeOn()?'checked':''}> <b>Bezplatný klíč – pravidla proti chybám</b></label>
    <p class="note2" style="margin:2px 0 8px">Dotazy na Google jdou po jednom s odstupem <input id="sfgap" inputmode="numeric" value="${esc(settings.freeGap||6)}" style="width:3em"> s, aby nenarazily na minutový limit. Appka nepřepíná na méně přesné „lite“ modely – když dojde limit, raději to řekne. Jedna fotka = asi 4–6 dotazů.${settings.useDay===new Date().toISOString().slice(0,10)?` Dnes odesláno <b>${settings.useN||0}</b> ${plur(settings.useN||0,'dotaz','dotazy','dotazů')}.`:''}</p>
    <label class="f" for="sm">Model (nech prázdné = automaticky)</label><input id="sm" value="${esc(settings.aiModel||'')}" placeholder="${DEF_MODELS[0]}">
    <div class="actions" style="margin-top:10px"><button class="pri" data-a="savekey">Uložit klíč</button><button data-a="testkey">Vyzkoušet</button>${settings.aiKey?'<button data-a="sharekey">Odkaz pro kolegu (s klíčem)</button><button class="danger" data-a="delkey">Smazat klíč</button>':''}</div>
    <p class="status" id="kst"></p>
  </div></div>
  <div class="card"><div class="pad">
    <b>Záloha a přenos</b>
    <p class="note2">Data jsou jen v tomto telefonu. Občas si udělej zálohu, stejně tak před smazáním appky nebo při výměně telefonu.</p>
    <div class="actions"><button data-a="export">Uložit zálohu (soubor)</button><label class="btn" style="position:relative">Načíst zálohu<input type="file" accept=".json,application/json" data-import style="position:absolute;inset:0;opacity:0"></label></div>
    <p class="status" id="bst"></p><p class="note2" id="sinfo"></p>
  </div></div>
  <div class="card"><div class="pad">
    <b>Aktualizace aplikace</b>
    <p class="note2">Máš verzi <b>${APP_VER}</b>. Tlačítko stáhne nejnovější verzi a appku restartuje. Účtenky, dluhy, klíč ani nastavení se nesmažou.</p>
    <div class="actions"><button class="pri" data-a="reboot">Aktualizovat a restartovat</button></div>
    <p class="status" id="rbst"></p>
  </div></div>
  <div class="card"><div class="pad">
    <b>Log běhu (pro hledání chyb)</b>
    <p class="note2">Záznam posledních kroků appky. Když něco nefunguje, zkopíruj ho a pošli vývojáři. Neobsahuje fotky ani klíče.</p>
    <div class="actions"><button class="pri" data-a="copylog">Kopírovat log</button><button data-a="showlog">Zobrazit</button><button class="danger" data-a="clearlog">Smazat</button></div>
    <pre id="logv" hidden style="max-height:320px;overflow:auto;font-size:11px;white-space:pre-wrap;background:var(--bg);padding:8px;border-radius:8px;margin-top:8px"></pre>
  </div></div>
  <div class="card"><div class="pad">
    <b>Jak se počítá</b>
    <p class="note2">Každá čárka je 1 kus, přeškrtnuté 4 čárky jsou 5 kusů. U řádku klepni na <b>Počítat</b> nebo <b>Ukázat</b>. Na zvětšené fotce pak klepáním na + odpočítáš čárky jednu po druhé, u přeškrtnuté skupiny dáš +5. Řádek si můžeš na fotce označit tažením prstem.</p>
    <p class="note2">Appka funguje bez internetu. Přidej si ji na plochu: v Safari Sdílet → Přidat na plochu.</p>
  </div></div>`;
  storageInfo().then(t=>{const e=$('sinfo');if(e)e.textContent=t});
}

/* ---------- actions ---------- */
function newReceipt(){
  const r={id:uid(),name:person||'',date:today(),status:'open',note:'',photos:[],rows:[],createdAt:Date.now(),updatedAt:Date.now()};
  receipts.push(r);save(r);curId=r.id;curPhoto=0;view='detail';render();scrollTo(0,0);
  setTimeout(()=>{const e=$('rn');e&&!r.name&&e.focus()},60);
}
function receiptText(r){const s=totR(r);const ps=pays(r);return [`Účtenka: ${r.name||'Bez jména'} (${fmtD(r.date)})${r.note?' – '+r.note:''}`,...rowsOf(r).filter(x=>+x.c).map(x=>`${x.p} Kč × ${x.c} = ${kc(x.p*x.c)}`),`Celkem: ${s[0]} ks = ${kc(s[1])}`,...ps.map(p=>`Zaplaceno ${fmtD(p.date)} (${p.method}): ${kc(p.amount)}`),...(ps.length?[dueR(r)>0?`Zbývá doplatit: ${kc(dueR(r))}`:'Zaplaceno celé.']:[])].join('\n')}
function summaryText(list){const bp=byPrice(list);let q=0,t=0;bp.forEach(([p,c])=>{q+=c;t+=p*c});return ['Souhrn účtenek',...list.map(r=>{const s=totR(r);return `${r.name||'Bez jména'} (${fmtD(r.date)}): ${s[0]} ks = ${kc(s[1])}`}),'',...bp.map(([p,c])=>`${p} Kč × ${c} = ${kc(p*c)}`),`Celkem: ${q} ks = ${kc(t)}`,'','(přeškrtnuté 4 čárky = 5 ks)'].join('\n')}
function logText(){return `Účtenky – log (${new Date().toLocaleString('cs-CZ')})\nnastavení: ai=${claudeAI?'claude(max '+claudeMax+')':settings.aiKey?'gemini '+(settings.aiModel||'auto'):'žádná'}, eet=${settings.eetMode}, úložiště=${memMode?'paměť':'IndexedDB'}, účtenek=${receipts.length}\n`+LOG.join('\n')}
async function copy(txt){try{await navigator.clipboard.writeText(txt);toast('Zkopírováno')}catch(e){toast('Kopírování nešlo',true)}}
let confirmCb=null;
function ask(title,msg,yes,cb){$('ct').textContent=title;$('cm').textContent=msg;$('cyes').textContent=yes;confirmCb=cb;$('conf').showModal()}
$('cno').onclick=()=>$('conf').close();
$('cyes').onclick=()=>{$('conf').close();confirmCb&&confirmCb()};

/* ---------- photos ---------- */
function loadImg(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('obrázek se nepodařilo načíst (málo paměti?)'));i.src=src})}
async function shrink(blobIn,max,q){
  const url=URL.createObjectURL(blobIn);
  try{const img=await loadImg(url);const s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*s);c.height=Math.round(img.naturalHeight*s);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    const w=c.width,h=c.height;const blob=await canvasBlob(c,q);return {blob,w,h}}
  finally{URL.revokeObjectURL(url)}
}
async function addPhotos(files){
  const r=getR(curId);if(!r)return;
  for(const f of files){
    log('INFO','fotka vybrána',{typ:f.type,kB:Math.round(f.size/1024)});
    try{const {blob,w,h}=await shrink(f,2400,.85);const id=uid();log('INFO','fotka zmenšena',{w,h,kB:Math.round(blob.size/1024)});
      memPhotos.set(id,blob);
      if(!memMode){const buf=await blob.arrayBuffer();await tx('photos','readwrite',s=>s.put({id,buf,type:blob.type||'image/jpeg'})).catch(e=>goMem(e))}
      photoURLs.set(id,URL.createObjectURL(blob));
      r.photos=[...(r.photos||[]),{id,w,h}];curPhoto=r.photos.length-1;save(r);render();
    }catch(e){log('CHYBA','uložení fotky',errInfo(e));toast('Fotku se nepodařilo uložit.',true);return}
  }
  toast('Fotka uložená');
}
async function delPhotoData(pid){memPhotos.delete(pid);try{if(idb&&!memMode)await tx('photos','readwrite',s=>s.delete(pid))}catch(e){}const u=photoURLs.get(pid);if(u){URL.revokeObjectURL(u);photoURLs.delete(pid)}}

/* ---------- zoom / counting / marking ---------- */
let zCur=null,zMode='row',zLevel=1,drag=null;
const padBox=(b,m,H)=>{const x1=Math.max(0,b[0]-m),y1=Math.max(0,b[1]*H-m),x2=Math.min(1,b[2]+m),y2=Math.min(H,b[3]*H+m);return[x1,y1,x2-x1,y2-y1]};
let tapMarks=[],tap5=false;
function autoZoom(r,x){if(!x||!x.box)return 1;const p=(r.photos||[])[x.ph||0];const H=p&&p.w?p.h/p.w:1.4;const ar=((x.box[3]-x.box[1])*H+.04)/((x.box[2]-x.box[0])+.04);return ar<.18?3:ar<.35?2:1}
function flagList(r){return rowsOf(r).map((x,i)=>x.q?i:-1).filter(i=>i>=0)}
function renderZoom(){
  const r=getR(curId);if(!r)return $('zoom').close();const x=rowsOf(r)[zCur];if(!x)return $('zoom').close();
  const hasPh=(r.photos||[]).length>0;
  if(x.ph==null||x.ph>=(r.photos||[]).length)x.ph=Math.min(curPhoto,Math.max(0,(r.photos||[]).length-1));
  const p=(r.photos||[])[x.ph||0];const H=p&&p.w?p.h/p.w:1.4;
  const fl=flagList(r);const k=fl.indexOf(zCur);
  $('zprog').textContent=x.q?`Sporné místo · ${fl.length===1?'poslední':'zbývá '+fl.length}`:fl.length?`Řádek ${zCur+1} · zbývá ${fl.length} sporných`:`Řádek ${zCur+1} / ${rowsOf(r).length}`;
  $('zprog').className='zprog'+(x.q?'':' okrow');
  $('zt').innerHTML=`<button id="zpe" class="zpbtn${x.pq?' bad':''}">${esc(x.p)} Kč ✎</button>`+(r.name?` <span class="note2" style="color:inherit">· ${esc(r.name)}</span>`:'');
  const showP=zPrice||x.pq;const cands=[...new Set([...(x.palts||[]),...priceList()])].filter(v=>v!==+x.p);
  $('zpr').innerHTML=showP?`<div class="note2" style="width:100%">${x.pq?'<b>Sporná cena.</b> ':''}Jaká je správná cena tohoto řádku?</div>`+[+x.p,...cands].slice(0,10).map(v=>`<button data-zp="${v}"${v===+x.p?' class="on"':''}>${v}${v===+x.p?' ✓':''}</button>`).join('')+'<button data-zp="jina">Jiná…</button>':'';
  const see=zMode==='row'?seeHTML(x):'';$('zsee').innerHTML=see;const seeTwo=see.includes('data-alt');
  $('zw').textContent=x.q&&!seeTwo&&!x.pq?(x.note||'Zkontroluj počet čárek.'):x.pq?'':'';
  $('zalts').innerHTML=!seeTwo&&x.q&&x.alts&&x.alts.length>1?x.alts.map(v=>`<button data-alt="${v}"${v===+x.c?' style="background:var(--penbg);color:#fff"':''}>${v} ks</button>`).join(''):'';
  if(zMode==='spot')zMode='row';if(zMode==='row'&&!x.box)zMode=hasPh?'mark':'row';if(zMode==='tap'&&!x.box)zMode='mark';
  document.querySelectorAll('#zoom [data-z]').forEach(b=>{b.setAttribute('aria-pressed',b.dataset.z===zMode);b.disabled=!hasPh||(!x.box&&(b.dataset.z==='row'||b.dataset.z==='tap'))});
  $('zmarkb').textContent=x.box?'✎ Přeznačit řádek':'✎ Označit řádek';
  let vb=null;if((zMode==='row'||zMode==='tap')&&x.box)vb=padBox(x.pbox?[Math.min(x.box[0],x.pbox[0]),Math.min(x.box[1],x.pbox[1]),Math.max(x.box[2],x.pbox[2]),Math.max(x.box[3],x.pbox[3])]:x.box,zMode==='row'&&(x.ga||x.bad)?.06:.02,H);
  $('zhint').textContent=zMode==='mark'?'Táhni prstem přes celý řádek.':zMode==='tap'?'Ťukni na každou čárku.':'';
  $('zlvl').textContent=zLevel+'×';
  const zb=$('zimg');zb.style.setProperty('--z',zMode==='mark'?1:zLevel);
  let svg=hasPh?svgPhoto(r,x.ph||0,vb,zMode==='mark'?'mark':zMode==='all'?'all':zMode==='tap'?'none':'one',zMode==='tap'?-1:zCur):'<p class="note2" style="color:#fff;padding:14px">K účtence není fotka – počítej tlačítky dole.</p>';
  if(zMode==='tap'&&hasPh){svg=svg.replace('class="phs','class="phs tap').replace('</svg>',tapMarks.map((m,i)=>{const R=(vb?vb[2]:1)*.035/Math.max(1,zLevel*.7);return `<circle class="mk${m[2]===5?' mk5':''}" cx="${m[0]}" cy="${m[1]}" r="${R}" style="stroke-width:${R*.18}"/><text class="mkt" x="${m[0]}" y="${m[1]}" style="font-size:${R*1.1}px">${m[2]===5?'5':tapMarks.slice(0,i+1).reduce((a,q)=>a+q[2],0)}</text>`}).join('')+'</svg>')}
  zb.innerHTML=svg;
  if(zMode==='row'&&vb&&zLevel>1){const d=seeDiff(x);const tx=[...[...d.a].map(k=>x.ga[k][0]),...(x.bad||[]).map(z=>z[0])].sort((a,b)=>a-b)[0];
    requestAnimationFrame(()=>{zb.scrollLeft=tx!=null?Math.max(0,(tx-vb[0])/vb[2]*zb.scrollWidth-zb.clientWidth/2):0})}
  $('ztapbar').hidden=zMode!=='tap';$('ztapn').textContent=tapMarks.reduce((a,m)=>a+m[2],0);$('ztap5').setAttribute('aria-pressed',tap5);
  $('zc').value=x.c;$('zsub').textContent=kc((+x.p||0)*(+x.c||0));
  $('zok').textContent=x.q?(fl.length>1?'Sedí ✓ Další ›':'Sedí ✓ Hotovo'):(fl.length?'Další sporné ›':'Hotovo ✓');
  $('zre').hidden=!(hasAI()&&x.box&&navigator.onLine);$('zsplitb').hidden=$('zre').hidden;$('zsplitb').classList.toggle('pri',!!(x.multi&&x.multi.length));
}
function openZoom(i){zCur=i;zPrice=false;if($('zsplit'))$('zsplit').hidden=true;const x=rowsOf(getR(curId))[i];zMode=x&&x.box?'row':'mark';zLevel=autoZoom(getR(curId),x);tapMarks=[];tap5=false;renderZoom();if(!$('zoom').open)$('zoom').showModal()}
function stepFlag(d){
  const r=getR(curId);const f=rowsOf(r).map((x,i)=>x.q?i:-1).filter(i=>i>=0);if(!f.length){$('zoom').close();openDone();return}
  let k=f.indexOf(zCur);if(k<0){k=f.findIndex(i=>i>zCur);if(k<0)k=0;if(d<0)k--}else k+=d;
  k=(k+f.length)%f.length;openZoom(f[k]);
}
$('zx').onclick=()=>$('zoom').close();
let zSplit=null;
function renderSplit(){const box=$('zsplit');const S=zSplit;if(!S)return;const r=getR(curId),x=rowsOf(r)[S.i];const t=S.rows.reduce((a,y)=>a+(+y.p||0)*(+y.c||0),0),n=S.rows.reduce((a,y)=>a+(+y.c||0),0);
  box.innerHTML=`<b>${S.ai?`AI tu vidí ${S.rows.length} ${plur(S.rows.length,'částku','částky','částek')}`:'Rozdělení řádku'} – oprav, co nesedí:</b>
  <div class="note2">Čárky bez vlastní ceny patří k poslední ceně před nimi (čteno po řádcích zleva doprava).</div>`+
  S.rows.map((y,k)=>`<div class="spr${y.q?' q':''}"><span class="spn">${k+1}</span>
    <button class="sppb" data-sp="${k}">${esc(y.p)} Kč ✎</button><span class="spx">×</span>
    <button data-spc="${k}" data-d="-1" aria-label="ubrat">−</button><input inputmode="numeric" data-spi="${k}" value="${esc(y.c)}" aria-label="počet"><button data-spc="${k}" data-d="1" aria-label="přidat">+</button>
    <button class="spdel" data-spdel="${k}" aria-label="odebrat">✕</button>
    ${S.pick===k?`<div class="sppick">${priceList().map(v=>`<button data-spv="${v}"${v===+y.p?' class="on"':''}>${v}</button>`).join('')}<button data-spv="jina">Jiná…</button></div>`:''}</div>`).join('')+
  `<button class="spadd" data-spadd="1">+ Přidat částku</button>
  <div class="sptot">Celkem <b>${n} ks · ${kc(t)}</b> <span class="note2">(dosud ${x?x.c+' ks · '+kc(x.p*x.c):''})</span></div>
  <div class="actions"><button class="pri" id="zspy">Uložit rozdělení</button><button id="zspn">Zrušit</button></div>`}
$('zsplit').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!zSplit)return;const S=zSplit;
  if(b.id==='zspn'){$('zsplit').hidden=true;zSplit=null;return}
  if(b.id==='zspy'){const keep=S.rows.filter(y=>+y.p>0&&+y.c>0);if(!keep.length){toast('Zadej aspoň jednu částku s počtem',true);return}
    const r=getR(curId);snap([r]);const rows=rowsOf(r);const orig=rows[S.i];
    keep.forEach(y=>{y.q=0;y.pq=0;y.alts=null;if(!y.box&&orig){y.box=orig.box;y.ph=orig.ph}if(y.ph==null&&orig)y.ph=orig.ph});
    rows.splice(S.i,1,...keep);r.rows=rows;save(r);$('zsplit').hidden=true;offerUndo(`Řádek rozdělen na ${keep.length} ${plur(keep.length,'položku','položky','položek')}`);
    const f=flagList(r);zSplit=null;if(f.length)openZoom(f.find(i=>i>=S.i)??f[0]);else{$('zoom').close();openDone()}return}
  if(b.dataset.sp!=null){S.pick=S.pick===+b.dataset.sp?null:+b.dataset.sp;renderSplit();return}
  if(b.dataset.spv!=null){let v=b.dataset.spv;if(v==='jina'){v=prompt('Cena v Kč','');if(v==null)return}v=num(v);if(v>0){const y=S.rows[S.pick];if(y.ai&&y.pai&&y.pai!==v)offerLearn(getR(curId),y,y.pai,v);y.p=v;y.pq=0}S.pick=null;renderSplit();return}
  if(b.dataset.spc!=null){const y=S.rows[+b.dataset.spc];y.c=Math.max(0,(+y.c||0)+(+b.dataset.d));renderSplit();return}
  if(b.dataset.spdel!=null){S.rows.splice(+b.dataset.spdel,1);S.pick=null;renderSplit();return}
  if(b.dataset.spadd){const last=S.rows[S.rows.length-1];S.rows.push({p:last?last.p:priceList()[0],c:0,ph:last?last.ph:0,box:null});S.pick=S.rows.length-1;renderSplit();return}
});
$('zsplit').addEventListener('change',e=>{const t=e.target;if(t.dataset.spi==null||!zSplit)return;zSplit.rows[+t.dataset.spi].c=num(t.value);renderSplit()});
$('zsplitb').onclick=async()=>{const r=getR(curId),x=rowsOf(r)[zCur];const p=(r.photos||[])[x.ph||0];
  const box=$('zsplit');box.hidden=false;setTimeout(()=>box.scrollIntoView({behavior:'smooth',block:'center'}),50);
  zSplit={i:zCur,rows:[{...x,spots:[]}],ai:false,pick:null};
  if(!(hasAI()&&navigator.onLine&&x.box&&p)){zSplit.rows.push({p:x.p,c:0,ph:x.ph,box:null});zSplit.pick=1;renderSplit();return}
  const b=$('zsplitb'),old=b.textContent;b.disabled=true;b.textContent='Čtu…';
  box.innerHTML='<div class="note2"><span class="spin"></span> AI znovu čte tohle místo a hledá všechny částky…</div><div class="actions"><button id="zspmanual">Rozdělit ručně</button></div>';
  let manual=false;$('zspmanual').onclick=()=>{manual=true;zSplit.rows.push({p:x.p,c:0,ph:x.ph,box:null});zSplit.pick=1;renderSplit()};
  try{const rec=await getOne('photos',p.id);const fimg=await imgFromBlob((await shrink(rec.blob,2400,.9)).blob);
    let sub=await regionRows(fimg,x.box,x.ph||0);if(!sub.length)throw{code:'empty',msg:'AI tu nenašla žádné částky'};sub=await countRows(sub,fimg);fixPrices(sub);
    if(manual||!zSplit)return;zSplit={i:zCur,rows:sub,ai:true,pick:null};renderSplit();box.scrollIntoView({behavior:'smooth',block:'center'})}
  catch(e){if(manual||!zSplit)return;zSplit.rows.push({p:x.p,c:0,ph:x.ph,box:null});renderSplit();box.insertAdjacentHTML('afterbegin',`<div class="status err">${esc(aiErr(e))} – rozděl ručně.</div>`)}
  finally{b.disabled=false;b.textContent=old}};
async function doLocal(r,i,quiet){const x=rowsOf(r)[i];if(!x||!x.box){toast('Nejdřív označ řádek na fotce (Označit)',true);return}
  try{const res=await localCountRow(r,x);const prev=+x.c||0;snap([r]);x.pts=res.pts;x.ga=null;x.gb=null;x.bad=[];
    if(prev&&prev!==res.c&&x.ai){x.q=1;x.alts=[...new Set([prev,res.c])].sort((a,b)=>a-b);x.note=`AI: ${prev}, telefon: ${res.c}. Zkontroluj tečky.`}
    else{x.q=res.unsure?1:0;x.alts=null;x.note=res.unsure?'Spočítáno v telefonu – nejisté (víc řádků nebo slité čárky), zkontroluj tečky.':'Spočítáno v telefonu – zkontroluj tečky.'}
    x.c=res.c;x.local=1;save(r);if(!quiet&&zMode==='tap'&&i===zCur){const p0=(r.photos||[])[x.ph||0]||{};const H0=(p0.h&&p0.w)?p0.h/p0.w:1.4;tapMarks=res.pts.map(p=>[p[0],p[1]*H0,1])}
    if(!quiet){renderZoom();offerUndo(`V telefonu: ${res.c} čárek`)}}
  catch(e){toast(errTxt(e)||'Spočítat se nepovedlo',true);log('CHYBA','v telefonu',errInfo(e))}}
$('zloc').onclick=()=>{doLocal(getR(curId),zCur)};
$('aloc').onclick=()=>{const r=getR(curId);$('ai').close();if(rowsOf(r).some(x=>x.box&&(x.ph||0)===curPhoto)){const b=document.querySelector('[data-a=localall]');b&&b.click()}else{settings.readMode='local';saveSettings();render();toast('Bez AI: klepni dole na cenu a na fotce táhni přes její čárky')}};
$('zdel').onclick=()=>{const r=getR(curId);if(!r)return;const x=rowsOf(r)[zCur];if(!x)return;snap([r]);r.rows=rowsOf(r).filter((_,k)=>k!==zCur);save(r);
  offerUndo(`Řádek ${x.p} Kč × ${x.c} smazán`);const n=rowsOf(r).length;if(!n){$('zoom').close();return}
  const f=flagList(r);if(f.length)openZoom(f.find(i=>i>=zCur)??f[0]);else openZoom(Math.min(zCur,n-1))};
$('zre').onclick=async()=>{const r=getR(curId),x=rowsOf(r)[zCur];const b=$('zre');b.disabled=true;const old=b.textContent;
  try{const res=await recountRow(r,zCur,t=>b.textContent=t);x.c=res.c;x.note=res.txt;if(res.sure)x.q=0;save(r);renderZoom();toast(res.txt)}
  catch(e){toast(aiErr(e),true)}finally{b.disabled=false;b.textContent=old}};
$('zoom').addEventListener('close',()=>render());
$('zoom').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;const r=getR(curId),x=rowsOf(r)[zCur];
  if(b.dataset.z){zMode=b.dataset.z;if(zMode==='tap'){const x0=rowsOf(getR(curId))[zCur];const p0=(getR(curId).photos||[])[x0.ph||0]||{};const H0=(p0.h&&p0.w)?p0.h/p0.w:1.4;tapMarks=x0&&x0.pts?x0.pts.map(p=>[p[0],p[1]*H0,1]):[];tap5=false;if(tapMarks.length)toast('Body AI jsou předvyplněné – klepnutím na bod ho odebereš, jinam přidáš')}renderZoom();return}
  if(b.dataset.zoom){zLevel=Math.min(4,Math.max(1,zLevel+(b.dataset.zoom==='+'?1:-1)));if(zMode==='mark')zMode=x.box?'row':'all';renderZoom();return}
  if(b.id==='zpe'){zPrice=!zPrice;renderZoom();return}
  if(b.dataset.zp){let v=b.dataset.zp;if(v==='jina'){v=prompt('Správná cena v Kč',x.p);if(v==null)return}v=num(v);if(!v)return;
    const old=+x.p;snap([r]);x.p=v;x.pq=0;x.palts=null;if(x.q&&!x.alts)x.q=0;zPrice=false;save(r);renderZoom();
    if(old!==v){const from=x.pai||old;offerLearn(r,x,from,v);if(!x.ai)toast(`Cena nastavena ${v} Kč`)}return}
  if(b.dataset.alt){snap([r]);x.c=+b.dataset.alt;save(r);renderZoom();toast(`Nastaveno ${x.c} ks`);return}
  const d=b.dataset.d;if(!d)return;
  if(d==='+')x.c=(+x.c||0)+1;if(d==='-')x.c=Math.max(0,(+x.c||0)-1);if(d==='+5')x.c=(+x.c||0)+5;
  if(d==='prev')return stepFlag(-1);
  if(d==='ok'){if(x.q||x.pq){x.q=0;x.pq=0;x.alts=null;save(r)}const f=flagList(r);if(!f.length){$('zoom').close();openDone();return}return stepFlag(1)}
  save(r);$('zc').value=x.c;$('zsub').textContent=kc((+x.p||0)*(+x.c||0));
  if(navigator.vibrate)navigator.vibrate(8);
});
$('ztap5').onclick=()=>{tap5=!tap5;renderZoom()};
$('ztapundo').onclick=()=>{tapMarks.pop();renderZoom()};
$('ztapuse').onclick=()=>{const r=getR(curId),x=rowsOf(r)[zCur];const n=tapMarks.reduce((a,m)=>a+m[2],0);if(!n){toast('Nejdřív ťukni na čárky');return}snap([r]);x.c=n;save(r);zMode='row';renderZoom();offerUndo(`Nastaveno ${n} ks podle ťukání`)};
$('zc').addEventListener('change',e=>{const r=getR(curId),x=rowsOf(r)[zCur];x.c=num(e.target.value);save(r);renderZoom()});
const zimg=$('zimg');
function svgPt(svg,ev){const pt=svg.createSVGPoint();pt.x=ev.clientX;pt.y=ev.clientY;const m=svg.getScreenCTM();if(!m)return null;const q=pt.matrixTransform(m.inverse());return[q.x,q.y]}
zimg.addEventListener('pointerdown',e=>{const svg=e.target.closest('svg.mark');if(!svg)return;e.preventDefault();svg.setPointerCapture(e.pointerId);const p=svgPt(svg,e);if(!p)return;drag={svg,a:p,b:p,H:+svg.dataset.h}});
zimg.addEventListener('pointermove',e=>{if(!drag)return;const p=svgPt(drag.svg,e);if(!p)return;drag.b=p;let n=drag.svg.querySelector('.nw');if(!n){n=document.createElementNS('http://www.w3.org/2000/svg','rect');n.setAttribute('class','nw');drag.svg.append(n)}
  n.setAttribute('x',Math.min(drag.a[0],p[0]));n.setAttribute('y',Math.min(drag.a[1],p[1]));n.setAttribute('width',Math.abs(p[0]-drag.a[0]));n.setAttribute('height',Math.abs(p[1]-drag.a[1]))});
zimg.addEventListener('pointerup',e=>{if(!drag)return;const {a,b,H}=drag;drag=null;
  if(Math.abs(b[0]-a[0])<.03||Math.abs(b[1]-a[1])<.01){toast('Táhni prstem přes celý řádek.');return}
  const cl=v=>Math.min(1,Math.max(0,v));const r=getR(curId),x=rowsOf(r)[zCur];
  x.box=[cl(Math.min(a[0],b[0])),cl(Math.min(a[1],b[1])/H),cl(Math.max(a[0],b[0])),cl(Math.max(a[1],b[1])/H)];x.ph=x.ph||0;
  save(r);zMode='row';zLevel=2;if(!(+x.c>0)){doLocal(r,zCur)}else{renderZoom();toast('Řádek označen – teď počítej čárky')}});
zimg.addEventListener('click',e=>{const svg=e.target.closest('svg.tap');if(svg){const p=svgPt(svg,e);if(!p)return;
    const hit=tapMarks.findIndex(m=>Math.hypot(m[0]-p[0],m[1]-p[1])<.012);if(hit>=0){tapMarks.splice(hit,1)}else{tapMarks.push([p[0],p[1],tap5?5:1]);tap5=false}
    if(navigator.vibrate)navigator.vibrate(6);const sl=zimg.scrollLeft,st=zimg.scrollTop;renderZoom();zimg.scrollLeft=sl;zimg.scrollTop=st;return}
  const rc=e.target.closest('rect[data-i]');if(rc){openZoom(+rc.dataset.i)}});

/* ---------- AI (Gemini) ---------- */
let aiCtl=null,aiResult=null;
const b64=b=>blobToDataURL(b).then(d=>d.split(',')[1]);
async function cropBlob(img,y0,y1){const c=document.createElement('canvas');const W=img.naturalWidth,Hh=img.naturalHeight;const sy=Math.round(y0*Hh),sh=Math.round((y1-y0)*Hh);const s=Math.min(1,1600/W);c.width=Math.round(W*s);c.height=Math.round(sh*s);c.getContext('2d').drawImage(img,0,sy,W,sh,0,0,c.width,c.height);return await canvasBlob(c,.88)}
function canvasBlob(c,q){return new Promise((res,rej)=>c.toBlob(b=>{c.width=c.height=0;b?res(b):rej(new Error('obrázek se nepodařilo zmenšit (málo paměti?)'))},'image/jpeg',q))}
async function capMP(blob,mp){try{return await capMP0(blob,mp)}catch(e){return blob}}
async function capMP0(blob,mp){const img=await imgFromBlob(blob);const px=img.naturalWidth*img.naturalHeight;if(px<=mp)return blob;const s=Math.sqrt(mp/px);
  const c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*s);c.height=Math.round(img.naturalHeight*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);return await canvasBlob(c,.88)}
async function aiCall(parts,signal,json){
  if(claudeAI&&!extAI()){
    const imgs=[];let txt='';let n=0;
    for(const p of parts){if(p.text)txt+=p.text+'\n';else if(p.inline_data){n++;txt+=`[obrázek ${n}]\n`;imgs.push(await capMP(b64ToBlob(p.inline_data.data,p.inline_data.mime_type),1.15e6))}}
    txt+='\nObrázky jsou přiloženy ve stejném pořadí, v jakém jsou v textu značky [obrázek N].';
    const t=Date.now();log('INFO','Claude dotaz',{znaku:txt.length,obrazku:imgs.length,velikosti:imgs.map(b=>Math.round(b.size/1024)+'kB')});
    try{const r=await claudeAI(txt,{images:imgs,modelTier:'default',cache:false,signal});log('INFO','Claude odpověď',{ms:Date.now()-t,znaku:r.text.length,truncated:r.truncated,tier:r.modelTierApplied,zacatek:r.text.slice(0,200)});return r.text}
    catch(e){log('CHYBA','Claude selhal',{ms:Date.now()-t,...errInfo(e),text:e&&e.text?String(e.text).slice(0,200):undefined});if(e&&e.code==='cancelled')throw{name:'AbortError'};if(e&&(e.code==='not_granted'||e.code==='sampling_disabled'))throw{code:'key',msg:'Claude tu není povolený'};if(e&&e.code==='rate_limited')throw{code:429};throw{code:0,msg:e&&e.code==='upstream_error'?'spojení s Claudem se přerušilo. Nech displej rozsvícený a appku v popředí':(e&&(e.code?e.code+': ':'')+(e.message||''))||'neznámá chyba'}}
  }
  return gQueue(()=>isOAI()?oaiCall(parts,signal,json):geminiKeys(parts,signal,json),signal);
}
/* ---------- pravidla pro bezplatný klíč: dotazy po jednom s odstupem, denní počítadlo ---------- */
const freeOn=()=>settings.freeMode!==false;
let gChain=Promise.resolve(),gLast=0;
function gQueue(fn,signal){const run=gChain.then(async()=>{
    if(signal&&signal.aborted)throw{name:'AbortError'};
    if(freeOn()){const gap=Math.max(1,+settings.freeGap||6)*1000;const w=gLast+gap-Date.now();
      if(w>0){aiChunk&&aiChunk(-Math.ceil(w/1000),false);await new Promise((ok,ko)=>{const t=setTimeout(ok,w);signal&&signal.addEventListener('abort',()=>{clearTimeout(t);ko({name:'AbortError'})},{once:true})});aiChunk&&aiChunk(0,false)}}
    gLast=Date.now();countUse();return await fn()});
  gChain=freeOn()?run.catch(()=>{}):gChain;return run}
function countUse(){const d=new Date().toISOString().slice(0,10);if(settings.useDay!==d){settings.useDay=d;settings.useN=0}settings.useN=(settings.useN||0)+1;saveSettings()}
const maxImgs=()=>claudeAI&&!extAI()?Math.max(2,claudeMax-1):30;
const GAPI='https://generativelanguage.googleapis.com/v1beta';
/* fetch na Google: nejdřív s klíčem v hlavičce, při síťové chybě (Safari „Load failed“) znovu s klíčem v adrese */
async function gfetch(url,opt={}){
  try{return await fetch(url,{...opt,headers:{...(opt.headers||{}),'x-goog-api-key':curKey()}})}
  catch(e){if(e&&e.name==='AbortError')throw e;log('VAROV','Google fetch (hlavička) selhal',errInfo(e));
    const h={...(opt.headers||{})};
    try{return await fetch(url+(url.includes('?')?'&':'?')+'key='+encodeURIComponent(curKey()),{...opt,headers:h})}
    catch(e2){if(e2&&e2.name==='AbortError')throw e2;log('CHYBA','Google fetch (key v adrese) selhal',errInfo(e2));
      throw{code:'net',msg:navigator.onLine?'Google spojení odmítl. Nejčastěji je to neplatným nebo nepovoleným klíčem':'Jsi offline'}}}
}
async function gErr(res){let msg='',quota=null;try{const d=await res.json();msg=(d.error&&(d.error.status?d.error.status+': ':'')+(d.error.message||''))||'';
  if(res.status===429){quota={day:false,min:false,zero:/limit: ?0\b/.test(msg),retry:0};for(const x of (d.error&&d.error.details)||[]){
    if(/RetryInfo/.test(x['@type']||'')&&x.retryDelay)quota.retry=parseFloat(x.retryDelay)||0;
    for(const v of x.violations||[]){const id=String(v.quotaId||v.quotaMetric||'');if(/PerDay/i.test(id))quota.day=true;if(/PerMinute/i.test(id))quota.min=true;if(String(v.quotaValue)==='0')quota.zero=true}}
    const rm=msg.match(/retry in ([\d.]+)s/i);if(rm&&!quota.retry)quota.retry=parseFloat(rm[1])}}catch(e){}return{code:res.status,msg,quota}}
/* zjistí modely, které klíč smí použít, a seřadí je od nejlepšího */
async function listModels(){
  const res=await gfetch(GAPI+'/models?pageSize=200');
  if(!res.ok){const e=await gErr(res);log('CHYBA','Gemini seznam modelů',e);if(res.status===400||res.status===401||res.status===403)throw{code:'key',msg:e.msg};throw e}
  const d=await res.json();
  const ver=n=>{const m=n.match(/gemini-(\d+)(?:\.(\d+))?/);return m?(+m[1])*100+(+(m[2]||0)):0};
  const ok=(d.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>m.name.replace(/^models\//,''))
    .filter(n=>/^gemini/.test(n)&&!/tts|image|live|audio|transcribe|embed|robotics|omni|translate|computer|exp/i.test(n));
  const score=n=>ver(n)*10+(/flash/.test(n)?5:0)-(/lite/.test(n)?3:0)-(/preview/.test(n)?2:0)-(/pro/.test(n)?1:0);
  const list=ok.sort((a,b)=>score(b)-score(a));
  log('INFO','Gemini modely',list.slice(0,8));
  return list;
}
let aiChunk=null,lastModel='';
/* víc Gemini klíčů: při denním limitu / limitu 0 / neplatném klíči přepnout na další */
async function geminiKeys(parts,signal,json){const n=allKeys().length;
  for(let t=0;;t++){try{return await gemini(parts,signal,json)}catch(e){
    const quota=e&&e.code===429&&e.quota&&(e.quota.day||e.quota.zero);const bad=e&&e.code==='key';
    if((quota||bad)&&t<n-1&&(settings.keyIdx||0)<n-1){settings.keyIdx=(settings.keyIdx||0)+1;saveSettings();log('INFO','přepínám na další klíč',{cislo:settings.keyIdx+1,z:n,duvod:quota?'limit':'klíč'});continue}
    throw e}}}
/* jiný poskytovatel – OpenAI-kompatibilní rozhraní (chat/completions s obrázkem) */
async function oaiCall(parts,signal,json){const url=String(settings.oaiUrl||'').replace(/\/+$/,'')+'/chat/completions';
  const content=parts.map(p=>p.text!=null?{type:'text',text:p.text}:{type:'image_url',image_url:{url:`data:${p.inline_data.mime_type};base64,${p.inline_data.data}`}});
  const tc=new AbortController();let timedOut=false;const tmo=setTimeout(()=>{timedOut=true;tc.abort()},(+settings.aiTimeout||90)*1000);const onAb=()=>tc.abort();signal&&signal.addEventListener('abort',onAb,{once:true});
  const send=async rf=>fetch(url,{method:'POST',signal:tc.signal,headers:{'Content-Type':'application/json','Authorization':'Bearer '+settings.oaiKey,'X-Title':'Uctenky'},
    body:JSON.stringify({model:settings.oaiModel,messages:[{role:'user',content}],temperature:0,...(rf?{response_format:{type:'json_object'}}:{})})});
  const t0=Date.now();
  try{let res;try{res=await send(json&&!settings.oaiNoRF)}catch(e){if(timedOut)throw{code:'busy',msg:'Poskytovatel neodpověděl včas'};if(e&&e.name==='AbortError')throw e;
        throw{code:'net',msg:navigator.onLine?'Spojení s poskytovatelem selhalo (špatná adresa, nebo nepovoluje volání z prohlížeče)':'Jsi offline'}}
    if(res.status===400&&json&&!settings.oaiNoRF){const tx=await res.clone().text();if(/response_format|json_object/i.test(tx)){settings.oaiNoRF=true;saveSettings();res=await send(false)}}
    log('INFO','AI '+settings.oaiModel,{status:res.status,ms:Date.now()-t0});
    if(!res.ok){let msg='';try{const d=await res.json();msg=(d.error&&(d.error.message||d.error))||JSON.stringify(d).slice(0,200)}catch(e){}
      if(res.status===401||res.status===403)throw{code:'key',msg:String(msg)};if(res.status===429)throw{code:429,msg:String(msg),quota:{min:!/day|daily|den/i.test(msg),day:/day|daily/i.test(msg)}};
      if(res.status>=500)throw{code:'busy',msg:String(msg)};throw{code:res.status,msg:String(msg)}}
    const d=await res.json();const m=d.choices&&d.choices[0]&&d.choices[0].message;let t=m?(typeof m.content==='string'?m.content:(m.content||[]).map(c=>c.text||'').join('')):'';
    if(!t)throw{code:'empty',msg:'poskytovatel vrátil prázdnou odpověď'};aiChunk&&aiChunk(t.length,false);lastModel=settings.oaiModel;return t}
  finally{clearTimeout(tmo);signal&&signal.removeEventListener('abort',onAb)}} /* callback(znaků) pro průběh */
function thinkCfg(m){const mr=settings.noMediaRes||settings.readMode!=='exact'?{}:{mediaResolution:'MEDIA_RESOLUTION_HIGH'};if(settings.noThink)return mr;if(/gemini-[3-9]/.test(m))return{...mr,thinkingConfig:{thinkingLevel:settings.readMode!=='exact'&&!settings.noMinimal?'minimal':'low'}};if(/gemini-2\.5-flash/.test(m))return{...mr,thinkingConfig:{thinkingBudget:0}};return mr}
function thinkCfg_old(m){if(settings.noThink)return{};if(/gemini-[3-9]/.test(m))return{thinkingConfig:{thinkingLevel:'low'}};if(/gemini-2\.5-flash/.test(m))return{thinkingConfig:{thinkingBudget:0}};return{}}
async function readSSE(res,onChunk){
  const rd=res.body.getReader();const dec=new TextDecoder();let buf='',txt='';
  for(;;){const {done,value}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let k;
    while((k=buf.indexOf('\n'))>=0){const line=buf.slice(0,k).trim();buf=buf.slice(k+1);if(!line.startsWith('data:'))continue;
      try{const d=JSON.parse(line.slice(5));if(d.error)throw{code:d.error.code||0,msg:d.error.message};const ps=(d.candidates&&d.candidates[0]&&d.candidates[0].content&&d.candidates[0].content.parts)||[];
        for(const p of ps){if(p.thought){onChunk&&onChunk(txt.length,true);continue}if(p.text){txt+=p.text;onChunk&&onChunk(txt.length,false)}}}catch(e){if(e&&e.msg)throw e}}}
  return txt;
}
async function gemini(parts,signal,json){
  let models=settings.aiModel?[settings.aiModel]:[...DEF_MODELS];let last;let listed=false;let triedNoThink=false;const waited={};let q429=null,busy=null;
  const pause=async w=>{aiChunk&&aiChunk(-w,false);await new Promise((ok,ko)=>{const t=setTimeout(ok,w*1000);signal&&signal.addEventListener('abort',()=>{clearTimeout(t);ko({name:'AbortError'})},{once:true})});aiChunk&&aiChunk(0,false)};
  const more=async lite=>{if(listed)return;listed=true;try{const l=await listModels();let rest=l.filter(x=>!models.includes(x)&&!/tts|image|embed|live|audio|veo|imagen/i.test(x));if(freeOn()){rest=rest.filter(x=>!/lite|pro|ultra|thinking|deep/i.test(x));rest.sort((a,b)=>(/2\.5-flash$/.test(b)?1:0)-(/2\.5-flash$/.test(a)?1:0));lite=false}if(lite)rest.sort((a,b)=>(/lite/.test(b)?1:0)-(/lite/.test(a)?1:0));models.push(...rest.slice(0,5))}catch(e){if(e.code==='key')throw e}};
  for(let i=0;i<models.length;i++){const m=models[i];const t0=Date.now();
    const stream=!!(window.ReadableStream&&TextDecoder);const cb=aiChunk;
    const tc=new AbortController();let timedOut=false;let tmo=setTimeout(()=>{timedOut=true;tc.abort()},(+settings.aiTimeout||60)*1000);/* do 1. odpovědi max 60 s; když data tečou, utnout až po 25 s ticha */
    const kick=()=>{clearTimeout(tmo);tmo=setTimeout(()=>{timedOut=true;tc.abort()},25000)};const onAb=()=>tc.abort();signal&&signal.addEventListener('abort',onAb,{once:true});
    let res;try{res=await gfetch(`${GAPI}/models/${encodeURIComponent(m)}:${stream?'streamGenerateContent?alt=sse':'generateContent'}`,{method:'POST',signal:tc.signal,headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contents:[{role:'user',parts}],generationConfig:{temperature:0,...thinkCfg(m),...(json?{responseMimeType:'application/json'}:{})}})})}
    catch(e){if(!timedOut){clearTimeout(tmo);throw e}res=null}
    const done=()=>{clearTimeout(tmo);signal&&signal.removeEventListener('abort',onAb)};
    if(!res){done();last={code:504,msg:`Google neodpověděl včas`};log('CHYBA','Gemini '+m,last);busy={code:'busy',msg:last.msg};const n=waited[m]||0;if(n<1){waited[m]=n+1;i--;continue}await more(false);continue}
    log('INFO','Gemini '+m,{status:res.status,stream});
    let st=res.status;
    if(res.ok){let t='';try{
      if(stream&&res.body){kick();t=await readSSE(res,(n,th)=>{kick();cb&&cb(n,th)})}else{const d=await res.json();t=(d.candidates&&d.candidates[0]&&d.candidates[0].content&&d.candidates[0].content.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('')}
      log('INFO','Gemini odpověď',{ms:Date.now()-t0,znaku:t.length});
      if(!t)throw{code:'empty',msg:'model vrátil prázdnou odpověď'};if(settings.aiModel!==m&&!q429){settings.aiModel=m;saveSettings()}done();lastModel=m;if(q429||busy)log('INFO','obejito jiným pokusem/modelem',m);return t
      }catch(e){done();if(timedOut){e={code:504,msg:`Google neodpověděl včas`}}else if(e&&(e.name==='AbortError'||e.code==='empty'))throw e;st=typeof e.code==='number'?e.code:503;last={code:st,msg:errTxt(e)};log('CHYBA','Gemini '+m+' (během odpovědi)',last)}}
    else{done();last=await gErr(res);log('CHYBA','Gemini '+m,last)}
    if(st>=500||/high demand|overloaded|UNAVAILABLE|try again later/i.test(last.msg||'')){busy={code:'busy',msg:last.msg};
      /* přetížený model: 2× počkat a zkusit znovu, pak jiný model */
      const n=waited[m]||0;if(n<1){waited[m]=n+1;const w=3;log('INFO','model přetížený – čekám',{s:w,model:m});await pause(w);i--;continue}
      await more(false);continue}
    if(st===400&&/minimal/i.test(last.msg)&&!settings.noMinimal){settings.noMinimal=true;saveSettings();i--;continue}
    if(st===400&&/media.?resolution/i.test(last.msg)&&!settings.noMediaRes){settings.noMediaRes=true;saveSettings();i--;continue}
    if(st===400&&/think/i.test(last.msg)&&!triedNoThink){triedNoThink=true;settings.noThink=true;saveSettings();i--;continue}
    if(st===400&&/api.?key/i.test(last.msg))throw{code:'key',msg:last.msg};
    if(st===401||st===403)throw{code:'key',msg:last.msg};
    if(st===429){const q=last.quota||{};q429=last;
      /* minutový limit: chvíli počkat a zkusit znovu stejný model */
      if(!q.day&&!q.zero&&(waited[m]||0)<2&&(q.retry||0)<=45){waited[m]=(waited[m]||0)+1;const w=Math.max(5,Math.ceil(q.retry||15));log('INFO','minutový limit – čekám',{s:w,model:m});await pause(w);i--;continue}
      if((q.day||q.zero)&&(settings.keyIdx||0)<allKeys().length-1)throw last; /* další klíč dřív než další model */
      /* denní limit / bez limitu: zkusit jiné modely (lite mívají vyšší limit) */
      await more(true);continue}
    if(st===404){await more(false);continue}
    throw last;
  }
  if(busy&&q429&&q429.quota&&q429.quota.zero)throw busy; /* záložní model bez bezplatného limitu nemá přebít skutečnou příčinu */
  throw q429||busy||last||{code:0};
}
function rowsOfJSON(d){if(!d)return[];if(Array.isArray(d))return d;for(const k of ['rows','items','polozky','položky','lines','radky','řádky','data'])if(Array.isArray(d[k]))return d[k];const v=Object.values(d).find(Array.isArray);return v||[]}
function parseJSON(t){try{return JSON.parse(t)}catch(e){}const a=t.indexOf('{'),b=t.lastIndexOf('}');if(a>=0&&b>a)try{return JSON.parse(t.slice(a,b+1))}catch(e){}return null}
const errTxt=e=>e==null?'':typeof e==='string'?e:(e.msg||e.message||(e.code!=null?'kód '+e.code:'')||(e.type?'událost '+e.type:'')||String(e));
function resetTxt(){try{const now=new Date();const pt=new Date(now.toLocaleString('en-US',{timeZone:'America/Los_Angeles'}));const mid=new Date(pt);mid.setHours(24,0,0,0);const at=new Date(now.getTime()+(mid-pt));const t=at.toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'});return (at.getDate()===now.getDate()?'dnes v ':'zítra v ')+t}catch(e){return 'v 9:00'}}
const quotaTxt=e=>{const q=e.quota||{};
  if(q.zero)return 'Google tomuto klíči nedává žádný bezplatný limit (limit 0). Vytvoř nový klíč na aistudio.google.com → Get API key → Create API key → „Create API key in new project“ a vlož ho sem. Klíč by měl začínat „AIza“.';
  if(q.day)return 'Dnešní bezplatný limit Googlu je vyčerpaný ('+(allKeys().length>1?'u všech '+allKeys().length+' klíčů':'u všech modelů, které klíč smí')+'). Obnoví se '+resetTxt()+'. Do té doby počítej čárky ručně, nebo použij jiný klíč (jiný Google účet).';
  return 'Google je teď přetížený nebo došel minutový limit. Zkus to za minutu.'+(e.msg?' ('+String(e.msg).slice(0,100)+')':'')};
const aiErr=e=>e&&e.name==='AbortError'?'Zastaveno.':e&&e.code==='net'?e.msg+(/^AIza/.test(settings.aiKey||'')?'.':'. Klíč Gemini má začínat „AIza“ – vytvoř nový na aistudio.google.com/app/apikey.'):e&&e.code==='key'?'Klíč nefunguje'+(e.msg?' ('+String(e.msg).slice(0,140)+')':'')+'. Zkontroluj ho v Nastavení.':e&&e.code===429?quotaTxt(e):e&&e.code==='busy'?'Google teď odpovídá moc pomalu nebo je přetížený'+(e.msg&&/neodpověděl/.test(e.msg)?' ('+e.msg+')':'')+'. Appka to zkusila znovu i s jiným modelem. Zkus to za pár minut – fotka zůstává uložená.':e&&e.code===404?'Žádný model není pro tento klíč dostupný'+(e.msg?' ('+String(e.msg).slice(0,140)+')':'')+'.':!navigator.onLine?'Jsi offline. Čtení přes AI potřebuje internet.':'Přečíst fotku se nepovedlo: '+(errTxt(e)||'neznámá chyba').slice(0,160)+'. Zkus to znovu.';
const LAYOUT_PROMPT=`Na fotkách je ručně psaná hospodská účtenka (útrata jednoho člověka). Na začátku řádku je cena v Kč (např. 55, 35, 40, 30, 28, 25, 20, 18, někdy 145 nebo 250), za ní čárky = počet kusů.
Pravidla:
- každá svislá čárka = 1 kus; 4 čárky přeškrtnuté pátou šikmou čárkou = 5 kusů
- KAŽDÁ čárka na papíře musí patřit k nějaké ceně – žádná nesmí zůstat nepřiřazená. Čárky BEZ vlastní napsané ceny patří k POSLEDNÍ ceně PŘED nimi v pořadí čtení (účtenka se čte jako text: od levého horního rohu po řádcích zleva doprava; cena platí pro všechny další čárky, dokud nepřijde jiná cena) – i když jsou daleko, jednotlivé, rozházené nebo úplně dole na papíře. Uveď každou takovou skupinu jako samostatnou položku s tou cenou a s vlastním rámečkem. Projdi papír celý až k dolnímu okraji
- na jednom řádku mohou být dvě skupiny (vlevo a vpravo), každá se svou cenou
- pisatel někdy připojí první čárku k číslici 5, takže to vypadá jako 7 („27“, „37“). Pokud cena nedává smysl, je to nejspíš 25/35 + 1 čárka; pak uncertain=true a vysvětli
- čárka přeškrtnutá malým křížkem může být zrušená; nepočítej ji, uncertain=true
- číslice 5 se často píše jako „T“ nebo „τ“ (svislá čára s vodorovnou čárou nahoře, u „55“ často jedna společná vodorovná čára přes obě číslice → vypadá jako „TT“). To je cena 55, ne čárky. Podobně 35 = „3T“, 25 = „2T“
- u každé položky vrať i rámeček samotné napsané CENY (price_box), aby se cena nepočítala jako čárky
Obrázek 1 je celá fotka. Obrázky 2, 3 a 4 jsou výřezy celé šířky ve vyšším rozlišení: obrázek 2 výška 0–0,4, obrázek 3 výška 0,3–0,7, obrázek 4 výška 0,6–1 (zlomky výšky celé fotky). Překryvy nepočítej dvakrát.
Počítej velmi pečlivě, čárku po čárce. Kde si nejsi jistý (překryvy, šmouhy, tvary N/X, nejasná cena), nastav "uncertain": true, do "note" napiš krátce česky proč a do "spot" dej rámeček kolem sporného místa.
Odpověz POUZE JSONem:
{"rows":[{"price":55,"count":25,"uncertain":false,"note":"1. řádek","box":[x1,y1,x2,y2],"price_box":[x1,y1,x2,y2],"spot":null}]}
Počítej jen to, co je napsané na papíře účtenky. Stůl, pozadí, prsty, tištěný text a razítka ignoruj. Řádek bez jediné čárky nevracej.
box a spot jsou souřadnice v CELÉ fotce jako zlomky 0–1 (x zleva, y shora). Řádky seřaď shora dolů.`;
const COUNT_PROMPT=n=>`Dostaneš ${n} výřezů z ručně psané hospodské účtenky. Každý výřez je jeden řádek (nebo blok řádků) čárek pro jednu cenu. Výřez může na okrajích obsahovat kousky sousedních řádků – ty nepočítej.
Úkol: u každého výřezu spočítej čárky patřící k vyznačené ceně. Každá svislá čárka = 1. Čtyři čárky přeškrtnuté šikmou pátou = 5 (přeškrtnutí se nepočítá navíc). Číslice ceny nejsou čárky. Čárka přeškrtnutá malým křížkem je zrušená.
CENA: je napsaná na začátku řádku (vlevo). Pokud je ve výřezu ČERVENÝ RÁMEČEK, je v něm cena – nic uvnitř nepočítej. Počítej až čárky VPRAVO od ceny.
POZOR na písmo: číslice 5 se často píše jako „T“ nebo „τ“ (svislá čára s vodorovnou čárou nahoře, vodorovná čára může spojovat obě číslice – „55“ pak vypadá jako „TT“ nebo „ττ“). To je cena, ne čárky ani plotek!
Postupuj zleva doprava a počítej po skupinách, pečlivě, čárku po čárce. Když je výřez nejasný (překryvy, šmouhy, tvary N/X), nastav uncertain=true a do note napiš krátce česky proč.
Ke každému výřezu vrať i SKUPINY, jak jsi je počítal zleva doprava: "groups":[{"x":0.21,"n":5},…] – x je vodorovný střed skupiny jako zlomek šířky výřezu (0 = levý okraj, 1 = pravý), n = počet čárek ve skupině (plný plotek = 5). Součet n musí být count.
Nejasná místa dej do "bad":[{"x":0.62,"why":"krátce česky, např. dvě čárky splývají"}].
Pokud ve výřezu vidíš na začátku jiného řádku nebo jiné skupiny JINOU napsanou cenu než vyznačenou (výřez zabírá víc položek), vypiš ji do "other_prices":[18,35] a počítej jen čárky k vyznačené ceně.
NEJDŮLEŽITĚJŠÍ: neodhaduj počet. Projdi výřez zleva doprava a ke KAŽDÉ jednotlivé čárce dej bod do "points" jako [y, x] v rozsahu 0–1000 vzhledem k výřezu (bod přesně na SPODNÍ konec čárky – tam, kde čárka dole končí). Šikmá přeškrtávací čárka plotku je taky jedna čárka = jeden bod na jejím spodním konci (plotek = 5 bodů). Nic nevynechej, nic nepočítej dvakrát. "count" = počet bodů.
Odpověz POUZE JSONem: {"counts":[{"id":1,"count":13,"points":[[500,120],[510,150]],"groups":[{"x":0.2,"n":5},{"x":0.4,"n":5},{"x":0.58,"n":3}],"bad":[],"uncertain":false,"note":""}]} – id je číslo výřezu.`;
/* Gemini zná rámečky nativně jako box_2d [ymin,xmin,ymax,xmax] v 0–1000 */
const G_BOX=()=>!isOAI()&&!!settings.aiKey;
function toGbox(p){if(!G_BOX())return p;return p
  .replace(/"box":\[x1,y1,x2,y2\],"price_box":\[x1,y1,x2,y2\],"spot":null/g,'"box_2d":[ymin,xmin,ymax,xmax],"price_box_2d":[ymin,xmin,ymax,xmax],"spot_2d":null').replace(/\(price_box\)/,'(price_box_2d)')
  .replace(/"box":\[0\.02,0\.1,0\.4,0\.35\],"price_box":\[0\.02,0\.1,0\.1,0\.35\]/g,'"box_2d":[100,20,350,400],"price_box_2d":[100,20,350,100]').replace(/"price_box" = rámeček/,'"price_box_2d" = rámeček').replace(/\(stejný formát jako box\)/,'(stejný formát jako box_2d)')
  .replace(/box a spot jsou souřadnice v CELÉ fotce jako zlomky 0–1 \(x zleva, y shora\)\./,'box_2d a spot_2d jsou rámečky ve formátu [ymin, xmin, ymax, xmax] v rozsahu 0–1000 vzhledem k celé fotce. Rámeček ať těsně obsahuje cenu i všechny její čárky a jen jeden řádek (jednu položku).')
  .replace(/box \[x1,y1,x2,y2\] jako zlomky TOHOTO VÝŘEZU \(0–1, x zleva, y shora\)/,'box_2d [ymin, xmin, ymax, xmax] v rozsahu 0–1000 vzhledem k TOMUTO výřezu')
  .replace(/do "spot" dej rámeček/,'do "spot_2d" dej rámeček')}
function readBox(x){const b=x.box_2d,a=x.box;if(Array.isArray(b)&&b.length===4){const v=b.map(n=>clamp01((+n||0)/1000));return[Math.min(v[1],v[3]),Math.min(v[0],v[2]),Math.max(v[1],v[3]),Math.max(v[0],v[2])]}
  if(Array.isArray(a)&&a.length===4){const big=a.some(n=>+n>1.5);return a.map(n=>clamp01(big?(+n||0)/1000:n))}return null}
function readPBox(x){return x.price_box_2d?readBox({box_2d:x.price_box_2d}):x.price_box?readBox({box:x.price_box}):null}
function readSpot(x){const s=x.spot_2d||x.spot;return Array.isArray(s)&&s.length===4?readBox(x.spot_2d?{box_2d:s}:{box:s}):null}
const clamp01=n=>Math.min(1,Math.max(0,+n||0));
async function imgFromBlob(b){const u=URL.createObjectURL(b);try{return await loadImg(u)}finally{URL.revokeObjectURL(u)}}
async function cropRow(fimg,box,pbox){const W=fimg.naturalWidth,Hh=fimg.naturalHeight,m=.015;const x1=clamp01(box[0]-m),y1=clamp01(box[1]-m),x2=clamp01(box[2]+m),y2=clamp01(box[3]+m);
  const c=document.createElement('canvas');const sw=(x2-x1)*W,sh=(y2-y1)*Hh;const s=Math.min(1.2,1200/sw);c.width=Math.max(1,Math.round(sw*s));c.height=Math.max(1,Math.round(sh*s));
  const g=c.getContext('2d');g.drawImage(fimg,x1*W,y1*Hh,sw,sh,0,0,c.width,c.height);
  /* cenu orámovat červeně, ať ji AI nepočítá jako čárky */
  if(pbox&&(pbox[2]-pbox[0])<(box[2]-box[0])*.6){const X=v=>(v-x1)/(x2-x1)*c.width,Y=v=>(v-y1)/(y2-y1)*c.height;g.strokeStyle='#e0182d';g.lineWidth=Math.max(3,c.height*.02);g.setLineDash([]);
    g.strokeRect(X(pbox[0]),Math.max(2,Y(pbox[1])),X(pbox[2])-X(pbox[0]),Math.min(c.height-4,Y(pbox[3])-Y(pbox[1])))}
  return await canvasBlob(c,.9)}
async function countPass(rows,crops,order,signal){
  const lim=maxImgs();if(order.length>lim){const out={};for(let i=0;i<order.length;i+=lim)Object.assign(out,await countPass(rows,crops,order.slice(i,i+lim),signal));return out}
  const ps=[{text:COUNT_PROMPT(order.length)+hwNote()}];
  for(let k=0;k<order.length;k++){const i=order[k];ps.push({text:`Výřez ${k+1}: cena ${rows[i].p} Kč${rows[i].cover?' – POKRAČOVÁNÍ bez napsané ceny, počítej všechny čárky ve výřezu':rows[i].nopr?' – výřez obsahuje JEN čárky (cena je mimo výřez); počítej všechny čárky, kousky čísel na okraji ignoruj':''}${rows[i].note&&!rows[i].cover?' ('+rows[i].note+')':''}`});ps.push({inline_data:{mime_type:'image/jpeg',data:await b64(crops[i])}})}
  const d=parseJSON(await aiCall(ps,signal,true));const out={};
  (d&&Array.isArray(d.counts)?d.counts:[]).forEach(c=>{const k=num(c.id)-1;const i=order[k];if(i==null)return;const bx=rows[i].box;
    const mx=v=>{if(!bx)return null;const x1=clamp01(bx[0]-.015),x2=clamp01(bx[2]+.015);return +(x1+(x2-x1)*clamp01(+v>1.5?(+v)/1000:v)).toFixed(4)};
    const g=(Array.isArray(c.groups)?c.groups:[]).map(z=>[mx(z.x),num(z.n)]).filter(z=>z[0]!=null&&z[1]>0).sort((a,b)=>a[0]-b[0]);
    const bad=(Array.isArray(c.bad)?c.bad:[]).map(z=>[mx(z.x),String(z.why||'').slice(0,80)]).filter(z=>z[0]!=null);
    const op=(Array.isArray(c.other_prices)?c.other_prices:[]).map(num).filter(v=>v>0);
    /* body jednotlivých čárek → souřadnice ve fotce; počet = počet bodů */
    let pts=null;if(bx&&Array.isArray(c.points)&&c.points.length){const x1=clamp01(bx[0]-.015),x2=clamp01(bx[2]+.015),y1=clamp01(bx[1]-.015),y2=clamp01(bx[3]+.015);
      pts=c.points.filter(z=>Array.isArray(z)&&z.length>=2).map(z=>{const yy=+z[0]>1.5?+z[0]/1000:+z[0],xx=+z[1]>1.5?+z[1]/1000:+z[1];return[+(x1+(x2-x1)*clamp01(xx)).toFixed(4),+(y1+(y2-y1)*clamp01(yy)).toFixed(4)]});
      pts=pts.filter((p,k)=>pts.findIndex(o=>Math.hypot(o[0]-p[0],o[1]-p[1])<.004)===k)}
    const cc=num(c.count);let cnt=pts&&pts.length?pts.length:cc,q=!!c.uncertain||bad.length>0,n=String(c.note||'');
    if(pts&&pts.length&&cc&&Math.abs(cc-pts.length)>0){q=true;n=(n?n+' · ':'')+`AI napsala ${cc}, ale označila ${pts.length} čárek`}
    out[i]={c:cnt,q,n,g,bad,op,pts}});
  return out;
}
function merge(rows,A,B){rows.forEach((x,i)=>{const a=A[i],b=B[i];const c0=x.c;x.lc=c0;x.pts=(a&&a.pts)||(b&&b.pts)||null;x.ga=a&&a.g&&a.g.length?a.g:null;x.gb=b&&b.g&&b.g.length?b.g:null;x.multi=[...new Set([...((a&&a.op)||[]),...((b&&b.op)||[])])].filter(v=>v!==+x.p);x.bad=[...((a&&a.bad)||[]),...((b&&b.bad)||[])].filter((z,k,arr)=>arr.findIndex(w=>Math.abs(w[0]-z[0])<.02)===k).slice(0,4);if(!x.ga&&x.gb){x.ga=x.gb;x.gb=null}
  if(a&&b){if(a.c===b.c){x.c=a.c;if(a.q||b.q){x.q=1;x.note=(a.n||b.n||x.note)}else if(x.q&&a.c===c0)x.q=1;else x.q=0;if(c0!==a.c&&x.q){x.alts=[...new Set([c0,a.c])].sort((m,n)=>m-n);x.note=(x.note?x.note+' · ':'')+`1. odhad ${c0}, přepočet ${a.c}`}}
    else{x.c=Math.max(a.c,b.c);x.q=1;x.alts=[...new Set([a.c,b.c,c0])].sort((m,n)=>m-n);x.note=`AI napočítala jednou ${a.c}, podruhé ${b.c}. Vyber nebo přepočítej.`+(a.n?' '+a.n:'')}}
  else if(a||b){const v=a||b;x.c=v.c;x.q=1;x.note='Přepočet jen jednou: '+v.c+(v.n?' – '+v.n:'')}
  else if(x.box){x.q=1;x.note=(x.note?x.note+' · ':'')+'Řádek nebyl přepočítán zvlášť.'}
  if(!(+x.c>0)&&c0>0){x.q=1;x.alts=[0,c0];x.c=c0;x.note=`Při hledání řádků AI viděla ${c0}, při přepočtu 0. Zkontroluj.`}
  if(x.q&&!x.spots.length&&x.box)x.spots=[x.box]})}
/* ---------- nové čtení: ceny a skupiny čárek zvlášť, přiřazení k nejbližší ceně v appce ---------- */
const SCENE_PROMPT=()=>`Fotka ručně psané hospodské účtenky (útrata jednoho člověka). Na papíře jsou napsané CENY (čísla v Kč) a ČÁRKY (počet kusů).
Najdi zvlášť:
1) "prices" – VŠECHNA napsaná čísla/ceny na papíře, kdekoli (vlevo od čárek, nad nimi i POD nimi). U každé: "value" a "box_2d".
   Písmo: číslice 5 se píše jako „T“/„τ“ (svislá + vodorovná nahoře; „55“ = „TT“ se společnou vodorovnou čarou, často s pomlčkou za ní). Číslo může mít ocásek nebo podtržení („40“ může vypadat jako „407“ nebo „40/“) – je to pořád jen cena 40.
   CENÍK této hospody: ${priceList().join(', ')} Kč. Cena mimo ceník je podezřelá – pak "uncertain": true a "alts" s 1–3 cenami z ceníku, které tak mohou vypadat.
2) "groups" – skupiny ČÁREK (svislé nebo šikmé tahy = kusy). Skupina = čárky blízko sebe. Velká mezera nebo jiný řádek = nová skupina. U každé: "count" (každá čárka 1, čtyři přeškrtnuté pátou = 5) a "box_2d" (jen čárky, BEZ číslic ceny).
   Číslice ceny NIKDY nejsou čárky. Pomlčka za cenou není čárka.
Účtenka se čte jako text: od levého horního rohu, po řádcích zleva doprava až dolů. Projdi CELÝ papír až k dolnímu okraji. Ignoruj stůl, pozadí, podtácky a tištěný text. Žádná čárka nesmí chybět.
box_2d je [ymin, xmin, ymax, xmax] v rozsahu 0–1000 vzhledem k celé fotce.
Odpověz POUZE JSONem: {"prices":[{"value":55,"box_2d":[100,150,160,260],"uncertain":false,"alts":[]}],"groups":[{"count":3,"box_2d":[90,280,200,420],"uncertain":false,"note":""}]}`+hwNote();
/* vzdálenost dvou rámečků (mezera), cena vlevo na stejném řádku má přednost */
function boxGap(g,p){const gx=Math.max(0,p[0]-g[2],g[0]-p[2]),gy=Math.max(0,p[1]-g[3],g[1]-p[3]);let d=Math.hypot(gx,gy*1.15);
  const ov=Math.max(0,Math.min(g[3],p[3])-Math.max(g[1],p[1]))/Math.max(1e-6,Math.min(g[3]-g[1],p[3]-p[1]));
  if(ov>.4&&p[2]<=g[0]+.02)d*=.5; return d}
/* čtení jako text: řádky shora dolů, v řádku zleva doprava; čárky patří k POSLEDNÍ ceně před nimi */
function readingOrder(items){const it=items.filter(o=>o.box).map(o=>({...o,cy:(o.box[1]+o.box[3])/2,h:o.box[3]-o.box[1]})).sort((a,b)=>a.cy-b.cy);
  const lines=[];for(const o of it){const L=lines[lines.length-1];
    if(L){const ov=Math.max(0,Math.min(L.y2,o.box[3])-Math.max(L.y1,o.box[1]))/Math.max(1e-6,Math.min(L.y2-L.y1,o.h));if(ov>.35||Math.abs(o.cy-L.cy)<Math.min(L.y2-L.y1,o.h)*.45){L.items.push(o);L.y1=Math.min(L.y1,o.box[1]);L.y2=Math.max(L.y2,o.box[3]);L.cy=(L.y1+L.y2)/2;continue}}
    lines.push({items:[o],y1:o.box[1],y2:o.box[3],cy:o.cy})}
  lines.forEach((L,k)=>L.items.sort((a,b)=>a.box[0]-b.box[0]).forEach(o=>o.line=k));return lines.flatMap(L=>L.items)}
/* Přiřazení čárek k ceně:
   1) cena vlevo na STEJNÉM řádku (nejmenší svislá vzdálenost středů; při dvou cenách na řádku ta nejbližší zleva)
   2) řádek čárek bez vlastní ceny (daleko od všech cen) = pokračování → POSLEDNÍ cena nad ním
   Skupiny patřící ke stejné napsané ceně se sečtou do jednoho řádku. */
function assignGroups(prices,groups,ph){const P=prices.filter(p=>p.box&&p.v>0).map((p,k)=>({...p,k,cx:(p.box[0]+p.box[2])/2,cy:(p.box[1]+p.box[3])/2}));if(!P.length)return[];
  const ys=P.map(p=>p.cy).sort((a,b)=>a-b);const gaps=ys.slice(1).map((y,i)=>y-ys[i]).filter(d=>d>.01).sort((a,b)=>a-b);
  const ph0=P.map(p=>p.box[3]-p.box[1]).sort((a,b)=>a-b)[Math.floor(P.length/2)];
  const sp=Math.min(gaps.length?gaps[Math.floor(gaps.length/2)]:1,Math.max(.03,ph0*1.8)); /* výška jednoho řádku */
  const A=[];
  for(const g of groups.filter(g=>g.box&&g.c>0)){const gcy=(g.box[1]+g.box[3])/2;
    let C=P.filter(p=>p.cx<g.box[0]+.05);if(!C.length)C=P;
    const dy=p=>Math.abs(p.cy-gcy);const best=Math.min(...C.map(dy));let note='',q=g.q?1:0,pr,cont=false;
    const ovl=C.some(p=>Math.min(p.box[3],g.box[3])-Math.max(p.box[1],g.box[1])>(p.box[3]-p.box[1])*.5);
    if(best>sp*.65&&!ovl){/* řádek bez vlastní ceny → poslední cena před ním v pořadí čtení */
      const top=P.filter(p=>p.cy<gcy);
      if(top.length){const lastY=Math.max(...top.map(p=>p.cy));pr=top.filter(p=>p.cy>lastY-sp*.3).sort((a,b)=>b.cx-a.cx)[0];cont=true;note=`Pokračování bez ceny → ${pr.v} Kč (poslední cena před ním).`}
      else{pr=C.slice().sort((a,b)=>dy(a)-dy(b))[0];q=1;note=`Čárky jsou nad první cenou – přiřazeno k ${pr.v} Kč, zkontroluj.`}}
    else{const same=C.filter(p=>dy(p)<=best+sp*.3);pr=same.sort((a,b)=>b.cx-a.cx)[0];
      const second=C.filter(p=>p!==pr&&Math.abs(dy(p)-dy(pr))<sp*.15&&Math.abs(p.cx-pr.cx)<.05)[0];if(second){q=1;note=`Čárky jsou mezi cenami ${pr.v} a ${second.v} – zkontroluj.`}}
    A.push({g,pr,note,q,cont})}
  /* cena, za kterou nic není (napsaná až pod čárkami) → převezme pokračování těsně nad ní */
  const lowest=Math.max(...P.map(p=>p.cy));
  P.filter(p=>!A.some(a=>a.pr===p)).forEach(p=>{if(p.cy<lowest-.005){log('INFO','čtení: cena bez čárek (uprostřed – nic nepřesouvám)',p.v);return} /* jen poslední cena dole na papíře */
    const cand=A.filter(a=>a.cont&&a.g.box[3]<=p.box[1]+sp*.3&&p.box[1]-a.g.box[3]<sp*1.5&&a.g.box[0]<p.box[2]+.15).sort((a,b)=>b.g.box[3]-a.g.box[3])[0];
    if(cand){const old=cand.pr.v;cand.pr=p;cand.cont=false;cand.q=1;cand.note=`Cena ${p.v} je napsaná pod čárkami – přiřazeno k ${p.v} (podle pořadí čtení by patřily k ${old}). Zkontroluj.`;cand.alt=old}
    else log('INFO','čtení: cena bez čárek',p.v)});
  const byPrice=new Map(),out=[];
  for(const a of A){const g=a.g,pr=a.pr;
    if(byPrice.has(pr.k)){const r=byPrice.get(pr.k);r.c+=g.c;r.lc+=g.c;r.box=[Math.min(r.box[0],g.box[0]),Math.min(r.box[1],g.box[1]),Math.max(r.box[2],g.box[2]),Math.max(r.box[3],g.box[3])];r.q=r.q||a.q;if(a.note)r.note=(r.note?r.note+' · ':'')+a.note;continue}
    const r={p:pr.v,c:g.c,q:a.q||pr.q?1:0,note:[a.note,g.note].filter(Boolean).join(' · '),box:g.box.slice(),pbox:pr.box,spots:[],ph,ai:1,pai:pr.v,pq:pr.q?1:0,palts:[...(a.alt?[a.alt]:[]),...(pr.alts||[])],nopr:1,lc:g.c};
    byPrice.set(pr.k,r);out.push(r)}
  return out.sort((a,b)=>(a.pbox[1]-b.pbox[1])||(a.pbox[0]-b.pbox[0]))}
async function sceneRead(blob,ph,signal){const parts=[{text:SCENE_PROMPT()},{inline_data:{mime_type:'image/jpeg',data:await b64(blob)}},...hwParts()];
  const raw=await aiCall(parts,signal,true);log('INFO','čtení: odpověď AI (ceny+čárky)',String(raw).slice(0,2000));const d=parseJSON(raw)||{};
  const L=priceList();
  /* ocásek/podtržení přečtené jako další číslice: 407 → 40, 557 → 55 */
  const fixV=v=>{if(!v||L.includes(v))return{v,f:0};const s=String(v);for(const k of [s.slice(0,-1),s.slice(1)])if(k&&L.includes(+k))return{v:+k,f:1};return{v,f:0}};
  const prices=(Array.isArray(d.prices)?d.prices:[]).map(x=>{const r=fixV(num(x.value??x.price));return{v:r.v,box:readBox(x),q:x.uncertain?1:0,alts:Array.isArray(x.alts)?x.alts.map(num).filter(Boolean):[],fixed:r.f?num(x.value??x.price):0}});
  prices.filter(p=>p.fixed).forEach(p=>log('INFO','čtení: cena upravena podle ceníku',[p.fixed,p.v]));
  const groups=(Array.isArray(d.groups)?d.groups:[]).map(x=>({c:num(x.count),box:readBox(x),q:x.uncertain?1:0,note:String(x.note||'').slice(0,150)}));
  log('INFO','čtení: ceny',prices.map(p=>[p.v,p.box&&p.box.map(v=>+v.toFixed(2))]));log('INFO','čtení: skupiny',groups.map(g=>[g.c,g.box&&g.box.map(v=>+v.toFixed(2))]));
  const rows=assignGroups(prices,groups,ph);log('INFO','čtení: přiřazení (pořadí čtení)',rows.map(x=>[x.p,x.c]));return rows}
/* přečte jednu fotku: vrátí řádky */
/* ---------- ceny: ceník, pravidla oprav, vzory písma ---------- */
const priceList=()=>(settings.prices&&settings.prices.length?settings.prices:DEF_PRICES).map(Number);
function priceCands(p){const L=priceList();const s=String(p);const sim=q=>{const t=String(q);let d=Math.abs(t.length-s.length)*2;for(let i=0;i<Math.min(t.length,s.length);i++)if(t[t.length-1-i]!==s[s.length-1-i])d++;return d};
  return L.filter(q=>q!==p).sort((a,b)=>sim(a)-sim(b)||Math.abs(a-p)-Math.abs(b-p)).slice(0,4)}
function fixPrices(rows){const F=settings.priceFix||[];const L=priceList();
  rows.forEach(x=>{const f=F.find(f=>+f.from===+x.p);if(f){x.note=(x.note?x.note+' · ':'')+`Cena opravena ${x.p} → ${f.to} (tvé pravidlo)`;x.p=+f.to;x.pq=0;return}
    if(x.pq||(L.length&&!L.includes(+x.p))){x.q=1;x.pq=1;x.palts=[...new Set([...(x.palts||[]),...priceCands(+x.p)])].filter(v=>v!==+x.p&&v>0).slice(0,5);
      x.note=`Sporná cena: AI přečetla ${x.p} Kč`+(L.includes(+x.p)?'':' (není v ceníku)')+'. Vyber správnou cenu.'+(x.note?' · '+x.note:'')}})}
async function priceCropB64(r,x){try{const p=(r.photos||[])[x.ph||0];if(!p||!x.box)return null;const rec=await getOne('photos',p.id);if(!rec)return null;
  const img=await imgFromBlob(rec.blob);const W=img.naturalWidth,Hh=img.naturalHeight;const b=x.box;const h=(b[3]-b[1])*Hh;
  const sx=Math.max(0,(b[0]-.01)*W),sy=Math.max(0,(b[1]-.01)*Hh),sw=Math.min((b[2]-b[0])*W,Math.max(h*3.2,W*.18)),sh=Math.min(Hh-sy,h+.02*Hh);
  const c=document.createElement('canvas');const s=Math.min(1,320/sw);c.width=Math.round(sw*s);c.height=Math.round(sh*s);c.getContext('2d').drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);
  return c.toDataURL('image/jpeg',.82).split(',')[1]}catch(e){log('VAROV','výřez ceny selhal',errInfo(e));return null}}
let learnT=null,zPrice=false;
function offerLearn(r,x,from,to){if(!x.ai||!from||!to||+from===+to)return;const el=$('learn');(document.querySelector('dialog[open]')||document.body).appendChild(el);
  $('learnt').textContent=`AI přečetla ${from}, správně je ${to}. Pamatovat si to?`;el.hidden=false;clearTimeout(learnT);learnT=setTimeout(()=>el.hidden=true,12000);
  $('learny').onclick=async()=>{el.hidden=true;const F=(settings.priceFix||[]).filter(f=>+f.from!==+from);
    if(!priceList().includes(+from))F.push({from:+from,to:+to});settings.priceFix=F;saveSettings();
    const b=await priceCropB64(r,x);if(b){hwSamples.push({id:Date.now().toString(36),price:+to,read:+from,img:b});hwSamples=hwSamples.slice(-24);saveHw()}
    toast(priceList().includes(+from)?`Uložen vzor písma ${to} Kč (${from} je v ceníku, pravidlo nedělám)`:`Zapamatováno: ${from} → ${to}`+(b?' + vzor písma':''))};
  $('learnn').onclick=()=>{el.hidden=true}}
function hwNote(){const t=(settings.hwNote||'').trim();return t?`\nPOZNÁMKA OBSLUHY K PÍSMU (ber vážně): ${t.slice(0,600)}`:''}
function hwParts(){if(!extAI()||!hwSamples.length)return[];const ps=[{text:'VZORY PÍSMA tohoto číšníka (jen pro rozpoznání číslic cen, nic z nich nepočítej a nezahrnuj do rows):'}];
  const seen={};for(const s of [...hwSamples].reverse()){if((seen[s.price]=(seen[s.price]||0)+1)>2)continue;ps.push({text:`Vzor písma: ${s.price} Kč`+(s.read&&s.read!==s.price?` (dřív chybně čteno jako ${s.read})`:'')});ps.push({inline_data:{mime_type:'image/jpeg',data:s.img}});if(ps.length>25)break}
  return ps}
async function readPhoto(pid,ph,status,signal){
  const rec=await getOne('photos',pid);if(!rec)throw{code:'empty',msg:'Fotka chybí'};
  status('Připravuji fotku…',0);
  const {blob}=await shrink(rec.blob,extAI()&&settings.readMode==='exact'?2400:1600,.88);const img=await imgFromBlob(blob);
  const lim=extAI()?1:claudeAI?claudeMax:4;const strips=lim>=4?[[0,.4],[.3,.7],[.6,1]]:lim>=3?[[0,.55],[.45,1]]:[];
  const stripTxt=strips.length?'Obrázek 1 je celá fotka. '+strips.map((s,i)=>`Obrázek ${i+2} je výřez celé šířky ve vyšším rozlišení, výška ${String(s[0]).replace('.',',')}–${String(s[1]).replace('.',',')}`).join('; ')+' (zlomky výšky celé fotky). Překryvy nepočítej dvakrát.':'Obrázek 1 je celá fotka.';
  const F=settings.priceFix||[];
  const prompt=toGbox(LAYOUT_PROMPT).replace(/Obrázek 1 je celá fotka\.[^\n]*/,stripTxt)+`\nCENÍK této hospody: ${priceList().join(', ')} Kč. Cena mimo ceník je možná, ale nejspíš špatně přečtená – pak nastav "price_uncertain": true a do "price_alts" dej 1–3 ceny z ceníku, které tak mohou vypadat.`+(F.length?`\nZnámé záměny tohoto písma: ${F.map(f=>f.from+' je ve skutečnosti '+f.to).join('; ')}.`:'')+`\nU každého řádku uveď i "price_uncertain" (true/false) a "price_alts" ([]).`+hwNote();
  const parts=[{text:prompt},{inline_data:{mime_type:'image/jpeg',data:await b64(blob)}}];
  for(const [a,b] of strips)parts.push({inline_data:{mime_type:'image/jpeg',data:await b64(await cropBlob(img,a,b))}});
  parts.push(...hwParts());
  log('INFO','čtení: obrázky připraveny',{full:Math.round(blob.size/1024)+'kB',w:img.naturalWidth,h:img.naturalHeight,pruhy:strips.length});
  status('Hledám ceny a čárky…',1);
  let rows=[];
  if(extAI()){try{rows=await sceneRead(blob,ph,signal)}catch(e){if(e&&e.name==='AbortError')throw e;if(e&&(e.code==='key'||e.code===429||e.code==='busy'))throw e;log('VAROV','čtení ceny+čárky selhalo, zkouším po řádcích',errInfo(e))}}
  if(!rows.length){
  const raw=await aiCall(parts,signal,true);log('INFO','čtení: odpověď AI (řádky)',String(raw).slice(0,1800));const data=parseJSON(raw);if(data&&!Array.isArray(data.rows))data.rows=rowsOfJSON(data);
  rows=(data&&Array.isArray(data.rows)?data.rows:[]).map(x=>({p:num(x.price),c:num(x.count),q:x.uncertain?1:0,note:String(x.note||'').slice(0,200),
    box:readBox(x),pbox:readPBox(x),spots:readSpot(x)?[readSpot(x)]:[],ph,ai:1,pai:num(x.price),pq:x.price_uncertain?1:0,palts:Array.isArray(x.price_alts)?x.price_alts.map(num).filter(Boolean):[]})).filter(x=>x.p||x.c);
  log('INFO','čtení: řádky z 1. průchodu',rows.map(x=>[x.p,x.c,x.box?x.box.map(v=>+v.toFixed(2)):null]));}
  if(!rows.length){log('VAROV','čtení: 1. průchod nenašel řádky – zkouším celou fotku jinak');status('Zkouším fotku přečíst jinak…',1);
    try{const fb=await regionRows(img,[0,0,1,1],ph,signal);rows.push(...fb.map(x=>({...x,split:0})))}catch(e){if(e&&e.name==='AbortError')throw e;log('VAROV','záložní čtení selhalo',errInfo(e))}}
  if(!rows.length)throw{code:'empty',msg:'AI na fotce nenašla žádné řádky s čárkami. Vyfoť účtenku zblízka, rovně a ostře (celý papír, bez stínu) a zkus to znovu.'};
  /* RYCHLÉ čtení: jeden dotaz – ceny a čárky z první odpovědi, sporné jen označit ke kontrole */
  if(settings.readMode!=='exact'&&rows.length&&rows.every(x=>x.nopr)){
    /* počty z celé fotky jsou hrubé → každý řádek ještě jednou spočítat ze zvětšeného výřezu (1 dotaz na všechny řádky) */
    try{status('Počítám čárky ve zvětšených výřezech…',2);const fimg=await imgFromBlob((await shrink(rec.blob,2400,.9)).blob);const crops=[];for(const x of rows)crops.push(await cropRow(fimg,x.box,null));
      const idx=rows.map((x,i)=>i);const A=await countPass(rows,crops,idx,signal);
      rows.forEach((x,i)=>{const a=A[i];x.ga=a&&a.g&&a.g.length?a.g:null;x.gb=null;x.bad=(a&&a.bad)||[];x.pts=a&&a.pts||null;if(!a)return;
        if(a.c===x.lc){x.c=a.c;if(a.q){x.q=1;x.note=(x.note?x.note+' · ':'')+(a.n||'AI si tu není jistá')}}
        else{x.c=a.c;x.q=1;x.alts=[...new Set([a.c,x.lc])].sort((m,n)=>m-n);x.note=`Celá fotka: ${x.lc}, zvětšený výřez: ${a.c}. Přepočítej (Ťukat čárky).`+(x.note?' · '+x.note:'')}})}
    catch(e){if(e&&e.name==='AbortError')throw e;log('VAROV','přepočet výřezů selhal – beru počty z celé fotky',errInfo(e));rows.forEach(x=>{x.q=1;x.note='Počet jen z celé fotky – zkontroluj.'})}
    rows.forEach(x=>{if(x.q&&!x.note)x.note='AI si tu není jistá – zkontroluj počet.'});
    fixPrices(rows);rows.sort((a,b)=>(a.box[1]-b.box[1])||(a.box[0]-b.box[0]));status('Hotovo',3);
    log('INFO','čtení: rychlý výsledek',rows.map(x=>[x.p,x.c,x.q?'?':'ok']));return rows}
  status('Připravuji výřezy řádků…',2);const mid=(await shrink(rec.blob,2400,.9)).blob;const fimg=await imgFromBlob(mid);
  /* příliš vysoké rámečky = nejspíš víc řádků v jednom → rozdělit hned */
  const med=medianH(rows);let pre=rows;if(med&&rows.some(x=>isTall(x,med))){log('INFO','čtení: vysoké rámečky',rows.filter(x=>isTall(x,med)).map(x=>x.p));pre=await splitRows(rows,fimg,signal,x=>isTall(x,med),status)}
  let kept=await countRows(pre.filter(x=>!x.split||x.ga===undefined),fimg,signal,status);kept=[...kept,...pre.filter(x=>x.split&&x.ga!==undefined)];
  /* AI při počítání viděla ve výřezu jiné ceny → rozdělit */
  if(kept.some(x=>x.multi&&x.multi.length&&!x.split&&!x.nopr))kept=await splitRows(kept,fimg,signal,x=>x.multi&&x.multi.length&&!x.split&&!x.nopr,status);
  /* kontrola úplnosti – nezůstaly čárky mimo rámečky? */
  try{status('Kontroluji, jestli nic nechybí…',2);const add=await coverRows(fimg,kept,ph,signal);
    if(add.length){log('INFO','úplnost: doplněno',add.map(x=>[x.p,x.c]));const cnt=await countRows(add,fimg,signal,status);cnt.forEach(x=>{if(!x.q){x.q=1;x.note=x.note+' – zkontroluj.'}});kept=[...kept,...cnt]}}
  catch(e){if(e&&e.name==='AbortError')throw e;log('VAROV','kontrola úplnosti selhala',errInfo(e))}
  kept.sort((a,b)=>a.box&&b.box?(a.box[1]-b.box[1])||(a.box[0]-b.box[0]):0);
  status('Hotovo',3);
  if(!kept.length)throw{code:'empty',msg:'Na fotce jsem nenašel žádné čárky'};
  fixPrices(kept);log('INFO','čtení: výsledek',kept.map(x=>[x.p,x.c,x.q?'?':'ok']));return kept;
}
/* ---------- oblast s více řádky: přečíst znovu a rozdělit ---------- */
const REGION_PROMPT=()=>`Obrázek je výřez z ručně psané hospodské účtenky. Může obsahovat JEDEN nebo VÍCE řádků. Položka = cena v Kč napsaná na začátku a za ní čárky (každá čárka 1 kus, 4 přeškrtnuté pátou = 5).
- na jednom řádku mohou být dvě skupiny (vlevo a vpravo), každá se svou cenou = dvě položky
- čárky, které pokračují na dalším řádku BEZ napsané ceny, patří k POSLEDNÍ ceně PŘED nimi v pořadí čtení (účtenka se čte jako text: od levého horního rohu po řádcích zleva doprava; cena platí pro všechny další čárky, dokud nepřijde jiná cena) – přičti je k té položce (jedna položka, box přes obě části)
- čáry useknuté horním nebo dolním okrajem výřezu patří sousedním řádkům – ignoruj je
- stůl, pozadí a tištěný text ignoruj
- číslice 5 se často píše jako „T“/„τ“ (svislá + vodorovná nahoře, u „55“ společná vodorovná čára → „TT“) – je to cena, ne čárky
CENÍK této hospody: ${priceList().join(', ')} Kč (cena mimo ceník je podezřelá → price_uncertain true a price_alts).
Pro každou položku vrať price, count, box [x1,y1,x2,y2] jako zlomky TOHOTO VÝŘEZU (0–1, x zleva, y shora) – box ať obsahuje cenu i všechny její čárky.
U každé položky vrať i "price_box" = rámeček jen samotné napsané ceny (stejný formát jako box).
Odpověz POUZE JSONem: {"rows":[{"price":18,"count":5,"box":[0.02,0.1,0.4,0.35],"price_box":[0.02,0.1,0.1,0.35],"uncertain":false,"note":"","price_uncertain":false,"price_alts":[]}]}`;
async function regionRows(fimg,box,ph,signal){const m=.012;const x1=clamp01(box[0]-m),y1=clamp01(box[1]-m),x2=clamp01(box[2]+m),y2=clamp01(box[3]+m);
  const W=fimg.naturalWidth,Hh=fimg.naturalHeight;const c=document.createElement('canvas');const sw=(x2-x1)*W,sh=(y2-y1)*Hh;const s=Math.min(1.5,1400/sw);
  c.width=Math.max(1,Math.round(sw*s));c.height=Math.max(1,Math.round(sh*s));c.getContext('2d').drawImage(fimg,x1*W,y1*Hh,sw,sh,0,0,c.width,c.height);
  const blob=await canvasBlob(c,.9);const ps=[{text:toGbox(REGION_PROMPT())+hwNote()},{inline_data:{mime_type:'image/jpeg',data:await b64(blob)}},...hwParts()];
  const raw=await aiCall(ps,signal,true);log('INFO','oblast: odpověď AI',String(raw).slice(0,1200));const d=parseJSON(raw);if(d&&!Array.isArray(d.rows))d.rows=rowsOfJSON(d);const mp=b=>[x1+(x2-x1)*clamp01(b[0]),y1+(y2-y1)*clamp01(b[1]),x1+(x2-x1)*clamp01(b[2]),y1+(y2-y1)*clamp01(b[3])].map(v=>+v.toFixed(4));
  const rows=(d&&Array.isArray(d.rows)?d.rows:[]).filter(x=>readBox(x)&&num(x.price)>0).map(x=>({p:num(x.price),c:num(x.count),q:x.uncertain?1:0,note:String(x.note||'').slice(0,200),box:mp(readBox(x)),pbox:readPBox(x)?mp(readPBox(x)):null,spots:[],ph,ai:1,pai:num(x.price),pq:x.price_uncertain?1:0,palts:Array.isArray(x.price_alts)?x.price_alts.map(num).filter(Boolean):[],split:1}));
  rows.sort((a,b)=>(a.box[1]-b.box[1])||(a.box[0]-b.box[0]));log('INFO','oblast: rozděleno',rows.map(x=>[x.p,x.c]));return rows}
/* ---------- počítání čárek přímo v telefonu (bez AI) ----------
   výřez řádku → normalizace jasu podle pozadí → maska inkoustu → vodorovné řezy, počet tahů na řezu → medián;
   u každého tahu se dohledá jeho spodní konec (tečka) */
async function localCount(img,box,pbox){
  const W=img.naturalWidth,Hh=img.naturalHeight;let bx0=box[0];
  if(pbox&&pbox[2]>box[0]&&pbox[2]<box[2]-.02&&Math.min(pbox[3],box[3])-Math.max(pbox[1],box[1])>0)bx0=Math.max(bx0,pbox[2]+.004);
  const sx=bx0*W,sy=box[1]*Hh,sw=(box[2]-bx0)*W,sh=(box[3]-box[1])*Hh;if(sw<4||sh<4)return{c:0,pts:[]};
  const s0=Math.min(2,1400/sw,640/sh);const w=Math.max(8,Math.round(sw*s0)),h=Math.max(8,Math.round(sh*s0));const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d',{willReadFrequently:true});
  g.drawImage(img,sx,sy,sw,sh,0,0,w,h);const d=g.getImageData(0,0,w,h).data;
  const L=new Float32Array(w*h);for(let i=0;i<w*h;i++)L[i]=.3*d[i*4]+.59*d[i*4+1]+.11*d[i*4+2];
  /* pozadí: maximum v okně 15×15 (papír) a rozmazání */
  const mx=(src,horiz,r)=>{const o=new Float32Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){let m=0;for(let k=-r;k<=r;k++){const xx=horiz?x+k:x,yy=horiz?y:y+k;if(xx<0||yy<0||xx>=w||yy>=h)continue;const v=src[yy*w+xx];if(v>m)m=v}o[y*w+x]=m}return o};
  const bl=(src,horiz,r)=>{const o=new Float32Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0,n=0;for(let k=-r;k<=r;k++){const xx=horiz?x+k:x,yy=horiz?y:y+k;if(xx<0||yy<0||xx>=w||yy>=h)continue;s+=src[yy*w+xx];n++}o[y*w+x]=s/n}return o};
  let bg=mx(mx(L,true,7),false,7);bg=bl(bl(bg,true,8),false,8);
  const ink=new Uint8Array(w*h);for(let i=0;i<w*h;i++)ink[i]=L[i]/Math.max(1,bg[i])<.78?1:0;
  const runsAt=y=>{const R=[];let s=-1;for(let x=0;x<w;x++){const v=ink[y*w+x]||(y>0&&ink[(y-1)*w+x])||(y<h-1&&ink[(y+1)*w+x]);if(v&&s<0)s=x;if(!v&&s>=0){R.push([s,x]);s=-1}}if(s>=0)R.push([s,w]);
    const M=[];for(const r of R){if(M.length&&r[0]-M[M.length-1][1]<2)M[M.length-1][1]=r[1];else M.push(r)}return M};
  /* souvislé tahy (komponenty) – výška typické čárky; když je výřez vyšší než ~1,7 čárky, je v něm víc řádků */
  const lab=new Int32Array(w*h);const comps=[];{let id=0;const st=[];for(let i=0;i<w*h;i++){if(!ink[i]||lab[i])continue;id++;let x0=w,x1=0,y0=h,y1=0,n=0;st.push(i);lab[i]=id;
    while(st.length){const q=st.pop();const qx=q%w,qy=(q-qx)/w;n++;if(qx<x0)x0=qx;if(qx>x1)x1=qx;if(qy<y0)y0=qy;if(qy>y1)y1=qy;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=qx+dx,ny=qy+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const k=ny*w+nx;if(ink[k]&&!lab[k]){lab[k]=id;st.push(k)}}}
    comps.push({x0,x1,y0,y1,n,id})}}
  const hs=comps.map(c=>c.y1-c.y0+1).filter(v=>v>h*.12).sort((a,b)=>a-b);const H0=hs.length?hs[Math.floor(hs.length/2)]:h; /* medián výšky čárky (bez smetí) */
  if(comps.length&&h>H0*1.7){const keep=comps.filter(c=>c.y1-c.y0+1>=H0*.45&&c.n>H0*1.2);const ws=keep.map(c=>c.x1-c.x0+1).sort((a,b)=>a-b);const mw=ws.length?ws[Math.floor(ws.length/3)]:1;
    let total=0;const pts=[];keep.forEach(c=>{const k=Math.max(1,Math.round((c.x1-c.x0+1)/Math.max(mw*1.6,1)));total+=k;
      for(let t=0;t<k;t++){const cx=c.x0+(c.x1-c.x0+1)*(t+.5)/k;pts.push([+((sx+cx/w*sw)/W).toFixed(4),+((sy+(c.y1+1)/h*sh)/Hh).toFixed(4)])}});
    log('INFO','v telefonu: víc řádků – podle tahů',{tahu:keep.length,vysledek:total});return{c:total,pts,unsure:true}}
  /* pásy (řádky čárek) podle vodorovného profilu inkoustu */
  const prof=new Float32Array(h);for(let y=0;y<h;y++){let s=0;for(let x=0;x<w;x++)s+=ink[y*w+x];prof[y]=s}
  const sm=new Float32Array(h);for(let y=0;y<h;y++){let s=0,n=0;for(let k=-3;k<=3;k++)if(y+k>=0&&y+k<h){s+=prof[y+k];n++}sm[y]=s/n}
  const pmax=Math.max(...sm);let bands=[];let st=-1;for(let y=0;y<=h;y++){const on=y<h&&sm[y]>pmax*.22;if(on&&st<0)st=y;if(!on&&st>=0){bands.push([st,y]);st=-1}}
  const bigH=Math.max(...bands.map(b=>b[1]-b[0]),1);bands=bands.filter(b=>b[1]-b[0]>=bigH*.35);
  /* spojit pásy, mezi kterými je jen malá mezera */
  const B=[];for(const b of bands){const l=B[B.length-1];if(l&&b[0]-l[1]<bigH*.12)l[1]=b[1];else B.push(b.slice())}if(!B.length)B.push([0,h]);
  let total=0,pts=[],unsure=false;const dbg=[];
  for(const [b0,b1] of B){const bh=b1-b0;const lines=[];for(let k=0;k<10;k++){const y=Math.round(b0+(.3+k*.05)*bh);if(y>=0&&y<h)lines.push({y,R:runsAt(y)})}
    if(!lines.length)continue;const counts=lines.map(l=>l.R.length).sort((a,b)=>a-b);const med=counts[Math.floor(counts.length/2)];
    const best=lines.filter(l=>l.R.length===med).sort((a,b)=>Math.abs(a.y-(b0+bh*.52))-Math.abs(b.y-(b0+bh*.52)))[0]||lines[0];
    best.R.forEach(r=>{let cx=(r[0]+r[1])/2,y=best.y;const lim=Math.min(h-1,b1+Math.round(bh*.25));for(;y<lim;){let got=0;for(let k=1;k<=4&&y+k<=lim;k++){let s=0,n=0;for(let x=Math.max(0,Math.round(cx)-4);x<=Math.min(w-1,Math.round(cx)+4);x++)if(ink[(y+k)*w+x]){s+=x;n++}if(n){cx=s/n;y+=k;got=1;break}}if(!got)break}
      pts.push([+((sx+cx/w*sw)/W).toFixed(4),+((sy+y/h*sh)/Hh).toFixed(4)])});
    total+=med;if(counts[counts.length-2]-counts[1]>2)unsure=true;dbg.push(lines.map(l=>l.R.length))}
  log('INFO','v telefonu: řezy',{pasy:B.length,pocty:dbg,vysledek:total});
  return{c:total,pts,unsure:unsure||B.length>1}}
try{window.uctenkyLocalCount=localCount}catch(e){}
async function localCountRow(r,x){const p=(r.photos||[])[x.ph||0];if(!p||!x.box)throw{code:'empty',msg:'Řádek není označený na fotce'};const rec=await getOne('photos',p.id);const img=await imgFromBlob(rec.blob);return localCount(img,x.box,x.pbox)}
/* ---------- kontrola úplnosti: čárky mimo nalezené rámečky ---------- */
/* nejbližší napsaná cena k rámečku čárek (cena vlevo na stejném řádku má přednost, pak nad) */
function nearestPrice(b,rows,fallback){const P=[];rows.forEach(r=>{if(r.cover||!r.p)return;const pb=r.pbox||[r.box[0],r.box[1],Math.min(r.box[2],r.box[0]+.06),r.box[3]];if(!P.some(q=>q.v===r.p&&Math.abs(q.box[1]-pb[1])<.005&&Math.abs(q.box[0]-pb[0])<.005))P.push({t:'p',v:r.p,box:pb})});
  if(!P.length)return fallback;const seq=readingOrder([...P,{t:'g',box:b}]);let cur=null;for(const o of seq){if(o.t==='p')cur=o;else return cur?cur.v:seq.find(x=>x.t==='p').v}return fallback}
function nearestPrice_old(b,rows,fallback){let best=null,bd=1e9;const cx=(b[0]+b[2])/2,cy=(b[1]+b[3])/2;
  for(const r of rows){if(!r.box||r.cover)continue;const p=r.pbox||[r.box[0],r.box[1],Math.min(r.box[2],r.box[0]+.08),r.box[3]];const px=(p[0]+p[2])/2,py=(p[1]+p[3])/2;
    let dx=cx-px,dy=cy-py;let d=Math.hypot(dx,dy*1.5);if(dy<-.02)d*=1.6; /* cena pod čárkami je méně pravděpodobná */ if(d<bd){bd=d;best=r}}
  return best?+best.p:fallback}
async function coverRows(img,rows,ph,signal){
  const W=img.naturalWidth,Hh=img.naturalHeight;const s=Math.min(1,2000/Math.max(W,Hh));const c=document.createElement('canvas');c.width=Math.round(W*s);c.height=Math.round(Hh*s);
  const g=c.getContext('2d');g.drawImage(img,0,0,c.width,c.height);const lw=Math.max(3,c.width*.004);g.lineWidth=lw;g.font=`bold ${Math.round(c.width*.025)}px sans-serif`;
  rows.forEach(x=>{if(!x.box)return;const [a,b,cc,d]=x.box;g.strokeStyle='#1238ff';g.strokeRect(a*c.width,b*c.height,(cc-a)*c.width,(d-b)*c.height);g.fillStyle='#1238ff';g.fillText(String(x.p),a*c.width+lw,b*c.height-lw)});
  const blob=await canvasBlob(c,.88);const G=G_BOX();
  const fmt=G?'"box_2d":[ymin,xmin,ymax,xmax] v rozsahu 0–1000 vzhledem k celé fotce':'"box":[x1,y1,x2,y2] jako zlomky 0–1 celé fotky (x zleva, y shora)';
  const prompt=`Fotka ručně psané hospodské účtenky. MODRÉ rámečky jsou už nalezené položky (modré číslo = cena). Úkol: najdi všechny ručně psané ČÁRKY na papíře, které NEJSOU uvnitř žádného modrého rámečku – i jednotlivé, rozházené nebo úplně dole.
Ke každé takové skupině urči cenu: má-li vlastní napsanou cenu, použij ji; jinak patří k POSLEDNÍ ceně PŘED nimi v pořadí čtení (účtenka se čte jako text: od levého horního rohu po řádcích zleva doprava; cena platí pro všechny další čárky, dokud nepřijde jiná cena). Žádná čárka nesmí zůstat nepřiřazená. U takové skupiny nastav "own_price": false.
Ignoruj stůl, pozadí, podtácky, tištěný text a samotné modré rámečky a čísla.
CENÍK: ${priceList().join(', ')} Kč. Číslice 5 se často píše jako „T“/„τ“ (55 = „TT“).
Pro každou chybějící skupinu vrať price, count (počet čárek, 4 přeškrtnuté = 5), ${fmt}, "note" krátce česky (např. "pokračování 55 pod prvním řádkem").
Když nic nechybí, vrať {"rows":[]}. Odpověz POUZE JSONem: {"rows":[{"price":55,"own_price":false,"count":2,${G?'"box_2d":[600,200,850,450]':'"box":[0.2,0.6,0.45,0.85]'},"note":""}]}`+hwNote();
  const raw=await aiCall([{text:prompt},{inline_data:{mime_type:'image/jpeg',data:await b64(blob)}}],signal,true);log('INFO','úplnost: odpověď AI',String(raw).slice(0,1200));
  const d=parseJSON(raw);if(d&&!Array.isArray(d.rows))d.rows=rowsOfJSON(d);const ov=(p,q)=>{const ix=Math.max(0,Math.min(p[2],q[2])-Math.max(p[0],q[0])),iy=Math.max(0,Math.min(p[3],q[3])-Math.max(p[1],q[1]));const ar=(p[2]-p[0])*(p[3]-p[1])||1e-6;return ix*iy/ar};
  return (d&&Array.isArray(d.rows)?d.rows:[]).map(x=>({x,b:readBox(x)})).filter(o=>o.b&&num(o.x.price)>0&&num(o.x.count)>0&&!rows.some(r=>r.box&&ov(o.b,r.box)>.5))
    .map(({x,b})=>({p:x.own_price===false?nearestPrice(b,rows,num(x.price)):num(x.price),c:num(x.count),q:0,note:('Doplněno kontrolou úplnosti'+(x.note?': '+String(x.note).slice(0,120):'')),box:b,spots:[],ph,ai:1,pai:num(x.price),pq:0,palts:[],cover:1}))}
/* dvojí přepočet řádků + sloučení + úklid */
async function countRows(rows,fimg,signal,status){
  const crops=[];for(const x of rows)crops.push(x.box?await cropRow(fimg,x.box,x.pbox):null);
  const idx=rows.map((x,i)=>i).filter(i=>crops[i]);let A={},B={};
  const base=idx.length&&idx.every(i=>rows[i].nopr&&rows[i].lc>0);
  if(base){/* skupiny z 1. průchodu už mají počet → stačí jeden přepočet, druhý jen kde se liší */
    status&&status(`Přepočítávám ${idx.length} ${plur(idx.length,'skupinu','skupiny','skupin')} čárek…`,2);
    try{A=await countPass(rows,crops,idx,signal)}catch(e){if(e&&e.name==='AbortError')throw e;log('VAROV','přepočet selhal',errInfo(e))}
    const dis=idx.filter(i=>!A[i]||A[i].c!==rows[i].lc||A[i].q);
    idx.filter(i=>!dis.includes(i)).forEach(i=>B[i]={c:rows[i].lc,q:false,n:'',g:null,bad:[],op:[]});
    if(dis.length){status&&status(`Kontrola ${dis.length} ${plur(dis.length,'sporné skupiny','sporných skupin','sporných skupin')}…`,2);
      try{const R=await countPass(rows,crops,[...dis].reverse(),signal);dis.forEach(i=>{B[i]=R[i]||{c:rows[i].lc,q:true,n:'',g:null,bad:[],op:[]}})}catch(e){if(e&&e.name==='AbortError')throw e;log('VAROV','kontrolní přepočet selhal',errInfo(e))}}
    log('INFO','čtení: přepočet',{shoda:idx.length-dis.length,sporne:dis.length})}
  else if(idx.length){status&&status(`Počítám ${idx.length} ${plur(idx.length,'řádek','řádky','řádků')}, 2× souběžně…`,2);const rs=await Promise.allSettled([countPass(rows,crops,idx,signal),countPass(rows,crops,[...idx].reverse(),signal)]);
    if(signal&&signal.aborted)throw{name:'AbortError'};
    rs.forEach((x,k)=>{if(x.status==='rejected')log('VAROV','přepočet '+(k+1)+' selhal – beru výsledek bez něj',errInfo(x.reason))});
    A=rs[0].status==='fulfilled'?rs[0].value:{};B=rs[1].status==='fulfilled'?rs[1].value:{}}
  log('INFO','čtení: přepočty',{A,B});merge(rows,A,B);
  const drop=rows.filter(x=>!(+x.c>0)&&!(x.alts||[]).some(v=>v>0));if(drop.length)log('INFO','čtení: zahozeny řádky bez čárek',drop.map(x=>[x.p,x.box&&x.box.map(v=>+v.toFixed(2))]));
  return rows.filter(x=>!drop.includes(x))}
const isTall=(x,med)=>!x.nopr&&x.box&&med>0&&(x.box[3]-x.box[1])>med*1.75;
function medianH(rows){const h=rows.filter(x=>x.box).map(x=>x.box[3]-x.box[1]).sort((a,b)=>a-b);return h.length>=3?h[Math.floor(h.length/2)]:0}
async function splitRows(rows,fimg,signal,which,status){let out=[];for(let i=0;i<rows.length;i++){const x=rows[i];
    if(!which(x)){out.push(x);continue}
    try{status&&status('Rozděluji místo s více řádky…',2);const sub=await regionRows(fimg,x.box,x.ph,signal);
      if(sub.length>=2||(sub.length===1&&sub[0].p!==x.p)){const cnt=await countRows(sub,fimg,signal);if(cnt.length){out.push(...cnt);continue}}}
    catch(e){if(e&&e.name==='AbortError')throw e;log('VAROV','rozdělení selhalo',errInfo(e))}
    if(x.multi&&x.multi.length){x.q=1;x.note=`Ve výřezu jsou i jiné ceny (${x.multi.join(', ')} Kč) – nejspíš víc řádků. Klepni na ✂ Rozdělit.`+(x.note?' · '+x.note:'')}
    out.push(x)}
  return out}
/* jeden řádek znovu (ze zvětšení) */
async function recountRow(r,i,status){
  const x=rowsOf(r)[i];const p=(r.photos||[])[x.ph||0];if(!x.box||!p)throw{code:'empty',msg:'Řádek není označený na fotce'};
  const rec=await getOne('photos',p.id);const crop=await cropRow(await imgFromBlob(rec.blob),x.box,x.pbox);
  const tmp=[{...x}];status('AI přepočítává řádek…');
  const [A,B]=await Promise.all([countPass(tmp,[crop],[0]),countPass(tmp,[crop],[0])]);
  const a=A[0],b=B[0];if(!a&&!b)throw{code:'empty',msg:'AI nevrátila počet'};x.ga=(a&&a.g&&a.g.length?a.g:(b&&b.g))||null;x.gb=a&&b&&b.g&&b.g.length?b.g:null;x.bad=[...((a&&a.bad)||[]),...((b&&b.bad)||[])].slice(0,4);
  return a&&b&&a.c===b.c?{c:a.c,sure:!(a.q||b.q),txt:`AI 2× napočítala ${a.c}`}:{c:(a||b).c,sure:false,txt:`AI napočítala ${a?a.c:'?'} a ${b?b.c:'?'} – přepočítej ručně`};
}
/* dialog s průběhem; auto = rovnou použít a projít sporná místa */
async function runAI(auto){
  const r=getR(curId),p=(r.photos||[])[curPhoto];if(!p)return;
  aiResult=null;$('arep').disabled=$('aadd').disabled=true;$('astop').hidden=false;
  const st=$('ast'),pr=$('aprog');st.className='status';pr.textContent='';renderAIName();$('ai').showModal();
  aiCtl=new AbortController();$('aretry').hidden=true;$('aloc').hidden=true;
  const t0=Date.now();let stage='',step=0,stepT=Date.now(),chars=0,thinking=false;
  const STEPS=['Příprava fotky','Hledání řádků a cen','Přepočet každého řádku','Hotovo'];const SPAN=[[0,6,3],[6,55,35],[55,96,30],[100,100,1]];
  const prog=$('aprogress');prog.hidden=false;
  const draw=()=>{const [a,b,tau]=SPAN[step];const el=(Date.now()-stepT)/1000;const pct=step===3?100:a+(b-a)*(1-Math.exp(-el/tau));
    $('apbar').style.width=pct.toFixed(1)+'%';$('appct').textContent=Math.round(pct)+' %';
    $('aptime').textContent=`${Math.round((Date.now()-t0)/1000)} s`;
    $('apsteps').innerHTML=STEPS.map((s,i)=>`<li class="${i<step?'done':i===step?'now':''}">${i<step?'✓':i===step?'<span class="spin"></span>':'○'} ${i===step&&step<3?esc(stage):s}</li>`).join('');
    $('apnote').textContent=waitTo>Date.now()?`Čekám na volný dotaz u Googlu – ${Math.ceil((waitTo-Date.now())/1000)} s…`:step===1||step===2?(chars?`Přijímám odpověď… ${chars} znaků`:thinking?'AI přemýšlí…':'Čekám na AI…')+((Date.now()-stepT)>60000?' · Google teď odpovídá pomalu, vydrž nebo Zastavit a Zkusit znovu.':''):'';};
  let waitTo=0;aiChunk=(n,th)=>{if(n<0){waitTo=Date.now()-n*1000;return}if(n===0)waitTo=0;chars=Math.max(0,n);thinking=th;};
  const tick=setInterval(draw,250);draw();
  try{
    const rows=await readPhoto(p.id,curPhoto,(t,s)=>{stage=t;if(s!=null&&s!==step){step=s;stepT=Date.now();chars=0;thinking=false}draw()},aiCtl.signal);clearInterval(tick);step=3;draw();setTimeout(()=>{prog.hidden=true},900);
    r.pendingAI=false;save(r);
    aiResult=rows;const q=rows.reduce((a,x)=>a+x.c,0),t=rows.reduce((a,x)=>a+x.c*x.p,0),f=rows.filter(x=>x.q).length;
    st.className='status ok';const secs=Math.round((Date.now()-t0)/1000);log('INFO','čtení trvalo',{s:secs,rezim:settings.readMode||'fast'});st.textContent=`Hotovo za ${secs} s: ${rows.length} ${plur(rows.length,'řádek','řádky','řádků')}, ${q} ks, ${kc(t)}. Ke kontrole: ${f}.`;
    pr.textContent=rows.map(x=>`${x.p} Kč × ${x.c}${x.q?'  ⚠ '+x.note:''}`).join('\n');
    $('arep').disabled=$('aadd').disabled=false;
    if(auto&&!rowsOf(r).some(x=>(x.ph||0)===curPhoto)){setTimeout(()=>applyAI(true,true),500)}
  }catch(e){clearInterval(tick);prog.hidden=true;log('CHYBA','čtení selhalo ve fázi: '+stage,errInfo(e));if(e&&e.name!=='AbortError'){$('aloc').hidden=false;$('aloc').textContent=rowsOf(r).some(x=>x.box&&(x.ph||0)===curPhoto)?'📱 Spočítat v telefonu':'📱 Počítat bez AI (označím řádky prstem)'}st.className='status err';st.textContent=aiErr(e)+(stage?` [fáze: ${stage}]`:'');$('aretry').hidden=false;if(e&&e.name!=='AbortError'&&!navigator.onLine){r.pendingAI=true;save(r);st.textContent+=' Přečtu ji sám, až bude internet.'}}
  finally{$('astop').hidden=true;aiCtl=null;aiChunk=null}
}
function renderAIName(){const r=getR(curId);const box=$('aname');if(!r||!box)return;
  const ns=names().filter(n=>n!==(r.name||'').trim()).slice(0,8);
  box.innerHTML=`<label class="f" for="ain">Čí je účtenka?</label><input id="ain" list="nl2" autocomplete="off" value="${esc(r.name||'')}" placeholder="Jméno" style="font-size:18px;font-weight:700"><datalist id="nl2">${names().map(n=>`<option value="${esc(n)}">`).join('')}</datalist>${ns.length?`<div class="chips" style="margin-top:6px">${ns.map(n=>`<button class="mini" data-ainame="${esc(n)}">${esc(n)}${esc(debtBadge(n))}</button>`).join('')}</div>`:''}`}
$('ai').addEventListener('click',e=>{const b=e.target.closest('[data-ainame]');if(!b)return;const r=getR(curId);r.name=b.dataset.ainame;save(r);renderAIName();toast('Uloženo pod jménem '+r.name)});
$('ai').addEventListener('change',e=>{if(e.target.id!=='ain')return;const r=getR(curId);r.name=e.target.value.trim();save(r);renderAIName()});
$('astop').onclick=()=>aiCtl&&aiCtl.abort();
$('aretry').onclick=()=>runAI(true);
$('alog').onclick=()=>copy(logText());
$('ax').onclick=()=>{aiCtl&&aiCtl.abort();$('ai').close()};
function applyAI(replace,walk){const r=getR(curId);if(!r||!aiResult)return;r.rows=replace?[...rowsOf(r).filter(x=>(x.ph||0)!==curPhoto||!x.box),...aiResult]:[...rowsOf(r),...aiResult];aiResult=null;save(r);$('ai').close();render();
  const f=rowsOf(r).findIndex(x=>x.q);if(f>=0){toast('Zkontroluj sporná místa');openZoom(f)}else if(walk)openDone()}
$('arep').onclick=()=>applyAI(true,true);$('aadd').onclick=()=>applyAI(false,true);
/* fronta: přečíst po připojení */
let bgBusy=false;
async function processPending(){
  if(bgBusy||!navigator.onLine||!hasAI())return;const list=receipts.filter(r=>r.pendingAI&&(r.photos||[]).length);if(!list.length)return;bgBusy=true;
  for(const r of list){try{const pi=(r.photos.length-1);const rows=await readPhoto(r.photos[pi].id,pi,t=>{},undefined);
      if(!rowsOf(r).some(x=>(x.ph||0)===pi))r.rows=[...rowsOf(r),...rows];r.pendingAI=false;save(r);toast(`Přečteno: ${r.name||'účtenka'} – ${kc(totR(r)[1])}`);if(view!=='detail'||curId===r.id)render()}
    catch(e){if(e&&e.code==='key')break}}
  bgBusy=false;
}
addEventListener('online',()=>setTimeout(processPending,1500));
/* hotovo: rychlé akce */
function openDone(){const r=getR(curId);if(!r)return;const s=totR(r);
  $('dname').textContent=r.name||'Bez jména';$('dsum').textContent=kc(s[1]);$('dqty').textContent=s[0]+' ks';$('done').showModal()}
$('done').addEventListener('click',e=>{const b=e.target.closest('[data-done]');if(!b)return;const k=b.dataset.done;const r=getR(curId);$('done').close();
  if(k==='pay')openPay(r);else if(k==='part')openPay(r,null,true);else if(k==='send')openMail([r]);else if(k==='next'){view='list';render();setTimeout(()=>$('camq').click(),50)}else{view='list';render()}});

/* ---------- doklad o zaplacení ---------- */
let payR=null,sigDirty=false,payTimer;
const sig=$('psig'),sctx=sig.getContext('2d');
function sigReset(){sctx.fillStyle='#fff';sctx.fillRect(0,0,sig.width,sig.height);sigDirty=false}
let sdraw=null;
const sp=e=>{const r=sig.getBoundingClientRect();return[(e.clientX-r.left)*sig.width/r.width,(e.clientY-r.top)*sig.height/r.height]};
sig.addEventListener('pointerdown',e=>{e.preventDefault();sig.setPointerCapture(e.pointerId);sdraw=sp(e)});
sig.addEventListener('pointermove',e=>{if(!sdraw)return;const p=sp(e);sctx.strokeStyle='#1f3a9e';sctx.lineWidth=5;sctx.lineCap='round';sctx.lineJoin='round';sctx.beginPath();sctx.moveTo(sdraw[0],sdraw[1]);sctx.lineTo(p[0],p[1]);sctx.stroke();sdraw=p;sigDirty=true});
sig.addEventListener('pointerup',()=>{sdraw=null;queuePrev()});
$('psclr').onclick=()=>{sigReset();queuePrev()};
const payNo=()=>`${settings.payPrefix!=null&&settings.payPrefix!==''?settings.payPrefix:new Date().getFullYear()+'-'}${String(settings.payNext||1).padStart(3,'0')}`;
function fillPay(r,pi){
  payR=r;payIdx=pi==null?-1:pi;const p=(r.isGroup||payIdx<0)?{}:pays(r)[payIdx]||{};const tot=r.isGroup?r.due:dueR(r);
  $('pno').value=p.no||payNo();$('pdate').value=p.date||today();$('pmeth').value=p.method||'Hotově';
  $('pamt').value=p.amount!=null?p.amount:tot;$('pwho').value=p.payer||r.name||'';$('pby').value=p.by||settings.issuer||'';
  $('pnote').value=p.note!=null?p.note:r.isGroup?`Úhrada dluhu za ${r.list.length} ${plur(r.list.length,'účtenku','účtenky','účtenek')}`:(`Útrata ${fmtD(r.date)}`+(r.note?' – '+r.note:''));
  sigReset();$('pskeep').checked=!!settings.signature;$('pst').textContent='';
  const src=p.sig||(payIdx>=0?'':settings.signature);
  return src?loadImg(src).then(i=>{sctx.drawImage(i,0,0,sig.width,sig.height);sigDirty=true;queuePrev()}).catch(()=>{}):Promise.resolve();
}
let payIdx=-1;
function openPay(r,pi,partial){
  fillPay(r,pi);if(partial){$('pamt').value='';setTimeout(()=>{$('pamt').focus()},80)}
  $('pquick').innerHTML=payIdx<0?[[ 'Celé '+kc(r.isGroup?r.due:dueR(r)),r.isGroup?r.due:dueR(r)],...[100,200,500,1000].filter(v=>v<(r.isGroup?r.due:dueR(r))).map(v=>[kc(v),v])].map(([l,v])=>`<button class="mini" data-amt="${v}">${l}</button>`).join(''):'';
  const fl=flagsR(r);if(fl){$('pst').className='status err';$('pst').textContent=`Pozor: ${fl} ${plur(fl,'řádek není zkontrolovaný','řádky nejsou zkontrolované','řádků není zkontrolovaných')}.`}
  $('pok').textContent=payIdx>=0?'Uložit změny':'Potvrdit platbu';$('ptitle').textContent=r.isGroup?'Platba dluhu – '+r.name:payIdx>=0?'Doklad o zaplacení':'Nová platba';$('pay').showModal();queuePrev();
}
function payData(){return{no:$('pno').value.trim()||payNo(),date:$('pdate').value||today(),method:$('pmeth').value,amount:num($('pamt').value),payer:$('pwho').value.trim(),by:$('pby').value.trim(),note:$('pnote').value.trim()}}
['pno','pdate','pmeth','pamt','pwho','pby','pnote'].forEach(id=>$(id).addEventListener('input',()=>queuePrev()));
function queuePrev(){clearTimeout(payTimer);payTimer=setTimeout(()=>{$('pprev').src=drawDoc().toDataURL('image/jpeg',.85)},120)}
function wrapText(c,t,x,y,maxW,lh){const words=String(t).split(' ');let line='';for(const w of words){const test=line?line+' '+w:w;if(c.measureText(test).width>maxW&&line){c.fillText(line,x,y);y+=lh;line=w}else line=test}if(line){c.fillText(line,x,y);y+=lh}return y}
function allocate(g,amount){let left=amount;return g.list.map(r=>{const due=dueR(r);const a=Math.min(due,left);left-=a;return{r,due,amount:a}}).filter(x=>x.amount>0||x.due>0)}
function drawDoc(){
  const d=payData(),r=payR;const W=1240,H=1754,c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
  const F='-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
  g.fillStyle='#fff';g.fillRect(0,0,W,H);g.fillStyle='#1f3a9e';g.fillRect(0,0,W,18);
  const L=100,R=W-100;let y=130;
  g.fillStyle='#151826';g.font=`700 58px ${F}`;g.fillText('Potvrzení o zaplacení',L,y);
  g.font=`400 30px ${F}`;g.fillStyle='#5d6273';g.textAlign='right';g.fillText('č. '+d.no,R,y-4);g.textAlign='left';
  y+=34;g.font=`400 24px ${F}`;g.fillText('Doklad o přijetí platby. Není daňovým dokladem.',L,y);
  y+=60;g.strokeStyle='#e3e0d8';g.lineWidth=2;g.beginPath();g.moveTo(L,y);g.lineTo(R,y);g.stroke();
  // two columns
  y+=56;const colW=(R-L)/2;
  const block=(x,title,lines)=>{let yy=y;g.fillStyle='#5d6273';g.font=`600 24px ${F}`;g.fillText(title,x,yy);yy+=42;g.fillStyle='#151826';g.font=`600 32px ${F}`;g.fillText(lines[0]||'—',x,yy);yy+=40;g.font=`400 26px ${F}`;g.fillStyle='#3a3f50';lines.slice(1).forEach(l=>{if(l){g.fillText(l,x,yy);yy+=34}});return yy};
  const y1=block(L,'Platbu přijal(a)',[d.by||settings.issuer||'',...String(settings.issuerInfo||'').split('\n').slice(0,4)]);
  const y2=block(L+colW,'Zaplatil(a)',[d.payer||'']);
  y=Math.max(y1,y2)+30;
  const info=[['Datum zaplacení',fmtD(d.date)],['Způsob platby',d.method],r.isGroup?['Úhrada dluhu',`${r.list.length} ${plur(r.list.length,'účtenka','účtenky','účtenek')}`]:['Datum útraty',fmtD(r.date)]];
  g.font=`400 28px ${F}`;info.forEach(([k,v])=>{g.fillStyle='#5d6273';g.fillText(k,L,y);g.fillStyle='#151826';g.font=`600 28px ${F}`;g.fillText(v,L+300,y);g.font=`400 28px ${F}`;y+=44});
  if(d.note){g.fillStyle='#5d6273';g.fillText('Poznámka',L,y);g.fillStyle='#151826';y=wrapText(g,d.note,L+300,y,R-L-300,38);y+=6}
  // table by price
  y+=30;g.fillStyle='#eef1fb';g.fillRect(L,y-38,R-L,56);g.fillStyle='#151826';g.font=`600 26px ${F}`;
  g.fillText('Položka',L+16,y);g.textAlign='right';g.fillText('Cena',L+640,y);g.fillText('Kusů',L+820,y);g.fillText('Celkem',R-16,y);g.textAlign='left';y+=56;
  if(r.isGroup){
    g.fillStyle='#eef1fb';g.fillRect(L,y-94,R-L,56);g.fillStyle='#151826';g.font=`600 26px ${F}`;g.fillText('Účtenka',L+16,y-56);g.textAlign='right';g.fillText('Dlužno',L+640,y-56);g.fillText('Nyní',L+820,y-56);g.fillText('Zbývá',R-16,y-56);g.textAlign='left';
    g.fillStyle='#fff';g.fillRect(L,y-36,R-L,60);g.font=`400 28px ${F}`;
    const al=allocate(r,d.amount);let sd=0,sn=0;
    al.slice(0,14).forEach(x=>{g.fillStyle='#151826';g.fillText(fmtD(x.r.date)+(x.r.note?' – '+String(x.r.note).slice(0,18):''),L+16,y);g.textAlign='right';g.fillText(kc(x.due),L+640,y);g.fillText(kc(x.amount),L+820,y);g.fillText(kc(x.due-x.amount),R-16,y);g.textAlign='left';g.strokeStyle='#eeeae2';g.beginPath();g.moveTo(L,y+18);g.lineTo(R,y+18);g.stroke();y+=48;sd+=x.due;sn+=x.amount});
    y+=8;g.strokeStyle='#1f3a9e';g.lineWidth=4;g.beginPath();g.moveTo(L,y);g.lineTo(R,y);g.stroke();y+=50;
    g.font=`600 30px ${F}`;g.fillText('Celkem dluh',L+16,y);g.textAlign='right';g.fillText(kc(sd),L+640,y);g.fillText(kc(sn),L+820,y);g.fillText(kc(sd-sn),R-16,y);g.textAlign='left';y+=80;
    g.fillStyle='#1f3a9e';g.fillRect(L,y,R-L,130);g.fillStyle='#fff';g.font=`600 30px ${F}`;g.fillText('Zaplaceno',L+30,y+56);g.font=`400 24px ${F}`;g.fillText(d.method+' · '+fmtD(d.date),L+30,y+96);g.font=`700 64px ${F}`;g.textAlign='right';g.fillText(kc(d.amount),R-30,y+88);g.textAlign='left';
    y+=170;g.font=`600 28px ${F}`;g.fillStyle=sd-sn>0?'#a3121f':'#1d7a46';g.fillText(sd-sn>0?`Zbývá dluh: ${kc(sd-sn)}`:'Dluh je celý uhrazen.',L,y);if(d.amount>sd){y+=40;g.fillStyle='#a3121f';g.fillText(`Přeplatek k vrácení: ${kc(d.amount-sd)}`,L,y)}
  }else{
  const bp=byPrice([r]);g.font=`400 28px ${F}`;let sum=0,cnt=0;
  const maxRows=Math.floor((H-560-y)/48);
  bp.slice(0,maxRows).forEach(([p,n])=>{g.fillStyle='#151826';g.fillText('Konzumace',L+16,y);g.textAlign='right';g.fillText(kc(p),L+640,y);g.fillText(String(n),L+820,y);g.fillText(kc(p*n),R-16,y);g.textAlign='left';
    g.strokeStyle='#eeeae2';g.beginPath();g.moveTo(L,y+18);g.lineTo(R,y+18);g.stroke();y+=48;sum+=p*n;cnt+=n});
  if(bp.length>maxRows){const rest=bp.slice(maxRows);let rs=0,rc=0;rest.forEach(([p,n])=>{rs+=p*n;rc+=n});g.fillText(`Další položky (${rest.length})`,L+16,y);g.textAlign='right';g.fillText(String(rc),L+820,y);g.fillText(kc(rs),R-16,y);g.textAlign='left';y+=48;sum+=rs;cnt+=rc}
  y+=8;g.strokeStyle='#1f3a9e';g.lineWidth=4;g.beginPath();g.moveTo(L,y);g.lineTo(R,y);g.stroke();y+=50;
  g.font=`600 30px ${F}`;g.fillText('Celkem útrata',L+16,y);g.textAlign='right';g.fillText(String(cnt)+' ks',L+820,y);g.fillText(kc(sum),R-16,y);g.textAlign='left';y+=80;
  // paid box
  g.fillStyle='#1f3a9e';g.fillRect(L,y,R-L,130);g.fillStyle='#fff';g.font=`600 30px ${F}`;g.fillText('Zaplaceno',L+30,y+56);g.font=`400 24px ${F}`;g.fillText(d.method+' · '+fmtD(d.date),L+30,y+96);
  g.font=`700 64px ${F}`;g.textAlign='right';g.fillText(kc(d.amount),R-30,y+88);g.textAlign='left';
  const others=pays(r).filter((p,i)=>i!==payIdx&&(payIdx<0||i<payIdx)).reduce((a,p)=>a+(+p.amount||0),0);const left=sum-others-d.amount;
  y+=170;g.font=`400 26px ${F}`;g.fillStyle='#3a3f50';if(others){g.fillText(`Dříve zaplaceno: ${kc(others)}`,L,y);y+=40}
  g.font=`600 28px ${F}`;g.fillStyle=left>0?'#a3121f':'#1d7a46';g.fillText(left>0?`Zbývá doplatit: ${kc(left)}`:left<0?`Přeplatek: ${kc(-left)}`:'Útrata je celá zaplacena.',L,y);
  }
  // signature
  const sy=H-300;g.fillStyle='#5d6273';g.font=`400 24px ${F}`;
  if(sigDirty){g.drawImage(sig,R-460,sy-120,440,127)}
  g.strokeStyle='#999';g.lineWidth=2;g.beginPath();g.moveTo(R-460,sy+20);g.lineTo(R,sy+20);g.stroke();g.fillText('Podpis – platbu přijal(a)',R-460,sy+56);
  g.fillText('Vystaveno '+new Date().toLocaleString('cs-CZ'),L,sy+56);
  const ee=!r.isGroup&&payIdx>=0&&pays(r)[payIdx]&&pays(r)[payIdx].eet;if(ee){g.font=`400 20px ${F}`;g.fillStyle='#3a3f50';const t=ee.state==='ok'?`Evidováno v EET${ee.test?' (TEST)':''} · POK ${ee.pok}`:ee.state==='manual-ok'?'Evidováno v MOJE EET':ee.state==='manual'?'Evidence v MOJE EET: probíhá':'EET: čeká na odeslání';g.fillText(t,L,sy+92)}
  g.font=`400 20px ${F}`;g.fillText('Přeškrtnuté 4 čárky = 5 ks. Vytvořeno v aplikaci Účtenky.',L,H-80);
  return c;
}
// minimal PDF from a JPEG (A4)
function jpegPdf(jpg,w,h){
  const enc=new TextEncoder();const parts=[];let len=0;const offs=[];
  const add=x=>{const b=typeof x==='string'?enc.encode(x):x;parts.push(b);len+=b.length};
  const obj=(n,body)=>{offs[n]=len;add(`${n} 0 obj\n`);body();add('\nendobj\n')};
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1,()=>add('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2,()=>add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3,()=>add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'));
  obj(4,()=>{add(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);add(jpg);add('\nendstream')});
  const cs='q 595 0 0 842 0 0 cm /Im0 Do Q';
  obj(5,()=>add(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
  const x=len;add('xref\n0 6\n0000000000 65535 f \n');for(let i=1;i<=5;i++)add(String(offs[i]).padStart(10,'0')+' 00000 n \n');
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`);
  return new Blob(parts,{type:'application/pdf'});
}
async function docPdfB64(r){await fillPay(r,pays(r).length-1);const c=drawDoc();const blob=await canvasBlob(c,.82);const jpg=new Uint8Array(await blob.arrayBuffer());const pdf=jpegPdf(jpg,1240,1754);const d=await blobToDataURL(pdf);return d.split(',')[1]}
function newEet(d){return eetApplies(d)?{mode:settings.eetMode,state:settings.eetMode==='server'?'pending':'manual',amount:d.amount,porad_cis:d.no.replace(/[^0-9a-zA-Z\.,:;\/#\-_ ]/g,'-').slice(0,25),dat_trzby:new Date().toISOString(),created:Date.now(),attempts:0}:null}
let lastEetRef=null;
function commitPay(){
  const d=payData();const r=payR;
  if(sigDirty&&$('pskeep').checked)settings.signature=sig.toDataURL('image/png');else if(!$('pskeep').checked)settings.signature='';
  const sg=sigDirty?sig.toDataURL('image/png'):'';
  if(!d.amount){toast('Zadej zaplacenou částku',true);throw{name:'NoAmount'}}
  if(r.isGroup){
    if(r.committed)return;
    const al=allocate(r,d.amount).filter(x=>x.amount>0);const eet=newEet(d);
    al.forEach((x,k)=>{const p={...d,amount:x.amount,sig:sg,issuedAt:Date.now(),group:d.no,groupTotal:d.amount,eet:k===0?eet:null};pays(x.r).push(p);save(x.r);if(k===0)lastEetRef={r:x.r,p}});
    r.committed=true;log('INFO','platba dluhu',{jmeno:r.name,castka:d.amount,rozdeleno:al.map(x=>[x.r.date,x.amount])});
  }else if(payIdx>=0){const p=pays(r)[payIdx];Object.assign(p,d,{sig:sg||p.sig,eet:p.eet||newEet(d)});save(r);lastEetRef={r,p}}
  else{const p={...d,sig:sg,issuedAt:Date.now(),eet:newEet(d)};pays(r).push(p);payIdx=pays(r).length-1;save(r);lastEetRef={r,p};log('INFO','platba',{castka:d.amount,zbyva:dueR(r)})}
  if(d.no===payNo())settings.payNext=(settings.payNext||1)+1;
  saveSettings();
}
const fileBase=()=>`doklad-${payData().no.replace(/[^\w-]+/g,'-')}-${(payData().payer||'').normalize('NFD').replace(/[^\w]+/g,'-')}`.replace(/-+$/,'');
const payText=()=>{const d=payData();return `Potvrzení o zaplacení č. ${d.no}\n${d.payer||''} zaplatil(a) ${kc(d.amount)} (${d.method}) dne ${fmtD(d.date)}.\n${d.note?d.note+'\n':''}Platbu přijal(a): ${d.by||settings.issuer||''}`};
async function shareFile(file,fallbackName){
  if(claudeDl){log('INFO','ukládám přes Claude',{name:fallbackName,kB:Math.round(file.size/1024)});
    try{await claudeDl.save({filename:fallbackName,data:file});return 'shared'}
    catch(e){log('CHYBA','downloads.save',errInfo(e));if(e&&e.code==='declined')throw{name:'AbortError'};throw new Error('Uložení souboru odmítnuto: '+(e&&e.code||''))}}
  if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:'Doklad o zaplacení',text:payText()});return 'shared'}
  const a=document.createElement('a');a.href=URL.createObjectURL(file);a.download=fallbackName;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);return 'saved'
}
$('ppdf').onclick=async()=>{const st=$('pst');try{
  const c=drawDoc();const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.9));const jpg=new Uint8Array(await blob.arrayBuffer());
  const pdf=jpegPdf(jpg,1240,1754);commitPay();const name=fileBase()+'.pdf';
  const how=await shareFile(new File([pdf],name,{type:'application/pdf'}),name);
  st.className='status ok';st.textContent=how==='shared'?'Doklad vystaven a předán ke sdílení (vyber Mail, WhatsApp…).':'Doklad vystaven a uložen jako '+name;
}catch(e){if(e&&e.name==='NoAmount')return;if(e&&e.name==='AbortError'){st.className='status';st.textContent='Platba uložena, sdílení jsi zrušil.';return}st.className='status err';st.textContent='Doklad se nepodařilo vytvořit.'}};
$('pimg').onclick=async()=>{const st=$('pst');try{
  const c=drawDoc();const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.9));commitPay();const name=fileBase()+'.jpg';
  const how=await shareFile(new File([blob],name,{type:'image/jpeg'}),name);
  st.className='status ok';st.textContent=how==='shared'?'Obrázek dokladu předán ke sdílení.':'Uloženo jako '+name;
}catch(e){if(e&&e.name==='NoAmount')return;if(e&&e.name==='AbortError'){st.textContent='';return}st.className='status err';st.textContent='Obrázek se nepodařilo vytvořit.'}};
$('pmail').onclick=()=>{try{commitPay()}catch(e){return}if(payR.isGroup){$('pay').close();openReminder(payR.name,true);return}if(claudeMcp){$('pay').close();openMail([payR],true);return}const d=payData();location.href=`mailto:${encodeURIComponent(settings.email||'').replace(/%40/g,'@')}?subject=${encodeURIComponent('Potvrzení o zaplacení č. '+d.no)}&body=${encodeURIComponent(payText()+'\n\n'+receiptText(payR)+'\n\n(PDF dokladu pošli přes „Odeslat PDF“.)')}`};
$('pamt').addEventListener('input',()=>{});
$('pquick').onclick=e=>{const b=e.target.closest('[data-amt]');if(!b)return;$('pamt').value=b.dataset.amt;queuePrev()};
$('pok').onclick=async()=>{const st=$('pst');snapAll('Platba uložena');try{commitPay()}catch(e){undoSnap=null;return}const r=lastEetRef&&lastEetRef.r;const pp=lastEetRef&&lastEetRef.p;
  const left=payR.isGroup?debtOf(payR.name).due:dueR(payR);st.className='status ok';st.textContent=left>0?`Platba uložena. Zbývá doplatit ${kc(left)}.`:'Platba uložena. Zaplaceno celé ✓';
  const ee=pp&&pp.eet;
  if(ee&&ee.mode==='server'&&ee.state!=='ok'){st.className='status';st.textContent='Odesílám do EET…';await sendEet(r,pp);
    const e2=pp.eet;st.className=e2.state==='ok'?'status ok':'status err';st.textContent=e2.state==='ok'?`Zaevidováno v EET${e2.test?' (test)':''}. POK ${e2.pok}`:`EET zatím neodešlo: ${e2.lastError||''}. Zkusím to znovu sám.`}
  else if(ee&&ee.mode==='moje'&&ee.state!=='manual-ok'){openMoje(r,pp)}
  queuePrev();$('pok').textContent='Uloženo ✓';$('pok').disabled=true;render();undoSnap.msg=`Zaplaceno ${kc(payData().amount)}`};
$('px').onclick=()=>$('pay').close();
$('pay').addEventListener('close',()=>{$('pok').disabled=false;render();if(undoSnap)offerUndo()});

/* ---------- EET 2.0 ---------- */
const eetApplies=p=>settings.eetMode!=='off'&&p&&p.method!=='Převodem na účet'&&p.amount>0;
const uuid4=()=>crypto.randomUUID?crypto.randomUUID():'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
let eetBusy=false;
async function sendEet(r,p){p=p||pays(r).find(x=>x.eet&&x.eet.mode==='server'&&x.eet.state!=='ok')||r.payment;
  const ee=p&&p.eet;if(!ee||ee.mode!=='server'||ee.state==='ok')return;
  if(!settings.eetUrl||!settings.eetToken){ee.state='pending';ee.lastError='Chybí nastavení EET serveru';save(r);return}
  const body={uuid:uuid4(),first:!ee.attempts,overeni:!!settings.eetOvereni||undefined,id_jednotky:settings.eetJednotka,id_pokl:settings.eetPokl,porad_cis:ee.porad_cis,dat_trzby:ee.dat_trzby,celk_trzba:ee.amount};
  ee.attempts=(ee.attempts||0)+1;ee.lastTry=Date.now();
  try{
    const res=await fetch(settings.eetUrl.replace(/\/+$/,'')+'/eet/send',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+settings.eetToken},body:JSON.stringify(body),signal:AbortSignal.timeout?AbortSignal.timeout(12000):undefined});
    const d=await res.json().catch(()=>({}));
    if(res.status===401){ee.state='pending';ee.lastError='Server odmítl token'}
    else if(d.ok&&d.pok){Object.assign(ee,{state:'ok',pok:d.pok,test:!!d.test,warnings:d.warnings||[],at:Date.now(),lastError:''})}
    else if(d.ok&&d.overeno){ee.state='pending';ee.lastError='Ověřovací režim: data jsou v pořádku, tržba ale není zaevidovaná'}
    else{ee.state=d.retry===false?'error':'pending';ee.lastError=(d.error&&(d.error.kod+': '+d.error.text))||('HTTP '+res.status)}
  }catch(e){log('CHYBA','EET odeslání',errInfo(e));ee.state='pending';ee.lastError=navigator.onLine?'Server neodpověděl':'Offline'}
  log('INFO','EET výsledek',{state:ee.state,pok:ee.pok,err:ee.lastError});
  save(r);
}
async function processEet(){
  if(eetBusy||!navigator.onLine||settings.eetMode!=='server')return;eetBusy=true;
  try{for(const r of receipts)for(const p of pays(r)){const ee=p.eet;if(ee&&ee.mode==='server'&&ee.state==='pending'&&(!ee.lastTry||Date.now()-ee.lastTry>45000)){await sendEet(r,p);if(ee.state==='ok')toast('EET odesláno: '+(r.name||'účtenka'))}}}
  finally{eetBusy=false;if(view!=='detail')render()}
}
const eetPending=()=>receipts.flatMap(r=>pays(r).filter(p=>p.eet&&p.eet.mode==='server'&&p.eet.state!=='ok').map(p=>({r,p})));
setInterval(processEet,60000);addEventListener('online',()=>setTimeout(processEet,3000));
let mojeP=null;function openMoje(r,p){mojeP=p||r.payment;$('emAmt').textContent=kc(mojeP.eet&&mojeP.eet.amount||mojeP.amount);$('emNo').textContent=mojeP.no;$('eetm').dataset.id=r.id;$('eetm').showModal()}
$('emGo').onclick=async()=>{const r=getR($('eetm').dataset.id);try{await navigator.clipboard.writeText(String(mojeP.eet&&mojeP.eet.amount||mojeP.amount))}catch(e){}window.open(settings.eetMojeUrl||'https://eet.gov.cz','_blank')};
$('emDone').onclick=()=>{const r=getR($('eetm').dataset.id);if(r&&mojeP&&mojeP.eet){mojeP.eet.state='manual-ok';mojeP.eet.at=Date.now();save(r)}$('eetm').close();queuePrev();render();toast('Označeno jako zaevidované')};
$('emLater').onclick=()=>$('eetm').close();

/* ---------- email / share ---------- */
let mailList=[];
let mailCustom='';const mailText=()=>($('mmsg').value?$('mmsg').value+'\n\n':'')+(mailCustom||(mailList.length===1?receiptText(mailList[0]):summaryText(mailList)));
function openMail(list,withDoc,custom,subj,to){
  mailList=list;mailCustom=custom||'';$('msms').hidden=true;
  const canDoc=!custom&&list.length===1&&pays(list[0]).length>0;$('mdocl').hidden=!canDoc;$('mdoc').checked=!!(canDoc&&(withDoc||claudeMcp));
  $('mgmail').hidden=!claudeMcp;$('msend').className=claudeMcp?'':'pri';let t=0;list.forEach(r=>t+=totR(r)[1]);
  $('mto').value=to||settings.email||'';
  $('msub').value=list.length===1?`Účtenka – ${list[0].name||'Bez jména'} – ${fmtD(list[0].date)} – ${kc(t)}`:`Souhrn účtenek – ${kc(t)}`;
  if(subj)$('msub').value=subj;$('mmsg').value='';$('mst').textContent='';
  const hasPh=list.some(r=>(r.photos||[]).length);
  $('mphl').hidden=!hasPh;$('mshare').hidden=!(navigator.share);
  const fl=list.reduce((n,r)=>n+flagsR(r),0);
  $('mst').className=fl?'status err':'status';$('mst').textContent=fl?`Pozor: ${fl} ${plur(fl,'řádek není zkontrolovaný','řádky nejsou zkontrolované','řádků není zkontrolovaných')}. Částka nemusí sedět.`:'';
  $('mprev').textContent=mailText();$('mail').showModal();
}
$('mmsg').addEventListener('input',()=>$('mprev').textContent=mailText());
$('mx').onclick=()=>$('mail').close();
$('mgmail').onclick=async()=>{
  const st=$('mst');const to=$('mto').value.split(/[,;\s]+/).map(s=>s.trim()).filter(Boolean);
  if(!to.length||to.some(a=>!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a))){st.className='status err';st.textContent='Zadej platnou e-mailovou adresu.';$('mto').focus();return}
  $('mgmail').disabled=true;st.className='status';st.textContent='Připravuji přílohy…';
  try{
    const att=[];let size=0;
    if(!$('mdocl').hidden&&$('mdoc').checked){const r=mailList[0];const b=await docPdfB64(r);att.push({content:b,filename:`doklad-${(r.payment||{}).no||'x'}.pdf`,mimeType:'application/pdf'});size+=b.length}
    if($('mph').checked&&!$('mphl').hidden){let n=0;for(const r of mailList)for(const p of r.photos||[]){if(n>=3)break;const rec=await getOne('photos',p.id);if(!rec)continue;const {blob}=await shrink(rec.blob,1300,.75);const b=(await blobToDataURL(blob)).split(',')[1];if(size+b.length>850000){log('VAROV','fotka vynechána kvůli velikosti');continue}att.push({content:b,filename:`uctenka-${++n}.jpg`,mimeType:'image/jpeg'});size+=b.length}}
    const body=mailText();
    st.textContent='Odesílám přes Gmail…';log('INFO','Gmail odeslání',{to:to.length,prilohy:att.map(a=>a.filename),kB:Math.round(size*0.75/1024)});
    await claudeMcp.callTool('Gmail','send_message',{to,subject:$('msub').value||'Účtenka',body,...(att.length?{attachments:att}:{})});
    markSent(to.join(', '));st.className='status ok';st.textContent='Odesláno na '+to.join(', ')+' ✓';log('INFO','Gmail odesláno');
    setTimeout(()=>{$('mail').close();render()},1500);
  }catch(e){log('CHYBA','Gmail',errInfo(e));const c=e&&e.code;st.className='status err';
    st.textContent=c==='needs_reauth'?'Gmail je potřeba znovu připojit v claude.ai → Nastavení → Konektory.':c==='server_not_connected'?'Gmail není v Claude připojený. Přidej ho v claude.ai → Nastavení → Konektory.':c==='not_in_manifest'||c==='approval_required'?'Odeslání nebylo povoleno. Klepni znovu a povol přístup ke Gmailu.':c==='tool_error'?'Gmail e-mail odmítl: '+String(e.message||'').slice(0,140):c==='server_unavailable'||c==='upstream_error'?'Gmail neodpověděl. Než to zkusíš znovu, mrkni do Odeslané pošty.':'Odeslání se nepovedlo: '+errTxt(e)}
  finally{$('mgmail').disabled=false}
};
$('msms').onclick=()=>{location.href=`sms:${$('msms').dataset.phone}&body=${encodeURIComponent(mailText())}`};
$('mcopy').onclick=()=>copy($('msub').value+'\n\n'+mailText());
function markSent(to){const now=Date.now();mailList.forEach(r=>{r.sentAt=now;r.sentTo=to;save(r)});if(to&&!settings.email){settings.email=to;saveSettings()}}
$('msend').onclick=()=>{
  const to=$('mto').value.trim();
  const href=`mailto:${encodeURIComponent(to).replace(/%40/g,'@').replace(/%2C/g,',')}?subject=${encodeURIComponent($('msub').value)}&body=${encodeURIComponent(mailText()+($('mph').checked&&!$('mphl').hidden?'\n\n(Fotky pošli přes „Sdílet s fotkami“.)':''))}`;
  markSent(to);location.href=href;
};
$('mshare').onclick=async()=>{
  const st=$('mst');st.className='status';st.textContent='Připravuji…';
  try{
    const files=[];
    if($('mph').checked&&!$('mphl').hidden){let n=0;for(const r of mailList)for(const p of r.photos||[]){const rec=await getOne('photos',p.id);if(!rec)continue;const {blob}=await shrink(rec.blob,1600,.82);files.push(new File([blob],`uctenka-${(r.name||'bez-jmena').normalize('NFD').replace(/[^\w]+/g,'-')}-${++n}.jpg`,{type:'image/jpeg'}))}}
    const data={title:$('msub').value,text:$('msub').value+'\n\n'+mailText()};
    if(files.length&&navigator.canShare&&navigator.canShare({files}))data.files=files;
    await navigator.share(data);
    markSent($('mto').value.trim());st.className='status ok';st.textContent='Předáno ke sdílení. V nabídce vyber Mail.';
  }catch(e){if(e&&e.name==='AbortError'){st.textContent='';return}st.className='status err';st.textContent='Sdílení se nepovedlo. Použij „Otevřít v Mailu“ nebo „Kopírovat text“.'}
};

/* ---------- backup ---------- */
const b64ToBlob=(b,type)=>{const s=atob(b);const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return new Blob([u],{type})};
const dataURLToBlob=d=>{const m=d.match(/^data:([^;,]+)?(;base64)?,(.*)$/);return m[2]?b64ToBlob(m[3],m[1]||'application/octet-stream'):new Blob([decodeURIComponent(m[3])],{type:m[1]||'text/plain'})};
const blobToDataURL=b=>new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=rej;fr.readAsDataURL(b)});
async function exportBackup(){
  const st=$('bst');st.className='status';st.textContent='Připravuji zálohu…';
  try{
    const photos=[];for(const r of receipts)for(const p of r.photos||[]){const rec=await getOne('photos',p.id);if(rec)photos.push({id:p.id,data:await blobToDataURL(rec.blob)})}
    const json=JSON.stringify({app:'uctenky',v:1,exported:new Date().toISOString(),settings,receipts,photos});
    const name=`uctenky-zaloha-${today()}.json`;const file=new File([json],name,{type:'application/json'});
    if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:name});st.className='status ok';st.textContent='Záloha předána – ulož ji do Souborů.';return}catch(e){if(e.name==='AbortError'){st.textContent='';return}}}
    const a=document.createElement('a');a.href=URL.createObjectURL(file);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    st.className='status ok';st.textContent='Záloha uložena: '+name;
  }catch(e){st.className='status err';st.textContent='Zálohu se nepodařilo vytvořit.'}
}
async function importBackup(file){
  const st=$('bst');st.className='status';st.textContent='Načítám zálohu…';
  try{
    const d=JSON.parse(await file.text());if(!d||!Array.isArray(d.receipts))throw 0;
    let added=0,upd=0;
    for(const p of d.photos||[]){if(!p.id||!p.data)continue;const blob=dataURLToBlob(p.data);memPhotos.set(p.id,blob);if(!memMode){const buf=await blob.arrayBuffer();await tx('photos','readwrite',s=>s.put({id:p.id,buf,type:blob.type||'image/jpeg'})).catch(e=>goMem(e))}}
    for(const r of d.receipts){if(!r||!r.id)continue;const ex=getR(r.id);if(ex){if((r.updatedAt||0)>=(ex.updatedAt||0)){Object.assign(ex,r);upd++}}else{receipts.push(syncR(r));added++}
      if(!memMode)await tx('receipts','readwrite',s=>s.put(JSON.parse(JSON.stringify(getR(r.id))))).catch(e=>goMem(e))}
    if(d.settings&&!settings.email&&d.settings.email){settings.email=d.settings.email;await saveSettings()}
    await preloadURLs();
    st.className='status ok';st.textContent=`Načteno: ${added} nových, ${upd} aktualizovaných účtenek.`;
    setTimeout(()=>{view='list';render()},900);
  }catch(e){st.className='status err';st.textContent='Tohle není platná záloha účtenek.'}
}

/* ---------- rychlé focení ---------- */
async function quickCapture(file){
  const r={id:uid(),name:person||'',date:today(),status:'open',note:'',photos:[],rows:[],createdAt:Date.now(),updatedAt:Date.now()};
  receipts.push(r);curId=r.id;curPhoto=0;view='detail';
  await addPhotos([file]);scrollTo(0,0);
  if(hasAI()&&navigator.onLine)runAI(true);
  else if(hasAI()){r.pendingAI=true;save(r);render();toast('Jsi offline – přečtu ji sama, až bude internet.')}
  else{render();setTimeout(()=>{const e=$('rn');e&&e.focus()},60)}
}
/* ---------- events ---------- */
document.querySelector('nav.tabbar').addEventListener('click',e=>{const b=e.target.closest('[data-nav]');if(!b)return;view=b.dataset.nav;render();scrollTo(0,0)});
$('fab').onclick=newReceipt;
app.addEventListener('input',e=>{if(e.target.id==='q'){query=e.target.value;const pos=e.target.selectionStart;renderList();const q=$('q');q.focus();q.setSelectionRange(pos,pos)}});
app.addEventListener('change',async e=>{
  const t=e.target;
  if(t.id==='camq'||t.id==='galq'){const fs=[...t.files];t.value='';if(!fs.length)return;await quickCapture(fs[0]);return}
  const r=getR(curId);
  if(t.dataset.up){const fs=[...t.files];t.value='';if(fs.length)await addPhotos(fs);return}
  if(t.id==='sprov'){settings.provider=t.value;saveSettings();render();return}
  if(t.id==='soprs'){if(t.value)$('sourl').value=t.value;return}
  if(t.id==='sk2'){settings.aiKeys2=t.value.trim();settings.keyIdx=0;saveSettings();toast('Záložní klíče uloženy ('+(allKeys().length-1)+')');render();return}
  if(t.id==='srm'){settings.readMode=t.value;saveSettings();toast(t.value==='exact'?'Důkladné čtení':t.value==='local'?'Počítání v telefonu bez AI':'Rychlé čtení');render();return}
  if(t.id==='sfree'){settings.freeMode=t.checked;saveSettings();toast(t.checked?'Pravidla pro bezplatný klíč zapnuta':'Pravidla vypnuta – dotazy jdou souběžně');render();return}
  if(t.id==='sfgap'){settings.freeGap=Math.min(30,Math.max(1,num(t.value)||6));saveSettings();toast('Odstup '+settings.freeGap+' s');return}
  if(t.id==='shw'){settings.hwNote=t.value;saveSettings();toast('Poznámka k písmu uložena');return}
  if(t.dataset.hwp){const s=hwSamples.find(s=>s.id===t.dataset.hwp);if(s){s.price=num(t.value);saveHw();toast('Vzor upraven')}return}
  if(t.id==='sbig'){settings.big=t.checked;document.body.classList.toggle('obs',t.checked);saveSettings();return}
  if(t.id==='em'){settings.eetMode=t.value;saveSettings();render();return}
  if(t.dataset.import!=null){const f=t.files[0];t.value='';if(f)importBackup(f);return}
  if(t.dataset.r&&r){r[t.dataset.r]=t.dataset.r==='name'?t.value.trim():t.value;save(r);render();if(t.dataset.r==='name'&&r.name){const d=debtOf(personOf(r));toast(d.over?`⚠ ${r.name} už dluží ${kc(d.due)}${d.lim?' (limit '+kc(d.lim)+')':''}`:'Uloženo pod jménem '+r.name,d.over)}return}
  if(t.dataset.f&&r){const x=rowsOf(r)[+t.closest('.row').dataset.i];const old=x.p;x[t.dataset.f]=t.dataset.f==='note'?t.value:num(t.value);if(t.dataset.f==='p'&&+old!==+x.p){x.pq=0;offerLearn(r,x,x.pai||old,x.p)}save(r);render()}
});
app.addEventListener('click',e=>{
  const rc=e.target.closest('rect[data-i]');if(rc){openZoom(+rc.dataset.i);return}
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.navGo){view=b.dataset.navGo;render();scrollTo(0,0);return}
  if(b.dataset.open){curId=b.dataset.open;curPhoto=0;view='detail';render();scrollTo(0,0);return}
  if(b.dataset.filter){filter=b.dataset.filter;render();return}
  if(b.dataset.person!=null){person=b.dataset.person;render();return}
  if(b.dataset.personDebt!=null){debtSel=b.dataset.personDebt;view='person';render();scrollTo(0,0);return}
  if(b.dataset.personGo!=null){person=b.dataset.personGo;view='list';render();scrollTo(0,0);return}
  if(b.dataset.setname!=null){const r=getR(curId);r.name=b.dataset.setname;save(r);render();toast('Uloženo pod jménem '+r.name);return}
  if(b.dataset.photo!=null){curPhoto=+b.dataset.photo;render();return}
  if(b.dataset.addp!=null){const r=getR(curId);const p=num(b.dataset.addp);
    r.rows=[...rowsOf(r),{p,c:0,note:'',q:0,box:null,spots:[],ph:curPhoto}];save(r);render();
    if(p&&(r.photos||[]).length){openZoom(r.rows.length-1);return}
    const rows=app.querySelectorAll('.row');const last=rows[rows.length-1];if(last){last.scrollIntoView({block:'center'});const inp=last.querySelector(p?'[data-f=c]':'[data-f=p]');inp&&inp.focus()}return}
  const a=b.dataset.a;if(!a)return;const r=getR(curId);
  if(a==='back'){view='list';render();return}
  if(a==='walk'){const f=rowsOf(r).findIndex(x=>x.q);if(f>=0)openZoom(f);return}
  if(a==='mail'){openMail([r]);return}
  if(a==='mailsum'){openMail(receipts.filter(byFilter));return}

  if(a==='copy'){copy(receiptText(r));return}
  if(a==='copysum'){copy(summaryText(receipts.filter(byFilter)));return}
  if(a==='delr'){ask('Smazat účtenku?',`Účtenka „${r.name||'Bez jména'}“ ${kc(totR(r)[1])} i její fotky se smažou natrvalo.`,'Ano, smazat',async()=>{receipts=receipts.filter(x=>x.id!==r.id);try{await tx('receipts','readwrite',s=>s.delete(r.id))}catch(e){}for(const p of r.photos||[])await delPhotoData(p.id);view='list';render();toast('Účtenka smazána')});return}
  if(a==='delphoto'){ask('Smazat fotku?','Fotka se smaže natrvalo. Řádky zůstanou, jen bez vyznačení na fotce.','Smazat',async()=>{const p=r.photos[curPhoto];r.photos=r.photos.filter((_,i)=>i!==curPhoto);r.rows=rowsOf(r).map(x=>{if((x.ph||0)===curPhoto)return{...x,box:null,spots:[]};if((x.ph||0)>curPhoto)return{...x,ph:x.ph-1};return x});if(p)await delPhotoData(p.id);curPhoto=0;save(r);render()});return}
  if(a==='reboot'){reboot();return}
  if(a==='localall'){const r=getR(curId);const idx=rowsOf(r).map((x,i)=>i).filter(i=>{const x=rowsOf(r)[i];return x.box&&(x.ph||0)===curPhoto});toast(`Počítám ${idx.length} ${plur(idx.length,'řádek','řádky','řádků')} v telefonu…`);
    (async()=>{for(const i of idx)await doLocal(r,i,true);render();const f=rowsOf(r).filter(x=>x.q).length;toast(`Hotovo v telefonu. Ke kontrole: ${f}`)})();return}
  if(a==='addfix'){const f=num($('fxf').value),t=num($('fxt').value);if(!f||!t||f===t){toast('Vyplň obě ceny',true);return}settings.priceFix=[...(settings.priceFix||[]).filter(x=>+x.from!==f),{from:f,to:t}];saveSettings();toast(`Pravidlo ${f} → ${t} přidáno`);render();return}
  if(a==='delfix'){settings.priceFix=(settings.priceFix||[]).filter((_,k)=>k!==+b.dataset.k);saveSettings();render();return}
  if(a==='delhw'){hwSamples=hwSamples.filter(s=>s.id!==b.dataset.k);saveHw();render();return}
  if(a==='saveset'){settings.email=$('se').value.trim();settings.prices=$('sp').value.split(/[,;\s]+/).map(num).filter(Boolean);if(!settings.prices.length)settings.prices=DEF_PRICES;saveSettings().then(()=>toast('Uloženo'));render();return}
  if(a==='export'){exportBackup();return}
  if(a==='copylog'){copy(logText());return}
  if(a==='showlog'){const v=$('logv');v.hidden=!v.hidden;v.textContent=logText();v.scrollTop=1e9;return}
  if(a==='clearlog'){LOG.length=0;try{localStorage.removeItem('uctenky-log')}catch(e){}log('INFO','log smazán');toast('Log smazán');return}
  if(a==='pay'){openPay(r);return}
  if(a==='paypart'){openPay(r,null,true);return}
  if(a==='payedit'){openPay(r,+b.dataset.pi);return}
  if(a==='paydel'){const pi=+b.dataset.pi;const p=pays(r)[pi];ask('Smazat platbu?',`Platba ${kc(p.amount)} z ${fmtD(p.date)} (doklad č. ${p.no}) se smaže a částka se znovu započítá do dluhu.${p.eet&&/ok/.test(p.eet.state)?' Pozor: platba už je v EET – smazání ji z EET neodstraní.':''}`,'Ano, smazat',()=>{snapAll('Platba smazána');if(p.group){receipts.forEach(x=>{const k=pays(x).filter(q=>q.group===p.group&&q.issuedAt===p.issuedAt);if(k.length){x.payments=pays(x).filter(q=>!k.includes(q));save(x)}})}else{r.payments=pays(r).filter((_,i)=>i!==pi);save(r)}render();offerUndo('Platba smazána')});return}
  if(a==='writeoff'){ask('Odepsat zbytek?',`Zbývajících ${kc(dueR(r))} se odepíše a účtenka bude brána jako vyřízená.`,'Odepsat',()=>{snap([r]);r.writtenOff=true;save(r);render();offerUndo('Zbytek odepsán')});return}
  if(a==='unwrite'){r.writtenOff=false;save(r);render();return}
  if(a==='paydebt'){payDebt(debtSel);return}
  if(a==='remind'){openReminder(debtSel);return}
  if(a==='copystmt'){copy(debtStatement(debtSel));return}
  if(a==='newfor'){person=debtSel;newReceipt();return}
  if(a==='saveperson'){settings.people=settings.people||{};settings.people[debtSel]={email:$('pe').value.trim(),phone:$('pt').value.trim(),limit:num($('pl').value)||'',note:$('pn').value.trim()};saveSettings().then(()=>{toast('Uloženo');render()});return}
  if(a==='savedebt'){settings.debtLimit=num($('sdl').value)||'';settings.debtDays=num($('sdd').value)||'';saveSettings().then(()=>{toast('Uloženo');render()});return}
  if(a==='moje'){openMoje(r,b.dataset.pi!=null?pays(r)[+b.dataset.pi]:null);return}
  if(a==='eetsend'){b.disabled=true;const ep=b.dataset.pi!=null?pays(r)[+b.dataset.pi]:null;sendEet(r,ep).then(()=>{render();const e=(ep||r.payment).eet;toast(e.state==='ok'?'EET odesláno ✓':'EET neodešlo: '+(e.lastError||''),e.state!=='ok')});return}
  if(a==='saveeet'){settings.eetMode=$('em').value;settings.eetMojeUrl=$('emu').value.trim()||'https://eet.gov.cz';settings.eetUrl=$('eu').value.trim();settings.eetToken=$('et').value.trim();settings.eetJednotka=$('ej').value.trim();settings.eetPokl=$('ep').value.trim()||settings.eetPokl;settings.eetOvereni=$('eo').checked;saveSettings().then(()=>{toast('Uloženo');render()});return}
  if(a==='testeet'){const k=$('est');k.className='status';k.textContent='Zkouším…';const url=$('eu').value.trim().replace(/\/+$/,'');
    fetch(url+'/eet/health',{headers:{Authorization:'Bearer '+$('et').value.trim()}}).then(r=>r.json()).then(d=>{if(d.ok){k.className='status ok';k.textContent=`Spojení OK · ${d.env==='produkce'?'OSTRÝ provoz':'Playground (test)'} · EIČ ${d.eic} · certifikát platí do ${new Date(d.certPlatnyDo).toLocaleDateString('cs-CZ')}`}else{k.className='status err';k.textContent=(d.error&&d.error.text)||'Chyba'}}).catch(()=>{k.className='status err';k.textContent='Server neodpovídá. Zkontroluj adresu.'});return}
  if(a==='saveissuer'){settings.issuer=$('si').value.trim();settings.issuerInfo=$('sii').value.trim();settings.payPrefix=$('spp').value;settings.payNext=Math.max(1,num($('spn').value));saveSettings().then(()=>toast('Uloženo'));return}
  if(a==='delsig'){settings.signature='';saveSettings().then(()=>render());return}
  if(a==='ai'){runAI(true);return}
  if(a==='manual'){newReceipt();return}
  if(a==='savekey'){settings.aiKey=$('sk').value.trim();settings.aiModel=$('sm').value.trim();saveSettings().then(()=>{toast(settings.aiKey?'Klíč uložen':'Klíč smazán');render()});return}
  if(a==='delkey'){settings.aiKey='';saveSettings().then(()=>render());return}
  if(a==='saveoai'||a==='testoai'){settings.oaiUrl=$('sourl').value.trim();settings.oaiKey=$('sokey').value.trim();settings.oaiModel=$('somod').value.trim();settings.oaiNoRF=false;saveSettings();
    if(a==='saveoai'){toast('Uloženo');render();return}
    const k=$('ost');if(!extAI()){k.className='status err';k.textContent='Vyplň adresu, klíč i model.';return}k.className='status';k.textContent='Zkouším…';
    oaiCall([{text:'Odpověz jen slovem OK.'}],undefined,false).then(t=>{k.className='status ok';k.textContent='Funguje ✓ ('+settings.oaiModel+')'},e=>{k.className='status err';k.textContent='Test selhal: '+(aiErr(e)||'').replace('Přečíst fotku se nepovedlo: ','')});return}
  if(a==='testkey'){const k=$('kst');settings.aiKey=$('sk').value.trim();settings.aiModel=$('sm').value.trim();if(!settings.aiKey){k.className='status err';k.textContent='Nejdřív vlož klíč.';return}
    saveSettings();
    k.className='status';k.textContent='Zjišťuji dostupné modely…';const userModel=settings.aiModel;listModels().then(l=>{if(!userModel&&l.length)settings.aiModel=l[0];k.textContent='Zkouším model '+(settings.aiModel||DEF_MODELS[0])+'…';return gemini([{text:'Odpověz jen slovem OK.'}],undefined,false)}).then(t=>{saveSettings();k.className='status ok';k.textContent='Klíč funguje ✓ (model: '+(lastModel||settings.aiModel)+(lastModel&&lastModel!==settings.aiModel?' – hlavní model '+settings.aiModel+' má dnes vyčerpaný limit':'')+')'},e=>{k.className='status err';k.textContent=aiErr(e).replace('Přečíst fotku se nepovedlo','Test klíče selhal')});return}
  if(a==='sharekey'){const link=location.origin+location.pathname+'#k='+encodeURIComponent(settings.aiKey)+(settings.aiModel?'&m='+encodeURIComponent(settings.aiModel):'');
    const txt='Appka na účtenky: otevři odkaz v Safari, pak Sdílet → Přidat na plochu. AI čtení čárek je v odkazu už nastavené.\n'+link;
    if(navigator.share)navigator.share({title:'Účtenky',text:txt}).catch(()=>{});else copy(txt);return}
  const row=b.closest('.row');if(!row||!r)return;const i=+row.dataset.i,x=rowsOf(r)[i];
  if(['-','ok','flag','del'].includes(a))snap([r]);
  if(a==='show'){openZoom(i);return}
  if(a==='+')x.c=(+x.c||0)+1;
  if(a==='-')x.c=Math.max(0,(+x.c||0)-1);
  if(a==='ok')x.q=0;
  if(a==='flag')x.q=1;
  if(a==='del')r.rows=rowsOf(r).filter((_,k)=>k!==i);
  save(r);render();if(a==='del')offerUndo(`Řádek ${x.p} Kč × ${x.c} smazán`);else if(a==='-')offerUndo(`${x.p} Kč: ubráno na ${x.c}`);else if(a==='ok')offerUndo('Řádek potvrzen');
});
document.addEventListener('change',e=>{if(e.target.id==='sk'||e.target.id==='sm'){settings.aiKey=$('sk').value.trim();if($('sm'))settings.aiModel=$('sm').value.trim();saveSettings().then(()=>toast(settings.aiKey?'Klíč uložen':'Klíč smazán'))}});
addEventListener('online',()=>render());addEventListener('offline',()=>render());

/* ---------- aktualizace / restart ---------- */
function showUpd(){if($('updbar'))return;const d=document.createElement('div');d.id='updbar';d.innerHTML='<span>Je nová verze aplikace.</span><button class="pri">Restartovat</button>';d.querySelector('button').onclick=()=>location.reload();document.body.appendChild(d)}
async function reboot(){const st=$('rbst');const say=t=>{if(st)st.textContent=t};
  if(!navigator.onLine){say('Jsi offline – aktualizace potřebuje internet. Appka zatím běží dál ve verzi '+APP_VER+'.');return}
  say('Zjišťuji nejnovější verzi…');let nv=null;
  try{const t=await (await fetch('sw.js?'+Date.now(),{cache:'no-store'})).text();const m=t.match(/uctenky-v(\d+)/);nv=m?+m[1]:null}catch(e){}
  log('INFO','restart',{mam:APP_VER,server:nv});
  say(nv&&nv>APP_VER?`Stahuji verzi ${nv}…`:'Načítám aplikaci znovu…');
  try{await Promise.all(['./','index.html','app.js','sw.js','manifest.webmanifest'].map(f=>fetch(f,{cache:'reload'}).catch(()=>null)))}catch(e){}
  try{if(window.caches){for(const k of await caches.keys())await caches.delete(k)}}catch(e){}
  try{if(navigator.serviceWorker){for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister()}}catch(e){}
  say('Restartuji…');setTimeout(()=>location.replace(location.pathname+'?r='+Date.now()),400)}
/* ---------- boot ---------- */
(async()=>{
  try{idb=await openDB();receipts=(await getAll('receipts')).map(syncR);const s=await getOne('kv','settings');if(s)settings={...settings,...s};try{hwSamples=(await getOne('kv','hw'))||[]}catch(e){hwSamples=[]}await preloadURLs()}
  catch(e){log('CHYBA','IndexedDB nedostupná',errInfo(e));idb=null;memMode=true;receipts=[]}
  const h=new URLSearchParams(location.hash.slice(1));
  if(h.get('k')){settings.aiKey=h.get('k');if(h.get('m'))settings.aiModel=h.get('m');await saveSettings();setTimeout(()=>toast('Čtení čárek přes AI je nastavené ✓'),300)}
  let keySrc=settings.aiKey?'úložiště':'žádný';
  if(!settings.aiKey){try{const b=JSON.parse(localStorage.getItem('uctenky-key')||'null');if(b&&b.k){settings.aiKey=b.k;if(!settings.aiModel)settings.aiModel=b.m||'';keySrc='záloha';saveSettings()}}catch(e){}}
  else keyBackup();
  const sa=!!(navigator.standalone||matchMedia('(display-mode: standalone)').matches);
  log('INFO','start',{klic:keySrc,ikona:sa,uloziste:memMode?'paměť':'IndexedDB',ucetenek:receipts.length});
  if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().then(p=>log('INFO','trvalé úložiště',p)).catch(()=>{});
  render();
  document.body.classList.toggle('obs',settings.big!==false);
  if(!settings.eetPokl){settings.eetPokl='tel-'+Math.random().toString(36).slice(2,8);saveSettings()}
  if(window.claude&&window.claude.use){window.claude.use('downloads').then(d=>{claudeDl=d||null;log('INFO','downloads',!!d)}).catch(()=>{});window.claude.use('mcp').then(m=>{claudeMcp=m||null;log('INFO','mcp',!!m)}).catch(()=>{});window.claude.use('sample').then(async s=>{if(!s)return;try{const l=await s.limits();log('INFO','sample limits',l);if(l&&l.images){claudeAI=s;claudeMax=l.images.maxCount||4;render()}}catch(e){log('CHYBA','sample.limits',errInfo(e))}}).catch(()=>{})}
  setTimeout(processPending,2000);setTimeout(processEet,3000);
  if('serviceWorker' in navigator){const had=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(reg=>{reg.update().catch(()=>{})}).catch(()=>{});
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(had)showUpd()})}
  if(location.search.includes('r='))history.replaceState(null,'',location.pathname+location.hash);
})();
}
