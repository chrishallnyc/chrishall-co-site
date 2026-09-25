// Rebuild the deterministic compact BSC5P asset from NASA's pinned query.
// node bake_bright_stars.mjs SOURCE.vot OUTPUT.bin
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [sourcePath,outputPath]=process.argv.slice(2);
if(!sourcePath||!outputPath)throw Error('Usage: node bake_bright_stars.mjs SOURCE.vot OUTPUT.bin');
const bytes=readFileSync(sourcePath),xml=bytes.toString();
const names=[...xml.matchAll(/<FIELD\b[^>]*\bname="([^"]+)"/g)].map(m=>m[1]);
if(names.join(',')!=='hr,ra,dec,vmag,bv_color,pmra,pmdec,alt_name'||!xml.includes('value="OK"'))throw Error('Unexpected NASA VOTable schema/status');
const payload=Buffer.from(xml.match(/<STREAM encoding="base64">([\s\S]*?)<\/STREAM>/)?.[1]||'','base64');
const rows=[],nonStellar=new Set([92,95,182,1057,1841,2472,2496,3515,3671,6309,6515,7189,7539,8296]);
let at=0;
while(at<payload.length){
 const hr=payload.readInt16BE(at),ra=payload.readDoubleBE(at+2),dec=payload.readDoubleBE(at+10);
 const magnitude=payload.readFloatBE(at+18),bv=payload.readFloatBE(at+22),pmRA=payload.readFloatBE(at+26),pmDec=payload.readFloatBE(at+30);
 const size=payload.readInt32BE(at+34);if(size<0||size>256)throw Error('Invalid name length');
 const name=payload.toString('ascii',at+38,at+38+size);at+=38+size;
 if(!nonStellar.has(hr)&&Number.isFinite(magnitude)&&magnitude<=6.000001)rows.push({hr,ra,dec,magnitude,bv,pmRA,pmDec,name});
}
if(at!==payload.length||rows.length!==5080)throw Error('Source row count/layout changed; review catalog before rebaking');
rows.sort((a,b)=>a.hr-b.hr);
const output=Buffer.alloc(24+rows.length*18);output.write('BSC1',0,'ascii');output.writeUInt16LE(1,4);output.writeUInt16LE(18,6);output.writeUInt32LE(rows.length,8);output.writeDoubleLE(2000,12);
for(let i=0;i<rows.length;i++){
 const s=rows[i],p=24+i*18;
 output.writeUInt16LE(s.hr,p);output.writeUInt32LE(Math.round(s.ra*3600000),p+2);output.writeInt32LE(Math.round(s.dec*3600000),p+6);
 output.writeInt16LE(Math.round(s.magnitude*100),p+10);output.writeInt16LE(Number.isFinite(s.bv)?Math.round(s.bv*100):32767,p+12);
 output.writeInt16LE(Number.isFinite(s.pmRA)?Math.round(s.pmRA*1000):0,p+14);output.writeInt16LE(Number.isFinite(s.pmDec)?Math.round(s.pmDec*1000):0,p+16);
}
writeFileSync(outputPath,output);
console.log(JSON.stringify({count:rows.length,bytes:output.length,sourceSHA256:createHash('sha256').update(bytes).digest('hex'),assetSHA256:createHash('sha256').update(output).digest('hex'),missingColor:rows.filter(s=>!Number.isFinite(s.bv)).length,bins:[1.5,3.5,6.5].map((max,i)=>({max,count:rows.filter(s=>s.magnitude<=max&&s.magnitude>(i?[1.5,3.5][i-1]:-Infinity)).length})),anchors:rows.filter(s=>[424,1713,1852,1903,1948,2061,2326,2491,4301,4295,4554,4660,4905,5054,5191,5267,7001].includes(s.hr))},null,2));
