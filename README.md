# Jarek's Custom Wrap — scroll-driven cinematic

A 38-second automotive title sequence that is **scrubbed by scroll position**,
not played. Stop scrolling and it settles; scroll slowly and it crawls; scroll
fast and it keeps up without tearing. It occupies 6.5 viewport heights and then
hands off into the ordinary site without a cut.

## Run it

```bash
python3 -m http.server 5599
```

Then open <http://localhost:5599>. No build step, no dependencies, no npm.
(ES modules need a server — `file://` will not work.)

## How it is put together

```
index.html      the page, and every word of typography as real HTML
css/main.css    the type choreography, chrome, and the site below
js/main.js      the scroll engine: one 0→1 master clock, eased, frame-rate independent
js/stage.js     WebGL2 host, adaptive render scale
js/shader.js    the studio: raymarched vehicle, analytic mirror floor, lighting
js/plate.js     optional supplied footage, scrubbed on the same clock
assets/         drop cinematic material here (see assets/README.md)
```

### The one idea

Everything the camera sees lives in a **single 3D scene with a single lighting
setup**. There are no scenes to cut between, so nothing can read as a cut. Each
"transition" in the brief is a camera move or a light change:

- the PPF beat is a **wet edge sweeping along world X**, changing roughness
  behind it and throwing a highlight and displaced water at the boundary;
- the colour change is a **second sweep** that lerps the paint and leaves an
  energy line at the front;
- the reveal is the softbox coming up and the camera pulling out.

### Scroll behaviour

`js/main.js` keeps a target derived from `scrollY` and eases the live value
toward it with a frame-rate-independent follow (`1 - 0.0016^dt`). That is what
makes a stopped scroll *settle* rather than freeze. A slow drift and pointer
parallax stay alive underneath, so a held frame still breathes.

### Typography

Nothing is baked into the visual layer. Every line, the wordmark, the tagline
and the CTA are HTML elements in `#type`, driven from the same master clock with
opacity, a small Z drift and a de-blur on entry. That is deliberate: it keeps
the text selectable, translatable, accessible and crisp at any DPI, and it is
what lets the page and the imagery read as one surface.

### The handoff

The stage is `position: fixed` and never unmounts. Past the cinematic it dims to
28 %, scales up 4 % and drifts, while `#site` slides over it behind a gradient
that starts fully transparent. The studio darkness *is* the page background, so
there is no seam to find.

## Where this stands

The lighting, floor, film application, colour transformation, camera path,
scroll engine, typography and handoff are finished and running.

**The vehicle itself is a procedural stand-in.** It is a signed-distance-field
sculpture — good enough to carry the lighting, the film sweep and the colour
change, and it means the site is complete and shippable with zero assets. It is
*not* photoreal, and it will not pass for a real car under close inspection.

For production, supply real material through `assets/` — see
`assets/README.md` for the exact spec. The plate layer scrubs it on the same
clock and the shader steps back to supplying only the haze, bloom, grain and
vignette, so the footage inherits the page's atmosphere rather than sitting in
it as a rectangle.

## Accessibility and fallbacks

- `prefers-reduced-motion` removes the easing and the entry blur.
- No WebGL2 → `body.no-webgl`, and a static studio gradient stands in.
- Render scale adapts on a 45-frame rolling average; it drops to 0.45 and
  reduces march steps before it drops frames.
