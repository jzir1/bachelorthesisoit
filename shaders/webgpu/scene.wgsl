struct Node {
    color: u32,
    depth: f32,
    next: u32,
    pad: u32,
};

struct OitUniforms {
    screenWidth:      u32,
    maxNodes:         u32,
    maxNodesPerPixel: u32, 
    pad:              u32,
};

struct SceneUniforms {
    viewProj: mat4x4f,
    model: mat4x4f,
    color: vec4f,
    camera_pos: vec3f,
    _pad0: f32,
    light_dir: vec3f,
    roughness: f32, 
};

@group(0) @binding(0) var<uniform> u: SceneUniforms;

@group(1) @binding(0) var<uniform>            oitParams:    OitUniforms;
@group(1) @binding(1) var<storage, read_write> head_indices: array<atomic<u32>>;
@group(1) @binding(2) var<storage, read_write> nodes:        array<Node>;
@group(1) @binding(3) var<storage, read_write> counter:      atomic<u32>;
@group(1) @binding(4) var<storage, read_write> pixel_counts: array<atomic<u32>>;

struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) normal: vec3f,
    @location(1) vPos: vec3f,
};

@vertex 
fn vs_main(@location(0) pos: vec3f, @location(1) normal: vec3f) -> VertexOut {
    var out: VertexOut;
    let world_pos = u.model * vec4f(pos, 1.0);
    out.position = u.viewProj * world_pos;
    out.vPos = world_pos.xyz;
    out.normal = (u.model * vec4f(normal, 0.0)).xyz;
    return out;
}

@fragment
fn fs_main(@builtin(position) frag_coord: vec4f, @location(0) normal: vec3f, @location(1) vPos: vec3f) {
    var N = normalize(normal);
    let V = normalize(u.camera_pos - vPos);
    if (dot(N, V) < 0.0) { N = -N; }

    let L = normalize(u.light_dir);
    let H = normalize(L + V);

    let diff = max(dot(N, L), 0.0);
    let shininess = mix(128.0, 1.0, u.roughness);
    let spec = pow(max(dot(N, H), 0.0), shininess) * (1.0 - u.roughness);

    let final_rgb = u.color.rgb * (diff + 0.2) + vec3(spec);
    let final_color = saturate(vec4f(final_rgb, u.color.a));

    let pixel_index = u32(frag_coord.y) * oitParams.screenWidth + u32(frag_coord.x);
    let pix_slot = atomicAdd(&pixel_counts[pixel_index], 1u);
    if (pix_slot >= oitParams.maxNodesPerPixel) {
        return;
    }

    let node_idx = atomicAdd(&counter, 1u);
    if (node_idx < oitParams.maxNodes) {
        let old_head = atomicExchange(&head_indices[pixel_index], node_idx);

        let c = final_color;
        let packed_color = (u32(c.a * 255.0) << 24u) | (u32(c.b * 255.0) << 16u) | (u32(c.g * 255.0) << 8u) | u32(c.r * 255.0);

        nodes[node_idx].color = packed_color;
        nodes[node_idx].depth = frag_coord.z;
        nodes[node_idx].next  = old_head;
    }
}