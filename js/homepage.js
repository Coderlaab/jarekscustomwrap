// ---------------------------------------------------------------------------
//  Homepage behaviour — everything BELOW the cinematic hero.
//
//  This module deliberately touches nothing the hero owns. It does not read or
//  write #stage, #type, #progress or the scroll timeline; main.js remains the
//  only owner of those. It reaches #nav in exactly two places — the language
//  switch and the developer signature — and only to move or relabel nodes.
// ---------------------------------------------------------------------------
import { CLEAR, COLOUR, GROUPS } from './films.js';

const site = document.getElementById('site');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------- language --- */
const Lang = {
  cur: 'no',
  set(l){
    this.cur = l;
    document.documentElement.lang = l === 'no' ? 'nb' : 'en';
    // The hero cues and the nav carry copy as well, so this reaches the whole
    // document — not just #site. It only ever writes textContent.
    for(const el of document.querySelectorAll('[data-no]')){
      const v = el.dataset[l];
      if(v !== undefined) el.textContent = v;
    }
    for(const el of document.querySelectorAll('[data-ph-no]')){
      el.placeholder = l === 'no' ? el.dataset.phNo : el.dataset.phEn;
    }
    for(const b of document.querySelectorAll('.lang button')){
      const on = b.dataset.lang === l;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    document.dispatchEvent(new CustomEvent('langchange', { detail: l }));
  }
};

/* -------------------------------------------------------------- reveals --- */
function reveals(){
  const els = [...site.querySelectorAll('[data-reveal]')];
  if(reduced || !('IntersectionObserver' in window)){
    els.forEach(e => e.classList.add('seen')); return;
  }
  const io = new IntersectionObserver(es => {
    for(const e of es){
      if(!e.isIntersecting) continue;
      e.target.classList.add('seen');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
  els.forEach(e => io.observe(e));
}

/* ---------------------------------------------------------- clear films --- */
function clearFilms(){
  const ul = document.getElementById('clear-list');
  if(!ul) return;
  for(const c of CLEAR){
    const li = document.createElement('li');
    li.innerHTML = `<b>${c.code}</b>`
      + `<span data-no="${c.finish.no}" data-en="${c.finish.en}">${c.finish.no}</span>`
      + `<i>${c.warranty}</i>`;
    ul.appendChild(li);
  }
}

/* ------------------------------------------------------ material surface --- */
// The point of this section is to let someone feel the difference between a
// gloss and a satin film: gloss returns a tight, bright specular, satin
// scatters it into a broad, low band. Same panel, different material.
function materials(){
  const list    = document.getElementById('film-list');
  const surface = document.getElementById('film-surface');
  const sheen   = document.getElementById('film-sheen');
  const nameEl  = document.getElementById('film-name');
  const metaEl  = document.getElementById('film-meta');
  const wrap    = document.getElementById('film-stage');
  if(!list) return;

  let active = null;

  for(const g of ['gloss', 'satin', 'designer']){
    const head = document.createElement('li');
    head.className = 'film-group';
    head.innerHTML = `<span data-no="${GROUPS[g].no}" data-en="${GROUPS[g].en}">${GROUPS[g].no}</span>`
                   + `<i>${GROUPS[g].count}</i>`;
    list.appendChild(head);

    for(const f of COLOUR.filter(x => x.group === g)){
      const li = document.createElement('li');
      const b  = document.createElement('button');
      b.type = 'button';
      b.className = 'film';
      b.dataset.slug = f.slug;
      b.innerHTML = `<i class="dot" style="--c:${f.hex}"></i><span>${f.name}</span>`;
      b.addEventListener('click', () => select(f));
      b.addEventListener('mouseenter', () => select(f));
      b.addEventListener('focus', () => select(f));
      li.appendChild(b); list.appendChild(li);
    }
  }

  function select(f){
    if(active === f) return;
    active = f;
    surface.style.backgroundImage = `url("${f.img}")`;
    surface.dataset.finish = f.group;
    nameEl.textContent = f.name;
    metaEl.textContent = Lang.cur === 'no' ? GROUPS[f.group].no : GROUPS[f.group].en;
    for(const b of list.querySelectorAll('.film'))
      b.classList.toggle('on', b.dataset.slug === f.slug);
  }

  wrap.addEventListener('pointermove', e => {
    const r = wrap.getBoundingClientRect();
    sheen.style.setProperty('--mx', ((e.clientX - r.left) / r.width  * 100).toFixed(1) + '%');
    sheen.style.setProperty('--my', ((e.clientY - r.top)  / r.height * 100).toFixed(1) + '%');
  }, { passive: true });

  document.addEventListener('langchange', () => {
    if(active) metaEl.textContent = Lang.cur === 'no' ? GROUPS[active.group].no : GROUPS[active.group].en;
  });

  select(COLOUR[0]);
}

/* ------------------------------------------------------------- in-page --- */
// main.js already owns [data-scroll-to]. This only covers plain anchors that
// live inside #site, so the two never handle the same click.
function anchors(){
  for(const a of site.querySelectorAll('a[href^="#"]:not([data-scroll-to])')){
    a.addEventListener('click', ev => {
      const t = document.querySelector(a.getAttribute('href'));
      if(!t) return;
      ev.preventDefault();
      t.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    });
  }
}

/* ------------------------------------------------------ developer credit --- */
// One element, two homes. The signature belongs in the header's utility
// cluster, but the phone header is already full, so below 640px the same node
// moves to the footer beside the copyright. Moved, never duplicated.
function signature(){
  const by   = document.querySelector('.by');
  const slot = document.querySelector('#nav .util');
  const legal = document.querySelector('#foot .f-legal');
  if(!by || !slot || !legal) return;

  const small = matchMedia('(max-width:640px)');
  const place = () => {
    if(small.matches){
      if(by.previousElementSibling !== legal) legal.after(by);
    } else if(by.parentNode !== slot){
      slot.prepend(by);
    }
  };
  place();
  small.addEventListener('change', place);
}

/* ------------------------------------------------------------------ form --- */
function form(){
  const f = document.getElementById('quote');
  if(!f) return;
  f.addEventListener('submit', ev => {
    ev.preventDefault();
    if(!f.reportValidity()) return;
    f.classList.add('sent');
    // Prototype: no backend, by design. Production posts to a mail endpoint.
  });
}

/* ------------------------------------------------------------------ init --- */
clearFilms();
materials();
Lang.set('no');
for(const b of document.querySelectorAll('.lang button'))
  b.addEventListener('click', () => Lang.set(b.dataset.lang));
reveals();
anchors();
form();
signature();
