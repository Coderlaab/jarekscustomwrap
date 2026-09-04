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
    this.hint     = document.getElementById('hint');
    this.progress = document.getElementById('progress');
    this.bars     = document.getElementById('bars');

    this.p = 0; this.target = 0; this.vel = 0;
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
    this.cineLength = this.baseH * 6.5;
    this.track.style.height = (this.cineLength + this.baseH) + 'px';
  }

  onScroll(){
    this.target = clamp(scrollY / this.cineLength, 0, 1);
  }

  frame(now){
    const dt = Math.min(now - this.last, 50);
    this.last = now;

    // Critically-damped-ish follow. Frame-rate independent.
    const k = reduced ? 1 : 1 - Math.pow(0.0016, dt / 1000);
    const prev = this.p;
    this.p += (this.target - this.p) * k;
    if(Math.abs(this.target - this.p) < 0.00004) this.p = this.target;

    this.vel = lerp(this.vel, (this.p - prev) * (1000/Math.max(dt,1)) * 0.016, 0.2);

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

    this.stage.render({
      time: now/1000, p: this.p, vel: this.vel,
      px: this.px, py: this.py, plate: !!this.stagePlate
    }, dt);
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

    // scroll hint
    // Hold the cue long enough to be read, then retire it as soon as the
    // visitor is clearly moving. Full opacity until 1.5% in, gone by 9%.
    this.hint.style.opacity = ((1 - ease(seg(p, 0.015, 0.090))) * alive).toFixed(3);

    // progress rule
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
