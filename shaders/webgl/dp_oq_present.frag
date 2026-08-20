#version 300 es
precision highp float;

in vec2 vUV;
uniform sampler2D uAccum;

out vec4 fragColor;

void main(){

  vec4 a = texture(uAccum, vUV);
  fragColor = vec4(a.rgb, a.a);
  
}
