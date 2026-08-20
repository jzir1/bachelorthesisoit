import { OrbitControls } from './controls.js';
import { mat4, mat4Perspective, mat4Multiply, mat4Translate, mat4Scale } from './math.js';
import { makeSphereScene } from './scenes/spheres.js';
import { makeSphereMesh } from './mesh.js';
import { loadGLB } from './glb_loader.js';
import { makeCoverageScene } from './scenes/cubes.js';

import { DPOQRenderer } from './renderers/dp_oq_renderer.js';
import { DualDPOQRenderer } from './renderers/dual_dp_oq_renderer.js';
import { StochasticOITRenderer } from './renderers/stochastic_renderer.js';
import { WeightedBlendedRenderer } from './renderers/weighted_renderer.js';
import { LinkedListOIT } from './renderers/linked_list_oit.js';

let RENDER_SCALE = 1;
const LIGHT_DIR = new Float32Array([-0.6, 1.0, -0.4]);

import { initBenchmark } from './benchmark.js';

const LL_MAX_NODES_PER_PIXEL = 12;

let currentCanvas     = null;
let currentRenderer   = null;
let currentControls   = null;
let currentScene      = null;
let rafId             = null;
let requestScreenshot = false;
let benchmarkRunning  = false;

let device     = null;
let format     = null;
let webgpuCtx  = null;
let glTimerCtx = null;


let rawGpuSamples = null;

const uiMethodSelect = document.getElementById('method-select');
const uiSceneSelect  = document.getElementById('scene-select');
const uiFps          = document.getElementById('fps');
const uiGpuTime      = document.getElementById('gpuTime');
const uiPeelInfo     = document.getElementById('peelInfo');
const container      = document.getElementById('canvas-container');

function onRawGpuSample(ms) {
  if (rawGpuSamples !== null) rawGpuSamples.push(ms);
  updateGpuUi(ms);
}

function updateGpuUi(ms) {
  if (!uiGpuTime || ms === undefined || isNaN(ms)) return;
  const prev = parseFloat(uiGpuTime.dataset.ms || ms);
  const smoothed = (isNaN(prev) ? ms : prev) * 0.9 + ms * 0.1;
  uiGpuTime.dataset.ms = smoothed;
  uiGpuTime.innerText = `GPU: ${smoothed.toFixed(2)} ms`;
  if (uiFps && smoothed > 0) uiFps.innerText = `FPS: ${(1000 / smoothed).toFixed(1)}`;
}

function initWebGLTimer(gl) {
  const ext2 = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const ext1 = gl.getExtension('EXT_disjoint_timer_query');
  const ext = ext2 || ext1;
  if (!ext) return null;
  return {
    ext,
    create:   ext2 ? () => gl.createQuery()               : () => ext.createQueryEXT(),
    delete:   ext2 ? (q) => gl.deleteQuery(q)             : (q) => ext.deleteQueryEXT(q),
    begin:    ext2 ? (t, q) => gl.beginQuery(t, q)        : (t, q) => ext.beginQueryEXT(t, q),
    end:      ext2 ? (t) => gl.endQuery(t)                : (t) => ext.endQueryEXT(t),
    getParam: ext2 ? (q, p) => gl.getQueryParameter(q, p) : (q, p) => ext.getQueryObjectEXT(q, p),
    TIME_ELAPSED: ext2 ? ext2.TIME_ELAPSED_EXT : ext.TIME_ELAPSED_EXT,
    DISJOINT:     ext2 ? ext2.GPU_DISJOINT_EXT : ext.GPU_DISJOINT_EXT,
    AVAILABLE:    ext2 ? gl.QUERY_RESULT_AVAILABLE        : ext.QUERY_RESULT_AVAILABLE_EXT,
    RESULT:       ext2 ? gl.QUERY_RESULT                  : ext.QUERY_RESULT_EXT,
    pendingQuery: null,
  };
}

async function initWebGPU() {
  if (!navigator.gpu) throw new Error('WebGPU is not supported on this browser.');
  if (!device) {
    const adapter = await navigator.gpu.requestAdapter();
    const requiredFeatures = [];
    if (adapter.features.has('timestamp-query')) requiredFeatures.push('timestamp-query');
    device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
      requiredFeatures,
    });
    format = navigator.gpu.getPreferredCanvasFormat();
  }
  return { device, format };
}


function createNewCanvas() {
  if (currentCanvas) {
    
    const gl = currentCanvas.getContext('webgl2');
    if (gl) {
      const loseCtx = gl.getExtension('WEBGL_lose_context');
      if (loseCtx) loseCtx.loseContext();
    }

    currentCanvas.remove();
    if (currentControls) currentControls.detach();
  }
  const canvas = document.createElement('canvas');
  canvas.width  = Math.floor(window.innerWidth  * RENDER_SCALE);
  canvas.height = Math.floor(window.innerHeight * RENDER_SCALE);
  container.appendChild(canvas);
  currentCanvas   = canvas;
  currentControls = new OrbitControls(canvas);
  return canvas;
}

function resize() {
  if (!currentCanvas) return;
  currentCanvas.width  = Math.floor(window.innerWidth  * RENDER_SCALE);
  currentCanvas.height = Math.floor(window.innerHeight * RENDER_SCALE);
  if (currentRenderer?.resize) currentRenderer.resize(currentCanvas.width, currentCanvas.height);
  if (uiMethodSelect.value === 'webgpu_ll' && webgpuCtx) {
    if (webgpuCtx.depthTexture)  webgpuCtx.depthTexture.destroy();
    if (webgpuCtx.opaqueTexture) webgpuCtx.opaqueTexture.destroy();
    webgpuCtx.depthTexture = device.createTexture({
      size: [currentCanvas.width, currentCanvas.height], format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    webgpuCtx.opaqueTexture = device.createTexture({
      size: [currentCanvas.width, currentCanvas.height], format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  }
}

window.addEventListener('resize', async () => {
  resize();
  
  
  if (currentScene?.noScale && uiSceneSelect.value.startsWith('cubes_')) {
    const newScene = await loadScene(uiSceneSelect.value);
    currentScene = newScene;
    
    if (uiMethodSelect.value !== 'webgpu_ll' && currentRenderer?.setScene) {
      currentRenderer.setScene(currentScene);
    }
    
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'p' || e.key === 'P') requestScreenshot = true;
});

const scaleSlider = document.getElementById('scale-slider');
const scaleGroup  = document.getElementById('scale-group');
const scaleLabel  = document.getElementById('scale-label');

function updateScaleSliderUi() {
  if (!scaleGroup) return;
  const disabled = !!(currentScene?.noScale);
  scaleGroup.classList.toggle('disabled', disabled);
  if (scaleSlider) scaleSlider.disabled = disabled;
}

async function loadScene(sceneType) {
  const currentScale = scaleSlider ? parseFloat(scaleSlider.value) : 6.0;
  
  if (sceneType.startsWith('cubes_')) {
    const coverage = parseInt(sceneType.split('_')[1]);
    return makeCoverageScene(coverage, currentCanvas.width, currentCanvas.height);
  }

  if (sceneType === 'spheres_mid' || sceneType === 'spheres_high') {
    const sc = makeSphereScene(sceneType === 'spheres_high' ? 'high' : 'mid');
    sc.id   = sceneType;
    sc.mesh = makeSphereMesh(24, 24);
    sc.mesh.chunks = [{ start: 0, count: sc.mesh.indices.length, baseColor: [0.1, 0.6, 0.9, 0.5], roughness: 0.2 }];
    sc.originalPositions = [];
    for (let i = 0; i < sc.instances.length; i++) {
      const pos = sc.instances[i].pos;
      sc.originalPositions.push([...pos]);
      sc.instances[i].pos = [pos[0]*currentScale, pos[1]*currentScale, pos[2]*currentScale];
    }
    sc.baseRadius = sc.radius;
    sc.radius = sc.baseRadius * currentScale;
    return sc;
  }

  const fileName = sceneType === 'bunnies' ? 'stanford_bunny.glb' : `${sceneType}.glb`;
  const mesh = await loadGLB(`./models/${fileName}`);
  if (mesh.chunks) mesh.chunks.forEach(chunk => { chunk.baseColor[3] = 0.5; });

  const instances = [];
  let originalPositions = null;

  if (sceneType === 'bunnies') {
    const dim = 2, spacing = 1.2, centerOffset = (dim - 1) / 2;
    originalPositions = [];
    for (let x = 0; x < dim; x++) for (let y = 0; y < dim; y++) for (let z = 0; z < dim; z++) {
      const pos = [(x-centerOffset)*spacing, (y-centerOffset)*spacing, (z-centerOffset)*spacing];
      originalPositions.push(pos);
      instances.push({ pos: [pos[0]*currentScale, pos[1]*currentScale, pos[2]*currentScale] });
    }
  } else {
    instances.push({ pos: [0, 0, 0] });
  }

  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x=mesh.positions[i],y=mesh.positions[i+1],z=mesh.positions[i+2];
    if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;if(z<minZ)minZ=z;if(z>maxZ)maxZ=z;
  }
  const maxSize = Math.max(maxX-minX,maxY-minY,maxZ-minZ)||1.0;
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2,cz=(minZ+maxZ)/2;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    mesh.positions[i]   = (mesh.positions[i]   - cx) / maxSize;
    mesh.positions[i+1] = (mesh.positions[i+1] - cy) / maxSize;
    mesh.positions[i+2] = (mesh.positions[i+2] - cz) / maxSize;
  }
  const suggestedCamRadius = sceneType === 'bunnies' ? currentScale * 2.8 : 10.0;
  const suggestedAzimuth   = sceneType === 'bunnies' ? Math.PI * 0.15 : undefined;
  const suggestedPolar     = sceneType === 'bunnies' ? 1.15 : undefined;
  return { id: sceneType, radius: currentScale, instances, originalPositions, suggestedCamRadius, suggestedAzimuth, suggestedPolar, mesh };
}

async function startRenderLoop() {
  if (rafId) cancelAnimationFrame(rafId);

  let lastTime = performance.now(), frames = 0;
  const projMatrix=mat4(), viewProjMatrix=mat4(), lastVPMatrix=mat4();
  const tempModel=mat4(), translationMat=mat4(), identityMat=mat4();

  function frame(time) {

    const width=currentCanvas.width, height=currentCanvas.height;
    mat4Perspective(projMatrix, 60*Math.PI/180, width/height, 1, 100.0);
    const viewMatrix = currentControls.getViewMatrix();
    const camPos     = currentControls.getEye();
    mat4Multiply(viewProjMatrix, projMatrix, viewMatrix);

    let cameraChanged = false;
    for (let i=0;i<16;i++) if(Math.abs(viewProjMatrix[i]-lastVPMatrix[i])>0.00001){cameraChanged=true;break;}
    for (let i=0;i<16;i++) lastVPMatrix[i]=viewProjMatrix[i];

    if (uiMethodSelect.value === 'webgpu_ll' && webgpuCtx) {
      const {context,gpuMesh,buildPipeline,ubo,drawCalls,depthTexture,opaqueTexture,timer,uboData,uboFloatView} = webgpuCtx;
      const baseModel = mat4Scale(mat4(), mat4(), [currentScene.radius,currentScene.radius,currentScene.radius]);
      drawCalls.forEach(dc => {
        mat4Translate(translationMat, identityMat, dc.inst.pos);
        mat4Multiply(tempModel, translationMat, baseModel);
        const fIdx = dc.offset/4;
        uboFloatView.set(viewProjMatrix,     fIdx);
        uboFloatView.set(tempModel,          fIdx+16);
        uboFloatView.set(dc.chunk.baseColor, fIdx+32);
        uboFloatView.set(camPos,             fIdx+36);
        uboFloatView.set(LIGHT_DIR,          fIdx+40);
        uboFloatView[fIdx+43] = dc.chunk.roughness;
      });
      device.queue.writeBuffer(ubo, 0, uboData);

      const encoder = device.createCommandEncoder();
      currentRenderer.clear(encoder);

      const isTimerActive = timer && !timer.isPending;
      const opaquePassDesc = {
        colorAttachments:[{view:opaqueTexture.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}],
        depthStencilAttachment:{view:depthTexture.createView(),depthLoadOp:'clear',depthClearValue:1.0,depthStoreOp:'store'},
      };
      if (isTimerActive) opaquePassDesc.timestampWrites = {querySet:timer.querySet,beginningOfPassWriteIndex:0};
      encoder.beginRenderPass(opaquePassDesc).end();

      const buildPass = encoder.beginRenderPass({
        colorAttachments:[],
        depthStencilAttachment:{view:depthTexture.createView(),depthLoadOp:'load',depthStoreOp:'store'},
      });
      buildPass.setPipeline(buildPipeline);
      buildPass.setBindGroup(1, currentRenderer.buildBindGroup);
      buildPass.setVertexBuffer(0, gpuMesh.posBuf);
      if (gpuMesh.normBuf)   buildPass.setVertexBuffer(1, gpuMesh.normBuf);
      if (gpuMesh.isIndexed) buildPass.setIndexBuffer(gpuMesh.idxBuf, gpuMesh.indexFormat);
      drawCalls.forEach(dc => {
        buildPass.setBindGroup(0, dc.bg);
        if (gpuMesh.isIndexed) buildPass.drawIndexed(dc.chunk.count,1,dc.chunk.start,0,0);
        else                   buildPass.draw(dc.chunk.count,1,dc.chunk.start,0);
      });
      buildPass.end();

      currentRenderer.resolve(encoder, opaqueTexture.createView(), context.getCurrentTexture().createView());

      if (isTimerActive) {
        encoder.beginComputePass({timestampWrites:{querySet:timer.querySet,endOfPassWriteIndex:1}}).end();
        encoder.resolveQuerySet(timer.querySet,0,2,timer.resolveBuffer,0);
        encoder.copyBufferToBuffer(timer.resolveBuffer,0,timer.resultBuffer,0,16);
      }
      device.queue.submit([encoder.finish()]);

      if (isTimerActive) {
        timer.isPending = true;
        timer.resultBuffer.mapAsync(GPUMapMode.READ).then(() => {
          const times = new BigInt64Array(timer.resultBuffer.getMappedRange());
          const ns = Number(times[1]-times[0]);
          timer.resultBuffer.unmap();
          timer.isPending = false;
          if (ns >= 0) onRawGpuSample(ns/1_000_000);
        }).catch(()=>{ timer.isPending=false; });
      }

    } else if (currentRenderer?.render) {
      const gl = currentRenderer.gl;
      let currentTimerQuery = null;
      if (glTimerCtx && !glTimerCtx.pendingQuery) {
        currentTimerQuery = glTimerCtx.create();
        glTimerCtx.begin(glTimerCtx.TIME_ELAPSED, currentTimerQuery);
      }

      const weightFar = currentScene.depthFar
        ?? Math.max(35.0, currentControls.radius + currentScene.radius * 2 + 2.0);

      currentRenderer.render({
        view:viewMatrix, proj:projMatrix, viewProj:viewProjMatrix, camPos,
        radius:currentScene.radius, mode:'peel', bgColor:[0,0,0,0],
        canvasW:width, canvasH:height, cameraChanged,
        meshChunks:currentScene.mesh.chunks,
        meshIndicesType: currentScene.mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        weightNear: 0.5,
        weightFar,
      });

      if (glTimerCtx && currentTimerQuery) {
        glTimerCtx.end(glTimerCtx.TIME_ELAPSED);
        glTimerCtx.pendingQuery = currentTimerQuery;
      }
      if (glTimerCtx?.pendingQuery) {
        const disjoint  = gl.getParameter(glTimerCtx.DISJOINT);
        const available = glTimerCtx.getParam(glTimerCtx.pendingQuery, glTimerCtx.AVAILABLE);
        if (available && !disjoint) {
          onRawGpuSample(glTimerCtx.getParam(glTimerCtx.pendingQuery, glTimerCtx.RESULT) / 1_000_000);
          glTimerCtx.delete(glTimerCtx.pendingQuery);
          glTimerCtx.pendingQuery = null;
        } else if (disjoint) {
          glTimerCtx.delete(glTimerCtx.pendingQuery);
          glTimerCtx.pendingQuery = null;
        }
      }
    }

    if (uiPeelInfo) {
      uiPeelInfo.innerText = (currentRenderer?.peelInfo && currentRenderer.peelInfo !== '-')
        ? `Layers: ${currentRenderer.peelInfo}` : 'Layers: not applicable';
    }

    if (requestScreenshot) {
      const tmp = document.createElement('canvas');
      tmp.width=currentCanvas.width; tmp.height=currentCanvas.height;
      const ctx = tmp.getContext('2d');
      ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,tmp.width,tmp.height);
      ctx.drawImage(currentCanvas,0,0);
      const link = document.createElement('a');
      link.download=`render_${new Date().toISOString().replace(/[:.]/g,'-')}.png`;
      link.href=tmp.toDataURL('image/png',1.0); link.click();
      requestScreenshot = false;
    }

    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
}

async function switchMethod() {
  const method    = uiMethodSelect.value;
  const sceneType = uiSceneSelect.value;

  if (rafId) cancelAnimationFrame(rafId);
  if (currentRenderer?.dispose) currentRenderer.dispose();
  webgpuCtx = null;
  if (glTimerCtx?.pendingQuery) { glTimerCtx.delete(glTimerCtx.pendingQuery); glTimerCtx.pendingQuery=null; }
  if (uiGpuTime) { uiGpuTime.innerText='GPU: -- ms'; delete uiGpuTime.dataset.ms; }
  if (uiFps) uiFps.innerText='FPS: --';

  const canvas = createNewCanvas();
  currentScene  = await loadScene(sceneType);
  currentControls.radius  = currentScene.suggestedCamRadius ?? 10;
  currentControls.azimuth = currentScene.suggestedAzimuth   ?? 0.9;
  currentControls.polar   = currentScene.suggestedPolar     ?? 1.3;

  
  updateScaleSliderUi();

  if (method === 'webgpu_ll') {
    const gpuConfig = await initWebGPU();
    const context   = canvas.getContext('webgpu');
    context.configure({ device:gpuConfig.device, format:gpuConfig.format, alphaMode:'premultiplied' });

    currentRenderer = new LinkedListOIT(gpuConfig.device, canvas.width, canvas.height, gpuConfig.format, LL_MAX_NODES_PER_PIXEL);
    await currentRenderer.init();

    const sceneWGSL = await fetch('./shaders/webgpu/scene.wgsl').then(r=>r.text());
    const meshData  = currentScene.mesh;
    const makeBuf   = (data, usage) => {
      const buf = gpuConfig.device.createBuffer({ size:(data.byteLength+3)&~3, usage, mappedAtCreation:true });
      new data.constructor(buf.getMappedRange()).set(data);
      buf.unmap(); return buf;
    };
    const gpuMesh = {
      posBuf:     makeBuf(meshData.positions, GPUBufferUsage.VERTEX),
      normBuf:    makeBuf(meshData.normals,   GPUBufferUsage.VERTEX),
      idxBuf:     meshData.indices ? makeBuf(meshData.indices, GPUBufferUsage.INDEX) : null,
      indexCount: meshData.indices ? meshData.indices.length : (meshData.positions.length/3),
      isIndexed:  !!meshData.indices,
      indexFormat:(meshData.indices instanceof Uint32Array) ? 'uint32' : 'uint16',
    };
    const vertexBuffers = [
      {arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:'float32x3'}]},
      {arrayStride:12,attributes:[{shaderLocation:1,offset:0,format:'float32x3'}]},
    ];
    const buildPipelineLayout = gpuConfig.device.createPipelineLayout({
      bindGroupLayouts:[
        gpuConfig.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]}),
        currentRenderer.buildBindGroupLayout,
      ],
    });
    const shaderModule  = gpuConfig.device.createShaderModule({ code:sceneWGSL });
    const buildPipeline = gpuConfig.device.createRenderPipeline({
      layout:buildPipelineLayout,
      vertex:  {module:shaderModule,entryPoint:'vs_main',buffers:vertexBuffers},
      fragment:{module:shaderModule,entryPoint:'fs_main',targets:[]},
      primitive:{topology:'triangle-list',cullMode:'none'},
      depthStencil:{depthWriteEnabled:false,depthCompare:'less',format:'depth24plus'},
    });
    const uniformStride  = 256;
    const totalDrawCalls = currentScene.instances.length * (meshData.chunks?.length ?? 1);
    const ubo            = gpuConfig.device.createBuffer({ size:uniformStride*totalDrawCalls, usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST });
    const uboData        = new ArrayBuffer(uniformStride*totalDrawCalls);
    const uboFloatView   = new Float32Array(uboData);
    const drawCalls=[]; let drawIndex=0;
    currentScene.instances.forEach(inst => {
      const chunks = meshData.chunks ?? [{start:0,count:gpuMesh.indexCount,baseColor:[0.7,0.7,0.7,1.0],roughness:0.5}];
      chunks.forEach(chunk => {
        const offset=drawIndex*uniformStride;
        const bg = gpuConfig.device.createBindGroup({
          layout:buildPipeline.getBindGroupLayout(0),
          entries:[{binding:0,resource:{buffer:ubo,offset,size:176}}],
        });
        drawCalls.push({inst,chunk,bg,offset}); drawIndex++;
      });
    });
    let timer = null;
    if (gpuConfig.device.features.has('timestamp-query')) {
      timer = {
        querySet:      gpuConfig.device.createQuerySet({type:'timestamp',count:2}),
        resolveBuffer: gpuConfig.device.createBuffer({size:16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),
        resultBuffer:  gpuConfig.device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),
        isPending:false,
      };
    }
    webgpuCtx = {
      context, gpuMesh, buildPipeline, ubo, drawCalls, uboData, uboFloatView, timer,
      depthTexture:  gpuConfig.device.createTexture({size:[canvas.width,canvas.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT}),
      opaqueTexture: gpuConfig.device.createTexture({size:[canvas.width,canvas.height],format:gpuConfig.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),
    };

  } else {
    
    
    const gl = canvas.getContext('webgl2', { antialias:false, alpha:true, premultipliedAlpha:true });
    if (!gl) throw new Error('WebGL2 not supported');
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_element_index_uint');
    glTimerCtx = initWebGLTimer(gl);

    if      (method==='dp_oq')      currentRenderer = new DPOQRenderer(gl);
    else if (method==='dual_dp_oq') currentRenderer = new DualDPOQRenderer(gl);
    else if (method==='stochastic') currentRenderer = new StochasticOITRenderer(gl);
    else if (method==='weighted')   currentRenderer = new WeightedBlendedRenderer(gl);

    await currentRenderer.init();
    currentRenderer.resize(canvas.width, canvas.height);
    currentRenderer.setScene(currentScene);
  }
  startRenderLoop();
}

uiMethodSelect.addEventListener('change', switchMethod);
uiSceneSelect.addEventListener('change',  switchMethod);

if (scaleSlider) {
  scaleSlider.addEventListener('input', (e) => {
    if (!currentScene) return;
    
    
    if (currentScene.noScale) return;

    const newScale = parseFloat(e.target.value);
    if (scaleLabel) scaleLabel.textContent = newScale.toFixed(1);

    if (currentScene.id==='spheres_mid'||currentScene.id==='spheres_high') {
      currentScene.radius = currentScene.baseRadius * newScale;
      if (currentScene.originalPositions) currentScene.instances.forEach((inst,i)=>{
        const o=currentScene.originalPositions[i]; inst.pos=[o[0]*newScale,o[1]*newScale,o[2]*newScale];
      });
    } else {
      currentScene.radius = newScale;
      if (currentScene.id==='bunnies'&&currentScene.originalPositions) currentScene.instances.forEach((inst,i)=>{
        const o=currentScene.originalPositions[i]; inst.pos=[o[0]*newScale,o[1]*newScale,o[2]*newScale];
      });
    }
    if (uiMethodSelect.value!=='webgpu_ll'&&currentRenderer?.setScene) currentRenderer.setScene(currentScene);
  });
}

switchMethod();

initBenchmark({
  getCanvas:        () => currentCanvas,
  getRawGpuSamples: () => rawGpuSamples,
  setRawGpuSamples: v  => { rawGpuSamples = v; },
  getRenderScale:   () => RENDER_SCALE,
  setRenderScale:   v  => { RENDER_SCALE = v; },
  isBusy:           () => benchmarkRunning,
  setBusy:          v  => { benchmarkRunning = v; },
  getRenderer:      () => currentRenderer,
  switchMethod,
});