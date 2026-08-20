#version 300 es
precision highp float;

in vec2 vUV;
out vec4 outColor;

uniform sampler2D uCur;
uniform sampler2D uHist;

uniform float uBlend;
uniform float uHistValid;

void main(){
  vec4 cur  = texture(uCur, vUV);
  vec4 hist = texture(uHist, vUV);

  float actualBlend = (uHistValid > 0.5) ? uBlend : 0.0;

  outColor = mix(cur, hist, actualBlend);
}
