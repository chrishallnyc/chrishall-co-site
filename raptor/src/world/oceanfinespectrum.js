// Missing-band render spectrum. The existing macro wave arrays are untouched.
// Integrate only wavelengths below their maximum represented radial mode;
// the fixed small-wave variance budget is split into resolved waves + tail.
export const FINE_VARIANCE = { VALDEZ: .0097 * .36 * .9 ** 2, MARIANAS: .0097 * .36 };
const clamp01 = x => Math.max(0, Math.min(1, x));
const smooth = (a,b,x) => {const t=clamp01((x-a)/(b-a));return t*t*(3-2*t);};
function hash(x,z,seed,salt){
 let h=(Math.imul(x,374761393)+Math.imul(z,668265263)+Math.imul(seed^salt,2246822519))>>>0;
 h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;
}
function gaussian(mx,mz,seed){
 const a=Math.sqrt(-2*Math.log(Math.max(1e-12,1-hash(mx,mz,seed,0x5bd1e995))));
 const b=2*Math.PI*hash(mx,mz,seed,0x27d4eb2f);return[a*Math.cos(b),a*Math.sin(b)];
}
export function buildFineSpectrum(front,{N=128,tileM=32,seed=1337,macroN=256,macroTileM=320}={}){
 if(!Number.isInteger(Math.log2(N))||N<32)throw new RangeError('Fine ocean N must be a power of two >=32');
 if(!(tileM>0))throw new RangeError('Fine ocean tile must be positive');
 const totalVariance=FINE_VARIANCE[front]??FINE_VARIANCE.MARIANAS;
 const direction=(front==='VALDEZ'?335:65)*Math.PI/180,wx=Math.sin(direction),wz=Math.cos(direction);
 const dk=2*Math.PI/tileM,half=N/2;
 const kMin=Math.SQRT2*2*Math.PI*(macroN/2-1)/macroTileM;
 // The existing baseline GGX width remains below this 10cm gravity/capillary
 // transition. This explicit cutoff bounds the added small-wave budget; it
 // is an art-preserving spectral partition, not a full wind-calibrated sea.
 const kDissipation=2*Math.PI/.1;
 const radial=k=>smooth(kMin,kMin*1.25,k)*Math.exp(-((k/kDissipation)**2))/k;
 // Fixed continuous logarithmic quadrature independent of resolution/tile.
 const panels=4096,lo=Math.log(kMin),hi=Math.log(kDissipation*8),step=(hi-lo)/panels;
 let radialIntegral=0;for(let i=0;i<panels;i++){const k=Math.exp(lo+(i+.5)*step);radialIntegral+=radial(k)*k*step;}
 const angularIntegral=Math.PI/2; // positive-wind cos² lobe
 const coefficient=totalVariance/(2*radialIntegral*angularIntegral);
 const maxK=(half-1)*dk;
 const modeEnergy=(mx,mz)=>{
  if(mx===-half||mz===-half)return 0;
  const kx=mx*dk,kz=mz*dk,k=Math.hypot(kx,kz);if(k<=kMin||k>=maxK)return 0;
  const cosD=(kx*wx+kz*wz)/k;if(cosD<=0)return 0;
  // Existing mode phases/amplitudes stay unchanged when N grows. The cutoff
  // is a physical radial band; a smooth edge is not necessary for a Fourier
  // field, whose every mode is continuous and is then footprint-filtered.
  return coefficient*radial(k)/k**3*cosD**2*dk**2;
 };
 const h0=new Float64Array(N*N*2);let resolvedVariance=0,expectedVariance=0,heightVariance=0,minK=Infinity,maxPresentK=0;
 for(let z=0;z<N;z++)for(let x=0;x<N;x++){
  const mx=x<half?x:x-N,mz=z<half?z:z-N,k=Math.hypot(mx,mz)*dk,p=modeEnergy(mx,mz),[g0,g1]=gaussian(mx,mz,seed^0x6a09e667),a=Math.sqrt(p/2),j=z*N+x;
  const re=g0*a,im=g1*a;h0[j*2]=re;h0[j*2+1]=im;
  resolvedVariance+=2*k*k*(re*re+im*im);expectedVariance+=2*k*k*p;heightVariance+=2*(re*re+im*im);
  if(p>0){minK=Math.min(minK,k);maxPresentK=Math.max(maxPresentK,k);}
 }
 if(resolvedVariance>totalVariance)throw new Error('Fine-wave realized variance exceeds retained small-wave budget');
 const data=new Float32Array(N*N*4);
 for(let z=0;z<N;z++)for(let x=0;x<N;x++){
  const i=z*N+x,j=((N-z)%N)*N+(N-x)%N;data[i*4]=h0[i*2];data[i*4+1]=h0[i*2+1];data[i*4+2]=h0[j*2];data[i*4+3]=-h0[j*2+1];
 }
 return{data,N,tileM,seed,totalVariance,resolvedVariance,expectedVariance,tailVariance:totalVariance-resolvedVariance,heightRMS:Math.sqrt(heightVariance),kMin,minK,maxPresentK};
}
