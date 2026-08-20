import { mat4, mat4Multiply } from '../math.js';
import { createProgram, createColorTex, createDepthTex, createTex, attachFbo } from './gl.js';

export class DualDPOQRenderer {
  constructor(gl) {
    this.gl = gl;
    this.peelInfo = '-';

    this._maxPeelLayers = 32;
    this._oqEnabled = true;
    this._oqTarget = null;
    this._oqPairLimit = 4;
    
    this._bufferSize = 5;
    this._queries = Array.from({ length: this._bufferSize }, () => []);
    this._qIdx = 0;
    this._oqLastSubmitted = new Array(this._bufferSize).fill(0);
    this._oqLastRenderedPairs = new Array(this._bufferSize).fill(0);
    
    this._oqActualPairs = 0;
    this._oqStableCount = 0;

    this._vp = mat4();
    this._w = 0;
    this._h = 0;
    this._indexCount = 0;
    this._indexType = gl.UNSIGNED_INT;
    this._instanceCount = 0;
  }

  
  get isReady() {
    return !this._oqEnabled || this._oqStableCount >= 2;
  }

  async init() {
    const gl = this.gl;
    this._oqTarget = gl.ANY_SAMPLES_PASSED;

    const [vsSphere, fsPeel, vsFS, fsComposite, fsPresent] = await Promise.all([
      fetch('./shaders/webgl/sphere.vert').then(r => r.text()),
      fetch('./shaders/webgl/dual_peel.frag').then(r => r.text()),
      fetch('./shaders/webgl/fullscreen.vert').then(r => r.text()),
      fetch('./shaders/webgl/composite.frag').then(r => r.text()),
      fetch('./shaders/webgl/dual_present.frag').then(r => r.text()),
    ]);

    this._progPeel      = createProgram(gl, vsSphere, fsPeel);
    this._uP_ViewProj   = gl.getUniformLocation(this._progPeel, 'uViewProj');
    this._uP_Radius     = gl.getUniformLocation(this._progPeel, 'uRadius');
    this._uP_LightDir   = gl.getUniformLocation(this._progPeel, 'uLightDir');
    this._uP_CamPos     = gl.getUniformLocation(this._progPeel, 'uCamPos');
    this._uP_BaseColor  = gl.getUniformLocation(this._progPeel, 'uBaseColor');
    this._uP_Roughness  = gl.getUniformLocation(this._progPeel, 'uRoughness');
    this._uP_HasFront   = gl.getUniformLocation(this._progPeel, 'uHasFront');
    this._uP_FrontDepth = gl.getUniformLocation(this._progPeel, 'uFrontDepth');
    this._uP_HasBack    = gl.getUniformLocation(this._progPeel, 'uHasBack');
    this._uP_BackDepth  = gl.getUniformLocation(this._progPeel, 'uBackDepth');
    this._uP_Eps        = gl.getUniformLocation(this._progPeel, 'uEps');

    this._progComposite = createProgram(gl, vsFS, fsComposite);
    this._uC_Layer      = gl.getUniformLocation(this._progComposite, 'uLayer');

    this._progPresent = createProgram(gl, vsFS, fsPresent);
    this._uS_Front    = gl.getUniformLocation(this._progPresent, 'uFront');
    this._uS_Back     = gl.getUniformLocation(this._progPresent, 'uBack');

    this._posBuf  = gl.createBuffer();
    this._nrmBuf  = gl.createBuffer();
    this._idxBuf  = gl.createBuffer();
    this._instBuf = gl.createBuffer();

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

    this._fboPeel  = gl.createFramebuffer();
    this._fboAccum = gl.createFramebuffer();
  }

  resize(w, h) {
    const gl = this.gl;
    if (w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;
    for (const t of [
      '_texPeelColor', '_texAccumFront', '_texAccumBack',
      '_texDepthFrontA', '_texDepthFrontB', '_texDepthBackA', '_texDepthBackB',
    ]) {
      if (this[t]) { gl.deleteTexture(this[t]); this[t] = null; }
    }
    this._texPeelColor   = createTex(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    
    this._texAccumFront  = createTex(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    this._texAccumBack   = createTex(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    this._texDepthFrontA = createDepthTex(gl, w, h);
    this._texDepthFrontB = createDepthTex(gl, w, h);
    this._texDepthBackA  = createDepthTex(gl, w, h);
    this._texDepthBackB  = createDepthTex(gl, w, h);
    attachFbo(gl, this._fboPeel, this._texPeelColor, this._texDepthFrontA);
    attachFbo(gl, this._fboAccum, this._texAccumFront, null);
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
    const instances = scene.instances;
    this._instanceCount = instances.length;
    const data = new Float32Array(this._instanceCount * 3);
    for (let i = 0; i < this._instanceCount; i++) {
      data[i*3 + 0] = instances[i].pos[0];
      data[i*3 + 1] = instances[i].pos[1];
      data[i*3 + 2] = instances[i].pos[2];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    
    this._oqEnabled           = true;
    this._oqPairLimit         = 4;
    this._oqLastSubmitted.fill(0);
    this._oqLastRenderedPairs.fill(0);
    this._oqStableCount       = 0;
    this._oqActualPairs       = 0;
  }

  dispose() {
    const gl = this.gl;
    for (const p of [this._progPeel, this._progComposite, this._progPresent]) {
      if (p) gl.deleteProgram(p);
    }
    for (const b of [this._posBuf, this._nrmBuf, this._idxBuf, this._instBuf]) {
      if (b) gl.deleteBuffer(b);
    }
    for (const v of [this._vao]) if (v) gl.deleteVertexArray(v);
    for (const t of [
      this._texPeelColor, this._texAccumFront, this._texAccumBack,
      this._texDepthFrontA, this._texDepthFrontB, this._texDepthBackA, this._texDepthBackB,
    ]) {
      if (t) gl.deleteTexture(t);
    }
    for (const f of [this._fboPeel, this._fboAccum]) if (f) gl.deleteFramebuffer(f);
    for (const qs of this._queries) {
        for (const q of qs) if (q) gl.deleteQuery(q);
    }
  }

  render({ view, proj, camPos, radius, bgColor = [0,0,0,0], meshChunks, meshIndicesType }) {
    const gl = this.gl;
    this.peelInfo = '-';
    mat4Multiply(this._vp, proj, view);

    if (!meshChunks) {
      meshChunks = [{ start: 0, count: this._indexCount, baseColor: [0.7,0.7,0.7,1.0], roughness: 0.5 }];
    }

    this._renderDepthPeel({ camPos, radius, bgColor, meshChunks, meshIndicesType });
  }

  _renderDepthPeel({ camPos, radius, bgColor, meshChunks, meshIndicesType }) {
    const gl = this.gl;
    const { _w: w, _h: h } = this;
    if (w <= 0 || h <= 0) return;
    if (!this._texPeelColor || !this._texAccumFront || !this._texAccumBack ||
        !this._texDepthFrontA || !this._texDepthFrontB || !this._texDepthBackA || !this._texDepthBackB) return;

    
    const pairLimitBefore = this._oqPairLimit;
    const readIdx = (this._qIdx + 1) % this._bufferSize;
    const lastSubmitted = this._oqLastSubmitted[readIdx];
    const lastRenderedPairs = this._oqLastRenderedPairs[readIdx];

    if (this._oqEnabled && lastSubmitted > 0) {
      let allReady = true;
      for (let i = 0; i < lastSubmitted; i++) {
        const qF = this._queries[readIdx][i*2];
        const qB = this._queries[readIdx][i*2 + 1];
        if (!qF || !qB ||
            !gl.getQueryParameter(qF, gl.QUERY_RESULT_AVAILABLE) ||
            !gl.getQueryParameter(qB, gl.QUERY_RESULT_AVAILABLE)) {
          allReady = false; break;
        }
      }
      if (allReady) {
        let firstEmpty = -1;
        for (let i = 0; i < lastSubmitted; i++) {
          const rF = gl.getQueryParameter(this._queries[readIdx][i*2],   gl.QUERY_RESULT);
          const rB = gl.getQueryParameter(this._queries[readIdx][i*2+1], gl.QUERY_RESULT);
          if ((!rF || rF === 0) && (!rB || rB === 0) && firstEmpty < 0) { firstEmpty = i; }
        }
        if (firstEmpty >= 0) {
          this._oqPairLimit = Math.max(0, Math.min(this._maxPeelLayers, firstEmpty));
        } else if (lastRenderedPairs < this._maxPeelLayers) {
          this._oqPairLimit = Math.min(this._maxPeelLayers, lastRenderedPairs + 1);
        } else {
          this._oqPairLimit = this._maxPeelLayers;
        }
        
        
        this._oqActualPairs = (firstEmpty >= 0) ? firstEmpty : lastSubmitted;
      }
    }
    
    if (this._oqPairLimit === pairLimitBefore) {
      this._oqStableCount++;
    } else {
      this._oqStableCount = 0;
    }
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboAccum);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._texAccumFront, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._texAccumBack, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let prevFront = this._texDepthFrontA, currFront = this._texDepthFrontB;
    let prevBack  = this._texDepthBackA,  currBack  = this._texDepthBackB;
    let hasFront = false, hasBack = false, pairs = 0;

    if (this._oqEnabled) {
      const need = (this._maxPeelLayers + 1) * 2;
      while (this._queries[this._qIdx].length < need) this._queries[this._qIdx].push(gl.createQuery());
    }

    const pairLimit  = this._oqEnabled ? Math.min(this._maxPeelLayers, this._oqPairLimit) : this._maxPeelLayers;
    const canProbe   = this._oqEnabled && (pairLimit < this._maxPeelLayers);
    const pairsToRun = pairLimit + (canProbe ? 1 : 0);
    this._oqLastRenderedPairs[this._qIdx] = pairLimit;

    const bytesPerIndex = meshIndicesType === gl.UNSIGNED_INT ? 4 : 2;

    const setPeelUniforms = () => {
      gl.uniformMatrix4fv(this._uP_ViewProj, false, this._vp);
      gl.uniform1f(this._uP_Radius, radius);
      gl.uniform3f(this._uP_LightDir, -0.6, 1.0, -0.4);
      gl.uniform3f(this._uP_CamPos, camPos[0], camPos[1], camPos[2]);
      gl.uniform1f(this._uP_Eps, 1e-6);
      gl.uniform1i(this._uP_HasFront, hasFront ? 1 : 0);
      gl.uniform1i(this._uP_HasBack,  hasBack  ? 1 : 0);
      let unit = 0;
      if (hasFront) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, prevFront);
        gl.uniform1i(this._uP_FrontDepth, unit++);
      }
      if (hasBack) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, prevBack);
        gl.uniform1i(this._uP_BackDepth, unit);
      }
    };

    const drawLayerToAccum = (accumTex, blendMode) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboAccum);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accumTex, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      if (blendMode === 'front') {
        gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.ONE_MINUS_DST_ALPHA, gl.ONE);
      } else {
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
      gl.useProgram(this._progComposite);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._texPeelColor);
      gl.uniform1i(this._uC_Layer, 0);
      gl.bindVertexArray(null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
    };

    for (let i = 0; i < pairsToRun; i++) {
      const isProbe = (i === pairLimit) && canProbe;
      const qF = this._oqEnabled ? this._queries[this._qIdx][i*2]   : null;
      const qB = this._oqEnabled ? this._queries[this._qIdx][i*2+1] : null;

      
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboPeel);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, currFront, 0);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LESS);
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this._progPeel);
      setPeelUniforms();
      if (qF) gl.beginQuery(this._oqTarget, qF);
      gl.bindVertexArray(this._vao);
      for (const chunk of meshChunks) {
        gl.uniform4fv(this._uP_BaseColor, chunk.baseColor);
        gl.uniform1f(this._uP_Roughness, chunk.roughness);
        gl.drawElementsInstanced(gl.TRIANGLES, chunk.count, meshIndicesType, chunk.start * bytesPerIndex, this._instanceCount);
      }
      gl.bindVertexArray(null);
      if (qF) gl.endQuery(this._oqTarget);
      if (!isProbe) drawLayerToAccum(this._texAccumFront, 'front');
      hasFront = true;
      let tmp = prevFront; prevFront = currFront; currFront = tmp;

      
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboPeel);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, currBack, 0);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.GREATER);
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(0.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this._progPeel);
      setPeelUniforms();
      if (qB) gl.beginQuery(this._oqTarget, qB);
      gl.bindVertexArray(this._vao);
      for (const chunk of meshChunks) {
        gl.uniform4fv(this._uP_BaseColor, chunk.baseColor);
        gl.uniform1f(this._uP_Roughness, chunk.roughness);
        gl.drawElementsInstanced(gl.TRIANGLES, chunk.count, meshIndicesType, chunk.start * bytesPerIndex, this._instanceCount);
      }
      gl.bindVertexArray(null);
      if (qB) gl.endQuery(this._oqTarget);
      if (!isProbe) drawLayerToAccum(this._texAccumBack, 'back');
      hasBack = true;
      tmp = prevBack; prevBack = currBack; currBack = tmp;

      if (!isProbe) pairs++;
    }

    this._oqLastSubmitted[this._qIdx] = this._oqEnabled ? pairsToRun : 0;
    this._qIdx = (this._qIdx + 1) % this._bufferSize; 

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(bgColor[0], bgColor[1], bgColor[2], bgColor[3] ?? 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this._progPresent);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._texAccumFront);
    gl.uniform1i(this._uS_Front, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._texAccumBack);
    gl.uniform1i(this._uS_Back, 1);

    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);


    const displayedPairs = (this._oqEnabled && this._oqActualPairs > 0) ? this._oqActualPairs : pairs;
    this.peelInfo = `${displayedPairs*2} layers (dual, max ${this._maxPeelLayers*2})`;
  }
}