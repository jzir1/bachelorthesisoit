struct Node {
    color: u32,
    depth: f32,
    next:  u32,
    pad:   u32,
};

struct OitUniforms {
    screenWidth: u32,
    maxNodes:    u32,
    p1: u32,
    p2: u32,
};

@group(0) @binding(0) var opaqueTex:    texture_2d<f32>;
@group(0) @binding(1) var<uniform>      oitParams:    OitUniforms;
@group(0) @binding(2) var<storage,read> head_indices: array<u32>;
@group(0) @binding(3) var<storage,read> nodes:        array<Node>;

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
    var pos = array<vec2f, 4>(
        vec2f(-1.0, -1.0), vec2f( 1.0, -1.0),
        vec2f(-1.0,  1.0), vec2f( 1.0,  1.0)
    );
    return vec4f(pos[vi], 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) frag_coord: vec4f) -> @location(0) vec4f {
    let coords    = vec2u(frag_coord.xy);
    let pixel_idx = coords.y * oitParams.screenWidth + coords.x;
    let head      = head_indices[pixel_idx];

    if (head == 0xFFFFFFFFu) {
        return textureLoad(opaqueTex, coords, 0);
    }

    var depths: array<f32, LL_MAX_FRAGS>;
    var colors: array<u32, LL_MAX_FRAGS>;
    var count = 0u;
    
    const COINCIDENT_EPS: f32 = 1e-6;

    var curr = head;
    while (curr != 0xFFFFFFFFu) {
        let n = nodes[curr];
        curr = n.next;

        var is_duplicate = false;
        for (var k = 0u; k < count; k++) {
            if (abs(depths[k] - n.depth) < COINCIDENT_EPS) {
                is_duplicate = true;
                break;
            }
        }
        
        if (is_duplicate) {
            continue;
        }

        if (count < LL_MAX_FRAGS_U) {
            var j = count;
            while (j > 0u && depths[j - 1u] < n.depth) {
                depths[j] = depths[j - 1u];
                colors[j] = colors[j - 1u];
                j--;
            }
            depths[j] = n.depth;
            colors[j] = n.color;
            count++;
        } else {
            if (n.depth < depths[0]) {
                var j = 0u;
                while (j < LL_MAX_FRAGS_MINUS1_U && depths[j + 1u] > n.depth) {
                    depths[j] = depths[j + 1u];
                    colors[j] = colors[j + 1u];
                    j++;
                }
                depths[j] = n.depth;
                colors[j] = n.color;
            }
        }
    }

    var accum = textureLoad(opaqueTex, coords, 0);

    for (var i = 0u; i < count; i++) {
        let c       = colors[i];
        let src_rgb = vec3f(
            f32( c        & 0xFFu) / 255.0,
            f32((c >>  8u)& 0xFFu) / 255.0,
            f32((c >> 16u)& 0xFFu) / 255.0,
        );
        let src_a = f32((c >> 24u) & 0xFFu) / 255.0;

        let src_premult_rgb = src_rgb * src_a;

        accum = vec4f(
            src_premult_rgb + accum.rgb * (1.0 - src_a),
            src_a           + accum.a   * (1.0 - src_a),
        );
    }

    return accum;
}