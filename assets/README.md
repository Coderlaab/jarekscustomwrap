# Cinematic assets

Drop nothing here and the site still works — it renders the studio, the car and
the whole 38-second arc procedurally in WebGL.

To drive the sequence with real footage instead, supply either a frame sequence
or a single video file and switch `assets/sequence.json` from `"type": "none"`
to the matching block. Both examples are already in that file.

## Frame sequence (preferred)

Scrubbing an image sequence is frame-accurate on every browser. Video seeking is
not — Safari in particular will not seek smoothly under scroll.

```
assets/seq/frame_0001.webp … frame_0420.webp
```

Edit `sequence.json`: set `"type": "frames"` and the real `count`.

- **420 frames** ≈ 12 fps across the 35 s master. Enough for a scrubbed shot;
  the eye reads scroll-driven motion as continuous well below 24 fps.
- **1920 × 1080**, WebP quality ~72. That lands around 45–70 KB a frame,
  ~25 MB total. Budget for it: the plate only takes over once ~18 % has decoded,
  and the procedural stage covers everything before that.
- Frames must be **numbered in timeline order**, frame 1 = t 0 s.

## Single video

```json
{ "type": "video", "src": "assets/master.mp4", "duration": 35 }
```

## What the footage must respect

The generated material has to sit inside the same room the site builds around
it. That means:

| Constraint | Why |
|---|---|
| Pure black background, no set dressing | The page bleeds into the footage at both ends |
| One overhead softbox, slightly forward of centre | The site's haze and bloom are keyed to that fixture |
| Glossy black floor with a vertical reflection | Continuity with the procedural stage and the page ground |
| One continuous camera — no cuts, ever | A cut is the single thing that breaks the illusion |
| **No typography, no logo, no UI, no buttons** | All of that is live HTML layered over the top |
| Frame the car centre-to-lower-third | The wordmark occupies the upper half at the brand beat |

## Chapter map

The master timeline is normalised 0 → 1 against 38 s. Cut the generated material
to these boundaries and it will land on the copy automatically.

| Progress | Seconds | Beat | HTML copy over the top |
|---|---|---|---|
| 0.000 – 0.132 | 0 – 5 | Darkness; reflections only | CRAFTED DIFFERENTLY. |
| 0.132 – 0.263 | 5 – 10 | Light blade travels the body | — |
| 0.263 – 0.395 | 10 – 15 | Down onto the paint surface | PRECISION. |
| 0.395 – 0.553 | 15 – 21 | PPF: wet edge, water displacement | PROTECTION. |
| 0.553 – 0.711 | 21 – 27 | Colour change sweeping the body | TRANSFORMATION. |
| 0.711 – 0.868 | 27 – 33 | Camera pulls out; full reveal | — |
| 0.868 – 1.000 | 33 – 38 | Lighting restrained; car held | JAREK'S CUSTOM WRAP + CTA |

Those numbers live in one place in the code: `C1`–`C6` in `js/shader.js`, mirrored
as `CH` in `js/main.js`. Change them together.
