const SUB_BENCHMARKS = [
  { key:'1', scale:0.5, type:'quality',               label:'0.5x Quality'                              },
  { key:'2', scale:0.5, type:'speed_main',             label:'0.5x Speed - Main Scenes'                  },
  { key:'3', scale:0.5, type:'speed_cubes',            label:'0.5x Speed - Cubes'                        },
  { key:'4', scale:1.0, type:'quality',               label:'1.0x Quality'                              },
  { key:'5', scale:1.0, type:'speed_main',             label:'1.0x Speed - Main Scenes'                  },
  { key:'6', scale:1.0, type:'speed_cubes',            label:'1.0x Speed - Cubes'                        },
  { key:'7', scale:1.5, type:'quality',               label:'1.5x Quality'                              },
  { key:'8', scale:1.5, type:'speed_main',             label:'1.5x Speed - Main Scenes'                  },
  { key:'9', scale:1.5, type:'speed_cubes',            label:'1.5x Speed - Cubes'                        },
  { key:'J', scale:1.0, type:'quality_layer_cap_dp',   label:'dp_oq layer cap — diminishing returns'     },
  { key:'K', scale:1.5, type:'quality_single',         label:'Quality – webgpu_ll vs dp_oq'              },
  { key:'L', scale:1.0, type:'quality_layer_cap_dual', label:'dual dp_oq viability vs dp_oq reference'   },
];

const BENCH_SCENES_MAIN = [
  'spheres_mid', 'spheres_high', 'bunnies',
  'Egyptian_Temple_1', 'Egyptian_Temple_2', 'Gas_Engine',
  'Gearbox', 'Hydrant', 'Chapel', 'Suspension', 'Parthenon',
];
const BENCH_SCENES_CUBES = ['cubes_25', 'cubes_50', 'cubes_75', 'cubes_100'];
const BENCH_METHODS      = ['dp_oq', 'dual_dp_oq', 'stochastic', 'weighted', 'webgpu_ll'];
const BENCH_REF_METHOD   = 'dp_oq';


const J_VARIANTS = [
  { id: 'dp_oq_unlimited', method: 'dp_oq', layerDesc: 'OQ-unlimited (reference)', isRef: true },
  { id: 'dp_oq_4layers',   method: 'dp_oq', layerDesc: '4 layers',  maxLayers: 4 },
  { id: 'dp_oq_8layers',   method: 'dp_oq', layerDesc: '8 layers',  maxLayers: 8 },
];


const L_VARIANTS = [
  { id: 'dp_oq_unlimited', method: 'dp_oq',     layerDesc: 'dp_oq OQ-unlimited (reference)', isRef: true },
  { id: 'dual_4layers',    method: 'dual_dp_oq', layerDesc: 'dual 2 pairs = 4 layers',  maxPairs: 2, totalLayers: 4  },
  { id: 'dual_8layers',    method: 'dual_dp_oq', layerDesc: 'dual 4 pairs = 8 layers',  maxPairs: 4, totalLayers: 8  },
  { id: 'dual_12layers',   method: 'dual_dp_oq', layerDesc: 'dual 6 pairs = 12 layers', maxPairs: 6, totalLayers: 12 },
];

const QUAL_WARMUP_DEFAULT    = 120;
const QUAL_WARMUP_STOCHASTIC = 280;
const STOCHASTIC_AVG_FRAMES  = 32;   
const SPEED_WARMUP  = 60;
const SPEED_MEASURE = 180;
const SPEED_DRAIN   = 8;


let _ctx = null;
const canvas        = ()  => _ctx.getCanvas();
const gpuSamples    = ()  => _ctx.getRawGpuSamples();
const setGpuSamples = v   => _ctx.setRawGpuSamples(v);
const setScale      = v   => _ctx.setRenderScale(v);
const isBusy        = ()  => _ctx.isBusy();
const setBusy       = v   => _ctx.setBusy(v);
const switchMethod  = ()  => _ctx.switchMethod();
const getRenderer   = ()  => _ctx.getRenderer?.();
const sceneSelect   = ()  => document.getElementById('scene-select');
const methodSelect  = ()  => document.getElementById('method-select');


const delay      = ms => new Promise(res => setTimeout(res, ms));
const waitFrames = n  => new Promise(resolve => {
  let c = 0; const t = () => (++c >= n) ? resolve() : requestAnimationFrame(t);
  requestAnimationFrame(t);
});


async function waitForReady(maxFrames = 300) {
  const r = getRenderer();
  if (!r || typeof r.isReady === 'undefined') return;
  for (let i = 0; i < maxFrames; i++) {
    if (r.isReady) return;
    await waitFrames(1);
  }
}

function readRefLayers() {
  const r = getRenderer();
  if (!r) return null;
  const n = r._oqActualLayers;
  return (typeof n === 'number' && n > 0) ? n : null;
}

function sampleStats(s) {
  const n = s.length;
  if (!n) return { mean: NaN, stddev: NaN, min: NaN, max: NaN, n: 0 };
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const v    = n > 1 ? s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  return { mean, stddev: Math.sqrt(v), min: Math.min(...s), max: Math.max(...s), n };
}

function _blob(name, mime, content) {
  const a = document.createElement('a');
  a.href     = 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(content);
  a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
const dlJSON = (name, data) => _blob(name, 'application/json', JSON.stringify(data, null, 2));
function dlCSV(data) {
  const hdr = 'Scene,Method,Mean_ms,Stddev_ms,Min_ms,Max_ms,Samples\n';
  const rows = data.map(r => `${r.scene},${r.method},${r.meanMs},${r.stddevMs},${r.minMs},${r.maxMs},${r.samples}`).join('\n');
  _blob('oit_benchmark_results.csv', 'text/csv', hdr + rows);
}

function capturePixels(src) {
  const tmp = document.createElement('canvas');
  tmp.width = src.width; tmp.height = src.height;
  const c = tmp.getContext('2d', { willReadFrequently: true });
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, tmp.width, tmp.height);
  c.drawImage(src, 0, 0);
  return c.getImageData(0, 0, tmp.width, tmp.height).data;
}

async function captureAveraged(src, frames) {
  const w = src.width, h = src.height;
  const acc = new Float32Array(w * h * 4);
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const c = tmp.getContext('2d', { willReadFrequently: true });
  for (let f = 0; f < frames; f++) {
    await waitFrames(1);
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    c.drawImage(src, 0, 0);
    const px = c.getImageData(0, 0, w, h).data;
    for (let i = 0; i < px.length; i++) acc[i] += px[i];
  }
  const result = new Uint8ClampedArray(acc.length);
  for (let i = 0; i < acc.length; i++) result[i] = Math.round(acc[i] / frames);
  return result;
}

function calcMSE_PSNR(ref, test) {
  if (ref.length !== test.length) return { mse: -1, psnr: -1 };
  let sq = 0, count = 0;
  for (let i = 0; i < ref.length; i += 4) {
    if (ref[i]  === 255 && ref[i+1]  === 255 && ref[i+2]  === 255 &&
        test[i] === 255 && test[i+1] === 255 && test[i+2] === 255) continue;
    const r = ref[i]-test[i], g = ref[i+1]-test[i+1], b = ref[i+2]-test[i+2];
    sq += r*r + g*g + b*b;
    count++;
  }
  if (count === 0) return { mse: 0, psnr: Infinity };
  const mse = sq / (count * 3);
  return { mse, psnr: mse === 0 ? Infinity : 10 * Math.log10(65025 / mse) };
}

function calcSSIM(ref, test, width) {
  if (ref.length !== test.length) return -1;
  const C1 = 6.5025, C2 = 58.5225;   
  const W  = 8;
  const height = (ref.length / 4) / width;
  let ssimSum = 0, count = 0;
  for (let y = 0; y <= height - W; y += W) {
    for (let x = 0; x <= width - W; x += W) {
      let sumR = 0, sumT = 0, sumR2 = 0, sumT2 = 0, sumRT = 0;
      for (let dy = 0; dy < W; dy++) {
        for (let dx = 0; dx < W; dx++) {
          const i = ((y + dy) * width + (x + dx)) * 4;
          const r = 0.299 * ref[i]  + 0.587 * ref[i+1]  + 0.114 * ref[i+2];
          const t = 0.299 * test[i] + 0.587 * test[i+1] + 0.114 * test[i+2];
          sumR += r; sumT += t; sumR2 += r*r; sumT2 += t*t; sumRT += r*t;
        }
      }
      const n   = W * W;
      const muR = sumR / n, muT = sumT / n;
      const sR2 = sumR2 / n - muR * muR;
      const sT2 = sumT2 / n - muT * muT;
      const sRT = sumRT / n - muR * muT;
      const num = (2 * muR * muT + C1) * (2 * sRT + C2);
      const den = (muR * muR + muT * muT + C1) * (sR2 + sT2 + C2);
      ssimSum += num / den;
      count++;
    }
  }
  return count > 0 ? ssimSum / count : 1;
}

function calcMetrics(ref, test, width) {
  const { mse, psnr } = calcMSE_PSNR(ref, test);
  const ssim = calcSSIM(ref, test, width);
  return { mse, psnr, ssim };
}

async function captureForMethod(method) {
  return method === 'stochastic'
    ? await captureAveraged(canvas(), STOCHASTIC_AVG_FRAMES)
    : capturePixels(canvas());
}

let _prog = null;

function showOverlay(total, title) {
  if (_prog) return;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.88);color:#fff;font-family:monospace;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;gap:16px;user-select:none';
  el.innerHTML = `
    <div style="font-size:20px;font-weight:bold">&#9201; ${title}</div>
    <div id="b-step" style="font-size:13px;color:#aaa">Initialising...</div>
    <div style="width:480px;background:#333;border-radius:6px;overflow:hidden;height:10px">
      <div id="b-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#0af,#06f);transition:width .3s"></div>
    </div>
    <div id="b-pct" style="font-size:12px;color:#aaa">0 / ${total}</div>
    <div id="b-eta" style="font-size:12px;color:#777">Estimating time...</div>
    <div style="font-size:10px;color:#444;margin-top:4px">Keep tab in foreground - RAF pauses when hidden</div>`;
  document.body.appendChild(el);
  _prog = el; _prog._t0 = Date.now(); _prog._tot = total;
}

function updOverlay(step, label) {
  if (!_prog) return;
  const pct = step / _prog._tot;
  document.getElementById('b-bar').style.width = (pct * 100).toFixed(1) + '%';
  document.getElementById('b-step').textContent = label;
  document.getElementById('b-pct').textContent  = step + ' / ' + _prog._tot;
  if (step > 0) {
    const el = (Date.now() - _prog._t0) / 1000;
    const et = Math.round(el / pct * (1 - pct));
    document.getElementById('b-eta').textContent =
      'Elapsed ' + Math.round(el) + 's  ETA ~' + Math.floor(et/60) + 'm ' + (et%60) + 's';
  }
}

function hideOverlay() { if (_prog) { _prog.remove(); _prog = null; } }

let _km = null;
function showKeymap() {
  if (_km) return;
  const rows = SUB_BENCHMARKS.map(b =>
    '<tr><td style="padding:2px 10px;color:#0df;font-weight:bold">' + b.key +
    '</td><td style="padding:2px 10px">' + b.label + '</td></tr>').join('');
  _km = document.createElement('div');
  _km.innerHTML = '<div style="position:fixed;bottom:12px;right:12px;background:rgba(0,0,0,.88);color:#ccc;font-family:monospace;font-size:11px;border-radius:8px;padding:12px 16px;z-index:999;line-height:1.5;min-width:280px">' +
    '<div style="color:#fff;font-weight:bold;margin-bottom:6px">&#9000; Benchmark keys</div>' +
    '<table style="border-collapse:collapse">' + rows + '</table>' +
    '<div style="margin-top:8px;color:#888;font-size:10px">g=quick speed &middot; G=quick quality &middot; P=screenshot &middot; ?=toggle</div>' +
    '<div style="margin-top:4px;color:#555;font-size:10px">&#9888; Reload page between sub-benchmarks to prevent context loss</div></div>';
  document.body.appendChild(_km);
}
function toggleKeymap() { if (_km) { _km.remove(); _km = null; } else showKeymap(); }

async function runSubBenchmark(sub) {
  setBusy(true);
  const { scale, type, label, key } = sub;

  
  if (type === 'quality_layer_cap_dp')   { await runLayerCapBenchmark(sub, J_VARIANTS); return; }
  if (type === 'quality_layer_cap_dual') { await runLayerCapBenchmark(sub, L_VARIANTS); return; }
  if (type === 'quality_single')         { await runQualitySingle(sub); return; }

  
  const scenes      = type === 'speed_cubes' ? BENCH_SCENES_CUBES : BENCH_SCENES_MAIN;
  const testMethods = BENCH_METHODS.filter(m => m !== BENCH_REF_METHOD);
  const totalSteps  = scenes.length * BENCH_METHODS.length;
  const W = Math.floor(window.innerWidth  * scale);
  const H = Math.floor(window.innerHeight * scale);
  setScale(scale);

  showOverlay(totalSteps, 'Sub-benchmark ' + key + ': ' + label);
  console.log('\n[bench:' + key + '] == ' + label + '  (' + W + 'x' + H + ' px) ==');

  const ts  = new Date().toISOString();
  const out = {
    subKey: key, type, label, scale, widthPx: W, heightPx: H,
    timestamp: ts, userAgent: navigator.userAgent,
    refMethod: BENCH_REF_METHOD,
    mainScenes: BENCH_SCENES_MAIN, cubeScenes: BENCH_SCENES_CUBES, methods: BENCH_METHODS,
    performance: [], quality: [],
  };
  let step = 0;

  if (type === 'quality') {
    
    for (const scene of scenes) {
      let ref = null;
      step++;
      const rl = scene + ' . ' + BENCH_REF_METHOD + ' (ref)';
      updOverlay(step, rl);
      console.log('[bench:' + key + '] [' + step + '/' + totalSteps + '] ' + rl);
      sceneSelect().value = scene; methodSelect().value = BENCH_REF_METHOD;
      try { await switchMethod(); } catch (e) {
        console.warn('[bench:' + key + '] ERR ref:', e.message);
        for (let i = 0; i < testMethods.length; i++) step++;
        continue;
      }
      await delay(300); await waitFrames(QUAL_WARMUP_DEFAULT); await waitForReady();
      ref = capturePixels(canvas());
      const refLayers = readRefLayers();
      out.quality.push({ scene, method: BENCH_REF_METHOD, mse: 0, psnr_dB: null, ssim: null, ref_layers: refLayers, note: 'reference' });

      for (const method of testMethods) {
        step++;
        const ml = scene + ' . ' + method;
        updOverlay(step, ml);
        console.log('[bench:' + key + '] [' + step + '/' + totalSteps + '] ' + ml);
        methodSelect().value = method;
        try { await switchMethod(); } catch (e) {
          console.warn('[bench:' + key + '] ERR ' + method + ':', e.message);
          out.quality.push({ scene, method, mse: null, psnr_dB: null, ssim: null, ref_layers: refLayers, note: 'ERR' });
          continue;
        }
        await delay(300);
        await waitFrames(method === 'stochastic' ? QUAL_WARMUP_STOCHASTIC : QUAL_WARMUP_DEFAULT);
        if (ref) {
          const pixels = await captureForMethod(method);
          const { mse, psnr, ssim } = calcMetrics(ref, pixels, canvas().width);
          const pv = isFinite(psnr) ? parseFloat(psnr.toFixed(2)) : null;
          const sv = parseFloat(ssim.toFixed(4));
          console.log('[bench:' + key + ']   MSE=' + mse.toFixed(4) +
            '  PSNR=' + (isFinite(psnr) ? psnr.toFixed(2) + 'dB' : 'inf') +
            '  SSIM=' + sv);
          out.quality.push({ scene, method,
            mse: parseFloat(mse.toFixed(4)), psnr_dB: pv, ssim: sv, ref_layers: refLayers });
        }
      }
    }
  } else {
    
    for (const scene of scenes) {
      for (const method of BENCH_METHODS) {
        step++;
        const sl = scene + ' . ' + method;
        updOverlay(step, sl);
        console.log('[bench:' + key + '] [' + step + '/' + totalSteps + '] ' + sl);
        sceneSelect().value = scene; methodSelect().value = method;
        try { await switchMethod(); } catch (e) {
          console.warn('[bench:' + key + '] ERR ' + method + ':', e.message);
          out.performance.push({ scene, method, meanMs:'ERR', stddevMs:'ERR', minMs:'ERR', maxMs:'ERR', samples:0 });
          continue;
        }
        await delay(300); await waitFrames(SPEED_WARMUP);
        setGpuSamples([]);
        await waitFrames(SPEED_MEASURE); await waitFrames(SPEED_DRAIN);
        const samples = [...gpuSamples()]; setGpuSamples(null);
        const st = sampleStats(samples);
        if (!st.n) {
          console.warn('[bench:' + key + ']   no GPU samples');
          out.performance.push({ scene, method, meanMs:'N/A', stddevMs:'N/A', minMs:'N/A', maxMs:'N/A', samples:0 });
        } else {
          console.log('[bench:' + key + ']   mean=' + st.mean.toFixed(3) + 'ms  s=' + st.stddev.toFixed(3) + '  n=' + st.n);
          out.performance.push({ scene, method,
            meanMs: st.mean.toFixed(3), stddevMs: st.stddev.toFixed(3),
            minMs:  st.min.toFixed(3),  maxMs:    st.max.toFixed(3), samples: st.n });
        }
      }
    }
  }

  hideOverlay();
  const fname = 'oit_bench_' + key + '_' + type + '_' + ts.replace(/[:.]/g,'-').slice(0,-5) + '.json';
  dlJSON(fname, out);
  console.log('\n[bench:' + key + '] == DONE - ' + fname + ' ==');
  if (type === 'quality') console.table(out.quality); else console.table(out.performance);
  setBusy(false);
}

async function runLayerCapBenchmark(sub, variants) {
  const { scale, type, label, key } = sub;
  const scenes       = BENCH_SCENES_MAIN;
  const testVariants = variants.filter(v => !v.isRef);
  const refVariant   = variants.find(v => v.isRef);
  const totalSteps   = scenes.length * variants.length;
  const W = Math.floor(window.innerWidth  * scale);
  const H = Math.floor(window.innerHeight * scale);
  setScale(scale);

  showOverlay(totalSteps, 'Sub-benchmark ' + key + ': ' + label);
  console.log('\n[bench:' + key + '] == ' + label + '  (' + W + 'x' + H + ' px) ==');

  const ts  = new Date().toISOString();
  const out = {
    subKey: key, type, label, scale, widthPx: W, heightPx: H,
    timestamp: ts, userAgent: navigator.userAgent,
    refMethod: BENCH_REF_METHOD,
    mainScenes: BENCH_SCENES_MAIN, cubeScenes: BENCH_SCENES_CUBES,
    variants, performance: [], quality: [],
  };
  let step = 0;

  for (const scene of scenes) {
    let ref = null;
    let refLayers = null;
    sceneSelect().value = scene;

    
    for (const variant of variants) {
      step++;
      const vl = scene + ' . ' + variant.id + (variant.isRef ? ' (ref)' : '');
      updOverlay(step, vl);
      console.log('[bench:' + key + '] [' + step + '/' + totalSteps + '] ' + vl);
      
      
      
      methodSelect().value = 'stochastic'; 
      try { await switchMethod(); } catch(e) {}
      
      
      methodSelect().value = variant.method;
      try { await switchMethod(); } catch (e) {
        console.warn('[bench:' + key + '] ERR ' + variant.id + ':', e.message);
        if (variant.isRef) { step += testVariants.length; break; } 
        out.quality.push({ scene, method: variant.id, mse: null, psnr_dB: null, ssim: null, ref_layers: refLayers, note: 'ERR' });
        continue;
      }

      
      const r = getRenderer();
      if (r && typeof r.render === 'function') {
        const origRender = r.render;
        const limit = variant.maxLayers !== undefined ? variant.maxLayers : (variant.maxPairs !== undefined ? variant.maxPairs : 64);
        const isRef = !!variant.isRef;
        
        
        r.render = function(...args) {
          this._oqEnabled = isRef;
          this._maxPeelLayers = limit;
          this._oqLayerLimit = limit;
          this._oqPairLimit = limit;
          return origRender.apply(this, args);
        };
      }

      await delay(300);
      await waitFrames(QUAL_WARMUP_DEFAULT);
      
      if (variant.isRef) {
        await waitForReady();
        ref = capturePixels(canvas());
        refLayers = readRefLayers();
        out.quality.push({ scene, method: variant.id, mse: 0, psnr_dB: null, ssim: null, ref_layers: refLayers, note: 'reference' });
      } else {
        if (ref) {
          const pixels = capturePixels(canvas());
          const { mse, psnr, ssim } = calcMetrics(ref, pixels, canvas().width);
          const pv = isFinite(psnr) ? parseFloat(psnr.toFixed(2)) : null;
          const sv = parseFloat(ssim.toFixed(4));
          console.log('[bench:' + key + ']   ' + variant.id +
            '  MSE=' + mse.toFixed(4) +
            '  PSNR=' + (isFinite(psnr) ? psnr.toFixed(2) + 'dB' : 'inf') +
            '  SSIM=' + sv);
          out.quality.push({ scene, method: variant.id,
            mse: parseFloat(mse.toFixed(4)), psnr_dB: pv, ssim: sv, ref_layers: refLayers });
        }
      }
    }
  }

  hideOverlay();
  const fname = 'oit_bench_' + key + '_quality_layer_cap_' + ts.replace(/[:.]/g,'-').slice(0,-5) + '.json';
  dlJSON(fname, out);
  console.log('\n[bench:' + key + '] == DONE - ' + fname + ' ==');
  console.table(out.quality);
  setBusy(false);
}

async function runQualitySingle(sub) {
  const { scale, label, key } = sub;
  const scenes     = BENCH_SCENES_MAIN;
  const testMethod = 'webgpu_ll';
  const totalSteps = scenes.length * 2;
  const W = Math.floor(window.innerWidth  * scale);
  const H = Math.floor(window.innerHeight * scale);
  setScale(scale);

  showOverlay(totalSteps, 'Sub-benchmark ' + key + ': ' + label);
  console.log('\n[bench:' + key + '] == ' + label + '  (' + W + 'x' + H + ' px) ==');

  const ts  = new Date().toISOString();
  const out = {
    subKey: key, type: 'quality_single', label, scale, widthPx: W, heightPx: H,
    timestamp: ts, userAgent: navigator.userAgent,
    refMethod: BENCH_REF_METHOD,
    mainScenes: BENCH_SCENES_MAIN, cubeScenes: BENCH_SCENES_CUBES,
    methods: [BENCH_REF_METHOD, testMethod],
    performance: [], quality: [],
  };
  let step = 0;

  for (const scene of scenes) {
    let ref = null;
    step++;
    updOverlay(step, scene + ' . ' + BENCH_REF_METHOD + ' (ref)');
    console.log('[bench:' + key + '] [' + step + '/' + totalSteps + '] ' + scene + ' . ref');
    sceneSelect().value = scene; methodSelect().value = BENCH_REF_METHOD;
    try { await switchMethod(); } catch (e) {
      console.warn('[bench:' + key + '] ERR ref:', e.message); step++; continue;
    }
    await delay(300); await waitFrames(QUAL_WARMUP_DEFAULT); await waitForReady();
    ref = capturePixels(canvas());
    const refLayers = readRefLayers();
    out.quality.push({ scene, method: BENCH_REF_METHOD, mse: 0, psnr_dB: null, ssim: null, ref_layers: refLayers, note: 'reference' });

    step++;
    updOverlay(step, scene + ' . ' + testMethod);
    console.log('[bench:' + key + '] [' + step + '/' + totalSteps + '] ' + scene + ' . ' + testMethod);
    methodSelect().value = testMethod;
    try { await switchMethod(); } catch (e) {
      console.warn('[bench:' + key + '] ERR webgpu_ll:', e.message);
      out.quality.push({ scene, method: testMethod, mse: null, psnr_dB: null, ssim: null, ref_layers: refLayers, note: 'ERR' });
      continue;
    }
    await delay(300); await waitFrames(QUAL_WARMUP_DEFAULT);
    if (ref) {
      const pixels = capturePixels(canvas());
      const { mse, psnr, ssim } = calcMetrics(ref, pixels, canvas().width);
      const pv = isFinite(psnr) ? parseFloat(psnr.toFixed(2)) : null;
      const sv = parseFloat(ssim.toFixed(4));
      console.log('[bench:' + key + ']   MSE=' + mse.toFixed(4) +
        '  PSNR=' + (isFinite(psnr) ? psnr.toFixed(2) + 'dB' : 'inf') +
        '  SSIM=' + sv);
      out.quality.push({ scene, method: testMethod,
        mse: parseFloat(mse.toFixed(4)), psnr_dB: pv, ssim: sv, ref_layers: refLayers });
    }
  }

  hideOverlay();
  const fname = 'oit_bench_' + key + '_quality_single_' + ts.replace(/[:.]/g,'-').slice(0,-5) + '.json';
  dlJSON(fname, out);
  console.log('\n[bench:' + key + '] == DONE - ' + fname + ' ==');
  console.table(out.quality);
  setBusy(false);
}

async function runBenchmark() {
  setBusy(true);
  console.log('[benchmark] Quick speed benchmark');
  const results = []; const total = BENCH_SCENES_MAIN.length * BENCH_METHODS.length; let step = 0;
  for (const scene of BENCH_SCENES_MAIN) {
    sceneSelect().value = scene;
    for (const method of BENCH_METHODS) {
      step++;
      console.log('[benchmark] [' + step + '/' + total + '] ' + method + ' . ' + scene);
      methodSelect().value = method;
      try { await switchMethod(); } catch (e) {
        results.push({ scene, method, meanMs:'ERR', stddevMs:'ERR', minMs:'ERR', maxMs:'ERR', samples:0 }); continue;
      }
      await delay(300); await waitFrames(SPEED_WARMUP);
      setGpuSamples([]);
      await waitFrames(SPEED_MEASURE); await waitFrames(SPEED_DRAIN);
      const s = [...gpuSamples()]; setGpuSamples(null);
      if (!s.length) { results.push({ scene, method, meanMs:'N/A', stddevMs:'N/A', minMs:'N/A', maxMs:'N/A', samples:0 }); continue; }
      const { mean, stddev, min, max, n } = sampleStats(s);
      console.log('[benchmark]   mean=' + mean.toFixed(3) + 'ms  n=' + n);
      results.push({ scene, method, meanMs: mean.toFixed(3), stddevMs: stddev.toFixed(3), minMs: min.toFixed(3), maxMs: max.toFixed(3), samples: n });
    }
  }
  console.table(results); dlCSV(results); setBusy(false);
}

async function runQualityBenchmark() {
  setBusy(true);
  console.log('[quality] Quick quality benchmark');
  const test = BENCH_METHODS.filter(m => m !== BENCH_REF_METHOD);
  const results = []; const total = BENCH_SCENES_MAIN.length * (test.length + 1); let step = 0;
  for (const scene of BENCH_SCENES_MAIN) {
    sceneSelect().value = scene; methodSelect().value = BENCH_REF_METHOD; step++;
    console.log('[quality] [' + step + '/' + total + '] ref . ' + scene);
    try { await switchMethod(); } catch (e) { for (let i = 0; i < test.length; i++) step++; continue; }
    await delay(300); await waitFrames(QUAL_WARMUP_DEFAULT); await waitForReady();
    const ref = capturePixels(canvas());
    const refLayers = readRefLayers();
    for (const method of test) {
      step++;
      console.log('[quality] [' + step + '/' + total + '] ' + method + ' . ' + scene);
      methodSelect().value = method;
      try { await switchMethod(); } catch (e) { results.push({ scene, method, MSE:'ERR', PSNR_dB:'ERR', SSIM:'ERR', ref_layers: refLayers }); continue; }
      await delay(300);
      await waitFrames(method === 'stochastic' ? QUAL_WARMUP_STOCHASTIC : QUAL_WARMUP_DEFAULT);
      const pixels = await captureForMethod(method);
      const { mse, psnr, ssim } = calcMetrics(ref, pixels, canvas().width);
      console.log('[quality]   MSE:' + mse.toFixed(4) +
        '  PSNR:' + (isFinite(psnr) ? psnr.toFixed(2) + 'dB' : 'inf') +
        '  SSIM:' + ssim.toFixed(4));
      results.push({ scene, method,
        MSE: mse.toFixed(4),
        PSNR_dB: psnr === Infinity ? 'Infinity' : psnr.toFixed(2),
        SSIM: ssim.toFixed(4),
        ref_layers: refLayers });
    }
    results.push({ scene, method: BENCH_REF_METHOD, MSE:'0.0000', PSNR_dB:'Infinity (Reference)', SSIM:'1.0000', ref_layers: refLayers });
  }
  console.table(results); console.log('[quality] done'); setBusy(false);
}

export function initBenchmark(ctx) {
  _ctx = ctx;
  window.addEventListener('keydown', (e) => {
    if (e.key === '?' || e.key === '/') { toggleKeymap(); return; }
    if (isBusy()) return;
    const sub = SUB_BENCHMARKS.find(b => b.key === e.key);
    if (sub)        { runSubBenchmark(sub).catch(console.error); return; }
    if (e.key === 'G') runQualityBenchmark().catch(console.error);
    if (e.key === 'g') runBenchmark().catch(console.error);
  });
  window.addEventListener('load', () => setTimeout(showKeymap, 600));
}