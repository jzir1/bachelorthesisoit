import { mat4, mat4Multiply } from '../math.js';
import { createProgram, createColorTex, createDepthTex, createTex, attachFbo } from './gl.js';

export class DPOQRenderer {
  constructor(gl) {
    this.gl = gl;
    this.peelInfo = '-';

    this._maxPeelLayers = 64;
    this._oqEnabled = true;
    this._oqLayerLimit = 4;
    this._oqTarget = null;
  
    this._bufferSize = 5; 
    this._queries = Array.from({ length: this._bufferSize }, () => []); 
    this._qIdx = 0;
    this._oqLastSubmitted = new Array(this._bufferSize).fill(0);

    this._oqActualLayers = 0;
    this._oqStableCount = 0;

    this._vp = mat4();
    this._view = mat4();
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
      fetch('./shaders/webgl/dp_oq_peel.frag').then(r => r.text()),
      fetch('./shaders/webgl/fullscreen.vert').then(r => r.text()),
      fetch('./shaders/webgl/composite.frag').then(r => r.text()),
      fetch('./shaders/webgl/dp_oq_present.frag').then(r => r.text()),
    ]);

    this._progPeel     = createProgram(gl, vsSphere, fsPeel);
    this._uP_ViewProj  = gl.getUniformLocation(this._progPeel, 'uViewProj');
    this._uP_Radius    = gl.getUniformLocation(this._progPeel, 'uRadius');
    this._uP_LightDir  = gl.getUniformLocation(this._progPeel, 'uLightDir');
    this._uP_CamPos    = gl.getUniformLocation(this._progPeel, 'uCamPos');
    this._uP_BaseColor = gl.getUniformLocation(this._progPeel, 'uBaseColor');
    this._uP_Roughness = gl.getUniformLocation(this._progPeel, 'uRoughness');
    this._uP_HasPrev   = gl.getUniformLocation(this._progPeel, 'uHasPrev');
    this._uP_PrevDepth = gl.getUniformLocation(this._progPeel, 'uPrevDepth');
    this._uP_Eps       = gl.getUniformLocation(this._progPeel, 'uEps');
    this._uP_View      = gl.getUniformLocation(this._progPeel, 'uView');
    this._uP_ChunkBias = gl.getUniformLocation(this._progPeel, 'uChunkBias');

    this._progComposite = createProgram(gl, vsFS, fsComposite);
    this._uC_Layer      = gl.getUniformLocation(this._progComposite, 'uLayer');

    this._progPresent = createProgram(gl, vsFS, fsPresent);
    this._uS_Accum    = gl.getUniformLocation(this._progPresent, 'uAccum');

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
    if (this._texPeelColor) gl.deleteTexture(this._texPeelColor);
    if (this._texAccum)     gl.deleteTexture(this._texAccum);
    if (this._texLinA)      gl.deleteTexture(this._texLinA);
    if (this._texLinB)      gl.deleteTexture(this._texLinB);
    if (this._texHwDepth)   gl.deleteTexture(this._texHwDepth);
    this._texPeelColor = createTex(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    this._texAccum     = createTex(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    // Linear view-space depth, ping-ponged between passes (requires EXT_color_buffer_float).
    this._texLinA      = createTex(gl, w, h, gl.R32F, gl.RED, gl.FLOAT);
    this._texLinB      = createTex(gl, w, h, gl.R32F, gl.RED, gl.FLOAT);
    // Hardware depth attachment, used only for the per-pass GPU depth test.
    this._texHwDepth   = createDepthTex(gl, w, h);
    attachFbo(gl, this._fboAccum, this._texAccum, null);
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

    
    this._oqEnabled       = true;
    this._oqLayerLimit    = 4;
    this._oqLastSubmitted.fill(0);
    this._oqStableCount   = 0;
    this._oqActualLayers  = 0;
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
    for (const t of [this._texPeelColor, this._texAccum, this._texLinA, this._texLinB, this._texHwDepth]) {
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
    this._view.set(view);

    if (!meshChunks) {
      meshChunks = [{ start: 0, count: this._indexCount, baseColor: [0.7,0.7,0.7,1.0], roughness: 0.5 }];
    }

    this._renderDepthPeel({ camPos, radius, bgColor, meshChunks, meshIndicesType });
  }

  _renderDepthPeel({ camPos, radius, bgColor, meshChunks, meshIndicesType }) {
    const gl = this.gl;
    const { _w: w, _h: h } = this;
    if (w <= 0 || h <= 0) return;
    if (!this._texPeelColor || !this._texAccum || !this._texLinA || !this._texLinB || !this._texHwDepth) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboAccum);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let prevDepth = this._texLinA;
    let currDepth = this._texLinB;
    let hasPrev = false;
    let layers = 0;
    let oqEnabled = this._oqEnabled && !!this._oqTarget;

    const limitBefore = this._oqLayerLimit;
    const readIdx = (this._qIdx + 1) % this._bufferSize;
    const lastSubmitted = this._oqLastSubmitted[readIdx];

    if (oqEnabled && lastSubmitted > 0) {
      let allAvailable = true;
      for (let i = 0; i < lastSubmitted; i++) {
        const q = this._queries[readIdx][i];
        if (!q || !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) { allAvailable = false; break; }
      }
      if (allAvailable) {
        let newLimit = Math.min(this._maxPeelLayers, lastSubmitted);
        let firstEmpty = -1;
        for (let i = 0; i < lastSubmitted; i++) {
          const any = gl.getQueryParameter(this._queries[readIdx][i], gl.QUERY_RESULT);
          if (!any) {
            if (i === 0 && this._instanceCount > 0) { this._oqEnabled = false; oqEnabled = false; }
            else { newLimit = i; firstEmpty = i; }
            break;
          }
        }
        if (oqEnabled) {
          this._oqLayerLimit = Math.max(1, Math.min(this._maxPeelLayers, newLimit));
          
          this._oqActualLayers = (firstEmpty >= 0) ? firstEmpty : lastSubmitted;
        }
      }
    }

    
    if (this._oqLayerLimit === limitBefore) {
      this._oqStableCount++;
    } else {
      this._oqStableCount = 0;
    }

    const setPeelUniforms = () => {
      gl.uniformMatrix4fv(this._uP_ViewProj, false, this._vp);
      gl.uniform1f(this._uP_Radius, radius);
      gl.uniform3f(this._uP_LightDir, -0.6, 1.0, -0.4);
      gl.uniform3f(this._uP_CamPos, camPos[0], camPos[1], camPos[2]);
      gl.uniform1f(this._uP_Eps, 1e-3);
      gl.uniformMatrix4fv(this._uP_View, false, this._view);
      gl.uniform1i(this._uP_HasPrev, hasPrev ? 1 : 0);
      if (hasPrev) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, prevDepth);
        gl.uniform1i(this._uP_PrevDepth, 0);
      }
    };

    const colorLimit = oqEnabled ? this._oqLayerLimit : this._maxPeelLayers;
    const queryLimit = oqEnabled ? Math.min(this._maxPeelLayers, colorLimit + 1) : colorLimit;
    const bytesPerIndex = meshIndicesType === gl.UNSIGNED_INT ? 4 : 2;

    for (let i = 0; i < queryLimit; i++) {
      const probeOnly = oqEnabled && (i === colorLimit);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboPeel);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._texPeelColor, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, currDepth, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,  gl.TEXTURE_2D, this._texHwDepth, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.depthFunc(gl.LESS);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // Clear the linear-depth target to a large sentinel so empty pixels never
      // falsely pass the layer-separation test.
      gl.clearBufferfv(gl.COLOR, 1, [1e30, 0, 0, 0]);

      gl.useProgram(this._progPeel);
      setPeelUniforms();

      const q = this._queries[this._qIdx][i] || (this._queries[this._qIdx][i] = gl.createQuery());
      if (oqEnabled) gl.beginQuery(this._oqTarget, q);

      gl.bindVertexArray(this._vao);
      // Per-part deterministic depth bias. The chunk index is a stable ID for
      // each CAD part (one draw call per part), so coplanar abutting surfaces
      // get separated reproducibly every frame. Scale is tiny relative to scene
      // depth so it only resolves exact ties, not real ordering.
      for (let ci = 0; ci < meshChunks.length; ci++) {
        const chunk = meshChunks[ci];
        gl.uniform4fv(this._uP_BaseColor, chunk.baseColor);
        gl.uniform1f(this._uP_Roughness, chunk.roughness);
        gl.uniform1f(this._uP_ChunkBias, ci * 5e-4);
        gl.drawElementsInstanced(gl.TRIANGLES, chunk.count, meshIndicesType, chunk.start * bytesPerIndex, this._instanceCount);
      }
      gl.bindVertexArray(null);

      if (oqEnabled) gl.endQuery(this._oqTarget);

      if (!probeOnly) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboAccum);
        gl.viewport(0, 0, w, h);
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.ONE_MINUS_DST_ALPHA, gl.ONE);

        gl.useProgram(this._progComposite);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._texPeelColor);
        gl.uniform1i(this._uC_Layer, 0);

        gl.bindVertexArray(null);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disable(gl.BLEND);
        layers++;
        hasPrev = true;
      }

      const tmp = prevDepth; prevDepth = currDepth; currDepth = tmp;
    }

    this._oqLastSubmitted[this._qIdx] = oqEnabled ? queryLimit : 0;
    this._qIdx = (this._qIdx + 1) % this._bufferSize; 

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(bgColor[0], bgColor[1], bgColor[2], bgColor[3] ?? 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this._progPresent);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._texAccum);
    gl.uniform1i(this._uS_Accum, 0);

    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const displayedCount = (oqEnabled && this._oqActualLayers > 0) ? this._oqActualLayers : layers;
    this.peelInfo = `${displayedCount} layers (max ${this._maxPeelLayers})`;
  }
}