import * as THREE from 'three';
import {paintSurfaceFinish} from './surface-finish.js';

const bases = new Map();
const textureSets = new Map();
let materialSetSerial = 0;
const profiles = {
  red: { color: 0xffffff },
  blue: { color: 0xb9d1e3 },
  ace: { color: 0xc75b48 },
};

function canvas(size) {
  const c=document.createElement('canvas');c.width=c.height=size;return c;
}

// Three explicit projection charts: upper, lower, and vertical surfaces.
// World-space coordinates keep service doors and control lines at actual
// airframe landmarks instead of distributing arbitrary noise over the skin.
function atlas(kind,extent,quality) {
  const key=`${kind}:${quality}`;
  if(textureSets.has(key))return textureSets.get(key);
  if(typeof document==='undefined')return {map:null,roughnessMap:null,normalMap:null};
  const size=1024,resolution={high:2048,medium:1024,low:512}[quality],physicalResolution=resolution/2;
  const color=canvas(resolution),rough=canvas(resolution),height=canvas(resolution);
  const c=color.getContext('2d'),r=rough.getContext('2d'),h=height.getContext('2d');
  for(const ctx of [c,r,h])ctx.scale(resolution/size,resolution/size);
  c.fillStyle={fighter:'#70858c',transport:'#8b9391',drone:'#a4af9f'}[kind];c.fillRect(0,0,size,size);
  c.fillStyle={fighter:'#99a8ab',transport:'#898f8c',drone:'#acb3a5'}[kind];c.fillRect(size*.501,0,size*.499,size*.5);
  r.fillStyle={fighter:'#b8b8b8',transport:'#c6c6c6',drone:'#cccccc'}[kind];r.fillRect(0,0,size,size);
  h.fillStyle='#808080';h.fillRect(0,0,size,size);
  const point=(p,chart='top')=> {
    const [x,z]=p;
    if(chart==='side')return [(z/extent.length+.5)*.996*size+.002*size,(.998-(x/extent.height+.5)*.496)*size];
    return [((x/extent.span+.5)*.496+(chart==='bottom'?.502:.002))*size,(.498-(z/extent.length+.5)*.496)*size];
  };
  const path=(ctx,points,chart,close)=>{ctx.beginPath();points.forEach((p,i)=>{const q=point(p,chart);if(i)ctx.lineTo(...q);else ctx.moveTo(...q);});if(close)ctx.closePath();};
  const panel=(points,{chart='top',fill=null,width=1,closed=true}={})=> {
    if(fill){path(c,points,chart,closed);c.fillStyle=fill;c.fill();path(r,points,chart,closed);r.fillStyle='rgb(195,195,195)';r.fill();}
    for(const [ctx,stroke,w]of [[c,'rgba(35,45,49,.27)',width],[r,'rgb(145,145,145)',width+1],[h,'rgb(114,114,114)',width]]) {
      path(ctx,points,chart,closed);ctx.strokeStyle=stroke;ctx.lineWidth=w;ctx.lineJoin='round';ctx.stroke();
    }
  };
  const label=(str,p,{chart='top',size:fontSize=11,rotate=0,alpha=.5}={})=> {
    c.save();c.translate(...point(p,chart));c.rotate(rotate);c.fillStyle=`rgba(29,38,41,${alpha})`;c.font=`600 ${fontSize}px monospace`;c.textAlign='center';c.fillText(str,0,0);c.restore();
  };
  const roundel=(x,z,chart='top')=> {
    const [px,py]=point([x,z],chart);c.save();c.translate(px,py);c.fillStyle='rgba(52,66,71,.66)';c.beginPath();c.arc(0,0,kind==='transport'?8:7,0,Math.PI*2);c.fill();
    c.fillStyle='rgba(191,199,199,.88)';c.beginPath();c.moveTo(0,-5);c.lineTo(4,4);c.lineTo(0,2);c.lineTo(-4,4);c.closePath();c.fill();c.restore();
  };
  paintSurfaceFinish({color:c,roughness:r,height:h,point,kind});
  if(kind==='fighter') {
    for(const s of [-1,1]) {
      panel([[s*.25,5.98],[s*.66,5.98]],{closed:false});
      panel([[s*.7,3.85],[s*1.17,2.2],[s*1.82,.85],[s*1.65,-3.2],[s*.9,-4.25]],{closed:false});
      panel([[s*1.4,1.9],[s*1.88,.75],[s*1.83,-.85],[s*1.36,-.85]],{fill:'rgba(59,76,81,.07)'});
      panel([[s*1.9,-2.85],[s*5.3,-4.03],[s*5.45,-4.8],[s*2.1,-4.6]],{fill:'rgba(208,214,210,.08)'});
      panel([[s*2.35,-.2],[s*3.85,-1.67],[s*5.62,-3.54]],{closed:false});
      panel([[s*3.7,-1.48],[s*3.82,-4.46]],{closed:false,width:.75});
      panel([[s*1.65,-5.8],[s*3.63,-7.3],[s*3.51,-7.82],[s*1.55,-7.5]],{fill:'rgba(210,212,207,.10)'});
      for(const z of [1.6,.4,-1.4,-3.2,-4.8]) panel([[s*.87,z],[s*1.58,z-.17]],{closed:false,width:.7});
      for(let j=0;j<8;j++)panel([[s*1.45,.52-j*.14],[s*1.79,.38-j*.14]],{closed:false,width:1.2});
      roundel(s*4.22,-3.6);
      label('NO STEP',[s*3.15,-2.7],{size:5,alpha:.44});
      panel([[s*.5,3.65],[s*.58,1.02],[s*1.38,.74],[s*1.34,3.15]],{chart:'bottom'});
      panel([[s*.53,-2.2],[s*1.35,-2.2],[s*1.4,-4.85],[s*.58,-4.85]],{chart:'bottom'});
    }
    panel([[-.42,-.65],[-.51,-2.76],[.51,-2.76],[.42,-.65]],{fill:'rgba(218,222,217,.12)'});
    panel([[-.4,2.1],[-.42,4.65],[.42,4.65],[.4,2.1]],{chart:'bottom'});
    label('07',[.3,5.05],{chart:'side',size:19,alpha:.65});
    label('DANGER',[.04,2.6],{chart:'side',size:5});
    label('07',[1.61,-5.76],{chart:'side',size:20,alpha:.64});
    label('714',[.92,-5.74],{chart:'side',size:7,alpha:.58});
    label('RESCUE',[.52,3.84],{chart:'side',size:4,alpha:.72});
  } else if(kind==='transport') {
    for(const s of [-1,1]) {
      panel([[s*2.05,3.7],[s*6.1,1.4],[s*11.1,-1.5],[s*14.2,-3.48]],{closed:false});
      panel([[s*2.7,-.8],[s*6.1,-2],[s*10.5,-4.05],[s*14.1,-4.93]],{closed:false,width:1.2});
      for(const x of [4.2,6.2,8.8,11.6])panel([[s*x,4.05-x*.5],[s*x,-.45-x*.29]],{closed:false,width:.65});
      panel([[s*2.9,-1.05],[s*6.1,-2.25],[s*6.1,-3.15],[s*2.9,-1.76]],{fill:'rgba(75,84,87,.08)'});
      panel([[s*6.4,-2.31],[s*10.3,-3.95],[s*10.3,-4.52],[s*6.4,-3.37]],{fill:'rgba(76,82,84,.08)'});
      roundel(s*10.6,-2.9);
      label('RESCUE',[s*2.8,-.1],{size:5});
      panel([[s*.5,-10],[s*4.9,-12.4]],{closed:false});
      panel([[s*1.55,1.4],[s*2.1,1.1],[s*2.12,-4.35],[s*1.55,-4.6]],{chart:'bottom',fill:'rgba(75,83,86,.1)'});
    }
    for(const z of [9.7,6.1,2.2,-2.4,-6.1,-8.75])panel([[-1.75,z],[1.75,z]],{closed:false,width:.7});
    panel([[-1.45,-7.3],[-.7,-12.3],[.7,-12.3],[1.45,-7.3]],{chart:'bottom',width:1.4});
    for(const z of [9.0,-7.0])panel([[-.87,z-.33],[.85,z-.33],[.9,z+.45],[-.9,z+.45]],{chart:'side',fill:'rgba(168,176,177,.6)'});
    for(const z of [7,3,-1.5,-5.8]) panel([[-1.67,z],[1.5,z]],{chart:'side',closed:false,width:.6});
    label('AIRLIFT',[.65,5.35],{chart:'side',size:13,alpha:.5});
    label('021',[3.2,-10.6],{chart:'side',size:17,alpha:.65});
  } else {
    for(const s of [-1,1]) {
      panel([[s*.6,-.48],[s*3.15,-.65],[s*7.85,-.82]],{closed:false,width:.75});
      panel([[s*3.13,.36],[s*3.15,-.86]],{closed:false,width:.6});
      panel([[s*6.8,.01],[s*6.8,-.94]],{closed:false,width:.6});
      roundel(s*5.3,-.15);
      label('NO STEP',[s*2.1,-.12],{size:6});
    }
    panel([[-.35,2.75],[-.39,1.3],[.39,1.3],[.35,2.75]],{fill:'rgba(226,226,216,.15)'});
    panel([[-.3,-1.85],[-.21,-3.65],[.21,-3.65],[.3,-1.85]],{fill:'rgba(67,77,80,.07)'});
    for(const z of [2.62,.74,-.92,-2.9])panel([[-.48,z],[.48,z]],{closed:false,width:.6});
    label('RQ 014',[.15,.9],{chart:'side',size:12,alpha:.5});
    panel([[-.2,2.3],[-.2,1.35],[.2,1.35],[.2,2.3]],{chart:'bottom'});
  }
  // Fine finish variation is below the scale of panel lines. A seeded hash
  // gives reproducible texture uploads with no per-frame work or randomness.
  const pixels=c.getImageData(0,0,resolution,resolution),rp=r.getImageData(0,0,resolution,resolution);
  for(let i=0;i<pixels.data.length;i+=4) {
    const px=i/4%resolution,py=Math.floor(i/4/resolution);
    let hash=Math.imul(px+71,374761393)^Math.imul(py+193,668265263);hash=Math.imul(hash^(hash>>>13),1274126177);
    const v=((hash^(hash>>>16))>>>0)/4294967295-.5;
    for(let ch=0;ch<3;ch++){pixels.data[i+ch]+=v*2.6;rp.data[i+ch]+=v*6;}
  }
  c.putImageData(pixels,0,0);r.putImageData(rp,0,0);
  const smallRough=canvas(physicalResolution),normal=canvas(physicalResolution),smallHeight=canvas(physicalResolution),heightAtResolution=canvas(physicalResolution);
  smallRough.getContext('2d').drawImage(rough,0,0,physicalResolution,physicalResolution);
  heightAtResolution.getContext('2d').drawImage(height,0,0,physicalResolution,physicalResolution);
  const sh=smallHeight.getContext('2d');
  // Sub-pixel engraved seams need a band-limited height signal before
  // differentiation. Otherwise diagonal lines produce serrated highlights.
  sh.filter='blur(0.65px)';sh.drawImage(heightAtResolution,0,0);sh.filter='none';
  const heights=sh.getImageData(0,0,physicalResolution,physicalResolution).data,nc=normal.getContext('2d'),np=nc.createImageData(physicalResolution,physicalResolution);
  for(let y=0;y<physicalResolution;y++)for(let x=0;x<physicalResolution;x++) {
    const at=(xx,yy)=>heights[(THREE.MathUtils.clamp(yy,0,physicalResolution-1)*physicalResolution+THREE.MathUtils.clamp(xx,0,physicalResolution-1))*4];
    const dx=(at(x+1,y)-at(x-1,y))*.017,dy=(at(x,y+1)-at(x,y-1))*.017,inv=1/Math.hypot(dx,dy,1),i=(y*physicalResolution+x)*4;
    np.data[i]=(dx*inv*.5+.5)*255;np.data[i+1]=(dy*inv*.5+.5)*255;np.data[i+2]=(inv*.5+.5)*255;np.data[i+3]=255;
  }
  nc.putImageData(np,0,0);
  const make=(source,srgb=false)=>{const t=new THREE.CanvasTexture(source);t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;t.anisotropy=4;return t;};
  const maps={map:make(color,true),roughnessMap:make(smallRough),normalMap:make(normal)};
  textureSets.set(key,maps);return maps;
}

export function createCoatings(kind,extent,quality='high') {
  const maps=atlas(kind,extent,quality);
  const setId=++materialSetSerial;
  const m={
    skin:new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:{fighter:.83,transport:.79,drone:.94}[kind],metalness:{fighter:.035,transport:.025,drone:.012}[kind],clearcoat:kind==='drone'?.025:.075,clearcoatRoughness:kind==='drone'?.68:.48,specularIntensity:kind==='drone'?.60:.76,normalScale:new THREE.Vector2(.22,.22),...maps,vertexColors:true}),
    dielectric:new THREE.MeshPhysicalMaterial({color:kind==='fighter'?0x5b6461:kind==='drone'?0xbfc2ad:0xa0a7a4,roughness:kind==='drone'?.97:.78,roughnessMap:kind==='drone'?maps.roughnessMap:null,metalness:.015,clearcoat:.025,clearcoatRoughness:.68,specularIntensity:.62,vertexColors:true}),
    trim:new THREE.MeshStandardMaterial({color:0x424b4d,roughness:.72,metalness:.22,vertexColors:true,side:THREE.DoubleSide}),
    glass:new THREE.MeshPhysicalMaterial({color:0x637f88,roughness:.065,metalness:0,clearcoat:1,clearcoatRoughness:.038,ior:1.48,specularIntensity:1,iridescence:.09,iridescenceIOR:1.32,iridescenceThicknessRange:[180,260],reflectivity:.72,vertexColors:true,side:THREE.DoubleSide}),
    metal:new THREE.MeshStandardMaterial({color:0x9ba2a6,roughness:kind==='fighter'?.50:.42,envMapIntensity:kind==='fighter'?.72:1,metalness:.86,vertexColors:true,side:THREE.DoubleSide}),
    cavity:new THREE.MeshStandardMaterial({color:0x11191d,roughness:.94,metalness:.05,vertexColors:true,side:THREE.DoubleSide}),
    light:new THREE.MeshStandardMaterial({color:0xebcda5,roughness:.18,metalness:.22,emissive:0xb39464,emissiveIntensity:.32,vertexColors:true}),
  };
  if(kind!=='drone')m.crew=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.94,metalness:0,envMapIntensity:.65,vertexColors:true});
  if(kind==='transport') {
    m.machined=new THREE.MeshStandardMaterial({color:0xadb6bc,roughness:.23,metalness:.92,envMapIntensity:.83,vertexColors:true,side:THREE.DoubleSide});
    m.fan=new THREE.MeshStandardMaterial({color:0x78868e,roughness:.47,metalness:.74,envMapIntensity:.78,vertexColors:true,side:THREE.DoubleSide});
  }
  if(kind==='drone') {
    m.glass.color.setHex(0x0c2833);m.glass.roughness=.038;m.glass.iridescence=.19;
    m.glass.iridescenceThicknessRange=[180,350];m.metal.roughness=.50;m.metal.metalness=.73;
  }
  for(const [role,mat]of Object.entries(m)) {
    // A second preview/model build must not replace the original pool's
    // tint when an older clone is recoloured later.
    const key=`${kind}:${quality}:${setId}:${role}`;mat.name=`bandit-${kind}-${role}`;
    mat.userData={banditMaterialKey:key,banditLivery:role==='skin',aircraft:kind,role};bases.set(key,mat);
  }
  return m;
}

/**
 * One cache per Bandits pool. apply() allocates a variant once per original
 * material/livery, then only assigns shared references. Textures, normal
 * scales, roughness maps and role metadata survive every spawn/recolour.
 * Object3D.clone(true) preserves the string key without serializing a
 * material or losing its identity through JSON userData cloning.
 */
export function createBanditLiveryCache() {
  const variants=new Map();
  return {
    apply(group,livery='red') {
      const profile=profiles[livery];if(!profile)throw new Error(`Unknown bandit livery: ${livery}`);
      group.traverse(mesh=>{
        if(!mesh.isMesh||!mesh.userData.livery)return;
        const base=bases.get(mesh.userData.banditMaterialKey);if(!base)return;
        if(livery==='red'){mesh.material=base;return;}
        const key=`${base.userData.banditMaterialKey}:${livery}`;
        if(!variants.has(key)){const mat=base.clone();mat.name=`${base.name}-${livery}`;mat.color.multiply(new THREE.Color(profile.color));mat.userData={...base.userData,livery};variants.set(key,mat);}
        mesh.material=variants.get(key);
      });
      group.userData.livery=livery;return group;
    },
    get size(){return variants.size;},
    dispose(){for(const mat of variants.values())mat.dispose();variants.clear();},
  };
}
