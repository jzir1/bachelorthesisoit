#version 300 es
precision highp float;

in vec3 vNor;
in vec3 vPos;
flat in vec3 vLayerSeed;

uniform vec3 uLightDir;
uniform vec3 uCamPos;
uniform float uFrame;
uniform float uAlphaMul;
uniform vec4 uBaseColor;
uniform float uRoughness;

out vec4 outColor;

uint getPixelLayerHash(vec2 co, vec3 seed) {
    uint n = uint(co.x) * 1973u + uint(co.y) * 9277u + floatBitsToUint(seed.x) * 26699u + floatBitsToUint(seed.y) * 3266489917u;
    n = (n ^ (n >> 13u)) * 668265263u;
    return n ^ (n >> 15u);
}

void main() {
    float a = clamp(uBaseColor.a * uAlphaMul, 0.0, 1.0);

    vec3 N = normalize(vNor);
    vec3 V = normalize(uCamPos - vPos);
    vec3 seed = vLayerSeed;
    
    if (dot(N, V) < 0.0) {
        N = -N;
        seed += vec3(12.34, 56.78, 90.12);
    }
    seed.x += gl_FragCoord.z * 43758.5453; 

    seed.y += uFrame * 137.031;

    uint h = getPixelLayerHash(gl_FragCoord.xy, seed);
    uint frameIdx = uint(uFrame) % 256u;
    uint multiplier = (h & 255u) | 1u; 
    uint offset = (h >> 8u) & 255u;
    uint permuted = (frameIdx * multiplier + offset) % 256u;
    float thr = (float(permuted) + 0.5) / 256.0;

    if (thr > a) discard;

    vec3 L = normalize(uLightDir);
    vec3 H = normalize(L + V);

    float diff = max(dot(N, L), 0.0);
    float shininess = mix(128.0, 1.0, uRoughness);
    float spec = pow(max(dot(N, H), 0.0), shininess) * (1.0 - uRoughness);

    outColor = vec4(uBaseColor.rgb * (diff + 0.2) + vec3(spec), 1.0);
}