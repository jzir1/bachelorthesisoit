function fract(x)  { return x - Math.floor(x); }
function rand01(s) { return fract(Math.sin(s * 127.1 + 311.7) * 43758.5453123); }

export function makeSphereScene(level, opts = {}) {
  const presets = {
    low:  { nx: 5, ny: 1, nz: 2, count: 10,  radius: 0.12,   alpha: 0.34 },
    mid:  { nx: 5, ny: 2, nz: 3, count: 30,  radius: 0.1067, alpha: 0.30 },
    high: { nx: 5, ny: 4, nz: 5, count: 100, radius: 0.0933, alpha: 0.28 },
  };
  const P = presets[level] ?? presets.mid;
  const baseAlpha = typeof opts.alpha === 'number' ? opts.alpha : P.alpha;

  const dx = 2 * P.radius * 0.78;
  const dy = 2 * P.radius * 0.76;
  const dz = 2 * P.radius * 0.74;
  const jitter = 0.06 * P.radius;

  const x0 = -0.5 * (P.nx - 1) * dx;
  const y0 = -0.5 * (P.ny - 1) * dy;
  const z0 = -0.5 * (P.nz - 1) * dz;

  const instances = [];
  let i = 0;
  for (let kz = 0; kz < P.nz; kz++) {
    for (let ky = 0; ky < P.ny; ky++) {
      for (let kx = 0; kx < P.nx; kx++) {
        if (i >= P.count) break;
        const seed = 1 + i*17.3 + kx*3.1 + ky*11.7 + kz*29.9;
        const x = x0 + kx*dx + (rand01(seed+1) - 0.5) * jitter;
        const y = y0 + ky*dy + (rand01(seed+2) - 0.5) * jitter;
        const z = z0 + kz*dz + (rand01(seed+3) - 0.5) * jitter;
        const a = Math.max(0.05, Math.min(0.95, baseAlpha + 0.10 * (rand01(seed+4) - 0.5)));
        instances.push({ pos: [x, y, z], color: [0.56, 0.93, 0.57, a] });
        i++;
      }
    }
  }

  return {
    id: level,
    radius: P.radius,
    alpha: baseAlpha,
    instances,
    suggestedCamRadius: 8.0 + 2.5 * (level === 'high'),
  };
}
