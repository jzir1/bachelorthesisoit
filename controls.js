import { vec3, vec3Add, mat4 } from './math.js';

export class OrbitControls {
  constructor(canvas) {
    this.target      = vec3(0, 0, 0);
    this.radius      = 10.0;
    this.azimuth     = 0.9;
    this.polar       = 0.85;
    this.minRadius   = 2.0;
    this.maxRadius   = 80.0;
    this.rotateSpeed = 0.005;
    this.zoomSpeed   = 0.0012;

    this._drag  = false;
    this._lastX = 0;
    this._lastY = 0;
    this._viewMatrix = mat4();

    this.attach(canvas);
  }

  attach(canvas) {
    this.canvas = canvas;
    this._onMouseDown = (e) => {
      if (e.button !== 0) return;
      this._drag  = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    };
    this._onMouseUp   = () => { this._drag = false; };
    this._onMouseMove = (e) => {
      if (!this._drag) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this.azimuth -= dx * this.rotateSpeed;
      this.polar   -= dy * this.rotateSpeed;
      const eps = 0.02;
      this.polar = Math.max(eps, Math.min(Math.PI - eps, this.polar));
    };
    this._onWheel = (e) => {
      e.preventDefault();
      this.radius *= (1.0 + e.deltaY * this.zoomSpeed);
      this.radius = Math.max(this.minRadius, Math.min(this.maxRadius, this.radius));
    };

    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup',   this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('wheel',     this._onWheel, { passive: false });
  }

  detach() {
    if (!this.canvas) return;
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup',   this._onMouseUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas = null;
  }

  getEye() {
    const sp = Math.sin(this.polar),  cp = Math.cos(this.polar);
    const sa = Math.sin(this.azimuth), ca = Math.cos(this.azimuth);
    return vec3Add(this.target, vec3(
      this.radius * sp * ca,
      this.radius * cp,
      this.radius * sp * sa,
    ));
  }

  getViewMatrix() {
    const eye = this.getEye();
    const up  = vec3(0, 1, 0);

    let z0 = eye[0] - this.target[0], z1 = eye[1] - this.target[1], z2 = eye[2] - this.target[2];
    let len = 1 / Math.hypot(z0, z1, z2);
    z0 *= len; z1 *= len; z2 *= len;

    let x0 = up[1]*z2 - up[2]*z1, x1 = up[2]*z0 - up[0]*z2, x2 = up[0]*z1 - up[1]*z0;
    len = Math.hypot(x0, x1, x2);
    if (len) { len = 1 / len; x0 *= len; x1 *= len; x2 *= len; }

    const y0 = z1*x2 - z2*x1, y1 = z2*x0 - z0*x2, y2 = z0*x1 - z1*x0;

    this._viewMatrix.set([
      x0, y0, z0, 0,
      x1, y1, z1, 0,
      x2, y2, z2, 0,
      -(x0*eye[0] + x1*eye[1] + x2*eye[2]),
      -(y0*eye[0] + y1*eye[1] + y2*eye[2]),
      -(z0*eye[0] + z1*eye[1] + z2*eye[2]),
      1,
    ]);
    return this._viewMatrix;
  }
}
