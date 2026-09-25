// Shared offline export for AO authoring and stale-bake detection.
// This module is never imported by the running game.
export async function geometryFingerprint(data) {
  const bytes = new TextEncoder().encode(JSON.stringify({schema:data.schema,axes:data.axes,charts:data.charts,meshes:data.meshes}));
  const digest = await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("");
}

export async function exportF22ForAO() {
  const THREE = await import('three');
  const { buildF22, updateF22Visuals } = await import('/src/aircraft/f22v3.js');
  const { createAircraftPose } = await import('/src/aircraft/pose.js');
  const { S } = await import('/src/sim/flight.js');
  const { F22_BODY_CHARTS, F22_LIFTING_CHARTS } = await import('/src/aircraft/geometry/f22-uv.js');
  const built = buildF22({ quality: 'high' }); await built.ready;
  updateF22Visuals(built.group, { forceLevel: 'high' });
  const neutral = new Float64Array(Math.max(...Object.values(S)) + 1);
  createAircraftPose(built.group, built.parts).update(neutral, neutral, 1);
  built.group.updateMatrixWorld(true);
  const meshes = [], exclusions = [], p = new THREE.Vector3(), n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  function ancestry(object) { const names = []; for (let a = object; a; a = a.parent) names.unshift(a.name || a.type); return names.join('/'); }
  function chartAt(atlas, u, v) {
    const charts = atlas === 'body' ? F22_BODY_CHARTS : F22_LIFTING_CHARTS;
    return Object.keys(charts).find(name => { const [x,y,w,h] = charts[name].rect; return u >= x-1e-5 && u <= x+w+1e-5 && v >= y-1e-5 && v <= y+h+1e-5; }) ?? null;
  }
  built.group.traverseVisible(mesh => {
    if (!mesh.isMesh) return;
    const path = ancestry(mesh), mat = mesh.material;
    if (Array.isArray(mat)) throw new Error(`AO exporter needs explicit material-group splitting: ${path}`);
    const omitted = /\/(gearNose|gearL|gearR|nozzleL|nozzleR)(\/|$)/.test(path)
      || mesh.userData.aircraftEffect || mesh.userData.excludeAO || mesh.userData.role === 'paint-marking'
      || mat.transparent || mat.transmission > 0 || mat.fog === false;
    if (omitted) { exclusions.push(path); return; }
    const coating = mat.userData.f22Coating;
    const atlas = coating?.quality === 'high' && ['body','lifting'].includes(coating.atlas)
      ? coating.atlas : /F-22 authored (body|lifting) high RAM coating/.exec(mat.name)?.[1] ?? null;
    const geometry = mesh.geometry, pos = geometry.attributes.position, normal = geometry.attributes.normal, uv = geometry.attributes.uv;
    if (!pos || !normal) throw new Error(`Missing geometry attributes: ${path}`);
    const positions = [], normals = [], uvs = [], faces = [], receivers = [], charts = [], neutralAO = [];
    const components = mesh.userData.componentRanges ?? [];
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); positions.push(p.x,p.y,p.z);
      n.fromBufferAttribute(normal,i).applyNormalMatrix(normalMatrix); normals.push(n.x,n.y,n.z);
      uvs.push(uv?.getX(i) ?? 0,uv?.getY(i) ?? 0);
    }
    const count = geometry.index?.count ?? pos.count;
    const mirrored = mesh.matrixWorld.determinant() < 0;
    for (let i = 0; i < count; i += 3) {
      const ids = [0,1,2].map(k => geometry.index ? geometry.index.getX(i+k) : i+k);
      if (mirrored) [ids[1],ids[2]] = [ids[2],ids[1]];
      faces.push(ids);
      const mean = (values,stride,axis) => ids.reduce((sum,id) => sum+values[id*stride+axis],0)/3;
      const x = mean(positions,3,0), nx = mean(normals,3,0);
      const faceCharts = atlas ? ids.map(id => chartAt(atlas,uvs[id*2],uvs[id*2+1])) : [];
      const chart = faceCharts[0] && faceCharts.every(name => name === faceCharts[0]) ? faceCharts[0] : null;
      const [a,b,c] = ids.map(id => [uvs[id*2],uvs[id*2+1]]);
      const uvArea = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
      const component = components.find(range => i/3 >= range.firstTriangle && i/3 < range.firstTriangle+range.triangles)?.name ?? mesh.name;
      // These steep fairings reuse the boom's XZ chart. Their compressed
      // projection cannot carry a distinct contact bake; retain occlusion
      // geometry but neutralize the conflicting body-chart footprint.
      const neutral = atlas === 'body' && /^finRootFairing[LR]$/.test(component) && !!chart && Math.abs(uvArea) > 1e-14;
      // A projected rim can be a valid physical occluder with zero UV area.
      let receiver = !!atlas && !!chart && Math.abs(uvArea) > 1e-14 && !neutral;
      // Shared UVs get one physical representative. All omitted receiver
      // faces remain opaque occluders, so opposite fins/cowls still exist.
      if (atlas === 'body') {
        const ny = mean(normals,3,1);
        receiver &&= chart === 'upper' ? ny > .5 : chart === 'lower' ? ny < -.5 : x >= -1e-5 && nx > .5;
      }
      if (atlas === 'lifting') {
        const localY = ids.reduce((sum,id) => sum+normal.getY(id),0)/3;
        const positive = /(?:Upper|Positive)(?:Left)?$/.test(chart ?? '');
        receiver &&= positive ? localY > .5 : localY < -.5;
        // Wings, stabilators and fin faces have independent charts on both
        // physical sides. Each side must receive its own contact bake.
        // Presence alone cannot detect a mirrored door borrowing the other
        // wing's occupied chart. Check ownership in the exported neutral pose.
        if (receiver && /^(?:wing|tail)/.test(chart)
          && (chart.endsWith('Left') ? x > 1e-5 : x < -1e-5)) {
          throw new Error(`AO receiver on wrong physical side: ${path}; chart ${chart}; triangle ${i / 3}; mean X ${x}`);
        }
      }
      receivers.push(receiver); charts.push(chart); neutralAO.push(neutral);
    }
    if (![...positions,...normals,...uvs].every(Number.isFinite)) throw new Error(`Non-finite export: ${path}`);
    meshes.push({ name:mesh.name,path,atlas,positions,normals,uv:uvs,faces,receivers,charts,neutralAO,components });
  });
  // Fail before baking if a chart-layout change silently drops a whole skin.
  const receiverCharts = new Set(meshes.flatMap(mesh => mesh.atlas === 'lifting'
    ? mesh.charts.filter((chart, i) => mesh.receivers[i]) : []));
  for (const chart of Object.keys(F22_LIFTING_CHARTS)) {
    if (!receiverCharts.has(chart)) throw new Error(`No AO receivers for lifting chart ${chart}`);
  }
  const data = { schema:1, units:'metres', axes:{right:'+X',up:'+Y',forward:'-Z'},
    pose:'neutral FM surfaces; GEAR=0; closed bay controllers; gear/nozzles/effects/transmission excluded', metadata:built.group.userData.aircraft,
    charts:{body:F22_BODY_CHARTS,lifting:F22_LIFTING_CHARTS}, meshes, exclusions };
  data.geometrySHA256 = await geometryFingerprint(data);
  return data;
}
