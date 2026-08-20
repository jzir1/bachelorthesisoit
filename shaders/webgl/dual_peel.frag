#version 300 es
precision highp float;

in vec3 vNor;
in vec3 vPos;

uniform vec3 uLightDir;
uniform vec3 uCamPos;
uniform vec4 uBaseColor;
uniform float uRoughness;

uniform bool uHasFront;
uniform sampler2D uFrontDepth;
uniform bool uHasBack;
uniform sampler2D uBackDepth;
uniform float uEps;

out vec4 fragColor;

void main() {
    float d = gl_FragCoord.z;
    ivec2 p = ivec2(gl_FragCoord.xy);
    
    if (uHasFront) {
        float dF = texelFetch(uFrontDepth, p, 0).r;
        if (d <= dF + uEps) discard;
    }
    if (uHasBack) {
        float dB = texelFetch(uBackDepth, p, 0).r;
        if (d >= dB - uEps) discard;
    }
    
    vec3 N = normalize(vNor);
    vec3 V = normalize(uCamPos - vPos);
    if (dot(N, V) < 0.0) N = -N;
    
    vec3 L = normalize(uLightDir);
    vec3 H = normalize(L + V);

    float diff = max(dot(N, L), 0.0);
    float shininess = mix(128.0, 1.0, uRoughness);
    float spec = pow(max(dot(N, H), 0.0), shininess) * (1.0 - uRoughness);
    
    vec3 color = uBaseColor.rgb * (diff + 0.2) + vec3(spec);
    fragColor = vec4(color, uBaseColor.a);
}