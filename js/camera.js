// ---------------------------------------------------------------------------
//  The cinematic camera.
//
//  Ported verbatim from the GLSL camAt() that drove the signed-distance build.
//  The eight keyframes, the easing, the breath and the pointer parallax are
//  byte-for-byte the same values. It lives in JS now only so that the mesh
//  raster and the shading pass are guaranteed to share one camera.
// ---------------------------------------------------------------------------

const C1 = 0.132, C2 = 0.263, C3 = 0.395, C4 = 0.553, C5 = 0.711, C6 = 0.868;

const P = [
  [-4.60, 1.30,  4.40], [-1.20, 0.95,  5.00], [ 3.50, 0.62,  3.20],
  [ 2.72, 0.66,  1.72], [ 2.15, 1.38,  1.78], [-1.55, 0.88,  2.45],
  [ 4.30, 1.15,  4.60], [ 3.70, 1.30,  5.75]
];
const T = [
  [ 0.00, 0.62, 0.00], [ 0.00, 0.60, 0.00], [ 1.10, 0.50, 0.30],
  [ 1.42, 0.50, 0.45], [ 0.10, 0.70, 0.05], [-0.55, 0.60, 0.10],
  [ 0.00, 0.60, 0.00], [ 0.00, 0.34, 0.00]
];
const F = [40.0, 44.0, 50.0, 58.0, 62.0, 52.0, 42.0, 38.0];
const K = [0.0, C1, C2, C3, C4, C5, C6, 1.0];

// Portrait framing multipliers, one per keyframe.
//
// Framing is normalised on WIDTH and the FOV above is horizontal, so the
// vertical world in frame is (height/width) x that. A 16:9 desktop sees 0.625
// of it; a 390x844 phone sees 2.164 — about 3.5x more. Left alone that turns
// every macro chapter into a wide shot and strands the wide chapters in dead
// space. These tighten each keyframe back to the composition it was cut for:
// the close beats hardest, the two hero-wide beats barely at all so the whole
// car still fits.
const FP = [0.88, 0.86, 0.74, 0.56, 0.56, 0.68, 0.88, 0.90];

const sat = x => Math.min(1, Math.max(0, x));
const easeIO = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
const mix3 = (a, b, t) => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];

export function camAt(p, time, px, py, aspect){
  let ro = P[7].slice(), ta = T[7].slice(), fov = F[7], fp = FP[7];
  for(let i = 0; i < 7; i++){
    if(p <= K[i+1] || i === 6){
      const t = easeIO(sat((p - K[i]) / Math.max(K[i+1] - K[i], 1e-4)));
      ro = mix3(P[i], P[i+1], t);
      ta = mix3(T[i], T[i+1], t);
      fov = F[i] + (F[i+1] - F[i]) * t;
      fp  = FP[i] + (FP[i+1] - FP[i]) * t;
      break;
    }
  }

  // How portrait the screen is: 0 at 1.10 and wider, 1 at 0.55 and narrower.
  // Every landscape desktop lands on 0, so nothing below this line changes it.
  const port = aspect === undefined ? 0 : sat((1.10 - aspect) / 0.55);
  fov *= 1 + (fp - 1) * port;

  // Living camera: a slow breath plus pointer parallax, so a stopped scroll
  // settles rather than freezing.
  const br = time * 0.16;
  const d = Math.hypot(ro[0]-ta[0], ro[1]-ta[1], ro[2]-ta[2]);
  // Parallax is reduced on a phone: the drift is a mouse affordance, and on a
  // narrow frame the same amplitude reads as the camera wobbling.
  const amp = (0.35 + 0.65 * sat(d / 4.0)) * (1 - 0.45 * port);
  ro[0] += Math.sin(br)*0.042*amp;      ro[1] += Math.cos(br*0.83)*0.026*amp;
  ro[2] += Math.sin(br*0.62)*0.036*amp;
  ro[0] += px * 0.15 * amp;             ro[1] += py * 0.10 * amp;
  ta[0] += px * 0.040 * amp;            ta[1] += py * 0.028 * amp;

  const roll = Math.sin(time*0.11) * 0.006 + px * 0.010;
  return { ro, ta, fov, roll };
}

// --- basis and projection ---------------------------------------------------
// Reproduces the ray the fragment shader builds:
//   rd = uv.x*rgt + uv.y*up + z*fwd,  uv.x spanning -1..1 across the WIDTH,
//   with uv.y carrying the vertical framing bias. The projection below puts a
//   world point exactly where that ray would have found it.

const norm = v => { const l = Math.hypot(v[0],v[1],v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

export function basis(cam, mirror){
  let fwd = norm([cam.ta[0]-cam.ro[0], cam.ta[1]-cam.ro[1], cam.ta[2]-cam.ro[2]]);
  let rgt = norm(cross(fwd, [0,1,0]));
  let up  = cross(rgt, fwd);
  const c = Math.cos(cam.roll), s = Math.sin(cam.roll);
  rgt = [rgt[0]*c + up[0]*s, rgt[1]*c + up[1]*s, rgt[2]*c + up[2]*s];
  up  = cross(rgt, fwd);
  let ro = cam.ro.slice();

  if(mirror){
    // Reflection in the floor is the same scene seen by a camera mirrored
    // through y = 0. Mirroring the basis makes each pixel's ray the mirror of
    // the real one — which is precisely the reflected ray.
    ro  = [ro[0], -ro[1], ro[2]];
    fwd = [fwd[0], -fwd[1], fwd[2]];
    rgt = [rgt[0], -rgt[1], rgt[2]];
    up  = [up[0],  -up[1],  up[2]];
  }
  return { ro, rgt, up, fwd };
}

// Column-major mat4 for GL. Camera space is (dot(P-ro,rgt), dot(P-ro,up), dot(P-ro,fwd)).
export function viewProj(cam, W, H, biasY, mirror){
  const b = basis(cam, mirror);
  const z = 1.0 / Math.tan(cam.fov * Math.PI / 360.0);
  const aspect = W / H;
  const n = 0.02, f = 200.0;

  const { ro, rgt, up, fwd } = b;
  // view rows
  const v = [
    rgt[0], rgt[1], rgt[2], -dot(rgt, ro),
    up[0],  up[1],  up[2],  -dot(up,  ro),
    fwd[0], fwd[1], fwd[2], -dot(fwd, ro)
  ];
  // clip.x = z*a ; clip.y = aspect*(z*b - bias*c) ; clip.z = depth ; clip.w = c
  const A = (f + n) / (f - n), Bd = -2*f*n / (f - n);
  const r0 = [z*v[0], z*v[1], z*v[2], z*v[3]];
  const r1 = [aspect*(z*v[4] - biasY*v[8]), aspect*(z*v[5] - biasY*v[9]),
              aspect*(z*v[6] - biasY*v[10]), aspect*(z*v[7] - biasY*v[11])];
  const r2 = [A*v[8], A*v[9], A*v[10], A*v[11] + Bd];
  const r3 = [v[8], v[9], v[10], v[11]];

  // to column-major
  return new Float32Array([
    r0[0], r1[0], r2[0], r3[0],
    r0[1], r1[1], r2[1], r3[1],
    r0[2], r1[2], r2[2], r3[2],
    r0[3], r1[3], r2[3], r3[3]
  ]);
}

// The vertical framing bias the fragment shader applies to uv.y.
export function framingBias(p, W, H){
  const ease = t => t*t*(3-2*t);
  const seg  = (x,a,b) => sat((x-a)/(b-a));
  const tall = sat((1.10 - W/H) * 1.25);
  return 0.235 * tall + 0.335 * ease(seg(p, C6, 0.99));
}
