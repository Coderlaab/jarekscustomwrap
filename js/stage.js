// ---------------------------------------------------------------------------
//  WebGL2 stage.
//
//  Three passes per frame:
//    1. G-buffer      — rasterise the vehicle from the cinematic camera
//    2. reflection    — rasterise it again from a camera mirrored in the floor
//    3. composite     — the original full-screen shader, now reading those
//                       buffers where it used to march a distance field
//
//  Only pass 3 does any shading, and it is the same code as the SDF build.
// ---------------------------------------------------------------------------
import { VERT, FRAG, GBUF_VERT, GBUF_FRAG } from './shader.js';
import { CarMesh } from './carmesh.js';
import { camAt, viewProj, framingBias } from './camera.js';

export class Stage {
  constructor(canvas){
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false
    });
    this.ok = !!this.gl;
    if(!this.ok) return;

    const gl = this.gl;
    this.hasFloat = !!gl.getExtension('EXT_color_buffer_float');
    if(!this.hasFloat){ this.ok = false; console.error('[stage] EXT_color_buffer_float missing'); return; }
    gl.getExtension('OES_texture_float_linear');

    this.scale = 0.78;
    this.frameTimes = [];
    this.still = false;      // the closing frame is held, so it can afford more

    this._build();
    this.resize();

    this.car = new CarMesh(gl);
    this.car.load().then(() => { this.carReady = true; })
                   .catch(e => console.error('[stage] mesh load failed', e));
  }

  _compile(type, src, label){
    const gl = this.gl, s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
      console.error(`[stage] ${label} shader error\n` + gl.getShaderInfoLog(s));
      this.ok = false;
    }
    return s;
  }

  _link(vs, fs, label, attribs){
    const gl = this.gl, p = gl.createProgram();
    gl.attachShader(p, this._compile(gl.VERTEX_SHADER, vs, label));
    gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fs, label));
    if(attribs) attribs.forEach((n, i) => gl.bindAttribLocation(p, i, n));
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)){
      console.error(`[stage] ${label} link error\n` + gl.getProgramInfoLog(p));
      this.ok = false;
    }
    return p;
  }

  _build(){
    const gl = this.gl;

    this.gProg = this._link(GBUF_VERT, GBUF_FRAG, 'gbuffer', ['aPos','aNrm','aMat']);
    this.gU = { uViewProj: gl.getUniformLocation(this.gProg, 'uViewProj') };

    this.cProg = this._link(VERT, FRAG, 'composite', ['aPos']);
    gl.useProgram(this.cProg);
    this.u = {};
    for(const n of ['uRes','uTime','uP','uVel','uPointer','uPlate',
                    'uGPos','uGNrm','uRPos','uRNrm',
                    'uCamRo','uCamTa','uCamFov','uCamRoll'])
      this.u[n] = gl.getUniformLocation(this.cProg, n);
    gl.uniform1i(this.u.uGPos, 0); gl.uniform1i(this.u.uGNrm, 1);
    gl.uniform1i(this.u.uRPos, 2); gl.uniform1i(this.u.uRNrm, 3);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    this.quad = buf;

    this.fbo = [this._makeGBuffer(), this._makeGBuffer()];
  }

  _makeGBuffer(){
    const gl = this.gl;
    const g = { fb: gl.createFramebuffer(), pos: gl.createTexture(),
                nrm: gl.createTexture(), depth: gl.createRenderbuffer(), w: 0, h: 0 };
    for(const t of [g.pos, g.nrm]){
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    return g;
  }

  _sizeGBuffer(g, w, h){
    if(g.w === w && g.h === h) return;
    const gl = this.gl;
    g.w = w; g.h = h;
    gl.bindTexture(gl.TEXTURE_2D, g.pos);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    gl.bindTexture(gl.TEXTURE_2D, g.nrm);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, g.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, g.pos, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, g.nrm, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, g.depth);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // The film renders below native so it can hold its frame rate. The held
  // closing frame renders 1:1 with the display instead: motion hides
  // resampling, a still frame does not, and it sits beside HTML type that is
  // always rasterised at native. Anything short of 1:1 reads as soft next to
  // it — at 87% of native the peak edge contrast on the bodywork measured 21%
  // lower than at 1:1.
  setStill(on){
    if(this.still === on) return;
    this.still = on;
    this.resize();
  }

  // The buffer is sized from the canvas's own box, never from the window. On
  // iOS the URL bar moves innerHeight by ~13% while the fixed stage keeps the
  // layout viewport; the browser resolves the difference by stretching the
  // buffer into the box, and no amount of extra resolution undoes a resample.
  resize(){
    if(!this.ok) return;
    const gl = this.gl;
    const dpr = this.still ? (window.devicePixelRatio || 1)
                           : Math.min(window.devicePixelRatio || 1, 1.75);
    const sc = this.still ? 1.0 : this.scale;
    const cw = this.canvas.clientWidth  || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;
    const w = Math.max(1, Math.round(cw * dpr * sc));
    const h = Math.max(1, Math.round(ch * dpr * sc));
    if(this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w; this.canvas.height = h;
    // A phone may grant less than was asked for. Everything downstream reads
    // drawingBuffer*, so the frame stays correctly composed either way.
    this._sizeGBuffer(this.fbo[0], gl.drawingBufferWidth, gl.drawingBufferHeight);
    this._sizeGBuffer(this.fbo[1], gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  // Keep the frame budget honest: drop render scale if we fall behind.
  _adapt(dt){
    // Frame rate does not matter once nothing is moving, so the scaler must not
    // be allowed to degrade the held frame.
    if(this.still) return;
    this.frameTimes.push(dt);
    if(this.frameTimes.length < 45) return;
    const avg = this.frameTimes.reduce((a,b)=>a+b,0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if(avg > 26 && this.scale > 0.45){
      this.scale = Math.max(0.45, this.scale - 0.10);
      this.resize();
    } else if(avg < 13 && this.scale < 0.9){
      this.scale = Math.min(0.9, this.scale + 0.05);
      this.resize();
    }
  }

  _gbufferPass(g, cam, bias, mirror){
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.fb);
    gl.viewport(0, 0, g.w, g.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if(!this.carReady) return;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);   // mirroring flips winding; depth still decides
    gl.disable(gl.BLEND);
    gl.useProgram(this.gProg);
    gl.uniformMatrix4fv(this.gU.uViewProj, false,
      viewProj(cam, g.w, g.h, bias, mirror));
    this.car.draw();
    gl.disable(gl.DEPTH_TEST);
  }

  render(state, dt){
    if(!this.ok) return;
    const gl = this.gl, u = this.u;
    this._adapt(dt);

    const bw = gl.drawingBufferWidth, bh = gl.drawingBufferHeight;
    const cam  = camAt(state.p, state.time, state.px, state.py, bw / bh);
    const bias = framingBias(state.p, bw, bh);

    this._gbufferPass(this.fbo[0], cam, bias, false);
    this._gbufferPass(this.fbo[1], cam, bias, true);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, bw, bh);
    gl.useProgram(this.cProg);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fbo[0].pos);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.fbo[0].nrm);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.fbo[1].pos);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.fbo[1].nrm);

    gl.uniform2f(u.uRes, bw, bh);
    gl.uniform1f(u.uTime, state.time);
    gl.uniform1f(u.uP, state.p);
    gl.uniform1f(u.uVel, state.vel);
    gl.uniform2f(u.uPointer, state.px, state.py);
    gl.uniform1f(u.uPlate, state.plate ? 1 : 0);
    gl.uniform3f(u.uCamRo, cam.ro[0], cam.ro[1], cam.ro[2]);
    gl.uniform3f(u.uCamTa, cam.ta[0], cam.ta[1], cam.ta[2]);
    gl.uniform1f(u.uCamFov, cam.fov);
    gl.uniform1f(u.uCamRoll, cam.roll);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
