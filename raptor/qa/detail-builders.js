// Review-only builders. The production aircraft and its 15 rig identities are
// retained for validation; optional isolation changes visibility for captures.
import { buildF22 } from '../src/aircraft/f22v3.js';
import { buildCockpit } from '../src/aircraft/cockpit.js';

export function buildDetailInspection({component='cockpit',pilot=true,isolate=false}={}) {
  const built=buildF22(),old=built.group.getObjectByName('cockpitInterior');
  if(!pilot&&old) {
    built.group.remove(old);
    const geometry=new Set(),materials=new Set(),textures=new Set();
    old.traverse(object=>{
      if(!object.isMesh)return;
      geometry.add(object.geometry);
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
      }
    });
    for(const value of [...geometry,...materials,...textures])value.dispose();
    built.group.add(buildCockpit({pilot:false}));
  }
  if(isolate)for(const child of built.group.children) {
    child.visible=component==='cockpit'?child.name==='cockpitInterior':
      [built.parts.gearNose,built.parts.gearL,built.parts.gearR].includes(child);
  }
  return built;
}
