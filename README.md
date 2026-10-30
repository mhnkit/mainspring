# Mainspring

An interactive 3D look inside clocks and watches. Choose a category, pick one of its models, scroll to take it apart piece by piece, then add it to the cart and register it.

It's a static site: plain HTML, CSS and ES modules, with Three.js, GSAP ScrollTrigger and Lenis loaded from the jsDelivr CDN. There's no build step, no backend and no login. Checkout only validates the form and confirms "Product registered!".

## Preview locally

ES modules don't load from `file://`, so serve the folder:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open the printed address (for example http://localhost:3000 or http://localhost:8000).

## Deploy to Vercel

Either way works:

- **Dashboard:** push this folder to a GitHub repository, then in Vercel choose *Add New → Project*, import the repository, set *Framework Preset* to **Other**, leave the build command empty and keep the root directory as the output. Deploy.
- **CLI:** `npm i -g vercel`, then run `vercel` inside this folder (and `vercel --prod` for production).

`vercel.json` turns on clean URLs and sets cache headers. Nothing else is needed.

## Project layout

```
index.html            page shell, overlays, cart drawer, checkout
styles.css            all styling, including the phone layout and reduced motion
vercel.json           Vercel settings
models/               put real .glb files here (optional)
src/
  config.js           every category, model, part, spec and price
  main.js             views, camera flights, input, scroll, cart flow
  item.js             one floating timepiece: springs, float, explode, cart flight
  models/             procedural builders (mechanical, quartz, digital, clock) and the registry
  three/              renderer and lighting (stage.js), materials, geometry and canvas textures
  ui/                 part labels with leader lines; cart, drawer and checkout
  lib/                spring physics and synthesized sound
```

## Edit products

Everything lives in `src/config.js`: category names, the part list for each category (its order is the order parts come apart), the label and one-line explanation for each part, and each model's name, type, price, description and specs. A model's `look` object controls the procedural build (case size, dial colour, hand style, strap and so on).

Each category has an `explode` block:

| Key | What it does |
| --- | --- |
| `tilt` | How far the model tips back as it comes apart, in radians |
| `azimuth`, `elevation` | The three-quarter camera angle at full explode |
| `gap` | Space between separated parts, relative to the model's size |

## Use real 3D models

1. Export a `.glb` (Draco or Meshopt compression and KTX2 textures are supported).
2. Name each mesh, or a parent node, after a part key from `config.js`, such as `crystal`, `dial`, `gearTrain` or `caseback`. Anything unnamed becomes part of `case`.
3. Put the file in `models/` and add `glb: '/models/your-file.glb'` to that model in `config.js`.

The loaders only download when a model has a `glb` path. If a file fails to load, the procedural model is used instead.

## Notes

- Works in current Chrome, Edge, Firefox and Safari (16.4 or later, for import maps).
- Sound is off by default; the speaker button in the top bar turns it on.
- With "reduce motion" turned on in the operating system, camera flights become crossfades and the exploded view is shown as a static labelled layout.
- Rendering pauses when the tab is hidden, the pixel ratio is capped at 2, and it steps down automatically if frames run slow.
