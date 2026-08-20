#version 300 es
precision highp float;

layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 iOffset;

uniform mat4 uView;
uniform mat4 uProj;
uniform float uRadius;

out vec3 vNor;
out vec3 vPos;
flat out vec3 vLayerSeed;

void main() {
    vec3 worldPos = aPos * uRadius + iOffset;
    vPos = worldPos;
    vNor = aNrm;
    vLayerSeed = iOffset; 
    gl_Position = uProj * uView * vec4(worldPos, 1.0);
}