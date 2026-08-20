#version 300 es
precision highp float;

in vec3 vNor;
in vec3 vPos;

uniform vec3 uLightDir;
uniform vec3 uCamPos;
uniform vec4 uBaseColor;
uniform float uRoughness;

uniform bool uHasPrev;
uniform sampler2D uPrevDepth;   // R32F: linear view-space depth of previous layer
uniform float uEps;             // tolerance in world/view units (linear)
uniform mat4 uView;             // view matrix, to compute linear view-space depth
uniform float uChunkBias;       // per-part deterministic depth offset (breaks coplanar ties)

layout(location = 0) out vec4 fragColor;     // shaded color
layout(location = 1) out float fragLinDepth; // linear view-space depth

void main() {
    // Linear depth along the view axis. Positive, grows with distance from camera.
    // This replaces the non-linear gl_FragCoord.z used for layer separation,
    // so the epsilon has the same physical meaning at every distance.
    float linZ = -(uView * vec4(vPos, 1.0)).z;

    // CAD assemblies contain parts that physically abut along shared planes
    // (e.g. a cover resting on a housing). Such coplanar surfaces have equal
    // depth, which no depth-based method can order deterministically, causing
    // frame-to-frame flicker. A tiny per-part offset, constant across frames,
    // separates them in a stable, reproducible way without any CPU sorting.
    linZ += uChunkBias;

    if (uHasPrev) {
        float dPrev = texelFetch(uPrevDepth, ivec2(gl_FragCoord.xy), 0).r;
        if (linZ <= dPrev + uEps) discard;
    }

    vec3 N = normalize(vNor);
    vec3 V = normalize(uCamPos - vPos);
    if (dot(N, V) < 0.0) N = -N;

    vec3 L = normalize(uLightDir);
    vec3 H = normalize(L + V);

    float diff = max(dot(N, L), 0.0);
    float shininess = mix(128.0, 1.0, uRoughness);
    float spec = pow(max(dot(N, H), 0.0), shininess) * (1.0 - uRoughness);

    vec3 color = clamp(uBaseColor.rgb * (diff + 0.2) + vec3(spec), 0.0, 1.0);
    fragColor    = vec4(color, uBaseColor.a);
    fragLinDepth = linZ;
}
