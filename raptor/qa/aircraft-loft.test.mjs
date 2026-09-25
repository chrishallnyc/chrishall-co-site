import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleSection,loft,mirror} from '../src/aircraft/bandits/geometry.js';

const rows=[[0,.006,.01,0,1],[.03,.17,.20,.02,1.1],[.13,.4,.45,.05,1.2],
 [.8,1.0,1.15,.09,1.0],[4,1.5,1.65,.02,.95],[12,1.5,1.65,-.03,1]];
test('unequally spaced aircraft sections keep one tangent at every station',()=>{
 for(let i=1;i<rows.length-1;i++)for(let field=1;field<=4;field++){
  const z=rows[i][0],h=Math.min(z-rows[i-1][0],rows[i+1][0]-z)*1e-6;
  const center=sampleSection(rows,z)[field];
  const left=(center-sampleSection(rows,z-h)[field])/h,right=(sampleSection(rows,z+h)[field]-center)/h;
  assert(Math.abs(left-right)<.0002,`field ${field} at ${z}: ${left} != ${right}`);
 }
});
test('smooth nose sections preserve every station and never fold past local extrema',()=>{
 for(const row of rows)assert.deepEqual(sampleSection(rows,row[0]),row);
 for(let i=0;i<rows.length-1;i++)for(let j=0;j<=100;j++){
  const v=sampleSection(rows,rows[i][0]+(rows[i+1][0]-rows[i][0])*j/100);
  for(let k=1;k<=4;k++)assert(v[k]>=Math.min(rows[i][k],rows[i+1][k])-1e-12&&v[k]<=Math.max(rows[i][k],rows[i+1][k])+1e-12);
 }
 assert.deepEqual(sampleSection([[0,1,2],[10,2,4]],5),[5,1.5,3,0,1]);
});

test('aircraft hull highlights retain their direction as ring density changes or geometry mirrors',()=>{
 const coarse=loft(rows,32,true,2),fine=loft(rows,32,true,7);
 const a=coarse.attributes.normal,b=fine.attributes.normal;
 for(let station=0;station<rows.length;station++)for(let angle=0;angle<32;angle++){
  const ia=station*2*32+angle,ib=station*7*32+angle;
  assert(Math.hypot(a.getX(ia)-b.getX(ib),a.getY(ia)-b.getY(ib),a.getZ(ia)-b.getZ(ib))<1e-6);
 }
 const mirrored=mirror(fine.clone()),n=mirrored.attributes.normal;
 for(let i=0;i<n.count;i++)assert(Math.hypot(n.getX(i)+b.getX(i),n.getY(i)-b.getY(i),n.getZ(i)-b.getZ(i))<1e-6);
 coarse.dispose();fine.dispose();mirrored.dispose();
});
