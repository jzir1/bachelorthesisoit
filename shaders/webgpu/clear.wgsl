struct OitUniforms {
    screenWidth:      u32,
    maxNodes:         u32,
    maxNodesPerPixel: u32,
    pad:              u32,
}

@group(0) @binding(0) var<storage, read_write> head_indices : array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> counter      : atomic<u32>;
@group(0) @binding(2) var<storage, read_write> pixel_counts : array<atomic<u32>>;
@group(0) @binding(3) var<uniform>             uniforms     : OitUniforms;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.y * uniforms.screenWidth + id.x;
    if (index == 0u) {
        atomicStore(&counter, 0u);
    }
    if (index < arrayLength(&head_indices)) {
        atomicStore(&head_indices[index], 0xFFFFFFFFu);
        atomicStore(&pixel_counts[index],  0u);
    }
}