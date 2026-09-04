// ---------------------------------------------------------------------------
//  Plate layer — the supplied cinematic footage.
//
//  The master timeline is the authority. The plate does not play; it is
//  scrubbed, exactly like the procedural stage, so both stay locked together
//  and the visitor never crosses a boundary between "video" and "site".
//
//  If no manifest is present the site runs procedurally and nothing here
//  activates — the experience is complete without any assets at all.
// ---------------------------------------------------------------------------

const MANIFEST = 'assets/sequence.json';

export class Plate {
  constructor(el){
    this.el = el;
    this.active = false;       // manifest found and enough media decoded
    this.ready = 0;            // 0..1 decode progress
    this.mode = null;          // 'frames' | 'video'
    this.frames = [];
    this.cur = -1;
    this.video = null;
    this._load();
  }

  async _load(){
    let man;
    try {
      const res = await fetch(MANIFEST, { cache: 'force-cache' });
      if(!res.ok) return;                      // no assets yet: stay procedural
      man = await res.json();
    } catch { return; }

    // Anything else — including the shipped type:'none' — leaves the site
    // running on the procedural stage alone.
    if(man.type === 'video')  return this._loadVideo(man);
    if(man.type === 'frames') return this._loadFrames(man);
  }

  // --- image sequence: the reliable way to scrub on every browser -----------
  async _loadFrames(man){
    this.mode = 'frames';
    const { path = 'assets/seq/', pattern = 'frame_{n}.jpg',
            start = 1, count = 0, pad = 4 } = man;
    if(!count) return;

    const url = i => path + pattern.replace('{n}', String(start + i).padStart(pad, '0'));

    const canvas = document.createElement('canvas');
    canvas.className = 'plate-canvas';
    this.el.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._sizeCanvas();
    addEventListener('resize', () => this._sizeCanvas(), { passive: true });

    // Decode in order so the opening is watchable as early as possible, and
    // hand over to the plate as soon as the first chapter is safely buffered.
    let done = 0;
    const HANDOVER = Math.min(count, Math.ceil(count * 0.18));
    for(let i = 0; i < count; i++){
      const img = new Image();
      img.decoding = 'async';
      img.src = url(i);
      this.frames[i] = img;
      img.decode().catch(() => {}).finally(() => {
        done++;
        this.ready = done / count;
        if(done >= HANDOVER && !this.active){
          this.active = true;
          this.el.classList.add('is-live');
        }
      });
      if(i % 12 === 11) await new Promise(r => setTimeout(r, 0));   // yield
    }
  }

  _sizeCanvas(){
    if(!this.canvas) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width  = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    this.cur = -1;                                    // force a redraw
  }

  // --- single video file: scrubbed, never played ---------------------------
  _loadVideo(man){
    this.mode = 'video';
    const v = document.createElement('video');
    v.src = man.src;
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.className = 'plate-video';
    this.el.appendChild(v);
    this.video = v;
    this.duration = man.duration || 0;
    v.addEventListener('loadedmetadata', () => { this.duration = v.duration; });
    v.addEventListener('canplaythrough', () => {
      this.active = true; this.ready = 1;
      this.el.classList.add('is-live');
    }, { once: true });
  }

  // --- scrub ----------------------------------------------------------------
  update(p){
    if(!this.active) return;

    if(this.mode === 'frames'){
      const n = this.frames.length;
      const i = Math.max(0, Math.min(n - 1, Math.round(p * (n - 1))));
      if(i === this.cur) return;
      const img = this.frames[i];
      if(!img || !img.complete || !img.naturalWidth) return;
      this.cur = i;
      // cover-fit: the plate must fill the viewport or the illusion breaks
      const cw = this.canvas.width, ch = this.canvas.height;
      const s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      this.ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
      return;
    }

    if(this.mode === 'video' && this.duration){
      const t = p * this.duration;
      if(Math.abs(this.video.currentTime - t) > 1 / 60) this.video.currentTime = t;
    }
  }
}
