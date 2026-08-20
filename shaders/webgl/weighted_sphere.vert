#version 300 es
precision highp float;

layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 iOffset;

uniform mat4 uViewProj;
uniform mat4 uView;
uniform float uRadius;

out vec3 vNor;
out vec3 vPos;
out float vViewZ;

void main() {
    vec3 worldPos = aPos * uRadius + iOffset;
    vPos = worldPos;
    vNor = aNrm;
    vec4 viewPos = uView * vec4(worldPos, 1.0);
    vViewZ = viewPos.z; 
    gl_Position = uViewProj * vec4(worldPos, 1.0);
}