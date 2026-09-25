// Shared aircraft-space wear on the body/wing gear aperture. Applying the
// same description through both charts keeps marks aligned across the join.
export function mainGearServicePaint(paint, chart, project, side) {
  const { repair, serviceTrace, flowMark } = paint;
  const left=side<0;
  repair(chart,[[1.15,2.89],[1.49,2.88],[1.83,2.99],[1.95,3.12],
    [1.81,3.24],[1.49,3.18],[1.16,3.13]].map(project),
    {shade:left?'#707b79':'#959b91',opacity:left?.27:.32,
      roughness:left?.57:.76,edge:0,feather:.036});
  serviceTrace(chart,[[1.08,2.95],[1.56,3.00],[2.17,3.00],[2.62,2.97]].map(project),
    {width:.17,strength:left?.13:.18,roughness:.78,warm:true,seed:left?107:131});
  for(const [x,z,length,width,strength] of left?
    [[1.13,3.02,.63,.16,.17],[2.58,2.98,.95,.27,.23]]:
    [[1.28,3.00,.91,.22,.22],[2.65,2.94,.60,.18,.14]])
    flowMark(chart,project([x,z]),project([x+.055,z+length]),
      {width,strength,roughness:.80,seed:x*11+side,shade:[65,62,52]});
}
