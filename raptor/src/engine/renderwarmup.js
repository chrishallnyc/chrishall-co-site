// Borrow existing render objects for one draw behind the loading veil. This
// reaches hidden exhaust programs and prepared near-terrain buffers without
// firing weapons, advancing effects, or allocating another geometry/pool.
export function withWarmupResources({ exhaustRoots = [], terrain = null, visible = [] }, draw) {
  const restore = [];
  const set = (object, property, value) => {
    if (object[property] === value) return;
    restore.push([object, property, object[property]]);
    object[property] = value;
  };
  try {
    for (const object of visible) if (object) set(object, 'visible', true);
    for (const root of exhaustRoots) {
      if (!root) continue;
      // Rig pivots normally remain visible across aircraft LODs. Including
      // their ancestors also makes a parked/hidden aircraft safe to prepare.
      for (let parent = root; parent; parent = parent.parent) set(parent, 'visible', true);
      root.traverse(object => {
        set(object, 'visible', true);
        if (object.isMesh) set(object, 'frustumCulled', false);
      });
      // Exhaust starts with zero emission/opacity. Leave those uniforms and
      // all effect clocks untouched; traversal alone prepares its pipeline.
    }
    const fine = terrain?.fineGrid, pool = terrain?.pool;
    if (fine && pool?.length && !pool.some(mesh => mesh.visible && mesh.geometry === fine)) {
      const mesh = pool.find(mesh => mesh.visible) || pool[0];
      set(mesh, 'geometry', fine);
      for (let parent = mesh; parent; parent = parent.parent) set(parent, 'visible', true);
      set(mesh, 'frustumCulled', false);
    }
    // The renderer's draw is synchronous. GPU completion is awaited by the
    // boot sequence after the clean second frame, with all objects restored.
    return draw();
  } finally {
    for (let i = restore.length - 1; i >= 0; i--) {
      const [object, property, value] = restore[i];
      object[property] = value;
    }
  }
}
