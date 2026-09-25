// Synchronous construction context. Nothing in a frame update reads or
// mutates this state; each quality level is finished before the next build.
let current={level:0,kind:''};

export function withBuildQuality(level,kind,build) {
  const previous=current;current={level,kind};
  try{return build();}finally{current=previous;}
}

export function curveSegments(count,min=8) {
  if(current.level===0)return count;
  const scale=current.level===1?.64:.34;
  return Math.max(min,Math.round(count*scale/4)*4);
}

export function curveSubdivisions(count) {
  return current.level===0?count:current.level===1?Math.max(1,Math.ceil(count*.6)):1;
}

export function chordSegments(count) {
  return current.level===0?count:current.level===1?Math.max(8,Math.round(count*.64)):6;
}

export function includePart(name) {
  if(current.level===0)return true;
  if(/nozzle-actuator$|crew-door-handle|antenna-crossbar|pilot-visor|pilot-oxygen-hose|engine-cooling-vent|air-data-vane|cockpit-.*-frame|cockpit-windshield-wiper|cowl-joint|cowl-fastener|sensor-aperture|sensor-turret-trunnion|gear-door|cargo-ramp|crew-door|service-door/.test(name))return false;
  if(current.level===1)return true;
  return !/aerial|antenna|beacon|navigation-light|hinge|joint|seam|slat|frame|irst-lens|pilot-|ejection-|actuator|sensor-aperture|sensor-optical|fan-stator|exhaust-stator|flameholder|stores-pylon|flap-track|dorsal-satcom|propeller-blade|propeller-tip-mark|gear-door|cargo-ramp|crew-door|service-door|cockpit-crew|cockpit-hud|cockpit-instrument-screen/.test(name);
}

export function coatingRole(role) {
  if(current.level<2)return role;
  if(role==='trim')return 'cavity';
  if(current.kind==='drone'&&role==='metal')return 'cavity';
  return role;
}
