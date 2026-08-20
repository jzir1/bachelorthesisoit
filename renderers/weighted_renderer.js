import { createProgram, createColorTex, createDepthTex, createTex, attachFbo } from './gl.js';

export class WeightedBlendedRenderer {
  constructor(gl) {
    this.gl = gl;
    this.peelInfo = '-';

    this._w = 0;
    this._h = 0;
    this._indexCount = 0;
    this._indexType  = gl.UNSIGNED_INT;
    this._instanceCount = 0;
    this._rt = null;

    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) throw new Error('EXT_color_buffer_float is required for Weighted Blended OIT');
  }

  async init() {
    const gl = this.gl;

    this._posBuf  = gl.createBuffer();
    this._nrmBuf  = gl.createBuffer();
    this._idxBuf  = gl.createBuffer();
    this._instBuf = gl.createBuffer();

    const [fullscreenVs, compositeFs, sphereVs, accumFs, revealFs] = await Promise.all([
      fetch('./shaders/webgl/fullscreen.vert').then(r => r.text()),
      fetch('./shaders/webgl/weighted_composite.frag').then(r => r.text()),
      fetch('./shaders/webgl/weighted_sphere.vert').then(r => r.text()),
      fetch('./shaders/webgl/weighted_accum.frag').then(r => r.text()),
      fetch('./shaders/webgl/weighted_reveal.frag').then(r => r.text()),
    ]);

    this._progAccum    = createProgram(gl, sphereVs, accumFs);
    this._uA_ViewProj  = gl.getUniformLocation(this._progAccum, 'uViewProj');
    this._uA_View      = gl.getUniformLocation(this._progAccum, 'uView');
    this._uA_Radius    = gl.getUniformLocation(this._progAccum, 'uRadius');
    this._uA_BaseColor = gl.getUniformLocation(this._progAccum, 'uBaseColor');
    this._uA_Roughness = gl.getUniformLocation(this._progAccum, 'uRoughness');
    this._uA_Near      = gl.getUniformLocation(this._progAccum, 'uNear');
    this._uA_Far       = gl.getUniformLocation(this._progAccum, 'uFar');
    this._uA_LightDir  = gl.getUniformLocation(this._progAccum, 'uLightDir');
    this._uA_CamPos    = gl.getUniformLocation(this._progAccum, 'uCamPos');

    this._progReveal   = createProgram(gl, sphereVs, revealFs);
    this._uR_ViewProj  = gl.getUniformLocation(this._progReveal, 'uViewProj');
    this._uR_Radius    = gl.getUniformLocation(this._progReveal, 'uRadius');
    this._uR_BaseColor = gl.getUniformLocation(this._progReveal, 'uBaseColor');

    this._progComposite = createProgram(gl, fullscreenVs, compositeFs);
    this._uC_Opaque     = gl.getUniformLocation(this._progComposite, 'uOpaque');
    this._uC_Accum      = gl.getUniformLocation(this._progComposite, 'uAccum');
    this._uC_Reveal     = gl.getUniformLocation(this._progComposite, 'uReveal');

    this._vao = gl.createVertexArray();
    gl.bindVertexArray(this._vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._posBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._nrmBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instBuf);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 12, 0);
    gl.vertexAttribDivisor(2, 1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._idxBuf);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this._vaoFS = gl.createVertexArray();
  }

  resize(w, h) {
    if (w === this._w && h === this._h && this._rt) return;
    this._w = w;
    this._h = h;
    if (this._rt) this._destroyRT(this._rt);
    this._rt = this._makeRT(w, h);
  }

  _destroyRT(r) {
    const gl = this.gl;
    gl.deleteFramebuffer(r.fboOpaque);
    gl.deleteFramebuffer(r.fboAccum);
    gl.deleteFramebuffer(r.fboReveal);
    gl.deleteTexture(r.texOpaque);
    gl.deleteTexture(r.texDepth);
    gl.deleteTexture(r.texAccum);
    gl.deleteTexture(r.texReveal);
  }

  _makeRT(w, h) {
    const gl = this.gl;
    const texDepth  = createDepthTex(gl, w, h);
    const texOpaque = createColorTex(gl, w, h);
    const texAccum  = createTex(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    const texReveal = createTex(gl, w, h, gl.R16F,    gl.RED,  gl.HALF_FLOAT);

    const fboOpaque = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboOpaque);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOpaque, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,  gl.TEXTURE_2D, texDepth, 0);

    const fboAccum = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboAccum);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texAccum, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,  gl.TEXTURE_2D, texDepth, 0);

    const fboReveal = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboReveal);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texReveal, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,  gl.TEXTURE_2D, texDepth, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { w, h, fboOpaque, fboAccum, fboReveal, texOpaque, texDepth, texAccum, texReveal };
  }

  setScene(scene) {
    const gl = this.gl;
    if (scene.mesh) {
      this._indexCount = scene.mesh.indices.length;
      this._indexType  = (scene.mesh.indices instanceof Uint32Array) ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      gl.bindBuffer(gl.ARRAY_BUFFER, this._posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, scene.mesh.positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._nrmBuf);
      gl.bufferData(gl.ARRAY_BUFFER, scene.mesh.normals, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._idxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, scene.mesh.indices, gl.STATIC_DRAW);
    }
    this._instanceCount = scene.instances.length;
    const arr = new Float32Array(this._instanceCount * 3);
    for (let i = 0; i < this._instanceCount; i++) {
      arr[i*3 + 0] = scene.instances[i].pos[0];
      arr[i*3 + 1] = scene.instances[i].pos[1];
      arr[i*3 + 2] = scene.instances[i].pos[2];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  dispose() {
    const gl = this.gl;
    for (const p of [this._progAccum, this._progReveal, this._progComposite]) if (p) gl.deleteProgram(p);
    for (const b of [this._posBuf, this._nrmBuf, this._idxBuf, this._instBuf]) if (b) gl.deleteBuffer(b);
    for (const v of [this._vao, this._vaoFS]) if (v) gl.deleteVertexArray(v);
    if (this._rt) this._destroyRT(this._rt);
  }

  render(params) {
    const gl = this.gl;
    const rt = this._rt;
    if (!rt) return;

    const bytesPerIndex = params.meshIndicesType === gl.UNSIGNED_INT ? 4 : 2;

    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fboOpaque);
    gl.viewport(0, 0, rt.w, rt.h);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fboAccum);
    gl.clearBufferfv(gl.COLOR, 0, new Float32Array([0,0,0,0]));
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    gl.useProgram(this._progAccum);
    gl.uniformMatrix4fv(this._uA_ViewProj, false, params.viewProj);
    gl.uniformMatrix4fv(this._uA_View, false, params.view);
    gl.uniform1f(this._uA_Radius, params.radius);
    
    gl.uniform1f(this._uA_Near, params.weightNear ?? 0.5);
    gl.uniform1f(this._uA_Far,  params.weightFar  ?? 35.0);
    gl.uniform3f(this._uA_LightDir, -0.6, 1.0, -0.4);
    gl.uniform3fv(this._uA_CamPos, params.camPos);

    gl.bindVertexArray(this._vao);
    for (const chunk of params.meshChunks) {
      gl.uniform4fv(this._uA_BaseColor, chunk.baseColor);
      gl.uniform1f(this._uA_Roughness, chunk.roughness);
      gl.drawElementsInstanced(gl.TRIANGLES, chunk.count, params.meshIndicesType, chunk.start * bytesPerIndex, this._instanceCount);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fboReveal);
    gl.clearBufferfv(gl.COLOR, 0, new Float32Array([1,0,0,0]));
    gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR);

    gl.useProgram(this._progReveal);
    gl.uniformMatrix4fv(this._uR_ViewProj, false, params.viewProj);
    gl.uniform1f(this._uR_Radius, params.radius);
    for (const chunk of params.meshChunks) {
      gl.uniform4fv(this._uR_BaseColor, chunk.baseColor);
      gl.drawElementsInstanced(gl.TRIANGLES, chunk.count, params.meshIndicesType, chunk.start * bytesPerIndex, this._instanceCount);
    }
    gl.bindVertexArray(null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, params.canvasW, params.canvasH);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this._progComposite);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, rt.texOpaque);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, rt.texAccum);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, rt.texReveal);
    gl.uniform1i(this._uC_Opaque, 0);
    gl.uniform1i(this._uC_Accum,  1);
    gl.uniform1i(this._uC_Reveal, 2);

    gl.bindVertexArray(this._vaoFS);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}