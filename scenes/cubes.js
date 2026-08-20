const CAM_DIST = 10.0;
const FOV_RAD  = 60 * Math.PI / 180;
const HALF_H   = CAM_DIST * Math.tan(FOV_RAD / 2); 
const LAYERS   = 16;
const LAYER_DZ = 2.5;  

export function makeCoverageQuadMesh(aspect) {
  const a = aspect;
  return {
    positions: new Float32Array([
      -a, -1, 0,
       a, -1, 0,
       a,  1, 0,
      -a,  1, 0,
    ]),
    normals: new Float32Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]),
    indices: new Uint32Array([0, 1, 2,  0, 2, 3]),
  };
}

export function makeCoverageScene(coveragePercent, canvasW, canvasH) {

  const aspect = canvasW / canvasH;
  const radius = HALF_H * Math.sqrt(Math.max(0.01, coveragePercent) / 100);

  const instances = [];
  for (let iz = 0; iz < LAYERS; iz++) {
    instances.push({ pos: [0, 0, -iz * LAYER_DZ] });
  }

  const mesh = makeCoverageQuadMesh(aspect);
  mesh.chunks = [{
    start:     0,
    count:     mesh.indices.length,
    baseColor: [0.9, 0.2, 0.3, 0.5],
    roughness: 0.3,
  }];

  return {
    id:      `cubes_${coveragePercent}`,
    radius,
    instances,
    mesh,
    nominalCoverage: coveragePercent,
    depthFar: CAM_DIST + (LAYERS - 1) * LAYER_DZ,  
    suggestedCamRadius: CAM_DIST,
    suggestedAzimuth:   Math.PI / 2,
    suggestedPolar:     Math.PI / 2,
    noScale: true,
    _canvasW: canvasW,
    _canvasH: canvasH,
  };
}