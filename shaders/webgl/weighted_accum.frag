#version 300 es
precision highp float;

in vec3 vNor;
in vec3 vPos;
in float vViewZ;

uniform vec3 uLightDir;
uniform vec3 uCamPos;
uniform vec4 uBaseColor;
uniform float uRoughness;
uniform float uNear;
uniform float uFar;

out vec4 outColor;

void main() {
    vec3 N = normalize(vNor);
    vec3 V = normalize(uCamPos - vPos);

    if (dot(N, V) < 0.0) N = -N;

    vec3 L = normalize(uLightDir);
    vec3 H = normalize(L + V);

    float diff = max(dot(N, L), 0.0);
    float shininess = mix(128.0, 1.0, uRoughness);
    float spec = pow(max(dot(N, H), 0.0), shininess) * (1.0 - uRoughness);

    vec3 color = clamp(uBaseColor.rgb * (diff + 0.2) + vec3(spec), 0.0, 1.0);
    float a = clamp(uBaseColor.a, 0.0, 1.0);

    float z = abs(vViewZ);
    float z_norm = clamp((z - uNear) / (uFar - uNear), 0.001, 1.0);
    float weight = a * max(0.01, min(3000.0, 0.03 / (1e-5 + pow(z_norm, 4.0))));

    outColor = vec4(color * a * weight, a * weight);
}
