export function vec3(x, y, z) {
  return new Float32Array([x, y, z]);
}

export function vec3Add(a, b) {
  return new Float32Array([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
}

export function mat4() {
  return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
}

export function mat4Multiply(out, a, b) {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[i*4 + j] = a[0*4 + j] * b[i*4 + 0]
                   + a[1*4 + j] * b[i*4 + 1]
                   + a[2*4 + j] * b[i*4 + 2]
                   + a[3*4 + j] * b[i*4 + 3];
    }
  }
  return out;
}

export function mat4Perspective(out, fovRadians, aspect, near, far) {
  const f = 1.0 / Math.tan(fovRadians / 2);
  out.fill(0);
  out[0]  = f / aspect;
  out[5]  = f;
  out[10] = far / (near - far);
  out[11] = -1;
  out[14] = (near * far) / (near - far);
  return out;
}

export function mat4Translate(out, m, v) {
  out.set(m);
  out[12] = m[0]*v[0] + m[4]*v[1] + m[8]*v[2]  + m[12];
  out[13] = m[1]*v[0] + m[5]*v[1] + m[9]*v[2]  + m[13];
  out[14] = m[2]*v[0] + m[6]*v[1] + m[10]*v[2] + m[14];
  out[15] = m[3]*v[0] + m[7]*v[1] + m[11]*v[2] + m[15];
  return out;
}

export function mat4Scale(out, m, v) {
  out.set(m);
  out[0] *= v[0]; out[1] *= v[0]; out[2]  *= v[0]; out[3]  *= v[0];
  out[4] *= v[1]; out[5] *= v[1]; out[6]  *= v[1]; out[7]  *= v[1];
  out[8] *= v[2]; out[9] *= v[2]; out[10] *= v[2]; out[11] *= v[2];
  return out;
}
