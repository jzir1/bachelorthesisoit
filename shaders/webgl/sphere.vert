#version 300 es
precision highp float;

layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec3 iOffset;

uniform mat4 uViewProj;
uniform float uRadius;

out vec3 vNor;
out vec3 vPos;

void main() {
    vec3 worldPos = aPos * uRadius + iOffset;
    vPos = worldPos;
    vNor = aNor;
    gl_Position = uViewProj * vec4(worldPos, 1.0);
}