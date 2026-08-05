/* CHALL.NET v1.21.0 — zen garden: a sumi-e ink tree on rice paper.
   The tree grows from the word-free margin, buds through spring, sheds through
   autumn; leaves flutter down the open areas and drift against the bottom of
   the page. Runs only while data-theme="zen"; fully behind the text (z 0);
   prefers-reduced-motion gets a single still summer painting. */
(function(){
'use strict';

var TAU=Math.PI*2;
var mq=window.matchMedia('(prefers-reduced-motion: reduce)');

var canvas=null, ctx=null, ground=null, gctx=null;
var W=0, H=0, DPR=1, SCALE=1;
var GRES=5, GMAX=90, heights=null, nCols=0;
var strokes=[], pads=[], padWheel=[], leaves=[], fallers=[];
var colL=0, colR=0, colTop=150;
var active=false, running=false, built=false, raf=0;
var lastTs=0, growT=0, seasonT=0, windT=0;
var seed=Math.random()*TAU;
var gust=0, gustTarget=0, nextGust=7+Math.random()*9;
var budAcc=0, dropAcc=0, colorTick=0, fadeTick=0;

var GROW=9;                                    /* branch growth, seconds   */
var SPRING=95, SUMMER=170, AUTUMN=120, WINTER=50;
var CYCLE=SPRING+SUMMER+AUTUMN+WINTER;
var TARGET=280;                                /* full-canopy leaf count   */
var MAXFALL=90;

var INK='#2c2922';
var SPRING_RGB=[181,193,118], SUMMER_RGB=[121,142,85];
var AUTUMN_RAMP=[[213,167,74],[199,128,54],[169,91,44],[147,107,64]];
var EARTH=[110,92,60];

/* scratch buffers for the bent-ribbon pass */
var BX=new Float32Array(220), BY=new Float32Array(220);
var LX=new Float32Array(220), LY=new Float32Array(220);
var RX=new Float32Array(220), RY=new Float32Array(220);

function rnd(a,b){ return a+Math.random()*(b-a); }
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function smooth(t){ t=clamp(t,0,1); return t*t*(3-2*t); }

/* ── seasons ─────────────────────────────────────────────── */
function season(){
  var t=((seasonT%CYCLE)+CYCLE)%CYCLE;
  if(t<SPRING) return {n:0,p:t/SPRING};
  t-=SPRING; if(t<SUMMER) return {n:1,p:t/SUMMER};
  t-=SUMMER; if(t<AUTUMN) return {n:2,p:t/AUTUMN};
  return {n:3,p:(t-AUTUMN)/WINTER};
}
function canopyTarget(s){
  if(s.n===0) return TARGET*smooth(s.p*1.15);
  if(s.n===1) return TARGET;
  if(s.n===2) return TARGET*(1-smooth((s.p-0.04)/0.88));
  return 0;
}

/* ── geometry ────────────────────────────────────────────── */
function cr(a,b,c,d,t){
  return b+0.5*t*(c-a+t*(2*a-5*b+4*c-d+t*(3*(b-c)+d-a)));
}
function sampleCurve(A,n){
  var pts=[],last=A.length-1;
  for(var i=0;i<n;i++){
    var t=i/(n-1)*last;
    var k=Math.min(last-1,Math.floor(t)), u=t-k;
    var p0=A[Math.max(0,k-1)],p1=A[k],p2=A[k+1],p3=A[Math.min(last,k+2)];
    pts.push({x:cr(p0.x,p1.x,p2.x,p3.x,u), y:cr(p0.y,p1.y,p2.y,p3.y,u)});
  }
  return pts;
}
function mkStroke(pts,hw0,hw1,g0,g1,sw0,sw1){
  var n=pts.length, hw=new Float32Array(n), sw=new Float32Array(n);
  for(var i=0;i<n;i++){
    var u=i/(n-1);
    hw[i]=hw0+(hw1-hw0)*Math.pow(u,0.72);
    sw[i]=sw0+(sw1-sw0)*Math.pow(u,1.35);
  }
  return {pts:pts,hw:hw,sw:sw,g0:g0,g1:g1,ph:rnd(0,TAU)};
}
function tangentAt(pts,idx){
  var a=pts[Math.max(0,idx-2)], b=pts[Math.min(pts.length-1,idx+2)];
  return Math.atan2(b.y-a.y,b.x-a.x);
}
function addPad(cx,cy,rx,ry,tilt,sw,g){
  pads.push({cx:cx,cy:cy,rx:rx,ry:ry,tilt:tilt,sw:sw,ph:rnd(0,TAU),g:g,dx:0,dy:0});
}
function addTufts(bp,L,swTip,g1){
  /* dense leaf clusters along the outer half of a branch */
  var us=L>90?[0.55,0.78,1]:[0.6,1];
  for(var k=0;k<us.length;k++){
    var u=us[k], B=bp[Math.round(u*(bp.length-1))];
    var rx=(u===1?L*0.42:L*0.30)+10;
    addPad(B.x,B.y-6,rx,rx*rnd(0.5,0.62),rnd(-0.22,0.22),
      swTip*(0.8+u*0.25),g1);
  }
}
function addBranch(pts,idx,spineHW,sweepSide,mR){
  var t=idx/(pts.length-1);
  var P=pts[idx], ang=tangentAt(pts,idx);
  var rising=t<0.55;
  var side=rising?1:sweepSide, L;
  if(rising){ L=clamp(mR*rnd(0.26,0.40),40,110); }
  else{ L=clamp(W*rnd(0.045,0.075),42,130)*(1-(t-0.55)*0.6); }
  var dir=ang+side*(rising?rnd(0.25,0.5):rnd(0.55,0.9));
  var e1={x:P.x+Math.cos(dir)*L*0.5, y:P.y+Math.sin(dir)*L*0.5+L*0.05};
  var e2={x:P.x+Math.cos(dir)*L,     y:P.y+Math.sin(dir)*L+L*(rising?0.10:0.26)};
  var bp=sampleCurve([P,e1,e2],26);
  var swBase=Math.pow(t,1.3), swTip=Math.min(1.45,swBase+0.45);
  var g0=clamp(0.30+t*0.40,0,0.7), g1=g0+0.28;
  strokes.push(mkStroke(bp,Math.max(1.6,spineHW*0.5),0.5,g0,g1,swBase,swTip));
  addTufts(bp,L,swTip,g1);
  if(Math.random()<0.45){
    var P2=bp[12], dir2=dir-side*rnd(0.5,0.85), L2=L*0.55;
    var f1={x:P2.x+Math.cos(dir2)*L2*0.55,y:P2.y+Math.sin(dir2)*L2*0.55+L2*0.06};
    var f2={x:P2.x+Math.cos(dir2)*L2,     y:P2.y+Math.sin(dir2)*L2+L2*0.2};
    var bp2=sampleCurve([P2,f1,f2],18);
    strokes.push(mkStroke(bp2,
      Math.max(1.2,spineHW*0.3),0.45,g0+0.12,g1+0.16,swBase+0.15,swTip+0.2));
    addTufts(bp2,L2,swTip+0.15,g1+0.16);
  }
}
function buildTree(){
  var mR=Math.max(70,W-colR);
  var rootX=colR+clamp(mR*0.52,40,Math.max(40,mR-26));
  if(W-colR<90) rootX=W-46;
  var bandY=clamp(colTop*0.5,54,170);
  var A=[
    {x:rootX+rnd(-8,8), y:H+26},
    {x:rootX+mR*0.06,   y:H*0.74},
    {x:rootX-mR*0.10,   y:H*0.50},
    {x:rootX+mR*0.02,   y:H*0.32},
    {x:rootX-mR*0.24,   y:colTop*rnd(1.0,1.12)},
    {x:W*0.86,          y:bandY*1.75},
    {x:W*0.66,          y:bandY*1.2},
    {x:W*0.44,          y:bandY*rnd(0.95,1.1)},
    {x:W*rnd(0.15,0.19),y:bandY*1.3}
  ];
  var pts=sampleCurve(A,150);
  var hw0=clamp(W*0.006,4.5,10.5);
  var spine=mkStroke(pts,hw0,0.55,0,0.5,0,1);
  var flare=[1.9,1.55,1.32,1.14,1.05];
  for(var i=0;i<flare.length;i++) spine.hw[i]*=flare[i];
  strokes.push(spine);
  var defs=[0.24,0.36,0.47,0.56,0.63,0.70,0.78,0.86,0.93];
  for(i=0;i<defs.length;i++){
    var t=clamp(defs[i]+rnd(-0.02,0.02),0.12,0.95);
    var idx=Math.round(t*(pts.length-1));
    addBranch(pts,idx,spine.hw[idx],(i%2?1:-1),mR);
  }
  /* canopy tufts directly along the top sweep */
  var tip=pts[pts.length-1];
  addPad(tip.x+W*0.006,tip.y-4,clamp(W*0.05,52,96),clamp(W*0.05,52,96)*0.55,
    rnd(-0.1,0.1),1.05,0.55);
  [0.60,0.68,0.76,0.84,0.92].forEach(function(u,i2){
    var id2=Math.round(u*(pts.length-1)), p=pts[id2];
    var rx=clamp(W*0.032,34,58);
    addPad(p.x,p.y+(i2%2?-14:9),rx,rx*rnd(0.5,0.6),
      rnd(-0.12,0.12),Math.pow(u,1.3)+0.2,0.55);
  });
}
function buildBranch(){ /* narrow screens: one bough leaning in from the corner */
  var bandY=clamp(colTop*0.55,42,120);
  var A=[
    {x:W+30,   y:-26},
    {x:W*0.88, y:bandY*0.5},
    {x:W*0.60, y:bandY*rnd(0.9,1.05)},
    {x:W*0.34, y:bandY*rnd(0.75,0.95)},
    {x:W*0.13, y:bandY*1.3}
  ];
  var pts=sampleCurve(A,90);
  strokes.push(mkStroke(pts,4.4,0.5,0,0.6,0.15,1));
  var defs=[0.35,0.55,0.75];
  for(var i=0;i<defs.length;i++){
    var idx=Math.round(defs[i]*(pts.length-1));
    var P=pts[idx], ang=tangentAt(pts,idx), side=(i%2?-1:1);
    var L=clamp(W*0.10,34,66), dir=ang+side*rnd(0.6,0.95);
    var e2={x:P.x+Math.cos(dir)*L, y:P.y+Math.sin(dir)*L+L*0.3};
    var bp2=sampleCurve([P,{x:(P.x+e2.x)/2,y:(P.y+e2.y)/2+L*0.05},e2],16);
    strokes.push(mkStroke(bp2,1.8,0.45,0.4+defs[i]*0.3,0.7+defs[i]*0.3,0.5,1.1));
    addTufts(bp2,L,1.1,0.7+defs[i]*0.3);
  }
  var tip=pts[pts.length-1];
  addPad(tip.x+6,tip.y,clamp(W*0.11,40,64),clamp(W*0.11,40,64)*0.55,rnd(-0.1,0.1),1.15,0.6);
  [0.5,0.7,0.88].forEach(function(u,i2){
    var id2=Math.round(u*(pts.length-1)), p=pts[id2];
    var rx=clamp(W*0.075,28,44);
    addPad(p.x,p.y+(i2%2?-10:7),rx,rx*rnd(0.5,0.62),
      rnd(-0.14,0.14),1+u*0.2,0.65);
  });
}
function buildWheel(){
  padWheel.length=0;
  var total=0,i;
  for(i=0;i<pads.length;i++) total+=pads[i].rx*pads[i].ry;
  for(i=0;i<pads.length;i++){
    var n=Math.max(2,Math.round(pads[i].rx*pads[i].ry/total*64));
    for(var k=0;k<n;k++) padWheel.push(i);
  }
}

/* ── leaves ──────────────────────────────────────────────── */
function colorOne(lf,s){
  var b0,b1,u;
  if(s.n===0){ u=smooth(s.p); b0=SPRING_RGB; b1=SUMMER_RGB; }
  else if(s.n===1){ u=1; b0=SPRING_RGB; b1=SUMMER_RGB; }
  else if(s.n===2){ u=smooth(clamp(s.p*1.3-lf.turn*0.6,0,1)); b0=SUMMER_RGB; b1=lf.autC; }
  else{ u=1; b0=lf.autC; b1=lf.autC; }
  var r=clamp(Math.round(b0[0]+(b1[0]-b0[0])*u+lf.jit[0]),0,255);
  var g=clamp(Math.round(b0[1]+(b1[1]-b0[1])*u+lf.jit[1]),0,255);
  var b=clamp(Math.round(b0[2]+(b1[2]-b0[2])*u+lf.jit[2]),0,255);
  lf.rgb[0]=r; lf.rgb[1]=g; lf.rgb[2]=b;
  lf.col='rgb('+r+','+g+','+b+')';
}
function spawnLeaf(instant,s){
  if(!padWheel.length) return;
  var g=growT>=GROW?1:growT/GROW;
  var pd=null;
  for(var tries=0;tries<10;tries++){
    var cand=pads[padWheel[(Math.random()*padWheel.length)|0]];
    if(cand.g<=g){ pd=cand; break; }
  }
  if(!pd) return;
  var a=rnd(0,TAU), rr=Math.pow(Math.random(),0.8);
  var ex=Math.cos(a)*pd.rx*rr, ey=Math.sin(a)*pd.ry*rr;
  var ct=Math.cos(pd.tilt), st=Math.sin(pd.tilt);
  var lf={pad:pd, ox:ex*ct-ey*st, oy:ex*st+ey*ct,
    size:rnd(4.2,9)*SCALE, asp:rnd(0.55,0.8),
    rot:pd.tilt+rnd(-1.1,1.1)+(Math.random()<0.5?Math.PI:0),
    fq:rnd(0.7,1.6), phz:rnd(0,TAU),
    jit:[Math.round(rnd(-14,14)),Math.round(rnd(-12,12)),Math.round(rnd(-10,10))],
    autC:AUTUMN_RAMP[(Math.random()*AUTUMN_RAMP.length)|0],
    turn:Math.random(), birth:instant?1:0, col:'', rgb:[0,0,0]};
  colorOne(lf,s||season());
  leaves.push(lf);
}
function dropOne(){
  if(!leaves.length||fallers.length>=MAXFALL) return;
  var i=(Math.random()*leaves.length)|0, lf=leaves[i];
  leaves[i]=leaves[leaves.length-1]; leaves.pop();
  var pd=lf.pad;
  fallers.push({x:pd.cx+lf.ox+pd.dx, y:pd.cy+lf.oy+pd.dy,
    vx:rnd(-6,6), vy:rnd(2,9), term:rnd(30,44)+lf.size*2.6,
    phase:rnd(0,TAU), fq:rnd(1.1,2.1), amp:rnd(14,34),
    rot0:lf.rot, tumble:rnd(-0.4,0.4),
    size:lf.size, asp:lf.asp, col:lf.col,
    rgb:[lf.rgb[0],lf.rgb[1],lf.rgb[2]]});
}

/* ── painting ────────────────────────────────────────────── */
function paintLeaf(c,x,y,rot,s,asp,col,alpha){
  var cs=Math.cos(rot), sn=Math.sin(rot);
  c.setTransform(DPR*cs,DPR*sn,-DPR*sn,DPR*cs,DPR*x,DPR*y);
  c.globalAlpha=alpha;
  c.fillStyle=col;
  c.beginPath();
  c.moveTo(0,-s);
  c.quadraticCurveTo(s*asp,-s*0.22,0,s);
  c.quadraticCurveTo(-s*asp,-s*0.22,0,-s);
  c.fill();
}
function resetT(c){ c.setTransform(DPR,0,0,DPR,0,0); c.globalAlpha=1; }
function drawStrokes(t,WA){
  ctx.fillStyle=INK;
  var g=growT>=GROW?1:growT/GROW;
  for(var s=0;s<strokes.length;s++){
    var st=strokes[s];
    var gp=(g-st.g0)/(st.g1-st.g0);
    if(gp<=0) continue;
    gp=smooth(clamp(gp,0,1));
    var pts=st.pts, n=pts.length;
    var m=Math.min(n,Math.max(2,Math.ceil((n-1)*gp)+1));
    var i;
    for(i=0;i<m;i++){
      var swv=st.sw[i];
      BX[i]=pts[i].x+WA*swv*(Math.sin(t*1.05+st.ph+i*0.045)*0.7-0.5);
      BY[i]=pts[i].y+WA*swv*0.35*Math.sin(t*0.8+st.ph*1.9+i*0.05);
    }
    for(i=0;i<m;i++){
      var i0=i>0?i-1:0, i1=i<m-1?i+1:m-1;
      var dx=BX[i1]-BX[i0], dy=BY[i1]-BY[i0];
      var len=Math.sqrt(dx*dx+dy*dy)||1;
      var nx=-dy/len, ny=dx/len;
      var hw=st.hw[i]*(gp<1&&i>=m-2?0.6:1);
      LX[i]=BX[i]+nx*hw; LY[i]=BY[i]+ny*hw;
      RX[i]=BX[i]-nx*hw; RY[i]=BY[i]-ny*hw;
    }
    ctx.beginPath();
    ctx.moveTo(LX[0],LY[0]);
    for(i=1;i<m;i++) ctx.lineTo(LX[i],LY[i]);
    for(i=m-1;i>=0;i--) ctx.lineTo(RX[i],RY[i]);
    ctx.closePath();
    ctx.fill();
  }
}
function drawCanopy(t,WA){
  for(var i=0;i<leaves.length;i++){
    var lf=leaves[i], pd=lf.pad;
    var b=lf.birth<1?smooth(lf.birth):1;
    var x=pd.cx+lf.ox+pd.dx+Math.sin(t*lf.fq+lf.phz)*(1.2+WA*0.16);
    var y=pd.cy+lf.oy+pd.dy+Math.cos(t*lf.fq*0.9+lf.phz)*(0.8+WA*0.08);
    var rot=lf.rot+Math.sin(t*lf.fq+lf.phz)*0.18;
    paintLeaf(ctx,x,y,rot,lf.size*b,lf.asp,lf.col,0.92);
  }
  resetT(ctx);
}
function groundYAt(x){
  var xi=clamp(x/GRES,0,nCols-1), i0=xi|0, i1=Math.min(nCols-1,i0+1), u=xi-i0;
  return H-4-(heights[i0]*(1-u)+heights[i1]*u);
}
function relaxAround(xi){
  for(var k=0;k<3;k++)
    for(var i=Math.max(1,xi-9);i<Math.min(nCols-1,xi+9);i++){
      var d=heights[i]-(heights[i-1]+heights[i+1])/2;
      if(d>5){ heights[i]-=d*0.45; heights[i-1]+=d*0.225; heights[i+1]+=d*0.225; }
    }
}
function stamp(f,gy){
  var rot=(Math.random()<0.5?0:Math.PI)+rnd(-0.55,0.55)+(f.rot0||0)*0.15;
  var m=0.24;
  var r=Math.round(f.rgb[0]+(EARTH[0]-f.rgb[0])*m);
  var g=Math.round(f.rgb[1]+(EARTH[1]-f.rgb[1])*m);
  var b=Math.round(f.rgb[2]+(EARTH[2]-f.rgb[2])*m);
  paintLeaf(gctx,f.x,gy+f.size*0.15,rot,f.size,f.asp,'rgb('+r+','+g+','+b+')',0.92);
  resetT(gctx);
  var xi=Math.round(clamp(f.x/GRES,2,nCols-3));
  var add=f.size*0.5;
  heights[xi]=Math.min(GMAX,heights[xi]+add);
  heights[xi-1]=Math.min(GMAX,heights[xi-1]+add*0.55);
  heights[xi+1]=Math.min(GMAX,heights[xi+1]+add*0.55);
  heights[xi-2]=Math.min(GMAX,heights[xi-2]+add*0.22);
  heights[xi+2]=Math.min(GMAX,heights[xi+2]+add*0.22);
  relaxAround(xi);
}
function stepFallers(dt,wind){
  var wx=-(6+wind*22);
  var cxm=(colL+colR)/2;
  for(var i=fallers.length-1;i>=0;i--){
    var f=fallers[i];
    f.phase+=f.fq*dt;
    f.vy+=(f.term-f.vy)*Math.min(1,dt*1.2);
    var sw=Math.sin(f.phase);
    if(f.y>colTop-60&&f.x>colL-24&&f.x<colR+24){
      f.vx+=(f.x<cxm?-1:1)*26*dt;
    }else{
      f.vx-=f.vx*Math.min(1,dt*0.5);
    }
    f.vx=clamp(f.vx,-44,44);
    f.x+=(f.vx+wx)*dt+sw*f.amp*dt;
    f.y+=f.vy*(0.7+0.3*Math.abs(Math.cos(f.phase)))*dt;
    var rot=f.rot0+f.phase*f.tumble+sw*0.65;
    if(f.x<-40||f.x>W+40){ fallers.splice(i,1); continue; }
    var gy=groundYAt(f.x);
    if(f.y>=gy){ f.rot0=rot; stamp(f,gy); fallers.splice(i,1); continue; }
    paintLeaf(ctx,f.x,f.y,rot,f.size,f.asp,f.col,0.95);
  }
  resetT(ctx);
}
function fadeGround(s){
  gctx.setTransform(1,0,0,1,0,0);
  gctx.globalCompositeOperation='destination-out';
  gctx.globalAlpha=s.n===3?0.055:(s.n===2?0.012:0.02);
  gctx.fillStyle='#000';
  gctx.fillRect(0,0,ground.width,ground.height);
  gctx.globalCompositeOperation='source-over';
  resetT(gctx);
  var dec=s.n===3?0.93:(s.n===2?0.988:0.982);
  for(var i=0;i<nCols;i++) heights[i]*=dec;
}

/* ── frame ───────────────────────────────────────────────── */
function render(t,WA,s,dt,wind){
  resetT(ctx);
  ctx.clearRect(0,0,W,H);
  ctx.drawImage(ground,0,0,W,H);
  for(var i=0;i<pads.length;i++){
    var p=pads[i];
    p.dx=WA*p.sw*(Math.sin(t*1.05+p.ph)*0.7-0.5);
    p.dy=WA*p.sw*0.35*Math.sin(t*0.8+p.ph*1.9);
  }
  drawStrokes(t,WA);
  drawCanopy(t,WA);
  stepFallers(dt,wind);
}
function loop(ts){
  if(!running) return;
  raf=requestAnimationFrame(loop);
  if(!lastTs){ lastTs=ts; return; }
  if(ts-lastTs<20) return;               /* ~48fps cap — kind to batteries */
  var dt=Math.min(0.05,(ts-lastTs)/1000);
  lastTs=ts;
  growT=Math.min(GROW+1,growT+dt);
  if(growT>GROW*0.5) seasonT+=dt;
  windT+=dt;
  nextGust-=dt;
  if(nextGust<=0){ gustTarget=rnd(0.5,1.5); nextGust=rnd(13,38); }
  gust+=(gustTarget-gust)*Math.min(1,dt*1.4);
  gustTarget*=Math.pow(0.5,dt/1.6);
  var wind=Math.max(0,0.30+0.24*Math.sin(windT*0.05+seed)+0.13*Math.sin(windT*0.021+seed*2.7))+gust;
  var WA=(4.5+12*wind)*clamp(W/1300,0.6,1);
  var s=season();
  colorTick-=dt;
  if(colorTick<=0){ colorTick=0.7; for(var i=0;i<leaves.length;i++) colorOne(leaves[i],s); }
  var ct=canopyTarget(s);
  if((s.n===0||s.n===1)&&growT>GROW*0.35){
    var deficit=ct-leaves.length;
    if(deficit>0){
      budAcc+=Math.min(42,1.5+deficit*0.12)*dt;
      while(budAcc>=1){ budAcc-=1; spawnLeaf(false,s); }
    }
  }
  var rate=0;
  if(s.n===0) rate=0.02;
  else if(s.n===1) rate=0.16+(gust>0.35?gust*1.5:0);
  else if(s.n===2) rate=0.05+Math.max(0,leaves.length-ct)*0.14+gust*2;
  else rate=leaves.length*0.08+(leaves.length?0.5:0);
  dropAcc+=rate*dt;
  while(dropAcc>=1&&leaves.length){ dropAcc-=1; dropOne(); }
  if(!leaves.length) dropAcc=0;
  for(i=0;i<leaves.length;i++) if(leaves[i].birth<1) leaves[i].birth=Math.min(1,leaves[i].birth+dt/1.4);
  fadeTick-=dt;
  if(fadeTick<=0){ fadeTick=2.6; fadeGround(s); }
  render(windT,WA,s,dt,wind);
}

/* ── scene management ────────────────────────────────────── */
function build(){
  W=window.innerWidth; H=window.innerHeight;
  DPR=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.max(1,W*DPR); canvas.height=Math.max(1,H*DPR);
  ground=document.createElement('canvas');
  ground.width=canvas.width; ground.height=canvas.height;
  gctx=ground.getContext('2d');
  resetT(ctx); resetT(gctx);
  nCols=Math.ceil(W/GRES)+2;
  heights=new Float32Array(nCols);
  GMAX=clamp(H*0.09,32,80);
  SCALE=clamp(W/1400,0.72,1.08);
  var hdr=document.querySelector('.site-header');
  if(hdr){
    var r=hdr.getBoundingClientRect();
    colL=r.left; colR=r.right;
    colTop=clamp(r.top,110,320);
  }else{ colL=W*0.2; colR=W*0.8; colTop=150; }
  strokes=[]; pads=[]; leaves=[]; fallers=[];
  if(W>=960) buildTree(); else buildBranch();
  buildWheel();
  TARGET=Math.round(clamp(W*H/2600,90,640));
  var s=season(), ct=Math.round(canopyTarget(s));
  for(var i=0;i<ct;i++) spawnLeaf(true,s);
  built=true;
}
function renderStaticScene(){
  if(seasonT===0){ growT=GROW; seasonT=SPRING+SUMMER*0.3; }
  build();
  /* a resting drift along the bottom for the still painting */
  var s=season();
  var n=Math.round(TARGET*0.22);
  for(var i=0;i<n;i++){
    var lf={rot0:rnd(0,TAU),size:rnd(3.4,7.2)*SCALE,asp:rnd(0.55,0.8),
      rgb:[0,0,0],col:'',jit:[Math.round(rnd(-14,14)),Math.round(rnd(-12,12)),Math.round(rnd(-10,10))],
      autC:AUTUMN_RAMP[(Math.random()*AUTUMN_RAMP.length)|0],turn:Math.random()};
    colorOne(lf,s);
    var x=rnd(4,W-4);
    lf.x=x; lf.y=0;
    stamp(lf,groundYAt(x));
  }
  render(0,0,s,0,0);
}
function ensureCanvas(){
  if(canvas) return;
  canvas=document.createElement('canvas');
  canvas.id='zen-canvas';
  canvas.setAttribute('aria-hidden','true');
  document.body.insertBefore(canvas,document.body.firstChild);
  ctx=canvas.getContext('2d');
}
function activate(){
  if(active) return;
  active=true;
  ensureCanvas();
  canvas.style.display='block';
  if(mq.matches){
    running=false; cancelAnimationFrame(raf);
    renderStaticScene();
  }else{
    if(!built) build();
    running=true; lastTs=0;
    raf=requestAnimationFrame(loop);
  }
}
function deactivate(){
  if(!active) return;
  active=false; running=false;
  cancelAnimationFrame(raf);
  if(canvas) canvas.style.display='none';
}
document.addEventListener('chall:themechange',function(e){
  if(e.detail&&e.detail.theme==='zen') activate(); else deactivate();
});
var resizeTo=0;
window.addEventListener('resize',function(){
  if(!active) return;
  clearTimeout(resizeTo);
  resizeTo=setTimeout(function(){
    if(mq.matches) renderStaticScene();
    else build();
  },180);
});
window.addEventListener('load',function(){
  if(active){ if(mq.matches) renderStaticScene(); else build(); }
});
var mqChange=function(){
  if(!active) return;
  running=false; cancelAnimationFrame(raf);
  if(mq.matches) renderStaticScene();
  else{ build(); running=true; lastTs=0; raf=requestAnimationFrame(loop); }
};
if(mq.addEventListener) mq.addEventListener('change',mqChange);
else if(mq.addListener) mq.addListener(mqChange);
window.__ZEN={skip:function(s){seasonT+=s;},info:function(){
  return {season:season(),leaves:leaves.length,fallers:fallers.length,grow:growT,t:seasonT};
}};
if(window.__CHALL_THEME__==='zen') activate();
})();
