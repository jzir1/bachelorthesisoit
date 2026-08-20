#version 300 es
precision highp float;

uniform vec4 uBaseColor;
out vec4 outColor;

void main(){
  float a = clamp(uBaseColor.a, 0.0, 1.0);
  outColor = vec4(a, 0.0, 0.0, 0.0);
}