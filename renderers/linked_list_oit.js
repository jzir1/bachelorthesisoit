export class LinkedListOIT {
  constructor(device, width, height, presentationFormat, maxNodesPerPixel = 16) {
    this.device = device;
    this.presentationFormat = presentationFormat;
    this.width  = width;
    this.height = height;
    this.peelInfo = '-';
    this._maxNodesPerPixel = maxNodesPerPixel;
  }

  async init() {
    const clearCode   = await fetch('./shaders/webgpu/clear.wgsl').then(r => r.text());
    const resolveCode = await fetch('./shaders/webgpu/resolve.wgsl').then(r => r.text());
    this._initPipelines(clearCode, resolveCode);
    this._createResources();
    this._createBindGroups();
  }

  _initPipelines(clearCode, resolveCode) {
    this.clearPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: this.device.createShaderModule({ code: clearCode }),
        entryPoint: 'main',
      },
    });

    const N = this._maxNodesPerPixel;
    const resolveSpecialized = resolveCode
      .replaceAll('LL_MAX_FRAGS_MINUS1_U', `${N - 1}u`)
      .replaceAll('LL_MAX_FRAGS_U',        `${N}u`)
      .replaceAll('LL_MAX_FRAGS',          `${N}`);

    const resolveModule = this.device.createShaderModule({ code: resolveSpecialized });
    this.resolvePipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module:     resolveModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module:     resolveModule,
        entryPoint: 'fs_main',
        targets:    [{ format: this.presentationFormat }],
      },
      primitive: { topology: 'triangle-strip' },
    });

    this.buildBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'storage' } },
      ],
    });
  }

  _createResources() {
    const maxNodes   = this.width * this.height * this._maxNodesPerPixel;
    const pixelCount = this.width * this.height;

    this.headIndexBuffer = this.device.createBuffer({
      size:  pixelCount * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.nodeBuffer = this.device.createBuffer({
      size:  maxNodes * 16,
      usage: GPUBufferUsage.STORAGE,
    });
    this.counterBuffer = this.device.createBuffer({
      size:  4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    
    
    
    this.pixelCountBuffer = this.device.createBuffer({
      size:  pixelCount * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.oitUniforms = this.device.createBuffer({
      size:  16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    this.device.queue.writeBuffer(
      this.oitUniforms, 0,
      new Uint32Array([this.width, maxNodes, this._maxNodesPerPixel, 0])
    );
  }

  _createBindGroups() {
    this.clearBindGroup = this.device.createBindGroup({
      layout: this.clearPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.headIndexBuffer } },
        { binding: 1, resource: { buffer: this.counterBuffer } },
        { binding: 2, resource: { buffer: this.pixelCountBuffer } },
        { binding: 3, resource: { buffer: this.oitUniforms } },   
      ],
    });

    this.buildBindGroup = this.device.createBindGroup({
      layout: this.buildBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.oitUniforms } },
        { binding: 1, resource: { buffer: this.headIndexBuffer } },
        { binding: 2, resource: { buffer: this.nodeBuffer } },
        { binding: 3, resource: { buffer: this.counterBuffer } },
        { binding: 4, resource: { buffer: this.pixelCountBuffer } },
      ],
    });
  }

  dispose() {
    for (const buf of [
      this.headIndexBuffer, this.nodeBuffer, this.counterBuffer,
      this.pixelCountBuffer, this.oitUniforms,
    ]) { if (buf) buf.destroy(); }
  }

  resize(width, height) {
    if (this.width === width && this.height === height) return;
    this.width  = width;
    this.height = height;
    for (const buf of [this.headIndexBuffer, this.nodeBuffer, this.counterBuffer, this.pixelCountBuffer, this.oitUniforms]) {
      if (buf) buf.destroy();
    }
    this._createResources();
    this._createBindGroups();
  }

  clear(commandEncoder) {
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.clearPipeline);
    pass.setBindGroup(0, this.clearBindGroup);
    
    
    pass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
    pass.end();
  }

  resolve(commandEncoder, opaqueTextureView, targetTextureView) {
    const resolveBindGroup = this.device.createBindGroup({
      layout: this.resolvePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: opaqueTextureView },
        { binding: 1, resource: { buffer: this.oitUniforms } },
        { binding: 2, resource: { buffer: this.headIndexBuffer } },
        { binding: 3, resource: { buffer: this.nodeBuffer } },
      ],
    });

    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: targetTextureView,
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.resolvePipeline);
    pass.setBindGroup(0, resolveBindGroup);
    pass.draw(4);
    pass.end();
  }
}