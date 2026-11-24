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
let claudeAI=null,claudeMax=0,claudeDl=null,claudeMcp=null;const hasAI=()=>!!(claudeAI||settings.aiKey);
const DEF_MODELS=['gemini-3.6-flash','gemini-2.5-flash','gemini-2.5-flash-lite'];
let debtSel='',view='list',curId=null,curPhoto=0,filter='open',query='',person='';
const photoURLs=new Map();
async function urlFor(pid){if(!pid)return'';if(photoURLs.has(pid))return photoURLs.get(pid);const p=await getOne('photos',pid);if(!p)return'';const u=URL.createObjectURL(p.blob);photoURLs.set(pid,u);return u}
async function preloadURLs(){for(const r of receipts)for(const p of r.photos||[])await urlFor(p.id)}
const pu=p=>p?photoURLs.get(p.id)||'':'';

const saveT=new Map();
function save(r){if(r&&r.rows)syncR(r);r.updatedAt=Date.now();if(memMode)return;clearTimeout(saveT.get(r.id));saveT.set(r.id,setTimeout(()=>tx('receipts','readwrite',s=>s.put(JSON.parse(JSON.stringify(r)))).catch(e=>goMem(e)),250))}
function saveSettings(){if(memMode)return Promise.resolve();return tx('kv','readwrite',s=>s.put(settings,'settings')).catch(e=>goMem(e))}

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
function offerUndo(msg){if(!undoSnap)return;$('undot').textContent=msg||undoSnap.msg||'Hotovo';$('undo').hidden=false;clearTimeout(undoT);undoT=setTimeout(()=>{$('undo').hidden=true;undoSnap=null},7000)}
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
function svgPhoto(r,pi,vb,mode,selIdx,extra){
  const p=(r.photos||[])[pi];if(!p)return'';
  const H=(p.h&&p.w)?p.h/p.w:1.4;
  const rect=(b,cls,i)=>`<rect class="${cls}" ${i!=null?`data-i="${i}"`:''} x="${b[0]}" y="${b[1]*H}" width="${Math.max(0,b[2]-b[0])}" height="${Math.max(0,(b[3]-b[1])*H)}" rx=".006"/>`;
  let inner='';
  rowsOf(r).forEach((x,i)=>{if(!x.box||(x.ph||0)!==pi)return;
    if(mode==='all'||(mode==='one'&&i===selIdx)){inner+=rect(x.box,'b'+(x.q?' q':'')+(i===selIdx?' sel':''),mode==='all'?i:null);if(mode==='all')inner+=`<text x="${x.box[0]+.006}" y="${x.box[1]*H+.032}">${esc(x.p)}</text>`}
    if(i===selIdx)(x.spots||[]).forEach(s=>inner+=rect(s,'s'));
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
      <div class="actions" style="margin-top:8px">${hasAI()?`<button class="pri" data-a="ai" ${navigator.onLine?'':'disabled'}>${r.pendingAI?'Čeká na internet – přečíst teď':'Přečíst čárky z fotky (AI)'}</button>`:`<button class="ghost" data-nav-go="settings">Zapnout čtení čárek přes AI</button>`}<button class="mini ghost" data-a="delphoto" style="margin-left:auto;color:var(--red)">Smazat fotku</button></div>
      ${hasAI()&&!navigator.onLine?'<p class="note2">Čtení přes AI potřebuje internet. Počítat ručně jde i offline.</p>':''}
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
    <b>Čtení čárek přes AI</b>
    ${claudeAI?'<p class="status ok">Běží v Claude: čárky čte Claude přes tvůj účet, klíč není potřeba. Pokud níže vložíš klíč Gemini, použije se ten.</p>':''}
    <p class="note2"><b>Google Gemini (zdarma)</b> – pro verzi mimo Claude (GitHub, kolega).</p>
    <p class="note2">Bezplatný klíč získáš na <b>aistudio.google.com</b> → Get API key → Create API key (stačí Google účet). Klíč se uloží jen v tomto telefonu.</p>
    <label class="f" for="sk">API klíč</label><input id="sk" type="password" autocomplete="off" value="${esc(settings.aiKey||'')}" placeholder="AIza…">
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
  $('zt').textContent=`${x.p} Kč`+(r.name?` · ${r.name}`:'');
  $('zw').textContent=x.q?(x.note||'Zkontroluj počet čárek.'):'';
  $('zalts').innerHTML=x.q&&x.alts&&x.alts.length>1?x.alts.map(v=>`<button data-alt="${v}"${v===+x.c?' style="background:var(--penbg);color:#fff"':''}>${v} ks</button>`).join(''):'';
  if(zMode==='spot')zMode='row';if(zMode==='row'&&!x.box)zMode=hasPh?'mark':'row';if(zMode==='tap'&&!x.box)zMode='mark';
  document.querySelectorAll('#zoom [data-z]').forEach(b=>{b.setAttribute('aria-pressed',b.dataset.z===zMode);b.disabled=!hasPh||(!x.box&&(b.dataset.z==='row'||b.dataset.z==='tap'))});
  $('zmarkb').textContent=x.box?'✎ Přeznačit řádek':'✎ Označit řádek';
  let vb=null;if((zMode==='row'||zMode==='tap')&&x.box)vb=padBox(x.box,.02,H);
  $('zhint').textContent=zMode==='mark'?'Táhni prstem přes celý řádek.':zMode==='tap'?'Ťukni na každou čárku.':'';
  $('zlvl').textContent=zLevel+'×';
  const zb=$('zimg');zb.style.setProperty('--z',zMode==='mark'?1:zLevel);
  let svg=hasPh?svgPhoto(r,x.ph||0,vb,zMode==='mark'?'mark':zMode==='all'?'all':zMode==='tap'?'none':'one',zMode==='tap'?-1:zCur):'<p class="note2" style="color:#fff;padding:14px">K účtence není fotka – počítej tlačítky dole.</p>';
  if(zMode==='tap'&&hasPh){svg=svg.replace('class="phs','class="phs tap').replace('</svg>',tapMarks.map((m,i)=>{const R=(vb?vb[2]:1)*.035/Math.max(1,zLevel*.7);return `<circle class="mk${m[2]===5?' mk5':''}" cx="${m[0]}" cy="${m[1]}" r="${R}" style="stroke-width:${R*.18}"/><text class="mkt" x="${m[0]}" y="${m[1]}" style="font-size:${R*1.1}px">${m[2]===5?'5':tapMarks.slice(0,i+1).reduce((a,q)=>a+q[2],0)}</text>`}).join('')+'</svg>')}
  zb.innerHTML=svg;
  $('ztapbar').hidden=zMode!=='tap';$('ztapn').textContent=tapMarks.reduce((a,m)=>a+m[2],0);$('ztap5').setAttribute('aria-pressed',tap5);
  $('zc').value=x.c;$('zsub').textContent=kc((+x.p||0)*(+x.c||0));
  $('zok').textContent=x.q?(fl.length>1?'Sedí ✓ Další ›':'Sedí ✓ Hotovo'):(fl.length?'Další sporné ›':'Hotovo ✓');
  $('zre').hidden=!(hasAI()&&x.box&&navigator.onLine);
}
function openZoom(i){zCur=i;const x=rowsOf(getR(curId))[i];zMode=x&&x.box?'row':'mark';zLevel=autoZoom(getR(curId),x);tapMarks=[];tap5=false;renderZoom();if(!$('zoom').open)$('zoom').showModal()}
function stepFlag(d){
  const r=getR(curId);const f=rowsOf(r).map((x,i)=>x.q?i:-1).filter(i=>i>=0);if(!f.length){$('zoom').close();openDone();return}
  let k=f.indexOf(zCur);if(k<0){k=f.findIndex(i=>i>zCur);if(k<0)k=0;if(d<0)k--}else k+=d;
  k=(k+f.length)%f.length;openZoom(f[k]);
}
$('zx').onclick=()=>$('zoom').close();
$('zre').onclick=async()=>{const r=getR(curId),x=rowsOf(r)[zCur];const b=$('zre');b.disabled=true;const old=b.textContent;
  try{const res=await recountRow(r,zCur,t=>b.textContent=t);x.c=res.c;x.note=res.txt;if(res.sure)x.q=0;save(r);renderZoom();toast(res.txt)}
  catch(e){toast(aiErr(e),true)}finally{b.disabled=false;b.textContent=old}};
$('zoom').addEventListener('close',()=>render());
$('zoom').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;const r=getR(curId),x=rowsOf(r)[zCur];
  if(b.dataset.z){zMode=b.dataset.z;if(zMode==='tap'){tapMarks=[];tap5=false}renderZoom();return}
  if(b.dataset.zoom){zLevel=Math.min(4,Math.max(1,zLevel+(b.dataset.zoom==='+'?1:-1)));if(zMode==='mark')zMode=x.box?'row':'all';renderZoom();return}
  if(b.dataset.alt){snap([r]);x.c=+b.dataset.alt;save(r);renderZoom();toast(`Nastaveno ${x.c} ks`);return}
  const d=b.dataset.d;if(!d)return;
  if(d==='+')x.c=(+x.c||0)+1;if(d==='-')x.c=Math.max(0,(+x.c||0)-1);if(d==='+5')x.c=(+x.c||0)+5;
  if(d==='prev')return stepFlag(-1);
  if(d==='ok'){if(x.q){x.q=0;x.alts=null;save(r)}const f=flagList(r);if(!f.length){$('zoom').close();openDone();return}return stepFlag(1)}
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
  save(r);zMode='row';zLevel=2;renderZoom();toast('Řádek označen – teď počítej čárky');});
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
  if(claudeAI&&!settings.aiKey){
    const imgs=[];let txt='';let n=0;
    for(const p of parts){if(p.text)txt+=p.text+'\n';else if(p.inline_data){n++;txt+=`[obrázek ${n}]\n`;imgs.push(await capMP(b64ToBlob(p.inline_data.data,p.inline_data.mime_type),1.15e6))}}
    txt+='\nObrázky jsou přiloženy ve stejném pořadí, v jakém jsou v textu značky [obrázek N].';
    const t=Date.now();log('INFO','Claude dotaz',{znaku:txt.length,obrazku:imgs.length,velikosti:imgs.map(b=>Math.round(b.size/1024)+'kB')});
    try{const r=await claudeAI(txt,{images:imgs,modelTier:'default',cache:false,signal});log('INFO','Claude odpověď',{ms:Date.now()-t,znaku:r.text.length,truncated:r.truncated,tier:r.modelTierApplied,zacatek:r.text.slice(0,200)});return r.text}
    catch(e){log('CHYBA','Claude selhal',{ms:Date.now()-t,...errInfo(e),text:e&&e.text?String(e.text).slice(0,200):undefined});if(e&&e.code==='cancelled')throw{name:'AbortError'};if(e&&(e.code==='not_granted'||e.code==='sampling_disabled'))throw{code:'key',msg:'Claude tu není povolený'};if(e&&e.code==='rate_limited')throw{code:429};throw{code:0,msg:e&&e.code==='upstream_error'?'spojení s Claudem se přerušilo. Nech displej rozsvícený a appku v popředí':(e&&(e.code?e.code+': ':'')+(e.message||''))||'neznámá chyba'}}
  }
  return gemini(parts,signal,json);
}
const maxImgs=()=>claudeAI&&!settings.aiKey?Math.max(2,claudeMax-1):30;
async function gemini(parts,signal,json){
  const models=settings.aiModel?[settings.aiModel]:DEF_MODELS;let last;
  for(const m of models){
    const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`,{method:'POST',signal,headers:{'Content-Type':'application/json','x-goog-api-key':settings.aiKey},
      body:JSON.stringify({contents:[{role:'user',parts}],generationConfig:{temperature:0,...(json?{responseMimeType:'application/json'}:{})}})});
    log('INFO','Gemini '+m,{status:res.status});
    if(res.ok){const d=await res.json();const t=(d.candidates&&d.candidates[0]&&d.candidates[0].content&&d.candidates[0].content.parts||[]).map(p=>p.text||'').join('');if(!t)throw{code:'empty'};if(!settings.aiModel&&m!==models[0]){settings.aiModel=m;saveSettings()}return t}
    let msg='';try{msg=(await res.json()).error.message}catch(e){}
    last={code:res.status,msg};
    if(res.status===400&&/api key/i.test(msg))throw{code:'key',msg};
    if(res.status===401||res.status===403)throw{code:'key',msg};
    if(res.status!==404&&res.status!==429&&res.status<500)throw last;
  }
  throw last||{code:0};
}
function parseJSON(t){try{return JSON.parse(t)}catch(e){}const a=t.indexOf('{'),b=t.lastIndexOf('}');if(a>=0&&b>a)try{return JSON.parse(t.slice(a,b+1))}catch(e){}return null}
const errTxt=e=>e==null?'':typeof e==='string'?e:(e.msg||e.message||(e.code!=null?'kód '+e.code:'')||(e.type?'událost '+e.type:'')||String(e));
const aiErr=e=>e&&e.name==='AbortError'?'Zastaveno.':e&&e.code==='key'?'Klíč nefunguje. Zkontroluj ho v Nastavení.':e&&e.code===429?'Vyčerpaný bezplatný limit. Zkus to za chvíli nebo zítra.':e&&e.code===404?'Model není dostupný. V Nastavení nech pole Model prázdné.':!navigator.onLine?'Jsi offline. Čtení přes AI potřebuje internet.':'Přečíst fotku se nepovedlo: '+(errTxt(e)||'neznámá chyba').slice(0,160)+'. Zkus to znovu.';
const LAYOUT_PROMPT=`Na fotkách je ručně psaná hospodská účtenka (útrata jednoho člověka). Na začátku řádku je cena v Kč (např. 55, 35, 40, 30, 28, 25, 20, 18, někdy 145 nebo 250), za ní čárky = počet kusů.
Pravidla:
- každá svislá čárka = 1 kus; 4 čárky přeškrtnuté pátou šikmou čárkou = 5 kusů
- řádek čárek bez ceny, který navazuje pod řádkem s cenou, patří k té ceně; uveď ho jako samostatnou položku se stejnou cenou
- na jednom řádku mohou být dvě skupiny (vlevo a vpravo), každá se svou cenou
- pisatel někdy připojí první čárku k číslici 5, takže to vypadá jako 7 („27“, „37“). Pokud cena nedává smysl, je to nejspíš 25/35 + 1 čárka; pak uncertain=true a vysvětli
- čárka přeškrtnutá malým křížkem může být zrušená; nepočítej ji, uncertain=true
Obrázek 1 je celá fotka. Obrázky 2, 3 a 4 jsou výřezy celé šířky ve vyšším rozlišení: obrázek 2 výška 0–0,4, obrázek 3 výška 0,3–0,7, obrázek 4 výška 0,6–1 (zlomky výšky celé fotky). Překryvy nepočítej dvakrát.
Počítej velmi pečlivě, čárku po čárce. Kde si nejsi jistý (překryvy, šmouhy, tvary N/X, nejasná cena), nastav "uncertain": true, do "note" napiš krátce česky proč a do "spot" dej rámeček kolem sporného místa.
Odpověz POUZE JSONem:
{"rows":[{"price":55,"count":25,"uncertain":false,"note":"1. řádek","box":[x1,y1,x2,y2],"spot":null}]}
box a spot jsou souřadnice v CELÉ fotce jako zlomky 0–1 (x zleva, y shora). Řádky seřaď shora dolů.`;
const COUNT_PROMPT=n=>`Dostaneš ${n} výřezů z ručně psané hospodské účtenky. Každý výřez je jeden řádek (nebo blok řádků) čárek pro jednu cenu. Výřez může na okrajích obsahovat kousky sousedních řádků – ty nepočítej.
Úkol: u každého výřezu spočítej čárky patřící k vyznačené ceně. Každá svislá čárka = 1. Čtyři čárky přeškrtnuté šikmou pátou = 5 (přeškrtnutí se nepočítá navíc). Číslice ceny nejsou čárky. Čárka přeškrtnutá malým křížkem je zrušená.
Postupuj zleva doprava a počítej po skupinách, pečlivě, čárku po čárce. Když je výřez nejasný (překryvy, šmouhy, tvary N/X), nastav uncertain=true a do note napiš krátce česky proč.
Odpověz POUZE JSONem: {"counts":[{"id":1,"count":12,"uncertain":false,"note":""}]} – id je číslo výřezu.`;
const clamp01=n=>Math.min(1,Math.max(0,+n||0));
async function imgFromBlob(b){const u=URL.createObjectURL(b);try{return await loadImg(u)}finally{URL.revokeObjectURL(u)}}
async function cropRow(fimg,box){const W=fimg.naturalWidth,Hh=fimg.naturalHeight,m=.015;const x1=clamp01(box[0]-m),y1=clamp01(box[1]-m),x2=clamp01(box[2]+m),y2=clamp01(box[3]+m);
  const c=document.createElement('canvas');const sw=(x2-x1)*W,sh=(y2-y1)*Hh;const s=Math.min(1.2,1200/sw);c.width=Math.max(1,Math.round(sw*s));c.height=Math.max(1,Math.round(sh*s));
  c.getContext('2d').drawImage(fimg,x1*W,y1*Hh,sw,sh,0,0,c.width,c.height);return await canvasBlob(c,.9)}
async function countPass(rows,crops,order,signal){
  const lim=maxImgs();if(order.length>lim){const out={};for(let i=0;i<order.length;i+=lim)Object.assign(out,await countPass(rows,crops,order.slice(i,i+lim),signal));return out}
  const ps=[{text:COUNT_PROMPT(order.length)}];
  for(let k=0;k<order.length;k++){const i=order[k];ps.push({text:`Výřez ${k+1}: cena ${rows[i].p} Kč${rows[i].note?' ('+rows[i].note+')':''}`});ps.push({inline_data:{mime_type:'image/jpeg',data:await b64(crops[i])}})}
  const d=parseJSON(await aiCall(ps,signal,true));const out={};
  (d&&Array.isArray(d.counts)?d.counts:[]).forEach(c=>{const k=num(c.id)-1;if(order[k]!=null)out[order[k]]={c:num(c.count),q:!!c.uncertain,n:String(c.note||'')}});
  return out;
}
function merge(rows,A,B){rows.forEach((x,i)=>{const a=A[i],b=B[i];const c0=x.c;
  if(a&&b){if(a.c===b.c){x.c=a.c;if(a.q||b.q){x.q=1;x.note=(a.n||b.n||x.note)}else if(x.q&&a.c===c0)x.q=1;else x.q=0;if(c0!==a.c&&x.q){x.alts=[...new Set([c0,a.c])].sort((m,n)=>m-n);x.note=(x.note?x.note+' · ':'')+`1. odhad ${c0}, přepočet ${a.c}`}}
    else{x.c=Math.max(a.c,b.c);x.q=1;x.alts=[...new Set([a.c,b.c,c0])].sort((m,n)=>m-n);x.note=`AI napočítala jednou ${a.c}, podruhé ${b.c}. Vyber nebo přepočítej.`+(a.n?' '+a.n:'')}}
  else if(a||b){const v=a||b;x.c=v.c;x.q=1;x.note='Přepočet jen jednou: '+v.c+(v.n?' – '+v.n:'')}
  else if(x.box){x.q=1;x.note=(x.note?x.note+' · ':'')+'Řádek nebyl přepočítán zvlášť.'}
  if(x.q&&!x.spots.length&&x.box)x.spots=[x.box]})}
/* přečte jednu fotku: vrátí řádky */
async function readPhoto(pid,ph,status,signal){
  const rec=await getOne('photos',pid);if(!rec)throw{code:'empty',msg:'Fotka chybí'};
  status('Připravuji fotku…');
  const {blob}=await shrink(rec.blob,1600,.88);const img=await imgFromBlob(blob);
  const lim=claudeAI&&!settings.aiKey?claudeMax:4;const strips=lim>=4?[[0,.4],[.3,.7],[.6,1]]:lim>=3?[[0,.55],[.45,1]]:[];
  const stripTxt=strips.length?'Obrázek 1 je celá fotka. '+strips.map((s,i)=>`Obrázek ${i+2} je výřez celé šířky ve vyšším rozlišení, výška ${String(s[0]).replace('.',',')}–${String(s[1]).replace('.',',')}`).join('; ')+' (zlomky výšky celé fotky). Překryvy nepočítej dvakrát.':'Obrázek 1 je celá fotka.';
  const prompt=LAYOUT_PROMPT.replace(/Obrázek 1 je celá fotka\.[^\n]*/,stripTxt);
  const parts=[{text:prompt},{inline_data:{mime_type:'image/jpeg',data:await b64(blob)}}];
  for(const [a,b] of strips)parts.push({inline_data:{mime_type:'image/jpeg',data:await b64(await cropBlob(img,a,b))}});
  log('INFO','čtení: obrázky připraveny',{full:Math.round(blob.size/1024)+'kB',w:img.naturalWidth,h:img.naturalHeight,pruhy:strips.length});
  status('1/3 Hledám řádky a ceny…');
  const data=parseJSON(await aiCall(parts,signal,true));
  const rows=(data&&Array.isArray(data.rows)?data.rows:[]).map(x=>({p:num(x.price),c:num(x.count),q:x.uncertain?1:0,note:String(x.note||'').slice(0,200),
    box:Array.isArray(x.box)&&x.box.length===4?x.box.map(clamp01):null,spots:Array.isArray(x.spot)&&x.spot.length===4?[x.spot.map(clamp01)]:[],ph,ai:1})).filter(x=>x.p||x.c);
  log('INFO','čtení: řádky z 1. průchodu',rows.map(x=>[x.p,x.c,x.box?x.box.map(v=>+v.toFixed(2)):null]));
  if(!rows.length)throw{code:'empty',msg:'Na fotce jsem nenašel žádné řádky'};
  status('Připravuji výřezy řádků…');const mid=(await shrink(rec.blob,2000,.9)).blob;const fimg=await imgFromBlob(mid);const crops=[];for(const x of rows)crops.push(x.box?await cropRow(fimg,x.box):null);
  const idx=rows.map((x,i)=>i).filter(i=>crops[i]);let A={},B={};
  if(idx.length){status('2/3 Počítám každý řádek zvlášť…');A=await countPass(rows,crops,idx,signal);status('3/3 Kontrolní přepočet…');B=await countPass(rows,crops,[...idx].reverse(),signal)}
  log('INFO','čtení: přepočty',{A,B});merge(rows,A,B);log('INFO','čtení: výsledek',rows.map(x=>[x.p,x.c,x.q?'?':'ok']));return rows;
}
/* jeden řádek znovu (ze zvětšení) */
async function recountRow(r,i,status){
  const x=rowsOf(r)[i];const p=(r.photos||[])[x.ph||0];if(!x.box||!p)throw{code:'empty',msg:'Řádek není označený na fotce'};
  const rec=await getOne('photos',p.id);const crop=await cropRow(await imgFromBlob(rec.blob),x.box);
  const tmp=[{...x}];status('AI přepočítává řádek…');
  const A=await countPass(tmp,[crop],[0]);const B=await countPass(tmp,[crop],[0]);
  const a=A[0],b=B[0];if(!a&&!b)throw{code:'empty',msg:'AI nevrátila počet'};
  return a&&b&&a.c===b.c?{c:a.c,sure:!(a.q||b.q),txt:`AI 2× napočítala ${a.c}`}:{c:(a||b).c,sure:false,txt:`AI napočítala ${a?a.c:'?'} a ${b?b.c:'?'} – přepočítej ručně`};
}
/* dialog s průběhem; auto = rovnou použít a projít sporná místa */
async function runAI(auto){
  const r=getR(curId),p=(r.photos||[])[curPhoto];if(!p)return;
  aiResult=null;$('arep').disabled=$('aadd').disabled=true;$('astop').hidden=false;
  const st=$('ast'),pr=$('aprog');st.className='status';pr.textContent='';renderAIName();$('ai').showModal();
  aiCtl=new AbortController();$('aretry').hidden=true;
  const t0=Date.now();let stage='';const tick=setInterval(()=>{st.textContent=`${stage} (${Math.round((Date.now()-t0)/1000)} s)`},1000);
  try{
    const rows=await readPhoto(p.id,curPhoto,t=>{stage=t;st.textContent=`${t} (${Math.round((Date.now()-t0)/1000)} s)`},aiCtl.signal);clearInterval(tick);
    r.pendingAI=false;save(r);
    aiResult=rows;const q=rows.reduce((a,x)=>a+x.c,0),t=rows.reduce((a,x)=>a+x.c*x.p,0),f=rows.filter(x=>x.q).length;
    st.className='status ok';st.textContent=`Hotovo: ${rows.length} ${plur(rows.length,'řádek','řádky','řádků')}, ${q} ks, ${kc(t)}. Ke kontrole: ${f}.`;
    pr.textContent=rows.map(x=>`${x.p} Kč × ${x.c}${x.q?'  ⚠ '+x.note:''}`).join('\n');
    $('arep').disabled=$('aadd').disabled=false;
    if(auto&&!rowsOf(r).some(x=>(x.ph||0)===curPhoto)){setTimeout(()=>applyAI(true,true),500)}
  }catch(e){clearInterval(tick);log('CHYBA','čtení selhalo ve fázi: '+stage,errInfo(e));st.className='status err';st.textContent=aiErr(e)+(stage?` [fáze: ${stage}]`:'');$('aretry').hidden=false;if(e&&e.name!=='AbortError'&&!navigator.onLine){r.pendingAI=true;save(r);st.textContent+=' Přečtu ji sám, až bude internet.'}}
  finally{$('astop').hidden=true;aiCtl=null}
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
  if(t.id==='sbig'){settings.big=t.checked;document.body.classList.toggle('obs',t.checked);saveSettings();return}
  if(t.id==='em'){settings.eetMode=t.value;saveSettings();render();return}
  if(t.dataset.import!=null){const f=t.files[0];t.value='';if(f)importBackup(f);return}
  if(t.dataset.r&&r){r[t.dataset.r]=t.dataset.r==='name'?t.value.trim():t.value;save(r);render();if(t.dataset.r==='name'&&r.name){const d=debtOf(personOf(r));toast(d.over?`⚠ ${r.name} už dluží ${kc(d.due)}${d.lim?' (limit '+kc(d.lim)+')':''}`:'Uloženo pod jménem '+r.name,d.over)}return}
  if(t.dataset.f&&r){const x=rowsOf(r)[+t.closest('.row').dataset.i];x[t.dataset.f]=t.dataset.f==='note'?t.value:num(t.value);save(r);render()}
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
  if(a==='testkey'){const k=$('kst');settings.aiKey=$('sk').value.trim();settings.aiModel=$('sm').value.trim();if(!settings.aiKey){k.className='status err';k.textContent='Nejdřív vlož klíč.';return}
    k.className='status';k.textContent='Zkouším…';gemini([{text:'Odpověz jen slovem OK.'}],undefined,false).then(t=>{saveSettings();k.className='status ok';k.textContent='Klíč funguje ✓ (model: '+(settings.aiModel||DEF_MODELS[0])+')'},e=>{k.className='status err';k.textContent=aiErr(e)});return}
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
addEventListener('online',()=>render());addEventListener('offline',()=>render());

/* ---------- boot ---------- */
(async()=>{
  try{idb=await openDB();receipts=(await getAll('receipts')).map(syncR);const s=await getOne('kv','settings');if(s)settings={...settings,...s};await preloadURLs()}
  catch(e){log('CHYBA','IndexedDB nedostupná',errInfo(e));idb=null;memMode=true;receipts=[]}
  const h=new URLSearchParams(location.hash.slice(1));
  if(h.get('k')){settings.aiKey=h.get('k');if(h.get('m'))settings.aiModel=h.get('m');await saveSettings();setTimeout(()=>toast('Čtení čárek přes AI je nastavené ✓'),300)}
  if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});
  render();
  document.body.classList.toggle('obs',settings.big!==false);
  if(!settings.eetPokl){settings.eetPokl='tel-'+Math.random().toString(36).slice(2,8);saveSettings()}
  if(window.claude&&window.claude.use){window.claude.use('downloads').then(d=>{claudeDl=d||null;log('INFO','downloads',!!d)}).catch(()=>{});window.claude.use('mcp').then(m=>{claudeMcp=m||null;log('INFO','mcp',!!m)}).catch(()=>{});window.claude.use('sample').then(async s=>{if(!s)return;try{const l=await s.limits();log('INFO','sample limits',l);if(l&&l.images){claudeAI=s;claudeMax=l.images.maxCount||4;render()}}catch(e){log('CHYBA','sample.limits',errInfo(e))}}).catch(()=>{})}
  setTimeout(processPending,2000);setTimeout(processEet,3000);
  if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
}
