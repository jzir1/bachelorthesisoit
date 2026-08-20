export async function loadGLB(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch GLB: ${response.statusText}`);
  const arrayBuffer = await response.arrayBuffer();

  const dataView = new DataView(arrayBuffer);
  if (dataView.getUint32(0, true) !== 0x46546C67) throw new Error('Invalid magic string in GLB');

  const jsonChunkLength = dataView.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, 20, jsonChunkLength)));

  const binByteOffset  = 20 + jsonChunkLength;
  const binChunkLength = dataView.getUint32(binByteOffset, true);
  const binBuffer      = arrayBuffer.slice(binByteOffset + 8, binByteOffset + 8 + binChunkLength);

  function getAccessorData(accessorIndex) {
    const accessor   = gltf.accessors[accessorIndex];
    const bufferView = gltf.bufferViews[accessor.bufferView];
    const offset     = (accessor.byteOffset || 0) + (bufferView.byteOffset || 0);

    let TypedArray = Float32Array;
    if (accessor.componentType === 5123) TypedArray = Uint16Array;
    else if (accessor.componentType === 5125) TypedArray = Uint32Array;

    const numComponents = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type] ?? 1;
    return {
      data: new TypedArray(binBuffer, offset, accessor.count * numComponents),
      count: accessor.count,
    };
  }

  const parsedMaterials = (gltf.materials || []).map(mat => {
    const pbr = mat.pbrMetallicRoughness || {};
    return {
      baseColor: pbr.baseColorFactor    ?? [1.0, 1.0, 1.0, 1.0],
      roughness: pbr.roughnessFactor    ?? 1.0,
    };
  });

  const allPositions = [];
  const allNormals   = [];
  const allIndices   = [];
  const chunks       = [];
  let vertexOffset   = 0;
  let indexOffset    = 0;

  for (const mesh of gltf.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      const mat = (primitive.material !== undefined && parsedMaterials[primitive.material])
        ? parsedMaterials[primitive.material]
        : { baseColor: [0.7, 0.7, 0.7, 1.0], roughness: 0.5 };

      let positions = null;
      if (primitive.attributes.POSITION !== undefined) {
        positions = getAccessorData(primitive.attributes.POSITION).data;
        for (let i = 0; i < positions.length; i++) allPositions.push(positions[i]);
      }
      if (primitive.attributes.NORMAL !== undefined) {
        const normals = getAccessorData(primitive.attributes.NORMAL).data;
        for (let i = 0; i < normals.length; i++) allNormals.push(normals[i]);
      }

      const numVertices = positions ? positions.length / 3 : 0;
      let numIndices = 0;

      if (primitive.indices !== undefined) {
        const indices = getAccessorData(primitive.indices).data;
        numIndices = indices.length;
        for (let i = 0; i < indices.length; i++) allIndices.push(indices[i] + vertexOffset);
      } else if (numVertices > 0) {
        numIndices = numVertices;
        for (let i = 0; i < numVertices; i++) allIndices.push(i + vertexOffset);
      }

      chunks.push({ start: indexOffset, count: numIndices, baseColor: mat.baseColor, roughness: mat.roughness });
      vertexOffset += numVertices;
      indexOffset  += numIndices;
    }
  }

  return {
    positions: new Float32Array(allPositions),
    normals:   new Float32Array(allNormals),
    indices:   new Uint32Array(allIndices),
    chunks,
  };
}
