#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uLayer;
out vec4 fragColor;
void main(){
  vec4 c = texture(uLayer, vUV);
  fragColor = vec4(c.rgb * c.a, c.a); 
}