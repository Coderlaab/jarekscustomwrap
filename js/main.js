// ---------------------------------------------------------------------------
//  Scroll engine + typography choreography.
//  The 38s "master timeline" is never played — it is scrubbed by scroll
//  position and eased toward, so stopping settles instead of snapping.
// ---------------------------------------------------------------------------
import { Stage } from './stage.js';
import { Plate } from './plate.js';

if('scrollRestoration' in history) history.scrollRestoration = 'manual';

const CH = {                       // chapter boundaries on the 0..1 master
  darkness:  [0.000, 0.132],
  reveal:    [0.132, 0.263],
  surface:   [0.263, 0.395],
  ppf:       [0.395, 0.553],
  transform: [0.553, 0.711],
  hero:      [0.711, 0.868],
  brand:     [0.868, 1.000]
};

// --- playback -------------------------------------------------------------
// The cinematic runs on a clock, not on scroll position. Scroll expresses
// forward intent and may accelerate that clock; it can never set the frame.
// That is what stops a flick throwing the film through several beats at once,
// and it removes the catch-up glide, because the timeline no longer has a
// distant target to chase.
const DUR_S       = 16.0;   // passive viewing duration of the whole arc
const RATE        = 1 / DUR_S;
const MAX_MULT    = 2.5;    // the most that scrolling may accelerate playback
const SKIP_MULT   = 4.75;   // once the visitor has clearly left the hero
const ENERGY_FULL = 900;    // px of recent scrolling that means "full speed"
const ENERGY_TAU  = 0.45;   // seconds; how fast that intent decays

const clamp = (v,a,b) => Math.min(b, Math.max(a, v));
const lerp  = (a,b,t) => a + (b-a)*t;
const seg   = (p,a,b) => clamp((p-a)/(b-a), 0, 1);
const ease  = t => t*t*(3-2*t);

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

class Experience {
  constructor(){
    this.canvas   = document.getElementById('gl');
    this.stage    = new Stage(this.canvas);
    this.plate    = new Plate(document.getElementById('plate'));
    this.plateLive = false;
    this.stageEl  = document.getElementById('stage');
    this.track    = document.getElementById('track');
    this.typeEl   = document.getElementById('type');
    this.cues     = [...document.querySelectorAll('.cue')];
    this.nav      = document.getElementById('nav');
    this.site     = document.getElementById('site');
    this.progress = document.getElementById('progress');
    this.bars     = document.getElementById('bars');

    this.p = 0; this.vel = 0; this.energy = 0; this.lastY = 0;
    this.px = 0; this.py = 0; this.tpx = 0; this.tpy = 0;
    this.last = performance.now();

    if(!this.stage.ok) document.body.classList.add('no-webgl');

    this.measure();
    addEventListener('resize', () => { this.measure(); this.stage.resize(); }, {passive:true});
    addEventListener('scroll', () => this.onScroll(), {passive:true});
    addEventListener('pointermove', e => {
      this.tpx = (e.clientX / innerWidth  - 0.5) * 2;
      this.tpy = (e.clientY / innerHeight - 0.5) * -2;
    }, {passive:true});

    document.querySelectorAll('[data-scroll-to]').forEach(el => {
      el.addEventListener('click', ev => {
        ev.preventDefault();
        const t = document.querySelector(el.dataset.scrollTo);
        if(t) t.scrollIntoView({behavior:'smooth', block:'start'});
      });
    });

    // Returning from a background tab must not advance the film by the time
    // spent away.
    document.addEventListener('visibilitychange', () => { this.last = performance.now(); });

    if(reduced) this.p = 1;          // finished hero state, no cinematic played
    this.onScroll();
    requestAnimationFrame(t => this.frame(t));
  }

  measure(){
    // 6.5 viewport heights of scroll drives the cinematic, plus one pinned
    // viewport so the last frame can be held.
    //
    // The reference height is captured once per orientation and NOT updated on
    // height-only resizes. On mobile Safari the URL bar collapses as you scroll,
    // which fires resize and changes innerHeight by ~13%. Recomputing here would
    // rescale the timeline underneath the scroll position and the cinematic
    // would lurch backwards mid-gesture. A width change is a real rotation, so
    // that does re-measure.
    if(this.baseW === innerWidth && this.cineLength) return;
    this.baseW = innerWidth;
    this.baseH = innerHeight;
    this.cineLength = this.baseH * 1.6;
    this.track.style.height = (this.cineLength + this.baseH) + 'px';
  }

  onScroll(){
    // Scroll contributes energy, not position. Distance travelled is intent.
    this.energy += Math.abs(scrollY - this.lastY);
    this.lastY = scrollY;
  }

  frame(now){
    const dts = Math.min((now - this.last) / 1000, 0.05);   // seconds, clamped
    const dt  = dts * 1000;
    this.last = now;
    const prev = this.p;

    if(!reduced && this.p < 1){
      this.energy *= Math.exp(-dts / ENERGY_TAU);
      const intent = clamp(this.energy / ENERGY_FULL, 0, 1);
      // Past the pinned track the visitor has plainly moved on, so the film
      // fast-forwards to its end rather than being abandoned mid-shot.
      const mult = (scrollY - this.cineLength) > 0
                 ? SKIP_MULT : 1 + intent * (MAX_MULT - 1);
      this.p = Math.min(1, this.p + RATE * mult * dts);
    }

    this.vel = lerp(this.vel, (this.p - prev) / Math.max(dts, 1e-3) * 0.016, 0.2);

    this.px = lerp(this.px, this.tpx, 0.045);
    this.py = lerp(this.py, this.tpy, 0.045);

    // Hand over to supplied footage once it is decoded. The procedural stage
    // keeps drawing underneath through the cross-fade, then steps back to being
    // the atmosphere so both layers still share one room.
    if(this.plate.active && !this.plateLive){
      this.plateLive = true;
      setTimeout(() => { this.stagePlate = true; }, 1400);
    }
    this.plate.update(this.p);

    // Nothing is drawn once the hero has faded out or the tab is hidden — the
    // two G-buffer passes are the most expensive thing on the page.
    // Once the film has finished the camera is frozen, so the frame is redrawn
    // at near-native resolution and only every third tick — a still image that
    // costs a third of a moving one.
    if(this.p >= 1 && !this.still){
      this.still = true; this.stage.setStill(true);
      this.tick = -1;          // the resized buffer is blank; draw it at once
    }
    this.tick = (this.tick || 0) + 1;
    const throttled = this.still && (this.tick % 3 !== 0);

    const off = (scrollY - this.cineLength) / (this.baseH * 0.9) >= 1;
    this.rendering = !off && !document.hidden && !throttled;
    if(this.rendering){
      this.stage.render({
        time: now/1000, p: this.p, vel: this.vel,
        px: this.px, py: this.py, plate: !!this.stagePlate
      }, dt);
    }
    this.paintDOM();

    requestAnimationFrame(t => this.frame(t));
  }

  // ---- HTML/CSS layer -----------------------------------------------------
  paintDOM(){
    const p = this.p;

    // Everything in the cinematic layer retires as the site arrives. Without
    // this the brand cue would sit over the real page for ever.
    const past   = scrollY - this.cineLength;
    const over   = clamp(past / (this.baseH * 0.9), 0, 1);
    const alive  = 1 - ease(clamp(past / (this.baseH * 0.35), 0, 1));

    // typographic cues
    for(const cue of this.cues){
      const a  = +cue.dataset.in;
      const b  = +cue.dataset.out;
      const fi = +(cue.dataset.fade || 0.030);
      const t  = ease(seg(p, a, a+fi)) * (1 - ease(seg(p, b-fi, b))) * alive;
      cue.style.opacity = t.toFixed(4);
      // drift and de-blur on entry; the text lives in the same space as the car
      const dz = (1 - t) * 26;
      const bl = (1 - t) * 9;
      cue.style.transform = `translate3d(0, calc(var(--y0, 0px) + ${dz.toFixed(2)}px), 0) scale(${(0.985 + t*0.015).toFixed(4)})`;
      cue.style.filter = t > 0.995 ? 'none' : `blur(${bl.toFixed(2)}px)`;
      cue.style.visibility = t < 0.002 ? 'hidden' : 'visible';
    }

    // letterbox bars — open at the start, close as we hand off to the site
    const lb = ease(seg(p, 0.0, 0.06)) * (1 - ease(seg(p, CH.brand[0], 0.99)));
    this.bars.style.setProperty('--lb', (lb * 5.4).toFixed(3) + 'vh');

    this.progress.style.setProperty('--w', (p*100).toFixed(2) + '%');
    this.progress.style.opacity = (ease(seg(p,0.01,0.05)) * (1 - ease(seg(p, 0.93, 1.0))) * alive).toFixed(3);

    // navigation arrives with the brand moment and stays
    const navT = ease(seg(p, CH.brand[0] + 0.02, 0.995));
    this.nav.style.opacity = navT.toFixed(3);
    this.nav.style.transform = `translate3d(0, ${((1-navT)*-14).toFixed(2)}px, 0)`;
    this.nav.style.pointerEvents = navT > 0.6 ? 'auto' : 'none';

    // ---- the handoff ------------------------------------------------------
    // The stage never cuts. Once the cinematic ends it stays pinned as the
    // page's own background and only dims as real content slides over it.
    this.stageEl.style.setProperty('--dim', (1 - over*0.72).toFixed(3));
    this.stageEl.style.setProperty('--push', (over * -6).toFixed(2) + 'vh');
    this.site.style.setProperty('--reveal', over.toFixed(3));
  }
}

addEventListener('DOMContentLoaded', () => new Experience());
