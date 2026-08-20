#version 300 es
precision highp float;

in vec2 vUV;
uniform sampler2D uFront;
uniform sampler2D uBack;

out vec4 fragColor;

void main(){

  vec4 f = texture(uFront, vUV);
  vec4 b = texture(uBack,  vUV);

  vec3 rgb = f.rgb + b.rgb * (1.0 - f.a);
  float a   = f.a  + b.a   * (1.0 - f.a);

  fragColor = vec4(rgb, a);
}
