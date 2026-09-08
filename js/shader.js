// ---------------------------------------------------------------------------
//  Jarek's Custom Wrap — cinematic stage shader
//  Fully procedural studio: raymarched vehicle + analytic mirror floor.
//  Everything the camera sees lives in one 3D scene, so every "scene change"
//  is a camera move or a light change — never a cut.
// ---------------------------------------------------------------------------

export const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const FRAG = `#version 300 es
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uP;        // master timeline 0..1 (scroll driven, smoothed)
uniform float uVel;      // scroll velocity, signed
uniform vec2  uPointer;  // -1..1 parallax
uniform float uPlate;    // 1.0 = supplied footage is live; render atmosphere only

// G-buffers rasterised from the vehicle mesh. uGPos.rgb is world position and
// uGPos.a the material id; uGNrm.rgb the world normal. uR* is the same buffer
// rendered from a camera mirrored through the floor, which is the reflection.
uniform sampler2D uGPos;
uniform sampler2D uGNrm;
uniform sampler2D uRPos;
uniform sampler2D uRNrm;

// The camera is built once in JS and handed to every pass, so the raster and
// this pass can never disagree about where it is.
uniform vec3  uCamRo;
uniform vec3  uCamTa;
uniform float uCamFov;
uniform float uCamRoll;

out vec4 O;

#define PI 3.141592653589793

// ---------------------------------------------------------------- utilities
float sat(float x){ return clamp(x, 0.0, 1.0); }
vec3  sat3(vec3 v){ return clamp(v, 0.0, 1.0); }
float smin(float a, float b, float k){ float h = sat(0.5 + 0.5*(b-a)/k); return mix(b,a,h) - k*h*(1.0-h); }
float smax(float a, float b, float k){ return -smin(-a,-b,k); }
mat2  rot(float a){ float s=sin(a), c=cos(a); return mat2(c,-s,s,c); }

float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i+vec3(0,0,0)), h31(i+vec3(1,0,0)), f.x),
                 mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x),
                 mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ return 0.55*vnoise(p) + 0.28*vnoise(p*2.03) + 0.17*vnoise(p*4.11); }

// ---------------------------------------------------------------- primitives
float sdRoundBox(vec3 p, vec3 b, float r){
  vec3 q = abs(p) - b;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)), 0.0) - r;
}
float sdBox(vec3 p, vec3 b){
  vec3 q = abs(p) - b;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)), 0.0);
}
// cylinder with its axis along Z  (the vehicle's lateral axis)
float sdCylZ(vec3 p, float halfLen, float r){
  vec2 d = vec2(length(p.xy) - r, abs(p.z) - halfLen);
  return min(max(d.x,d.y), 0.0) + length(max(d,0.0));
}
float sdTorusZ(vec3 p, float R, float r){
  vec2 q = vec2(length(p.xy) - R, p.z);
  return length(q) - r;
}

// ---------------------------------------------------------------- timeline
// Chapter boundaries, normalised against a 38s master.
const float C1 = 0.132;  // darkness            -> first reveal
const float C2 = 0.263;  // first reveal        -> surface
const float C3 = 0.395;  // surface             -> ppf
const float C4 = 0.553;  // ppf                 -> transformation
const float C5 = 0.711;  // transformation      -> full reveal
const float C6 = 0.868;  // full reveal         -> brand

float seg(float p, float a, float b){ return sat((p-a)/(b-a)); }
float ease(float t){ return t*t*(3.0-2.0*t); }
float easeIO(float t){ return t<0.5 ? 4.0*t*t*t : 1.0-pow(-2.0*t+2.0,3.0)/2.0; }

// ---------------------------------------------------------------- materials
// 1 paint   2 glass   3 tyre   4 rim   5 taillight   6 caliper
// hit = vec2(distance, materialId)  -- deliberately not a struct: ternary
// selection on structures is rejected by some GLSL ES front-ends.
vec2 closer(vec2 a, vec2 b){ return a.x < b.x ? a : b; }

// PPF application front: sweeps nose -> tail across chapter 4.
float ppfFront(){
  float t = easeIO(seg(uP, C3 - 0.02, C4));
  return mix(3.4, -3.2, t);            // world X of the wet edge
}
// how much of the body is already filmed at this point
float ppfMask(vec3 p){
  float f = ppfFront();
  return sat((f - p.x) * 2.6 + 0.5);   // 1 = film applied
}
// bright wet edge line right at the squeegee
float ppfEdge(vec3 p){
  float f = ppfFront();
  float on = sat(seg(uP, C3-0.03, C3+0.02)) * (1.0 - sat(seg(uP, C4-0.03, C4+0.02)));
  return exp(-pow(abs(p.x - f)*6.5, 2.0)) * on;
}

// Colour transformation. Each entry in the palette gets its own front, sweeping
// tail -> nose exactly as the original two fronts did: same easing, same span,
// same soft edge. Only the schedule changed.
//
// The fronts no longer overlap. CDUR is 45% of CSTEP, so each sweep completes
// and then NOTHING happens for the remaining 55% — the finished colour simply
// sits on the car and is seen before the next front sets off. Under the old
// 2.4x overlap there were always ~2.4 fronts in flight and settle time was
// structurally zero.
const int   NCOL  = 4;
const float CJ0   = 0.553;                        // = C4, transformation opens
const float CJ1   = 0.860;                        // settled before the brand beat
const float CSTEP = (CJ1 - CJ0) / float(NCOL);    // one slot per colour
const float CDUR  = CSTEP * 0.45;                 // sweep 45%, hold 55%

// Four premium finishes, as linear reflectance for the clearcoat. The larger
// library lives in the material chapter further down the page.
const vec3 CPAL[4] = vec3[4](
  vec3(0.520, 0.030, 0.018),   // racing red
  vec3(0.030, 0.110, 0.420),   // vivid blue
  vec3(0.011, 0.095, 0.062),   // emerald jade
  vec3(0.032, 0.034, 0.040)    // satin graphite — the finish it settles on
);

// With no overlap at most one front is ever in flight, so the window is two.
int colFirst(){
  return clamp(int(floor((uP - CJ0 - CDUR) / CSTEP)) + 1, 0, NCOL);
}

vec3 paintColour(vec3 p){
  int first = colFirst();
  vec3 c = first > 0 ? CPAL[first - 1] : vec3(0.020, 0.021, 0.026);   // near-black
  for(int i = 0; i < 2; i++){
    int k = first + i;
    if(k >= NCOL) break;
    float a = CJ0 + float(k) * CSTEP;
    float t = easeIO(seg(uP, a, a + CDUR));
    if(t <= 0.0) break;
    c = mix(c, CPAL[k], sat((mix(-3.4, 3.4, t) - p.x) * 2.2 + 0.5));
  }
  return c;
}

float transformEdge(vec3 p){
  // The bright line that rides each colour front. Unchanged, one per front.
  int first = colFirst();
  float e = 0.0;
  for(int i = 0; i < 2; i++){
    int k = first + i;
    if(k >= NCOL) break;
    float a = CJ0 + float(k) * CSTEP;
    float t = easeIO(seg(uP, a, a + CDUR));
    if(t <= 0.0) break;
    if(t < 0.998) e += exp(-pow(abs(p.x - mix(-3.4, 3.4, t)) * 7.0, 2.0));
  }
  return min(e, 1.6);
}

// ---------------------------------------------------------------- the vehicle
// The vehicle is no longer a signed distance field. It is a rasterised mesh
// (Porsche 911 Turbo S, baked to this coordinate frame) delivered through the
// G-buffers above. Everything below this point — the environment, the paint,
// the film sweep, the colour sweep, the grade — is unchanged from the SDF
// build and needs no knowledge of how the surface was produced.

// ---------------------------------------------------------------- lighting
// A directional environment: one large overhead softbox plus two low strips.
// Reflections of this env are what actually draws the car.

float softboxIntensity(){
  float a = ease(seg(uP, 0.010, C1 + 0.02)) * 0.16;   // studio wakes up
  a += ease(seg(uP, C1, C2)) * 0.30;                  // first reveal
  a += ease(seg(uP, C2, C3)) * 0.14;
  a += ease(seg(uP, C5 - 0.03, C6 - 0.03)) * 0.44;    // wide reveal, full power
  a -= ease(seg(uP, C6, 0.995)) * 0.45;               // brand moment, restrained
  return max(a, 0.0);
}

// Narrow travelling light bar — the first reveal's signature move.
float sweepPos(){ return mix(-3.6, 3.6, easeIO(seg(uP, C1 - 0.01, C2 + 0.02))); }
float sweepAmount(){
  return ease(seg(uP, C1 - 0.02, C1 + 0.03)) * (1.0 - ease(seg(uP, C2, C2 + 0.05)));
}

vec3 env(vec3 rd, float rough){
  // the void: almost nothing. Every bright value below is a real fixture.
  vec3 c = vec3(0.0013, 0.0015, 0.0022);
  float I = softboxIntensity();

  if(rd.y > 0.030){
    vec2 uv = rd.xz / rd.y;                 // project onto the ceiling plane
    float soft = 0.045 + rough * 1.35;

    // main overhead softbox — large, rectangular, slightly forward of centre
    vec2 d = abs(uv - vec2(0.26, 0.0)) - vec2(1.12, 0.44);
    float box = 1.0 - smoothstep(-soft, soft, max(d.x, d.y));
    box *= box;
    c += vec3(1.00, 0.988, 0.978) * box * I * 2.40;

    // travelling violet-white blade
    float sw = sweepAmount();
    if(sw > 0.001){
      float bl = exp(-pow((uv.x - sweepPos()) / (0.075 + rough*1.2), 2.0));
      bl *= 1.0 - smoothstep(1.8, 2.5, abs(uv.y));
      c += vec3(0.74, 0.68, 1.00) * bl * sw * 1.9;
    }
  }

  // two low kicker strips either side — these draw the shoulder line
  float side = I * 0.26 + 0.020;
  float lz = exp(-pow((abs(rd.z) - 0.97) / (0.16 + rough*1.1), 2.0))
           * exp(-pow((rd.y - 0.26) / (0.30 + rough*0.9), 2.0));   // lifted off the wheels
  c += vec3(0.58, 0.63, 0.90) * lz * side * 0.95;

  // cool rim from behind the car
  float back = exp(-pow((rd.x + 0.90) / (0.16 + rough*1.2), 2.0)) * sat(rd.y*1.5 + 0.30);
  c += vec3(0.38, 0.46, 0.80) * back * side * 0.60;

  return c;
}

float softShadow(vec3 ro, vec3 rd){
  // The SDF that used to be marched here is gone. The key light is a large
  // overhead source, so its occlusion is dominated by how deep under the body
  // a point sits — height above the floor is a close, cheap stand-in.
  return sat(0.30 + 0.70 * smoothstep(0.04, 0.62, ro.y));
}

// ---------------------------------------------------------------- shading
vec3 shade(vec3 p, vec3 n, vec3 rd, float mid, float pxSpread, float foot){
  vec3 v = -rd;
  float ndv = sat(dot(n, v));
  float fres = pow(1.0 - ndv, 5.0);
  vec3  col = vec3(0.0);

  // --- vehicle paint --------------------------------------------------
  if(mid < 1.5){
    vec3 base = paintColour(p);

    float film = ppfMask(p);
    // clearcoat gets glassier under film; satin phase dulls it
    float rough = mix(0.030, 0.012, film);
    rough = mix(rough, 0.075, easeIO(seg(uP, C5, C5 + 0.075)) * 0.55);   // satin phase
    rough += pxSpread * 0.5;

    // micro orange-peel + metallic flake, only readable up close
    vec3 nn = n;
    float peel = fbm(p * 46.0) - 0.5;
    nn = normalize(nn + peel * 0.026 * (1.0 - film * 0.55)
                      * smoothstep(0.010, 0.0015, foot));

    vec3 r = reflect(rd, nn);
    vec3 spec = env(r, rough);

    float sh = softShadow(p + n*0.02, normalize(vec3(0.12, 1.0, 0.05)));
    // Sky occlusion: the underside of the car cannot see the softbox, and
    // without this the whole lower body floats in a grey haze.
    float sky = sat(n.y*0.5 + 0.5);
    vec3 diff = base * env(n, 0.60) * 0.85 * mix(0.35, 1.0, sh) * (0.20 + 0.80*sky);

    float F = 0.030 + 0.970 * fres;
    col = diff + spec * F * mix(0.35, 1.0, sh) * (0.25 + 0.75*sky);

    // clearcoat second lobe — the tight highlight that sells automotive paint
    vec3 rc = reflect(rd, n);
    col += env(rc, 0.006 + pxSpread) * (0.028 + 0.22*fres) * (0.6 + 0.4*film)
           * mix(0.35, 1.0, sh);

    // Metallic flake. Only resolvable when the pixel footprint is genuinely
    // small — otherwise it aliases into speckle, which reads as noise, not paint.
    float macro = smoothstep(0.0030, 0.0006, foot);
    if(macro > 0.002){
      float fl = h31(floor(p * 1700.0));
      fl = pow(sat(fl - 0.955) * 22.0, 2.0);
      col += vec3(0.80,0.84,1.00) * fl * macro
             * sat(dot(reflect(rd,n), normalize(vec3(0.1,1.0,0.0))))
             * softboxIntensity() * 0.42 * (1.0 - film*0.45);
    }

    // Rim light — tight, so it draws the silhouette without fogging the body.
    col += vec3(0.30,0.36,0.58) * pow(1.0 - ndv, 6.0) * (0.045 + softboxIntensity()*0.16);

    // --- PPF: wet edge, trapped water, film thickness fringe ------------
    float edge = ppfEdge(p);
    if(edge > 0.002){
      col += vec3(0.92, 0.94, 1.00) * edge * 3.4;
      // water being displaced just ahead of the squeegee
      float w = fbm(p * 30.0 + uTime * 0.15);
      col += vec3(0.70,0.78,0.95) * edge * smoothstep(0.50, 0.82, w) * 3.0;
    }
    // faint iridescent fringe where film has settled
    float fr = film * (1.0 - film) * 4.0;
    col += vec3(0.30, 0.55, 0.95) * fr * fres * 0.9;
    // film adds a whisper of extra gloss depth
    col *= mix(1.0, 1.06, film);

    // --- colour change energy line --------------------------------------
    float te = transformEdge(p);
    col += vec3(0.80, 0.86, 1.00) * te * 1.6;
  }

  // --- glazing ----------------------------------------------------------
  else if(mid < 2.5){
    vec3 r = reflect(rd, n);
    vec3 spec = env(r, 0.045 + pxSpread);
    col = spec * (0.055 + 0.945*fres) * 0.92;
    col += vec3(0.0026,0.0030,0.0050);
    float edge = ppfEdge(p);
    col += vec3(0.88,0.92,1.0) * edge * 1.4;
    col += vec3(0.22,0.27,0.46) * pow(1.0-ndv, 5.0) * softboxIntensity() * 0.30;
  }

  // --- tyre / rubber / carbon ------------------------------------------
  else if(mid < 3.5){
    float grain = fbm(p * 110.0);
    vec3 r = reflect(rd, n);
    col  = vec3(0.0044,0.0047,0.0055) * (0.7 + 0.6*grain);
    col += env(r, 0.40 + pxSpread) * 0.070;
    col += vec3(0.15,0.18,0.28) * pow(1.0-ndv, 3.4) * softboxIntensity() * 0.26;
  }

  // --- rim / machined metal --------------------------------------------
  else if(mid < 4.5){
    vec3 r = reflect(rd, n);
    // spoke suggestion: radial banding around the wheel centre
    bool front = p.x > 0.0;
    vec2 wc = vec2(front ? 1.28 : -1.30, front ? 0.385 : 0.425);
    float WR = front ? 0.310 : 0.345;
    vec2 rv = vec2(p.x, p.y) - wc;
    float rr  = length(rv) / WR;                 // 0 hub .. 1 lip
    float ang = atan(rv.y, rv.x);

    float spoke = 0.5 + 0.5*cos(ang * 20.0);
    spoke = smoothstep(0.42, 0.86, spoke) * smoothstep(0.24, 0.42, rr)
                                          * (1.0 - smoothstep(0.80, 0.93, rr));
    float lip = smoothstep(0.84, 0.955, rr) * (1.0 - smoothstep(0.985, 1.04, rr));

    col  = env(r, 0.20 + pxSpread) * (0.016 + 0.034*spoke + 0.16*lip);
    col += vec3(0.0044,0.0047,0.0058) * (0.55 + 0.45*spoke);
    col += vec3(0.42,0.45,0.60) * pow(1.0-ndv, 3.4) * softboxIntensity() * 0.16;
  }

  // --- emissive: tail bar + headlights ----------------------------------
  else if(mid < 5.5){
    float isTail = sat((-p.x - 1.4) * 4.0);
    vec3 warm = vec3(1.00, 0.085, 0.075);
    vec3 cool = vec3(0.72, 0.80, 1.00);
    vec3 e = mix(cool, warm, isTail);
    float on = 0.22 + 0.78 * ease(seg(uP, 0.0, C1 + 0.05));
    on *= mix(0.55, 1.0, softboxIntensity() * 0.6 + 0.4);
    col = e * (1.4 + 2.2*fres) * on;
  }

  // --- brake caliper ----------------------------------------------------
  else {
    col = vec3(0.62, 0.40, 0.055) * (0.30 + softboxIntensity()*0.55);
    col += env(reflect(rd,n), 0.30) * 0.20;
  }

  return col;
}

// ---------------------------------------------------------------- camera
// The eight keyframes that used to live here are now evaluated in js/camera.js
// so that the mesh raster and this pass share one camera. The values, the
// easing, the breath and the pointer parallax are unchanged.

// ---------------------------------------------------------------- main
void main(){
  vec2 fc = gl_FragCoord.xy;
  // Framing is normalised on WIDTH, and cam.fov is a horizontal angle. A tall
  // phone then shows more darkness rather than a differently-composed shot.
  vec2 uv = (fc - 0.5*uRes) / uRes.x * 2.0;

  // Vertical framing bias. The type owns the upper half, so the car is pushed
  // down — hard on a tall phone, and harder still at the brand beat where the
  // wordmark needs the whole top of the frame.
  float tall = sat((1.10 - uRes.x/uRes.y) * 1.25);
  uv.y += 0.235 * tall + (0.335 + 0.125 * tall) * ease(seg(uP, C6, 0.99));

  vec3 fwd = normalize(uCamTa - uCamRo);
  vec3 rgt = normalize(cross(fwd, vec3(0.0,1.0,0.0)));
  vec3 up  = cross(rgt, fwd);
  rgt = rgt*cos(uCamRoll) + up*sin(uCamRoll);
  up  = cross(rgt, fwd);

  float z = 1.0 / tan(radians(uCamFov) * 0.5);
  vec3 rd = normalize(uv.x*rgt + uv.y*up + z*fwd);
  vec3 ro = uCamRo;

  // pixel footprint drives reflection blur — cheap, believable roughness LOD
  float pxSpread = 1.70 / (uRes.x * z);

  // ---- atmosphere-only pass ----------------------------------------------
  // When supplied footage is driving the visual, this shader stops drawing the
  // scene and becomes the room the footage sits in: the same haze, the same
  // grain, the same vignette, on the same scroll clock. That shared atmosphere
  // is what stops the footage reading as an embedded video.
  if(uPlate > 0.5){
    vec3 add = vec3(0.0);
    float ha = 0.0;
    for(int i = 0; i < 6; i++){
      float t = (float(i) + h21(fc + float(i))) / 6.0;
      float d = mix(1.0, 14.0, t*t);
      vec3 sp = ro + rd*d;
      float dens = exp(-abs(sp.y - 2.2)*0.55) * exp(-length(sp.xz)*0.075);
      dens *= 0.55 + 0.45*fbm(sp*0.30 + vec3(0.0, uTime*0.02, 0.0));
      ha += dens;
    }
    add += vec3(0.55,0.60,0.80) * (ha/6.0) * softboxIntensity() * 0.055;

    float g = h21(fc + fract(uTime)*137.0);
    add += vec3(g * 0.026);

    vec2 vg = fc/uRes - 0.5;
    float dark = dot(vg, vg) * 0.80;
    dark = sat(dark + (1.0 - sat(seg(uP, 0.0, 0.045)*0.85 + 0.15)));
    O = vec4(add * (1.0 - dark), dark);            // premultiplied
    return;
  }

  vec3 col = vec3(0.0);

  // The vehicle now arrives rasterised. Everything downstream — shade(), env(),
  // the film sweep, the colour sweep — is the same code that ran against the
  // signed distance field, because all of it is a function of world position.
  vec2 suv = fc / uRes;
  vec4  gp = texture(uGPos, suv);
  vec3  gn = texture(uGNrm, suv).xyz;
  float mid = gp.w;
  bool  hitCar = mid > 0.5;
  float tCar = hitCar ? length(gp.xyz - ro) : -1.0;

  // analytic mirror floor at y = 0
  float tFloor = (rd.y < -0.0005) ? (-ro.y / rd.y) : -1.0;
  bool hitFloor = tFloor > 0.0 && (!hitCar || tFloor < tCar);

  if(hitFloor){
    vec3 fp = ro + rd*tFloor;
    float rad = length(fp.xz);

    vec3 rr = reflect(rd, vec3(0.0,1.0,0.0));
    // roughen the mirror with distance so the reflection stretches vertically
    float fRough = 0.030 + rad*0.0075;
    vec3 refl = env(rr, fRough);

    vec4 rp = texture(uRPos, suv);
    vec3 rn = texture(uRNrm, suv).xyz;
    if(rp.w > 0.5){
      float tR = length(rp.xyz - fp);
      refl = shade(rp.xyz, rn, rr, rp.w, pxSpread + 0.03 + rad*0.006,
                   pxSpread*(tR+tFloor)*2.2);
      refl *= exp(-tR * 0.10);
    }

    float fres = pow(1.0 - sat(dot(-rd, vec3(0.0,1.0,0.0))), 4.0);
    col = refl * (0.030 + 0.52*fres);
    col *= exp(-rad * 0.150);                     // floor falls into the void
    col += vec3(0.0010,0.0011,0.0016) * exp(-rad*0.24);

    // contact shadow / ambient occlusion pool under the car
    float pool = exp(-pow(length(vec2(fp.x*0.42, fp.z*0.80)), 2.4));
    col *= mix(1.0, 0.18, sat(pool));
  }

  if(hitCar){
    col = shade(gp.xyz, gn, rd, mid, pxSpread, pxSpread * tCar);
    col *= exp(-max(tCar - 2.0, 0.0) * 0.028);    // gentle atmospheric falloff
  }

  // ---- volumetric haze around the softbox --------------------------------
  {
    float ha = 0.0;
    for(int i = 0; i < 8; i++){
      float t = (float(i) + h21(fc + float(i))) / 8.0;
      float d = mix(1.0, 14.0, t*t);
      vec3 sp = ro + rd*d;
      float dens = exp(-abs(sp.y - 2.2)*0.55) * exp(-length(sp.xz)*0.075);
      dens *= 0.55 + 0.45*fbm(sp*0.30 + vec3(0.0, uTime*0.02, 0.0));
      ha += dens;
    }
    ha /= 8.0;
    col += vec3(0.52,0.57,0.76) * ha * softboxIntensity() * 0.030;
  }

  // ---- speed-reactive bloom streak ---------------------------------------
  float vel = sat(abs(uVel) * 26.0);
  col += col * vel * 0.16;

  // ---- exposure & grade ---------------------------------------------------
  float expo = 1.00 + ease(seg(uP, 0.0, C1)) * 0.26 + ease(seg(uP, C5, C6)) * 0.16;
  expo *= 1.0 - ease(seg(uP, C6, 1.0)) * 0.22;
  col *= expo;

  // cinematic tone map (ACES-ish)
  col = (col*(2.51*col + 0.03)) / (col*(2.43*col + 0.59) + 0.14);

  // cool shadows, neutral highlights — the studio grade
  col = mix(col, col * vec3(0.93, 0.965, 1.085), 0.45 * (1.0 - sat(length(col))));
  col = pow(max(col, 0.0), vec3(0.4545));

  // subtle violet lift in the darkness, matching the brand accent
  col += vec3(0.0075, 0.0060, 0.0145) * (1.0 - sat(length(col)*1.8));

  // vignette
  vec2 vg = fc/uRes - 0.5;
  col *= 1.0 - dot(vg, vg) * 0.85;

  // film grain, animated
  float g = h21(fc + fract(uTime)*137.0);
  col += (g - 0.5) * 0.028;

  // opening fade from pure black
  col *= sat(seg(uP, 0.0, 0.045) * 0.85 + 0.15);

  O = vec4(max(col, 0.0), 1.0);   // opaque: the procedural stage is the base
}`;

// ---------------------------------------------------------------------------
//  G-buffer pass — the only new shader in this build.
//
//  It rasterises the vehicle mesh and writes nothing but raw surface data:
//  world position + material id, and world normal. No lighting happens here.
//  All shading is still done by shade() in the pass above, on exactly the
//  values it used to get from the raymarcher.
// ---------------------------------------------------------------------------

export const GBUF_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec3  aPos;
layout(location = 1) in vec4  aNrm;   // int8 normalised, .w unused
layout(location = 2) in float aMat;

uniform mat4 uViewProj;

out vec3  vPos;
out vec3  vNrm;
flat out float vMat;

void main(){
  vPos = aPos;
  vNrm = normalize(aNrm.xyz);
  vMat = aMat;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

export const GBUF_FRAG = `#version 300 es
precision highp float;

in vec3  vPos;
in vec3  vNrm;
flat in float vMat;

layout(location = 0) out vec4 oPos;   // xyz world position, w material id
layout(location = 1) out vec4 oNrm;   // xyz world normal

void main(){
  // The normal is a property of the surface, not of the camera, so the
  // mirrored reflection pass writes exactly the same value here.
  oPos = vec4(vPos, vMat);
  oNrm = vec4(normalize(vNrm), 0.0);
}`;
