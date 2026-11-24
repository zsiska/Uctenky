// testovací náhrada finanční správy: ověří podpis a vrátí POK
const http=require('http');const {SignedXml}=require('xml-crypto');const {DOMParser}=require('@xmldom/xmldom');const fs=require('fs');
http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{
 const doc=new DOMParser().parseFromString(b,'text/xml');const sig=doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#','Signature')[0];
 const v=new SignedXml({publicCert:fs.readFileSync(__dirname+'/t.crt','utf8'),idMode:'wssecurity'});v.loadSignature(sig);const ok=v.checkSignature(b);
 const uuid=(b.match(/uuid_zpravy="([^"]+)"/)||[])[1];
 s.writeHead(200,{'Content-Type':'text/xml'});
 s.end(ok?`<soap:Envelope><soap:Body><eet:Odpoved><eet:Hlavicka uuid_zpravy="${uuid}" dat_prij="2026-11-23T22:00:00+01:00"/><eet:Potvrzeni pok="${uuid}-ff" test="true"/></eet:Odpoved></soap:Body></soap:Envelope>`:`<eet:Odpoved><eet:Hlavicka/><eet:Chyba kod="4" test="true">Neplatny podpis SOAP zpravy</eet:Chyba></eet:Odpoved>`)})}).listen(9999);
