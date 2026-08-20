export function makeSphereMesh(latBands = 24, lonBands = 24) {
  const positions = [];
  const normals   = [];
  const indices   = [];

  for (let lat = 0; lat <= latBands; lat++) {
    const theta = (lat / latBands) * Math.PI;
    const st = Math.sin(theta), ct = Math.cos(theta);
    for (let lon = 0; lon <= lonBands; lon++) {
      const phi = (lon / lonBands) * Math.PI * 2;
      const sp = Math.sin(phi), cp = Math.cos(phi);
      const x = st * cp, y = ct, z = st * sp;
      positions.push(x, y, z);
      normals.push(x, y, z);
    }
  }

  const stride = lonBands + 1;
  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const a = lat*stride + lon, b = a + stride, c = b + 1, d = a + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals:   new Float32Array(normals),
    indices:   new Uint32Array(indices),
  };
}

export function makeCubeMesh() {
  const positions = new Float32Array([
    // Front
    -1,-1, 1,   1,-1, 1,   1, 1, 1,  -1, 1, 1,
    // Back
    -1,-1,-1,  -1, 1,-1,   1, 1,-1,   1,-1,-1,
    // Top
    -1, 1,-1,  -1, 1, 1,   1, 1, 1,   1, 1,-1,
    // Bottom
    -1,-1,-1,   1,-1,-1,   1,-1, 1,  -1,-1, 1,
    // Right
     1,-1,-1,   1, 1,-1,   1, 1, 1,   1,-1, 1,
    // Left
    -1,-1,-1,  -1,-1, 1,  -1, 1, 1,  -1, 1,-1,
  ]);

  const normals = new Float32Array([
    // Front
     0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
    // Back
     0, 0,-1,  0, 0,-1,  0, 0,-1,  0, 0,-1,
    // Top
     0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0,
    // Bottom
     0,-1, 0,  0,-1, 0,  0,-1, 0,  0,-1, 0,
    // Right
     1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0,
    // Left
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ]);

  const indices = new Uint32Array([
     0, 1, 2,   0, 2, 3,   // Front
     4, 5, 6,   4, 6, 7,   // Back
     8, 9,10,   8,10,11,   // Top
    12,13,14,  12,14,15,   // Bottom
    16,17,18,  16,18,19,   // Right
    20,21,22,  20,22,23,   // Left
  ]);

  return { positions, normals, indices };
}
