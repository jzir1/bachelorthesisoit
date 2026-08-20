#version 300 es
precision highp float;

in vec2 vUV;
out vec4 outColor;

uniform sampler2D uOpaque;
uniform sampler2D uAccum;
uniform sampler2D uReveal;

void main(){
    vec4 accum  = texture(uAccum, vUV);
    float reveal = texture(uReveal, vUV).r;

    float a = 1.0 - reveal;
    
    if (a < 0.001) discard;

    vec3 trans = accum.rgb / max(accum.a, 0.0001);
    
    outColor = vec4(trans * a, a);
}