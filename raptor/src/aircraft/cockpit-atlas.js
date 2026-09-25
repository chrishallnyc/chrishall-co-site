// Authored instrument layout inspired by public F-22 cockpit photographs.
// These static pages are illustration, not a simulation of classified avionics.
// Color, emitted light, roughness and raised controls are independent channels.
import * as THREE from 'three';

export const COCKPIT_ATLAS = Object.freeze({
  panel: [0, 0, .625, .75], left: [.64, 0, .16, .75], right: [.82, 0, .16, .75],
  seat: [0, .80, .25, .16], caution: [.28, .80, .22, .16],
});

function canvas(width, height) {
  const image = document.createElement('canvas'); image.width = width; image.height = height;
  return [image, image.getContext('2d')];
}
function texture(image, color = false) {
  const map = new THREE.CanvasTexture(image);
  map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.anisotropy = 4;
  return map;
}

export function createCockpitAtlas() {
  const W = 2048, H = 1024;
  const [color, c] = canvas(W, H), [emission, e] = canvas(W, H);
  const [roughness, r] = canvas(W, H), [height, h] = canvas(W, H);
  c.fillStyle = '#22282a'; c.fillRect(0, 0, W, H);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  r.fillStyle = '#c8c8c8'; r.fillRect(0, 0, W, H);
  h.fillStyle = '#808080'; h.fillRect(0, 0, W, H);
  const line = (ctx, points, stroke, width = 2) => {
    ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
  };
  const label = (ctx, text, x, y, size = 10, fill = '#a8b3b1') => {
    ctx.fillStyle = fill; ctx.font = `${size}px monospace`; ctx.textAlign = 'center'; ctx.fillText(text, x, y);
  };
  function fastener(x, y) {
    c.fillStyle = '#0e1213'; c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill();
    line(c, [[x-2,y],[x+2,y]], '#747a78', 1);
    h.fillStyle = '#515151'; h.fillRect(x-3,y-3,6,6);
  }
  function button(x, y, w = 15, ht = 12, text = '') {
    c.fillStyle = '#101516'; c.fillRect(x-w/2-1,y-ht/2-1,w+2,ht+2);
    c.fillStyle = '#384144'; c.fillRect(x-w/2,y-ht/2,w,ht);
    line(c, [[x-w/2,y-ht/2],[x+w/2,y-ht/2]], '#59615f', 1);
    h.fillStyle = '#b2b2b2'; h.fillRect(x-w/2,y-ht/2,w,ht);
    r.fillStyle = '#a5a5a5'; r.fillRect(x-w/2,y-ht/2,w,ht);
    if (text) label(c, text, x, y+3, 8);
  }
  function display(x, y, width, ht, mode, legend) {
    c.fillStyle = '#080d0f'; c.fillRect(x-20,y-20,width+40,ht+40);
    line(c, [[x-21,y+ht+20],[x-21,y-21],[x+width+21,y-21]], '#50595a', 2);
    h.fillStyle = '#999'; h.fillRect(x-21,y-21,width+42,ht+42);
    h.fillStyle = '#6d6d6d'; h.fillRect(x,y,width,ht);
    r.fillStyle = '#525252'; r.fillRect(x,y,width,ht);
    for (let k=0;k<5;k++) {
      button(x+(k+.5)*width/5,y-12,13,9);
      button(x+(k+.5)*width/5,y+ht+12,13,9);
    }
    for (let k=0;k<4;k++) {
      button(x-12,y+(k+.5)*ht/4,9,13);
      button(x+width+12,y+(k+.5)*ht/4,9,13);
    }
    for (const ctx of [c,e]) {
      ctx.save(); ctx.beginPath(); ctx.rect(x,y,width,ht);ctx.clip();
      ctx.fillStyle = '#071216';ctx.fillRect(x,y,width,ht);
      const cx=x+width/2, cy=y+ht*.55;
      const green='#749d78', cyan='#76a5ad', dim='#345351';
      label(ctx,legend,cx,y+13,9,cyan);
      if(mode==='tactical') {
        // Compass scale, ownship and route are intentional recognizable data.
        for(let j=1;j<5;j++) {
          ctx.strokeStyle=dim;ctx.lineWidth=1;ctx.beginPath();ctx.arc(cx,cy,j*width*.12,0,Math.PI*2);ctx.stroke();
        }
        line(ctx,[[cx,y+24],[cx,y+ht-15]],dim,1);
        line(ctx,[[x+10,cy],[x+width-10,cy]],dim,1);
        line(ctx,[[cx-3,cy+38],[cx+22,cy-10],[cx+7,cy-56]],cyan,1.5);
        line(ctx,[[cx-7,cy+6],[cx,cy-6],[cx+7,cy+6]],green,2);
        for(const [dx,dy] of [[-44,-34],[53,-50]]) {
          line(ctx,[[cx+dx-5,cy+dy+5],[cx+dx,cy+dy-4],[cx+dx+5,cy+dy+5]],cyan,2);
        }
        label(ctx,'N',cx,y+29,10,green);label(ctx,'40 NM',x+width-28,y+ht-9,9,green);
      } else if(mode==='attitude') {
        ctx.fillStyle='#16313a';ctx.fillRect(x+16,y+25,width-32,ht*.36);
        ctx.fillStyle='#3b3225';ctx.fillRect(x+16,y+ht*.50,width-32,ht*.32);
        line(ctx,[[x+16,y+ht*.5],[x+width-16,y+ht*.5]],'#afb2a0',2);
        for(let k=-2;k<=2;k++)line(ctx,[[cx-13,cy+k*17],[cx+13,cy+k*17]],green,1);
        line(ctx,[[cx-29,cy],[cx-9,cy],[cx,cy+6],[cx+9,cy],[cx+29,cy]],'#c2b38a',2);
        label(ctx,'350',x+19,y+ht*.5,10,cyan);label(ctx,'180',x+width-19,y+ht*.5,10,cyan);
      } else if(mode==='engine') {
        ['N1','EGT','FUEL','OIL'].forEach((t,k)=>{
          const yy=y+34+k*(ht-48)/4;
          label(ctx,t,x+29,yy,10,green);
          line(ctx,[[x+58,yy-4],[x+width-17,yy-4]],dim,4);
          line(ctx,[[x+58,yy-4],[x+width-36-k*9,yy-4]],cyan,3);
          label(ctx,['82','690','8.4','95'][k],x+width-18,yy+12,8,cyan);
        });
      } else if(mode==='stores') {
        line(ctx,[[cx,y+29],[cx,y+ht-24]],dim,2);
        line(ctx,[[cx-width*.29,cy+16],[cx,cy-9],[cx+width*.29,cy+16]],green,2);
        for(const dx of [-.25,-.10,.10,.25]) {
          ctx.strokeStyle=green;ctx.lineWidth=1;ctx.strokeRect(cx+width*dx-5,cy+22,10,25);
        }
        label(ctx,'MASTER SAFE',cx,y+ht-9,9,cyan);
      } else {
        ['COM 1  251.0','NAV  042  18.5','IFF   1200'].forEach((t,k)=>label(ctx,t,cx,y+30+k*18,9,green));
      }
      ctx.restore();
    }
  }
  // F-22's six-screen hierarchy: large central situation display, secondary
  // left/right/lower pages and small upper auxiliary displays beside the ICP.
  display(456,275,368,289,'tactical','SITUATION');
  display(151,313,231,221,'attitude','FLIGHT');
  display(897,313,231,221,'stores','STORES');
  display(485,610,310,119,'engine','SYSTEMS');
  display(206,128,225,118,'nav','COMM / NAV');
  display(849,128,225,118,'engine','ENGINE');
  // Integrated control panel directly below the HUD.
  c.fillStyle='#141a1c';c.fillRect(493,87,294,149);
  for(let j=0;j<4;j++)for(let i=0;i<6;i++)button(514+i*49,116+j*29,34,20,j===0?['COM','NAV','IFF','LIST','AA','AG'][i]:String((j-1)*6+i));
  label(c,'INTEGRATED CONTROL',640,80,11);
  for(const x of [98,1182])for(const y of [90,265,564,735])fastener(x,y);
  // Side consoles: functional groups, panel breaks, rotary switches and
  // legends; individual buttons do not become scene graph objects.
  for(const [base,side] of [[1311,'left'],[1680,'right']]) {
    for(let row=0;row<6;row++) {
      const y=14+row*123;
      c.fillStyle=row%2?'#252c2e':'#202729';c.fillRect(base,y,317,116);
      line(c,[[base,y],[base+317,y]],'#080f10',2);
      for(const x of [base+9,base+308])fastener(x,y+8);
      label(c,(side==='left'?['FUEL','ENG START','FLIGHT CONTROL','THROTTLE','LIGHTING','ELECTRICAL']:['COMM','NAVIGATION','ECS','AUDIO','OXYGEN','TEST'])[row],base+158,y+18,13);
      for(let j=0;j<2;j++)for(let k=0;k<4;k++) {
        const x=base+43+k*77,yy=y+44+j*49;
        if((row+k)%3===0) {
          c.fillStyle='#101719';c.beginPath();c.arc(x,yy,9,0,Math.PI*2);c.fill();
          line(c,[[x,yy],[x+3,yy-7]],'#bbc1b7',2);
          h.fillStyle='#aaa';h.beginPath();h.arc(x,yy,9,0,Math.PI*2);h.fill();
        } else button(x,yy,18,11);
        label(c,['OFF','NORM','AUTO','ON'][k],x,yy+20,8);
      }
    }
  }
  c.fillStyle='#191d1d';c.fillRect(0,819,520,165);
  label(c,'ACES II',255,861,28,'#c3c7b8');
  label(c,'EJECTION SEAT',255,892,17);label(c,'DANGER  •  EGRESS SYSTEM',255,922,15,'#d3b74e');
  c.fillStyle='#968645';c.fillRect(577,830,430,137);
  label(c,'CAUTION',792,875,25,'#1b2020');label(c,'CANOPY JETTISON',792,905,19,'#1b2020');
  label(c,'KEEP CLEAR',792,936,19,'#1b2020');
  // Normal from the raised-control height field only. Printed text and lit
  // symbols deliberately do not emboss themselves into the instrument face.
  const [normal,n]=canvas(W,H), heights=h.getImageData(0,0,W,H).data;
  const pixels=n.createImageData(W,H), data=pixels.data;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++) {
    const at=(xx,yy)=>heights[(Math.max(0,Math.min(H-1,yy))*W+Math.max(0,Math.min(W-1,xx)))*4]/255;
    const dx=(at(x-1,y)-at(x+1,y))*2,dy=(at(x,y+1)-at(x,y-1))*2;
    const scale=1/Math.hypot(dx,dy,1),i=(y*W+x)*4;
    data[i]=(dx*scale*.5+.5)*255;data[i+1]=(dy*scale*.5+.5)*255;data[i+2]=(scale*.5+.5)*255;data[i+3]=255;
  }
  n.putImageData(pixels,0,0);
  return {map:texture(color,true),emissiveMap:texture(emission,true),roughnessMap:texture(roughness),normalMap:texture(normal)};
}

export function createFabricMaps() {
  const N=128,[normal,n]=canvas(N,N),[roughness,r]=canvas(N,N);
  const ni=n.createImageData(N,N),ri=r.createImageData(N,N);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++) {
    const i=(y*N+x)*4,over=((x>>2)+(y>>2))%2;
    ni.data[i]=128+Math.sin(x*Math.PI/2)*(over?13:6);
    ni.data[i+1]=128+Math.sin(y*Math.PI/2)*(over?6:13);
    ni.data[i+2]=254;ni.data[i+3]=255;
    const q=218+((x*13+y*19)%11);ri.data.set([q,q,q,255],i);
  }
  n.putImageData(ni,0,0);r.putImageData(ri,0,0);
  const maps={normalMap:texture(normal),roughnessMap:texture(roughness)};
  for(const map of Object.values(maps)){map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(5,7);}
  return maps;
}

export function createHUDSymbols() {
  const [image,c]=canvas(256,256);c.clearRect(0,0,256,256);
  c.strokeStyle='#93c191';c.lineWidth=1.1;c.fillStyle='#93c191';c.font='9px monospace';
  for(let i=-2;i<=2;i++) {
    const y=132+i*25;c.beginPath();c.moveTo(96,y);c.lineTo(117,y);c.moveTo(139,y);c.lineTo(160,y);c.stroke();
    if(i)c.fillText(String(Math.abs(i)*10),164,y+3);
  }
  c.beginPath();c.arc(128,137,5,0,Math.PI*2);c.moveTo(116,137);c.lineTo(122,137);
  c.moveTo(134,137);c.lineTo(140,137);c.moveTo(128,132);c.lineTo(128,126);c.stroke();
  c.fillText('350',42,123);c.fillText('18000',178,123);c.fillText('042',118,61);
  return texture(image,true);
}
