import { createProgram, createColorTex, createTex, attachFbo } from './gl.js';

export class StochasticOITRenderer {
  constructor(gl) {
    this.gl = gl;
    this.peelInfo = '-';

    this._indexCount = 0;
    this._indexType  = gl.UNSIGNED_INT;
    this._instanceCount = 0;
    this._alphaMul = 1.0;
    this._w = 0;
    this._h = 0;

    this._msaaSamples = 8;
    this._histToggle = 0;
    this._histValid = false;
    this._frameIndex = 0;
    this._framesAccumulated = 0;
    this._lightDir = new Float32Array([-0.6, 1.0, -0.4]);
  }

  async init() {
    const gl = this.gl;

    this._posBuf  = gl.createBuffer();
    this._nrmBuf  = gl.createBuffer();
    this._idxBuf  = gl.createBuffer();
    this._instBuf = gl.createBuffer();

    const [sphereVs, sphereFs, fullscreenVs, accumFs, presentFs] = await Promise.all([
      fetch('./shaders/webgl/stochastic_sphere.vert').then(r => r.text()),
      fetch('./shaders/webgl/stochastic_sphere.frag').then(r => r.text()),
      fetch('./shaders/webgl/fullscreen.vert').then(r => r.text()),
      fetch('./shaders/webgl/stochastic_accum.frag').then(r => r.text()),
      fetch('./shaders/webgl/stochastic_present.frag').then(r => r.text()),
    ]);

    this._progSphere  = createProgram(gl, sphereVs, sphereFs);
    this._uView       = gl.getUniformLocation(this._progSphere, 'uView');
    this._uProj       = gl.getUniformLocation(this._progSphere, 'uProj');
    this._uRadius     = gl.getUniformLocation(this._progSphere, 'uRadius');
    this._uLightDir   = gl.getUniformLocation(this._progSphere, 'uLightDir');
    this._uCamPos     = gl.getUniformLocation(this._progSphere, 'uCamPos');
    this._uFrame      = gl.getUniformLocation(this._progSphere, 'uFrame');
    this._uAlphaMul   = gl.getUniformLocation(this._progSphere, 'uAlphaMul');
    this._uBaseColor  = gl.getUniformLocation(this._progSphere, 'uBaseColor');
    this._uRoughness  = gl.getUniformLocation(this._progSphere, 'uRoughness');

    this._progAccum    = createProgram(gl, fullscreenVs, accumFs);
    this._uAcc_Blend   = gl.getUniformLocation(this._progAccum, 'uBlend');
    this._uAcc_HistValid = gl.getUniformLocation(this._progAccum, 'uHistValid');
    this._uAcc_Cur     = gl.getUniformLocation(this._progAccum, 'uCur');
    this._uAcc_Hist    = gl.getUniformLocation(this._progAccum, 'uHist');

    this._progPresent  = createProgram(gl, fullscreenVs, presentFs);
    this._uPres_Tex    = gl.getUniformLocation(this._progPresent, 'uTex');

    this._vao = gl.createVertexArray();
    gl.bindVertexArray(this._vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._posBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._nrmBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._idxBuf);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instBuf);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 12, 0);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this._vaoFS = gl.createVertexArray();
  }

  dispose() {
    const gl = this.gl;
    for (const p of [this._progSphere, this._progAccum, this._progPresent]) if (p) gl.deleteProgram(p);
    for (const b of [this._posBuf, this._nrmBuf, this._idxBuf, this._instBuf]) if (b) gl.deleteBuffer(b);
    if (this._vao)   gl.deleteVertexArray(this._vao);
    if (this._vaoFS) gl.deleteVertexArray(this._vaoFS);
    this._destroyFbos();
  }

  _destroyFbos() {
    const gl = this.gl;
    for (const x of [this._fboSceneMSAA, this._fboScene, this._fboHistA, this._fboHistB]) {
      if (x) gl.deleteFramebuffer(x);
    }
    for (const x of [this._texCur, this._texHistA, this._texHistB]) {
      if (x) gl.deleteTexture(x);
    }
    for (const x of [this._rbMsaaColor, this._rbMsaaDepth, this._rbDepth]) {
      if (x) gl.deleteRenderbuffer(x);
    }
    this._fboSceneMSAA = this._fboScene = this._fboHistA = this._fboHistB = null;
    this._texCur = this._texHistA = this._texHistB = null;
    this._rbMsaaColor = this._rbMsaaDepth = this._rbDepth = null;
  }

  _recreateFbos(w, h) {
    const gl = this.gl;
    this._destroyFbos();

    const maxSamples = gl.getParameter(gl.MAX_SAMPLES);
    this._msaaSamples = Math.max(2, Math.min(8, maxSamples));

    this._fboSceneMSAA  = gl.createFramebuffer();
    this._rbMsaaColor   = gl.createRenderbuffer();
    this._rbMsaaDepth   = gl.createRenderbuffer();

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboSceneMSAA);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this._rbMsaaColor);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this._msaaSamples, gl.RGBA8, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this._rbMsaaColor);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this._rbMsaaDepth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this._msaaSamples, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this._rbMsaaDepth);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    const msaaStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    if (msaaStatus !== gl.FRAMEBUFFER_COMPLETE) throw new Error('MSAA FBO incomplete: ' + msaaStatus);

    this._fboScene = gl.createFramebuffer();
    this._texCur   = createColorTex(gl, w, h);
    this._rbDepth  = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this._rbDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboScene);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._texCur, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this._rbDepth);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    const resolveStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (resolveStatus !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Resolve FBO incomplete: ' + resolveStatus);

    this._fboHistA = gl.createFramebuffer();
    this._fboHistB = gl.createFramebuffer();
    this._texHistA = createTex(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    this._texHistB = createTex(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    attachFbo(gl, this._fboHistA, this._texHistA, null);
    attachFbo(gl, this._fboHistB, this._texHistB, null);

    this._histToggle = 0;
    this._histValid = false;
    this._frameIndex = 0;
    this._framesAccumulated = 0;

    for (const fbo of [this._fboHistA, this._fboHistB]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize(w, h) {
    if (this._w === w && this._h === h && this._fboSceneMSAA) return;
    this._w = w;
    this._h = h;
    this._recreateFbos(w, h);
  }

  invalidateHistory() {
    this._histValid = false;
    this._framesAccumulated = 0;
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
    this._alphaMul = 1.0;
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

    this.invalidateHistory();
  }

  render(params) {
    const gl = this.gl;
    if (!this._fboSceneMSAA) return;

    if (params.cameraChanged) this.invalidateHistory();

    const { _w: w, _h: h } = this;
    const maxFrames = 256;
    let blendWeight = 0.0;
    let skipSceneDraw = false;

    if (!this._histValid) {
      this._framesAccumulated = 1;
      blendWeight = 0.0;
    } else {
      this._framesAccumulated++;
      if (this._framesAccumulated > maxFrames) {
        blendWeight = 1.0;
        skipSceneDraw = true;
      } else {
        blendWeight = (this._framesAccumulated - 1.0) / this._framesAccumulated;
      }
    }

    const meshChunks = params.meshChunks ||
      [{ start: 0, count: this._indexCount, baseColor: [0.7,0.7,0.7,1.0], roughness: 0.5 }];

    if (!skipSceneDraw) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboSceneMSAA);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.useProgram(this._progSphere);
      gl.uniformMatrix4fv(this._uView, false, params.view);
      gl.uniformMatrix4fv(this._uProj, false, params.proj);
      gl.uniform1f(this._uRadius, params.radius);
      gl.uniform3fv(this._uLightDir, this._lightDir);
      gl.uniform3f(this._uCamPos, params.camPos[0], params.camPos[1], params.camPos[2]);
      gl.uniform1f(this._uFrame, this._frameIndex);
      gl.uniform1f(this._uAlphaMul, this._alphaMul);

      const bytesPerIndex = params.meshIndicesType === gl.UNSIGNED_INT ? 4 : 2;
      gl.bindVertexArray(this._vao);
      for (const chunk of meshChunks) {
        gl.uniform4fv(this._uBaseColor, chunk.baseColor);
        gl.uniform1f(this._uRoughness, chunk.roughness);
        gl.drawElementsInstanced(gl.TRIANGLES, chunk.count, params.meshIndicesType, chunk.start * bytesPerIndex, this._instanceCount);
      }
      gl.bindVertexArray(null);

      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._fboSceneMSAA);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._fboScene);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }

    const histSrcTex = this._histToggle === 0 ? this._texHistA : this._texHistB;
    const histDstFbo = this._histToggle === 0 ? this._fboHistB : this._fboHistA;
    const histDstTex = this._histToggle === 0 ? this._texHistB : this._texHistA;

    gl.bindFramebuffer(gl.FRAMEBUFFER, histDstFbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this._progAccum);
    gl.uniform1f(this._uAcc_Blend, blendWeight);
    gl.uniform1f(this._uAcc_HistValid, this._histValid ? 1.0 : 0.0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._texCur);
    gl.uniform1i(this._uAcc_Cur, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, histSrcTex);
    gl.uniform1i(this._uAcc_Hist, 1);
    gl.bindVertexArray(this._vaoFS);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.viewport(0, 0, params.canvasW, params.canvasH);
    gl.disable(gl.DEPTH_TEST);
    const bgAlpha = params.bgColor?.[3] ?? 0.0;
    gl.clearColor(0, 0, 0, bgAlpha);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this._progPresent);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, histDstTex);
    gl.uniform1i(this._uPres_Tex, 0);
    gl.bindVertexArray(this._vaoFS);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);

    this._histToggle = 1 - this._histToggle;
    this._histValid = true;
    this._frameIndex++;
  }
}
