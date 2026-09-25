// Assertions for physically fitted cockpit/gear assemblies. They use declared
// dimensions and component ranges, not legacy F-22 attachment coordinates.
import * as THREE from 'three';

export async function inspectDetailedAssemblies(group,parts) {
  const checks=[],gear=[],cockpit=group.getObjectByName('cockpitInterior');
  const check=(id,pass,detail)=>checks.push({id,pass:!!pass,severity:'error',detail});
  group.updateMatrixWorld(true);
  const inverse=group.matrixWorld.clone().invert();
  for(const name of ['gearNose','gearL','gearR']) {
    const rig=parts[name],spec=rig?.userData.landingGear;
    if(!spec)continue;
    const center=new THREE.Vector3(...spec.wheelCenter).applyMatrix4(rig.matrixWorld).applyMatrix4(inverse);
    const axis=new THREE.Vector3(...spec.axleAxis).transformDirection(rig.matrixWorld).transformDirection(inverse);
    gear.push({name,center:center.toArray(),radius:spec.wheelRadius,ground:center.y-spec.wheelRadius});
    check(`gear:axle:${name}`,Math.abs(axis.x)>.999,{axis:axis.toArray()});
    let tireMinY=Infinity,tireMaxY=-Infinity;
    const materials=[];
    rig.traverse(mesh=>{
      if(!mesh.isMesh)return;
      materials.push(mesh.material);
      const ranges=mesh.userData.componentRanges?.filter(range=>range.name==='groovedAircraftTire')??[];
      const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
      for(const range of ranges)for(let j=range.firstTriangle*3;j<(range.firstTriangle+range.triangles)*3;j++) {
        const vertex=new THREE.Vector3().fromBufferAttribute(p,index?index.getX(j):j)
          .applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
        tireMinY=Math.min(tireMinY,vertex.y);tireMaxY=Math.max(tireMaxY,vertex.y);
      }
    });
    check(`gear:tire-diameter:${name}`,Math.abs(tireMaxY-tireMinY-spec.wheelRadius*2)<.0001,{actual:tireMaxY-tireMinY,declared:spec.wheelRadius*2});
    check(`gear:tire-ground:${name}`,Math.abs(tireMinY-(center.y-spec.wheelRadius))<.0001,{actual:tireMinY,declared:center.y-spec.wheelRadius});
  }
  if(gear.length===3) {
    const bottoms=gear.map(g=>g.ground);
    check('gear:coplanar-contact',Math.max(...bottoms)-Math.min(...bottoms)<.001,gear);
    const left=gear.find(g=>g.name==='gearL'),right=gear.find(g=>g.name==='gearR');
    check('gear:paired-main-wheels',Math.abs(left.center[0]+right.center[0])<.001&&Math.abs(left.center[1]-right.center[1])<.001&&Math.abs(left.center[2]-right.center[2])<.001,{left:left.center,right:right.center});
    const shared=new Map();
    for(const name of ['gearNose','gearL','gearR'])parts[name].traverse(mesh=>{
      if(!mesh.isMesh||!mesh.material.name.startsWith('gear:'))return;
      const instances=shared.get(mesh.material.name)??new Set();instances.add(mesh.material);shared.set(mesh.material.name,instances);
    });
    check('gear:shared-materials',[...shared.values()].every(set=>set.size===1),Object.fromEntries([...shared].map(([name,set])=>[name,set.size])));
  }
  const spec=cockpit?.userData.cockpit;
  if(spec?.canopyStations) {
    const {stationSet}=await import('/src/aircraft/geometry/interpolation.js');
    const canopy=stationSet(spec.canopyStations,['w','top','sill']),penetrations=new Map(),facing=new Map();
    const first=spec.canopyStations[0].z,last=spec.canopyStations.at(-1).z;
    const cockpitMatrix=cockpit.matrixWorld.clone().premultiply(inverse);
    check('cockpit:aircraft-coordinates',cockpitMatrix.elements.every((value,i)=>Math.abs(value-new THREE.Matrix4().elements[i])<1e-7),'Cockpit is added directly without the removed legacy scale/translation');
    cockpit.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal,index=mesh.geometry.index;
      for(const range of mesh.userData.componentRanges??[]) {
        const sum=new THREE.Vector3();
        for(let j=range.firstTriangle*3;j<(range.firstTriangle+range.triangles)*3;j++) {
          const vertex=index?index.getX(j):j;
          const v=new THREE.Vector3().fromBufferAttribute(p,vertex).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
          if(spec.facing?.[range.name])sum.add(new THREE.Vector3().fromBufferAttribute(n,vertex));
          if(v.z<first||v.z>last)continue;
          const c=canopy(v.z);if(v.y<c.sill+.01||c.w<.01)continue;
          const t=Math.abs(v.x)/c.w,maxY=c.sill+(c.top-c.sill)*Math.pow(Math.sqrt(Math.max(0,1-t*t)),.9);
          const error=t>1?Math.max(Math.abs(v.x)-c.w,v.y-maxY):v.y-maxY;
          if(error>.003)penetrations.set(range.name,Math.max(penetrations.get(range.name)??0,error));
        }
        if(spec.facing?.[range.name]) {
          sum.normalize();const expected=new THREE.Vector3(...spec.facing[range.name]);
          facing.set(range.name,{normal:sum.toArray(),dot:sum.dot(expected.normalize())});
        }
      }
    });
    check('cockpit:closed-canopy-clearance',penetrations.size===0,Object.fromEntries(penetrations));
    for(const [name,result]of facing)check(`cockpit:facing:${name}`,result.dot>.70,result);
  }
  return {checks,gear};
}
