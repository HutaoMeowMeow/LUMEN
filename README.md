# LUMEN

A first-person, open-world ocean exploration game that runs in the browser. You play a diver who returns to a drowned research
station to find out why its crew went silent. The island, reefs, kelp forests, glass dunes, caves and the deep, glowing
Hollow Rift are all generated procedurally, and a journal fills in as you explore.

Everything here is original: the world, the creatures, the story, the shaders and the procedural audio. There are no
external assets, no backend and no API keys.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

Click **Dive in**, then click the view to capture the mouse.

| Key | Action |
| --- | --- |
| W A S D | Swim or walk |
| Mouse | Look |
| Space / Ctrl (or C) | Swim up / down; Space jumps on land |
| Shift | Sprint (uses oxygen faster underwater) |
| E | Examine the highlighted object |
| F | Toggle the lamp |
| J / M | Journal / map |
| Esc | Pause |

Oxygen lasts about 90 seconds and refills whenever your head is above water. If it runs out, you black out and wake at
the last place you had air. Progress autosaves every 30 seconds, and also when you pause or leave the page.

## Features

- **World:** a 4 km world with a seamless swim-to-walk transition onto the islands. It includes eight islands, five
  regions and three sculpted cave systems, meshed from signed distance fields in a Web Worker.
- **Water and sky:** a wave-animated ocean with foam, a Snell's window and underwater refraction. There's a sky with
  clouds, a full day/night cycle with a moon and stars, and shadows from whichever of the sun or moon is up.
- **Underwater lighting:** depth-based light absorption, caustics, light shafts, marine snow, bubbles, bloom and a lamp.
- **Haven island:** hills, a sea cliff and a valley with a waterfall, a plunge pool and a stream to the beach. There's
  also a forest giant in its own clearing, a natural sea arch you can swim through, and shore clusters of rocks,
  driftwood, shells and crabs. All of these are optional scenery, with no quests attached.
- **Creatures:** small reef fish that live around one coral head, circle it and dart away from the diver. There are
  also schooling fish, reef sharks, sea turtles, sand rays and giant open-water rays, and drifting jellyfish blooms. In
  the deep you'll find bioluminescent schools and a lure-carrying hunter. A whale and her calf sing as they pass, and
  every minute or two they rise to the surface to breathe.
- **Journal:** 40 entries across places, creatures and regions, plus a map and an ending.
- **Audio:** fully procedural (Web Audio). It covers ambience, surf, wind, the whale song, bubbles, footsteps and a
  generative score.
- **Quality presets:** Low, Medium, High and Ultra. A preset sets render scale, shadow resolution, bloom, light shafts,
  draw distance and creature counts. A default is picked from the device, and a change applies after a reload.

## Project layout

```
src/
  core/       Game loop and state machine, settings and save game, discoveries, story text
  world/      Layout, height and biome generation (worker), terrain, ocean, sky, caves, structures, vegetation
  creatures/  Instanced fish, rays, jellyfish, whales and their shapes
  fx/         Shared underwater material patch, caustics, light shafts, particles, post-processing
  player/     Input and the diver's swim/walk physics with SDF collision
  audio/      Procedural Web Audio engine
  ui/         Menus, HUD, journal, map and styles
tests/        Node unit tests for world generation, layout and save data
```

## Test and build

```bash
npm test           # node --test: world generation, layout, journal coverage, settings and save validation
npm run build      # static build in dist/
npm run preview    # serve dist/ at http://localhost:4173
```

## Deploy to GitHub Pages

`vite.config.js` uses `base: '/LUMEN/'`, so the repository must be named `LUMEN` (rename it and change `base` to
match otherwise). Push to `main` and enable
**Settings → Pages → Source: GitHub Actions**. The workflow in `.github/workflows/deploy.yml` then tests, builds and
publishes `dist/`.

## Requirements

A browser with WebGL 2 (current Chrome, Edge, Firefox or Safari). On a 4-core laptop with an integrated GPU, the Low
preset runs at 60 fps. Medium and above are aimed at discrete GPUs.

## Performance

While playing, the game lowers its render resolution in 10% steps (down to 60%) when frames take longer than 21 ms,
and raises it again once frames hold the display rate. If raising it costs frame rate, it waits longer before trying
again. Above water, terrain chunks and structures that lie wholly below 25 m are not drawn, because the ocean surface
is opaque at that depth.

Measured on an Intel UHD integrated GPU (ANGLE/D3D11), Medium preset, 1366×633 canvas, in-game benchmark
(`window.__lumenBench.measure`). Before: one 3 s run. After: median of three 1.5 s runs at a fixed 100% resolution.
GPU timings on this machine vary by ±3–6 ms between runs, so differences in fps or GPU time this small are noise.

| View | Draw calls before → after | FPS before → after (100%) | FPS with dynamic resolution |
|---|---|---|---|
| Beach, facing the sea | 201 → 163 | 50.8 → 45.3 | 43.1 (60%) |
| Reef, 2.5 m down | 155 → 150 | 44.2 → 45.3 | 58.0 (60%) |
| Inland from the beach | not measured → 270 | not measured → 30.9 | 36.8 (70%) |
| Deep, 188 m down | — | — | 60 (back to 100% within 12 s) |

The beach view gains nothing from a lower resolution: it is CPU-bound (draw submission). The inland view is limited by
both CPU and GPU, so it improves but does not reach 60 fps.
