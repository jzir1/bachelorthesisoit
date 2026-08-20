#version 300 es
precision highp float;

in vec2 vUV;
out vec4 outColor;

uniform sampler2D uTex;

void main(){
  vec4 color = texture(uTex, vUV);
  
  outColor = color;
}