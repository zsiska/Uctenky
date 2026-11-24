'use strict';
/*
  Účtenky – EET 2.0 brána
  Malý server, který přijme tržbu z aplikace Účtenky, podepíše ji pokladním
  certifikátem (.p12) a odešle do systému EET 2.0 finanční správy (SOAP v4).

  Nastavení přes proměnné prostředí (viz README.md):
    EET_P12_PATH      cesta k pokladnímu certifikátu .p12
    EET_P12_PASS      heslo k certifikátu
    EET_EIC           EIČ poplatníka (CZ + 8–10 číslic)
    EET_ENV           playground | produkce   (výchozí playground)
    API_TOKEN         tajný token, který musí aplikace posílat
    ALLOW_ORIGIN      adresa aplikace, např. https://zsiska.github.io (pro CORS)
    PORT              port (výchozí 8080)
*/
const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const forge = require('node-forge');
const { SignedXml } = require('xml-crypto');

const ENDPOINTS = {
  playground: 'https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4',
  produkce: 'https://trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4',
};
const NS = {
  soap: 'http://schemas.xmlsoap.org/soap/envelope/',
  wsse: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
  wsu: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd',
  eet: 'http://fs.gov.cz/eet/schema/v4',
  x509: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3',
  b64: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary',
};

const cfg = {
  p12Path: process.env.EET_P12_PATH,
  p12Pass: process.env.EET_P12_PASS || '',
  eic: process.env.EET_EIC,
  env: process.env.EET_ENV === 'produkce' ? 'produkce' : 'playground',
  token: process.env.API_TOKEN,
  origin: process.env.ALLOW_ORIGIN || '*',
  port: +process.env.PORT || 8080,
  endpoint: process.env.EET_ENDPOINT, // jen pro testy
};

/* ---------- certifikát ---------- */
function loadP12(path, pass) {
  const der = fs.readFileSync(path).toString('binary');
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), pass);
  const keyBag = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [])[0]
    || (p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])[0];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  if (!keyBag || !certBags.length) throw new Error('V .p12 chybí klíč nebo certifikát');
  // vezmi certifikát, který patří ke klíči
  const pub = forge.pki.setRsaPublicKey(keyBag.key.n, keyBag.key.e);
  const certBag = certBags.find(b => b.cert.publicKey.n.equals(pub.n)) || certBags[0];
  const cert = certBag.cert;
  return {
    keyPem: forge.pki.privateKeyToPem(keyBag.key),
    certB64: forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()),
    cn: (cert.subject.getField('CN') || {}).value,
    notAfter: cert.validity.notAfter,
  };
}

/* ---------- formáty ---------- */
const pad = n => String(n).padStart(2, '0');
function isoPrague(d) {
  // rrrr-mm-ddThh:mm:ss±hh:mm v čase Europe/Prague
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d).map(p => [p.type, p.value]));
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  const off = Math.round((local - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const sign = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `${parts.year}-${parts.month}-${parts.day}T${pad(+parts.hour % 24)}:${parts.minute}:${parts.second}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
const money = v => { const n = Math.round(Number(v) * 100) / 100; if (!isFinite(n)) throw new Error('Neplatná částka'); return n.toFixed(2); };
const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const RX = {
  eic: /^CZ[0-9]{8,10}$/, jednotka: /^[1-9][0-9]{0,8}$/, pokl: /^[0-9a-zA-Z\.,:;\/#\-_ ]{1,20}$/, porad: /^[0-9a-zA-Z\.,:;\/#\-_ ]{1,25}$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
};

/* ---------- zpráva ---------- */
function buildTrzba(t, eic) {
  const attrs = { uuid_zpravy: t.uuid, dat_odesl: isoPrague(new Date()), prvni_zaslani: t.first ? 'true' : 'false' };
  if (t.overeni) attrs.overeni = 'true';
  const data = { eic_popl: eic, id_jednotky: String(t.id_jednotky), id_pokl: String(t.id_pokl), porad_cis: String(t.porad_cis), dat_trzby: isoPrague(new Date(t.dat_trzby)), celk_trzba: money(t.celk_trzba) };
  if (!RX.uuid.test(attrs.uuid_zpravy)) throw new Error('Neplatné uuid_zpravy');
  if (!RX.eic.test(data.eic_popl)) throw new Error('Neplatné EIČ (CZ + 8–10 číslic)');
  if (!RX.jednotka.test(data.id_jednotky)) throw new Error('Neplatné ID evidenční jednotky');
  if (!RX.pokl.test(data.id_pokl)) throw new Error('Neplatné ID pokladny');
  if (!RX.porad.test(data.porad_cis)) throw new Error('Neplatné pořadové číslo');
  const a = o => Object.entries(o).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
  return `<eet:Trzba xmlns:eet="${NS.eet}"><eet:Hlavicka ${a(attrs)}/><eet:Data ${a(data)}/></eet:Trzba>`;
}
function signEnvelope(trzbaXml, cert) {
  const tokId = 'X509-' + crypto.randomUUID();
  const bodyId = 'id-' + crypto.randomUUID();
  const xml = `<soap:Envelope xmlns:soap="${NS.soap}"><soap:Header><wsse:Security xmlns:wsse="${NS.wsse}" xmlns:wsu="${NS.wsu}" soap:mustUnderstand="1"><wsse:BinarySecurityToken EncodingType="${NS.b64}" ValueType="${NS.x509}" wsu:Id="${tokId}">${cert.certB64}</wsse:BinarySecurityToken></wsse:Security></soap:Header><soap:Body xmlns:wsu="${NS.wsu}" wsu:Id="${bodyId}">${trzbaXml}</soap:Body></soap:Envelope>`;
  const sig = new SignedXml({
    privateKey: cert.keyPem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    idMode: 'wssecurity',
    getKeyInfoContent: () => `<wsse:SecurityTokenReference xmlns:wsse="${NS.wsse}"><wsse:Reference URI="#${tokId}" ValueType="${NS.x509}"/></wsse:SecurityTokenReference>`,
  });
  sig.addReference({
    xpath: "//*[local-name(.)='Body']",
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: ['http://www.w3.org/2001/10/xml-exc-c14n#'],
  });
  sig.computeSignature(xml, { prefix: 'ds', location: { reference: "//*[local-name(.)='Security']", action: 'append' } });
  return sig.getSignedXml();
}

/* ---------- odeslání a odpověď ---------- */
function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method: 'POST', timeout: 10000, headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"http://fs.gov.cz/eet/OdeslaniTrzby"', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let d = ''; res.setEncoding('utf8'); res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}
function attr(xml, el, name) { const m = xml.match(new RegExp(`<(?:\\w+:)?${el}\\b[^>]*\\b${name}="([^"]*)"`)); return m ? m[1] : null; }
function parseOdpoved(xml) {
  const warnings = [...xml.matchAll(/<(?:\w+:)?Varovani\b[^>]*kod_varov="(\d+)"[^>]*>([^<]*)</g)].map(m => ({ kod: +m[1], text: m[2] }));
  const pok = attr(xml, 'Potvrzeni', 'pok');
  if (pok) return { ok: true, pok, test: attr(xml, 'Potvrzeni', 'test') === 'true', prijato: attr(xml, 'Hlavicka', 'dat_prij'), warnings };
  const ch = xml.match(/<(?:\w+:)?Chyba\b[^>]*kod="(-?\d+)"[^>]*>([^<]*)</);
  if (ch) { const kod = +ch[1]; return { ok: kod === 0, overeno: kod === 0, error: kod === 0 ? null : { kod, text: ch[2] }, test: attr(xml, 'Chyba', 'test') === 'true', retry: kod === -1, warnings }; }
  if (/Fault/.test(xml)) return { ok: false, error: { kod: 'fault', text: (xml.match(/<faultstring>([^<]*)/) || [])[1] || 'SOAP Fault' }, retry: false, warnings };
  return { ok: false, error: { kod: 'neznamy', text: 'Neznámá odpověď' }, retry: true, warnings };
}

/* ---------- HTTP API ---------- */
let CERT = null;
function cert() { if (!CERT) { if (!cfg.p12Path) throw new Error('Chybí EET_P12_PATH'); CERT = loadP12(cfg.p12Path, cfg.p12Pass); } return CERT; }
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': cfg.origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' });
  res.end(JSON.stringify(obj));
}
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const authed = cfg.token && auth.length === cfg.token.length && crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(cfg.token));
  const path = req.url.split('?')[0];
  if (path === '/eet/health' && req.method === 'GET') {
    if (!authed) return send(res, 401, { ok: false, error: { text: 'Špatný token' } });
    try { const c = cert(); return send(res, 200, { ok: true, env: cfg.env, eic: cfg.eic, certCN: c.cn, certPlatnyDo: c.notAfter }); }
    catch (e) { return send(res, 500, { ok: false, error: { text: e.message } }); }
  }
  if (path === '/eet/send' && req.method === 'POST') {
    if (!authed) return send(res, 401, { ok: false, error: { text: 'Špatný token' } });
    let body = ''; for await (const c of req) { body += c; if (body.length > 20000) return send(res, 413, { ok: false }); }
    let t; try { t = JSON.parse(body); } catch { return send(res, 400, { ok: false, error: { text: 'Neplatný JSON' } }); }
    let xml;
    try { xml = signEnvelope(buildTrzba(t, cfg.eic), cert()); }
    catch (e) { return send(res, 400, { ok: false, error: { kod: 'data', text: e.message }, retry: false }); }
    if (Buffer.byteLength(xml) > 12000) return send(res, 400, { ok: false, error: { kod: 7, text: 'Zpráva je větší než 12 kB' } });
    try {
      const r = await post(cfg.endpoint || ENDPOINTS[cfg.env], xml);
      const out = parseOdpoved(r.body);
      return send(res, 200, { ...out, env: cfg.env, uuid: t.uuid });
    } catch (e) {
      return send(res, 200, { ok: false, error: { kod: 'spojeni', text: 'Finanční správa neodpověděla: ' + e.message }, retry: true, env: cfg.env, uuid: t.uuid });
    }
  }
  send(res, 404, { ok: false });
});

if (require.main === module) {
  if (!cfg.token) { console.error('Chybí API_TOKEN'); process.exit(1); }
  if (!cfg.eic) { console.error('Chybí EET_EIC'); process.exit(1); }
  try { const c = cert(); console.log(`Certifikát ${c.cn}, platný do ${c.notAfter.toISOString()}`); } catch (e) { console.error('Certifikát:', e.message); process.exit(1); }
  server.listen(cfg.port, () => console.log(`EET brána běží na :${cfg.port} (${cfg.env})`));
}
module.exports = { buildTrzba, signEnvelope, parseOdpoved, loadP12, isoPrague, server, cfg };
