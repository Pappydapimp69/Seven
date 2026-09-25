// render.js — Three.js presentation of the basin, drawn from PERCEPTION.
//
// Hard rule: this module reads the perceived world (percept.js), never the sim's
// truth. That is what lets a hallucinating lead be shown a monolith that does not
// exist without any special case here — the phantom simply arrives in the same
// list as the real ones.

import * as THREE from "../lib/three.module.js";
import { CELL, cellToWorld, gridOf } from "./world.js?v=seven-0.26.2";
import { nightFactor } from "./state.js?v=seven-0.26.2";
import { perceivedMonoliths, perceivedPylons, perceivedCompanions, perceivedWorldItems, distortion } from "./percept.js?v=seven-0.26.2";
import { PYLON_RADIUS } from "./state.js?v=seven-0.26.2";
import { WEATHER_LOOK, dayMarks } from "./woods.js?v=seven-0.26.2";

const PALETTE = {
  sky: 0x0a0f16,
  fog: 0x121a24,
  fogLost: 0x2a1d2b, // the basin goes wrong-coloured when the lead does
  ground: 0x333c4b,
  groundHi: 0x475364,
  // Lifted from 0x1b212b, which was the real reason the basin looked flat. At
  // that value a spire returns almost nothing to any light in the scene, so
  // facets, rim and fog all landed inside one or two sRGB steps and a stand of
  // them rendered as a single cutout. This is still dark and still cold — it is
  // the same hue — but it is far enough off the floor to HAVE a lit side.
  rock: 0x39424f,
  // Two more, for per-instance variation across the spire field. One mass in
  // one colour reads as a repeated stamp however many instances it has; the
  // shading below picks a point on this range from each cell's own hash, so it
  // is deterministic and costs no rng.
  rockCool: 0x2e3a4a,
  rockWarm: 0x474337,
  monolith: 0x59657a,
  monolithLogged: 0x7fd6c0,
  pylon: 0x2a3550,
  pylonLive: 0x74e0ff,
  pylonDead: 0x40484f,
  camp: 0xffb562,
  body: 0x8d97a8,
  // A gone companion must separate from a well one by LUMINANCE, not hue. The
  // previous 0xb06a72 was a warm red at almost exactly the body's brightness:
  // WCAG contrast 1.38 normally and 1.14 simulated for deuteranopia, i.e. the
  // single most important tell in the game — "that mind is gone" — was
  // invisible to a large share of players. This is the same warm register,
  // dropped in brightness: 3.15 against the body across all three CVD types,
  // and still 1.8 against PALETTE.monster, which additionally carries a size
  // change and a different eye colour. (Brain: COUCH-MULTIPLAYER/accessibility
  // — no palette is safe across all CVD types, so meaning must never rest on
  // hue alone. A contrast guard in logic.test.mjs holds this.)
  bodyLost: 0x5e2f3c,
  monster: 0x140a0d, // near-black with a red undertone — wrong, not just "gone"
  monsterEye: 0xff2a2a,
  itemFlare: 0xff8a3d,
  itemTether: 0x5fe0c0,
  itemLens: 0xbfe6ff,
  treeTrunk: 0x4a3826,
  treeLeaf: 0x3f6b3f, // green, deliberately distinct from the dark rock-spire cones
  stoneDeposit: 0x8b95a3, // lighter than the near-black rock spires and the grey ground litter
};

// No phantom-object case here — a fake pickup is resolved entirely in
// state.js/percept.js's inventory layer, never as a fake mesh sitting in the
// world (see perceivedWorldItems's own comment for why).
const ITEM_COLOR = { flare: PALETTE.itemFlare, tether: PALETTE.itemTether, lens: PALETTE.itemLens };

const EYE_HEIGHT = 1.72;

// Horizontal field of view, in degrees. 90 sits in the ordinary first-person
// band (most games ship 90-100 horizontal); past ~100 the perspective starts
// reading as a fisheye lens rather than as a room.
// 90 was too wide. Rectilinear projection stretches hard toward the frame edges
// at that angle — trunks near the screen border lean and smear as you turn, and
// it reads as the lens being wrong rather than as a wide view. It is also the
// wrong choice for THIS game: a slow, close, wooded exploration where the
// periphery is where you are trying to notice a figure. 78 keeps the edges
// honest. Still a player setting (70-110) — this is only the default.
const DEFAULT_HFOV = 78;
// On a very tall/narrow window (a phone held upright) deriving vertical from a
// fixed horizontal would balloon it, so cap it — a portrait player loses a
// little horizontal instead of gaining a vertical fisheye.
// And a hard cap on the VERTICAL, which is what actually distorts. On a narrow
// or square window verticalFov() from a wide horizontal runs away — at a 1:1
// aspect a 90 horizontal solves to 90 vertical — so the cap is the only thing
// standing between an unusual window shape and a fisheye. 68 is wide enough to
// feel open and short of where the stretch becomes obvious.
const MAX_VFOV = 68;

/** The VERTICAL fov Three wants, for a given aspect, holding horizontal fixed. */
function verticalFov(aspect, hfov = DEFAULT_HFOV) {
  const h = (hfov * Math.PI) / 180;
  const v = 2 * Math.atan(Math.tan(h / 2) / Math.max(0.2, aspect || 1));
  return Math.min(MAX_VFOV, (v * 180) / Math.PI);
}

export function createRenderer(canvas, sim) {
  // The grid of the world being drawn, not the basin constant: the camp has its
  // own, and reading `cellKind` at the wrong stride draws a different map
  // entirely — every cell shifted, with nothing thrown. `world.js` no longer
  // exports GRID to this module, so a missed site is a ReferenceError.
  const grid = gridOf(sim.world);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // NO TONE CURVE, and this was tried the other way first.
  //
  // ACES was the obvious reach for a scene that lives in the bottom eighth of
  // the range — it is what everything else uses. It made this one WORSE, and
  // the reason is worth keeping: a filmic curve's toe DARKENS shadows on its
  // way to compressing highlights, and a basin at dusk is nothing but shadow.
  // There were no highlights to buy the trade with, so it spent contrast the
  // scene could not spare and the spires went from dark cones to solid cutouts.
  // Screenshots either side, same seed and same camera, settled it.
  //
  // The plain sRGB transfer function already lifts darks harder than ACES does
  // here. The range this scene was missing is not in the curve — it is in the
  // content, which was authored near-black. That is fixed below, in the rock.
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  // Fog density set against SIGHT_RANGE (38 units): at 0.021 a marker at the
  // edge of sighting range was ~47% fogged out, which made exploring feel like
  // guessing. 0.014 keeps the basin oppressive but legible.
  // The CAMP is daylight, not a fogged basin at dusk. Same scene, different
  // weather: thinner fog so you can see the length of the path and the cabins
  // at the far end, and a warmer ground colour. Built without this the camp
  // rendered as a near-black clearing — correct geometry, unreadable place.
  const isCamp = !!sim.world.cellKind;
  scene.fog = new THREE.FogExp2(isCamp ? 0x8fa2b4 : PALETTE.fog, isCamp ? 0.006 : 0.014);
  // Without this the sky is the clear colour — black — so a daylit camp still
  // read as night above the treeline.
  if (isCamp) scene.background = new THREE.Color(0x8fa2b4);

  // FIELD OF VIEW IS HORIZONTAL-FIRST ("Hor+"), and this matters more than it
  // looks. Three's PerspectiveCamera takes a VERTICAL fov, and this shipped at
  // 72 — which is 105° HORIZONTAL on a 16:9 screen and 119° on an ultrawide.
  // That is deep fisheye: wide-angle perspective bows straight lines toward the
  // frame edges and sweeps edge geometry past you as you walk, which reads as
  // "the world is curved and misshapen" and as a problem with the MOVEMENT,
  // even though the movement is mathematically exact (a constant input walks a
  // line with 0.0000 lateral deviation — measured, not assumed).
  //
  // So: pick the horizontal angle and derive vertical from the real aspect.
  // A wider monitor now shows MORE WORLD instead of more distortion, which is
  // the whole point of Hor+ — the lens stops changing shape with the window.
  // Player-adjustable, because comfort at a given angle is genuinely personal —
  // the same lens that reads as "a room" to one player reads as a tunnel or a
  // fisheye to another. setFov() is the only writer.
  let hfov = DEFAULT_HFOV;
  const camera = new THREE.PerspectiveCamera(verticalFov(1.778, hfov), 1, 0.1, 420);
  const rig = new THREE.Group(); // yaw/position; camera holds pitch and roll
  rig.add(camera);
  scene.add(rig);

  const sky = isCamp
    ? new THREE.HemisphereLight(0xcfe0f2, 0x6a6555, 1.5)
    : new THREE.HemisphereLight(0x5d708c, 0x1d2230, 1.05);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(isCamp ? 0xfff0d8 : 0xbfd0e6, isCamp ? 1.15 : 0.55);
  sun.position.set(-40, 60, 30);
  scene.add(sun);
  // A RIM, opposite the sun and low. The basin's problem was never brightness —
  // it was that a dark cone in front of dark fog has no edge, so a stand of
  // spires reads as one flat mass however many of them there are. A cool light
  // from behind catches the far side of each silhouette and puts a line between
  // them. Deliberately weak: this is separation, not illumination, and pushing
  // it turns an oppressive basin into a lit set.
  const rim = new THREE.DirectionalLight(isCamp ? 0xbcd2e8 : 0x6f86a8, isCamp ? 0.35 : 0.55);
  rim.position.set(46, 22, -38);
  scene.add(rim);
  // A single carried lamp — cheaper than one light per companion, and it makes
  // the party's own pool of light the thing you navigate by.
  const lamp = new THREE.PointLight(0xffdcb0, 1.9, 44, 1.5);
  // NIGHTFALL, held as the values the scene was BUILT with rather than as a
  // second copy of them. The camp and the woods run no cycle (nightFactor knows
  // that), so this is inert there without the renderer needing to ask.
  const dayLit = { sky: sky.intensity, sun: sun.intensity, rim: rim.intensity, fog: scene.fog.density, lamp: lamp.intensity };
  rig.add(lamp);

  // ---- the sky, as a gradient rather than a colour --------------------------
  //
  // `scene.background` was a flat Color, and the update loop then overwrote it
  // with black on every frame — so PALETTE.sky was dead the moment the first
  // frame ran, and the basin's whole upper half was one value. A single value
  // above the treeline reads as a wall, and it wastes the one place in the
  // frame where depth is free: the horizon.
  //
  // A closed sphere on the inside, with a vertical two-stop gradient. It is one
  // extra draw call, no texture, and the colours are uniforms so nightfall
  // drives them instead of a second copy of the palette.
  const SKY = isCamp
    ? { low: new THREE.Color(0xa8bccb), high: new THREE.Color(0x5f7f9e) }
    : { low: new THREE.Color(0x2a3646), high: new THREE.Color(0x070b12) };
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      low: { value: SKY.low.clone() },
      high: { value: SKY.high.clone() },
      // Where the gradient's midpoint sits, as a height above the eye. Small,
      // because the interesting band is just above the treeline.
      spread: { value: 120.0 },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 low;
      uniform vec3 high;
      uniform float spread;
      varying vec3 vWorld;
      void main() {
        // smoothstep rather than a linear mix: a straight ramp puts a visible
        // mach band across the sky at this value range, and the eye finds it
        // immediately on a flat-shaded scene with no texture anywhere else.
        float t = smoothstep(-0.12, 1.0, vWorld.y / spread);
        gl_FragColor = vec4(mix(low, high, t), 1.0);
      }
    `,
  });
  // 380, not 420. The camera's far plane IS 420, so a dome of that radius sits
  // exactly on it — the horizon band lands in the worst depth precision the
  // buffer has, and whether it survives the depth test is down to rounding.
  // It happened to draw during this work, which is the kind of "working" that
  // stops working on someone else's GPU.
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(380, 24, 16), skyMat);
  // Follows the eye, so the horizon never slides away from the player. Render
  // first and without depth so everything else draws over it.
  skyDome.renderOrder = -1;
  skyDome.frustumCulled = false;
  scene.add(skyDome);
  // The clear colour still shows for one frame before the dome draws, and on
  // any pixel the dome somehow misses, so it matches the horizon rather than
  // being black.
  scene.background = SKY.low.clone();

  // ---- terrain -------------------------------------------------------------
  const span = grid * CELL;
  const groundGeo = new THREE.PlaneGeometry(span, span, grid, grid);
  groundGeo.rotateX(-Math.PI / 2);
  {
    const pos = groundGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    // Grass in the camp, cold rock in a basin.
    const lo = new THREE.Color(isCamp ? 0x3f5230 : PALETTE.ground);
    const hi = new THREE.Color(isCamp ? 0x59703c : PALETTE.groundHi);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = sim.world.heightAt(x / CELL + grid / 2, z / CELL + grid / 2);
      pos.setY(i, h);
      c.copy(lo).lerp(hi, Math.min(1, Math.max(0, (h + 2) / 7)));
      // A TONAL SCATTER, deterministic from the vertex's own cell. Height alone
      // is a smooth field, so lerping colour along it produced a smooth wash —
      // the basin floor read as a sheet of plastic with a gradient on it, which
      // is the one surface in frame the eye has nothing else to hold onto. This
      // is small enough not to look like noise and large enough to give the
      // ground a grain. Hashed, not random: the same seed draws the same floor.
      const gx = Math.round(x / CELL + grid / 2);
      const gz = Math.round(z / CELL + grid / 2);
      const j = ((gx * 73856093) ^ (gz * 19349663)) >>> 0;
      const shade = 0.88 + ((j % 100) / 100) * 0.24;
      colors[i * 3] = c.r * shade;
      colors[i * 3 + 1] = c.g * shade;
      colors[i * 3 + 2] = c.b * shade;
    }
    groundGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    groundGeo.computeVertexNormals();
  }
  const ground = new THREE.Mesh(
    groundGeo,
    // FLAT SHADING, like everything else in the scene. Smooth normals over a
    // gentle heightfield give every triangle almost the same response, so the
    // floor lit as one tone no matter how much relief the terrain actually had
    // — and it was the only smooth-shaded surface among flat-shaded spires,
    // trees and stones, which is why it read as a different material entirely.
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true }),
  );
  scene.add(ground);

  const terrainHeight = (x, z) => sim.world.heightAt(x / CELL + grid / 2, z / CELL + grid / 2);

  // ---- what a blocked cell LOOKS like --------------------------------------
  // A basin has one answer: a rock spire. The camp has four, and it needs them —
  // built without this, its cabins drew as rock, its treeline drew as rock, and
  // its dirt path drew as nothing, so the whole map read as a rocky clearing and
  // a player who pressed "Learn the walk" believed the tutorial had not loaded.
  // Every geometry test passed the whole time; none of them can see.
  //
  // `cellKind` is camp-only. A world without it takes the original path below,
  // unchanged.
  const KIND = { NONE: 0, CABIN: 1, TREELINE: 2, WOOD: 3, PATH: 4 };
  const kindAt = (cx, cz) => (sim.world.cellKind ? sim.world.cellKind[cz * grid + cx] : KIND.NONE);
  const isSpire = (cx, cz) => {
    const i = cz * grid + cx;
    if (!sim.world.blocked[i]) return false;
    return kindAt(cx, cz) === KIND.NONE;   // anything tagged draws as itself
  };

  // ---- the day's weather (THE WOODS) ----------------------------------------
  //
  // The weather is one of the six things a false account can bend, and until
  // 0.26 nothing drew it — so a wrong-weather claim asked the player about a
  // thing they had never been shown. The look is woods.js's WEATHER_LOOK, read
  // off `sim.woods.weather` EVERY FRAME rather than copied at build: a copy is
  // one missed update from the scene and the chronicle disagreeing.
  const weatherLook = () => (isCamp && sim.woods ? WEATHER_LOOK[sim.woods.weather] || null : null);

  // Wind is MOVEMENT, so it is drawn in the vertex shader rather than by
  // rewriting a thousand instance matrices a frame. Every tree leans the same
  // way — a still frame of a windy day has to read as wind too, and trees
  // swaying at random read as nothing in particular.
  const windU = { uWindT: { value: 0 }, uSway: { value: 0 } };
  function swayable(mat, base) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWindT = windU.uWindT;
      sh.uniforms.uSway = windU.uSway;
      sh.vertexShader = "uniform float uWindT;\nuniform float uSway;\n" + sh.vertexShader.replace(
        "#include <project_vertex>",
        THREE.ShaderChunk.project_vertex.replace(
          "mvPosition = modelViewMatrix * mvPosition;",
          `vec4 wSw = modelMatrix * mvPosition;
          float wH = max(0.0, transformed.y + ${base.toFixed(2)}) / 7.8;
          float wPh = uWindT * 2.3 + wSw.x * 0.31 + wSw.z * 0.17;
          wSw.x += uSway * wH * wH * (0.85 + 0.45 * sin(wPh));
          wSw.z += uSway * wH * wH * 0.22 * sin(wPh * 1.37);
          mvPosition = viewMatrix * wSw;`,
        ),
      );
    };
  }

  // Held for the weather: frost whitens the crowns, drizzle darkens the grass.
  let campLeaf = null;
  let creekWater = null;
  const leafBase = new THREE.Color(PALETTE.treeLeaf);
  const creekBase = new THREE.Color(0x3d5a6b);

  // Rain: short streaks in a box that follows the eye. Positions are hashed,
  // not random, so tools/shoot.mjs frames of the same instant are identical.
  const RAIN_N = 1400, RAIN_BOX = 26, RAIN_H = 16;
  const rainPos = new Float32Array(RAIN_N * 6);
  const rainSeed = new Float32Array(RAIN_N * 3);
  for (let i = 0; i < RAIN_N; i++) {
    const j = Math.imul(i + 1, 2654435761) >>> 0;
    rainSeed[i * 3] = ((j % 1000) / 1000 - 0.5) * RAIN_BOX * 2;
    rainSeed[i * 3 + 1] = (((j >>> 10) % 1000) / 1000) * RAIN_H;
    rainSeed[i * 3 + 2] = ((((j >>> 20) % 1000) / 1000) - 0.5) * RAIN_BOX * 2;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xc2ced8, transparent: true, opacity: 0.6, fog: false }));
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);

  // Leaves on the wind: the other half of "wind", because a treeline swaying at
  // the edge of the frame is easy to walk a whole day without looking at.
  const LEAF_N = 220;
  const leafPos = new Float32Array(LEAF_N * 3);
  const leafGeo = new THREE.BufferGeometry();
  leafGeo.setAttribute("position", new THREE.BufferAttribute(leafPos, 3));
  const leafFly = new THREE.Points(leafGeo, new THREE.PointsMaterial({ color: 0x7a6a3a, size: 0.22 }));
  leafFly.frustumCulled = false;
  leafFly.visible = false;
  scene.add(leafFly);

  /** Move the rain and the leaves. `t` is scene time; everything is a function of it. */
  function updateWeatherParticles(look, eye, t) {
    rain.visible = !!(look && look.rain);
    leafFly.visible = !!(look && look.leaves);
    if (rain.visible) {
      const fall = 14;
      for (let i = 0; i < RAIN_N; i++) {
        const x = eye.x + rainSeed[i * 3];
        const z = eye.z + rainSeed[i * 3 + 2];
        const y = RAIN_H - ((rainSeed[i * 3 + 1] + t * fall) % RAIN_H) + terrainHeight(eye.x, eye.z) - 2;
        rainPos.set([x, y, z, x + 0.05, y - 0.55, z], i * 6);
      }
      rainGeo.attributes.position.needsUpdate = true;
    }
    if (leafFly.visible) {
      const span = RAIN_BOX * 2;
      for (let i = 0; i < LEAF_N; i++) {
        const sx = rainSeed[i * 3], sy = rainSeed[i * 3 + 1], sz = rainSeed[i * 3 + 2];
        const x = eye.x - RAIN_BOX + ((sx + RAIN_BOX + t * (7 + (i % 5))) % span + span) % span;
        const y = terrainHeight(eye.x, eye.z) + 0.3 + (sy / RAIN_H) * 5 + Math.sin(t * 3 + i) * 0.4;
        leafPos.set([x, y, eye.z + sz], i * 3);
      }
      leafGeo.attributes.position.needsUpdate = true;
    }
  }
  if (sim.world.cellKind) buildCampScenery();

  /** Cabins, trees and a dirt path — the camp's own vocabulary. */
  function buildCampScenery() {
    const timber = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95, flatShading: true });
    const roof = new THREE.MeshStandardMaterial({ color: 0x2e2620, roughness: 1, flatShading: true });
    const trunkMat = new THREE.MeshStandardMaterial({ color: PALETTE.treeTrunk, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: PALETTE.treeLeaf, roughness: 0.85, flatShading: true });
    campLeaf = leafMat;
    // The offset is how far the geometry's local origin sits above the ground,
    // so the bend grows from the roots: a trunk is centred on 1.7, a crown on
    // 3.4 + 2.2.
    swayable(leafMat, 5.6);
    swayable(trunkMat, 1.7);
    // Well lighter than the grass. At 0x50432f the path was technically drawn
    // and read as a slightly different green — a path you cannot see is not a path.
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0x9c7f55, roughness: 1 });

    // CABINS. One box per tagged cell would read as a wall of cubes, so
    // contiguous runs are merged into a single building per rectangle and only
    // the run's first cell places geometry.
    const seen = new Uint8Array(grid * grid);
    for (let cz = 0; cz < grid; cz++) {
      for (let cx = 0; cx < grid; cx++) {
        if (kindAt(cx, cz) !== KIND.CABIN || seen[cz * grid + cx]) continue;
        let x1 = cx; while (x1 + 1 < grid && kindAt(x1 + 1, cz) === KIND.CABIN) x1++;
        let z1 = cz;
        outer: while (z1 + 1 < grid) {
          for (let x = cx; x <= x1; x++) if (kindAt(x, z1 + 1) !== KIND.CABIN) break outer;
          z1++;
        }
        for (let z = cz; z <= z1; z++) for (let x = cx; x <= x1; x++) seen[z * grid + x] = 1;

        const a = cellToWorld(cx, cz, grid), b = cellToWorld(x1, z1, grid);
        const w = Math.abs(b.x - a.x) + CELL, d = Math.abs(b.z - a.z) + CELL;
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        const ground = terrainHeight(mx, mz);
        const H = 3.2;
        const walls = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, H, d * 0.92), timber);
        walls.position.set(mx, ground + H / 2, mz);
        scene.add(walls);
        // A pitched roof, so it reads as a building rather than a crate.
        const cap = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, 1.9, 4), roof);
        cap.position.set(mx, ground + H + 0.85, mz);
        cap.rotation.y = Math.PI / 4;
        scene.add(cap);
      }
    }

    // TREES, for the perimeter wall and the thin wood inside it. Instanced —
    // there are over a thousand.
    let treeCount = 0;
    for (let i = 0; i < sim.world.cellKind.length; i++) {
      const k = sim.world.cellKind[i];
      if (k === KIND.TREELINE || k === KIND.WOOD) treeCount++;
    }
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.32, 3.4, 5), trunkMat, treeCount);
    const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1.5, 4.4, 6), leafMat, treeCount);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    let n = 0;
    for (let cz = 0; cz < grid; cz++) {
      for (let cx = 0; cx < grid; cx++) {
        const k = kindAt(cx, cz);
        if (k !== KIND.TREELINE && k !== KIND.WOOD) continue;
        const { x, z } = cellToWorld(cx, cz, grid);
        // Deterministic jitter from the cell index — the same camp every time,
        // without touching the sim's rng.
        const j = ((cx * 73856093) ^ (cz * 19349663)) >>> 0;
        const ox = (((j % 100) / 100) - 0.5) * CELL * 0.55;
        const oz = ((((j >>> 8) % 100) / 100) - 0.5) * CELL * 0.55;
        const h = 0.82 + ((j >>> 16) % 100) / 100 * 0.7;
        const g = terrainHeight(x + ox, z + oz);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((j >>> 5) % 360) * (Math.PI / 180));
        m.compose(new THREE.Vector3(x + ox, g + 1.7 * h, z + oz), q, new THREE.Vector3(h, h, h));
        trunks.setMatrixAt(n, m);
        m.compose(new THREE.Vector3(x + ox, g + (3.4 + 2.2) * h, z + oz), q, new THREE.Vector3(h, h, h));
        crowns.setMatrixAt(n, m);
        n++;
      }
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    scene.add(trunks, crowns);

    // THE PATH. Flat quads just above the ground, so the route through the camp
    // is legible as a route.
    const pathGeo = new THREE.PlaneGeometry(CELL, CELL);
    let pathCount = 0;
    for (let i = 0; i < sim.world.cellKind.length; i++) if (sim.world.cellKind[i] === KIND.PATH) pathCount++;
    const dirt = new THREE.InstancedMesh(pathGeo, dirtMat, pathCount);
    let pn = 0;
    for (let cz = 0; cz < grid; cz++) {
      for (let cx = 0; cx < grid; cx++) {
        if (kindAt(cx, cz) !== KIND.PATH) continue;
        const { x, z } = cellToWorld(cx, cz, grid);
        m.makeRotationX(-Math.PI / 2);
        // Sample the cell's CORNERS and clear the highest of them. Placing the
        // quad at the cell-centre height buried it: the ground is an
        // interpolated vertex-coloured plane, so between grid vertices the real
        // surface can sit well above the centre sample, and the path vanished
        // under the grass in exactly the places the ground rose.
        const h = Math.max(
          terrainHeight(x - CELL / 2, z - CELL / 2), terrainHeight(x + CELL / 2, z - CELL / 2),
          terrainHeight(x - CELL / 2, z + CELL / 2), terrainHeight(x + CELL / 2, z + CELL / 2),
          terrainHeight(x, z),
        );
        m.setPosition(x, h + 0.06, z);
        dirt.setMatrixAt(pn++, m);
      }
    }
    dirt.instanceMatrix.needsUpdate = true;
    scene.add(dirt);
  }

  // ---- rock spires (one instanced mesh for every UNTAGGED blocked cell) -----
  {
    let count = 0;
    for (let cz = 0; cz < grid; cz++) for (let cx = 0; cx < grid; cx++) if (isSpire(cx, cz)) count++;
    const rocks = new THREE.InstancedMesh(
      new THREE.ConeGeometry(CELL * 0.72, 1, 6),
      // roughness just off 1: a perfectly rough surface has no directional
      // response at all, so the rim light had nothing to catch and the facets
      // stayed equal. 0.92 is still matte rock and it lets an edge exist.
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: true }),
      count,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const tint = new THREE.Color();
    const rockCool = new THREE.Color(PALETTE.rockCool);
    const rockWarm = new THREE.Color(PALETTE.rockWarm);
    const rockBase = new THREE.Color(PALETTE.rock);
    let n = 0;
    for (let cz = 0; cz < grid; cz++) {
      for (let cx = 0; cx < grid; cx++) {
        if (!isSpire(cx, cz)) continue;
        const { x, z } = cellToWorld(cx, cz, grid);
        // Deterministic pseudo-variation from the cell index — no rng needed, and
        // it stays identical across reloads of the same seed.
        const j = ((cx * 73856093) ^ (cz * 19349663)) >>> 0;
        const h = 3.4 + ((j % 100) / 100) * 5.2;
        const yaw = ((j >>> 7) % 360) * (Math.PI / 180);
        // A FEW DEGREES OFF VERTICAL, and a width that is not 1:1. Every spire
        // being a perfectly upright cone of the same footprint is what made a
        // field of them read as a repeating tile rather than as terrain — the
        // eye locks onto the shared axis immediately. All of it comes off the
        // same cell hash, so it is stable across reloads of a seed and adds no
        // rng draw to a sim that counts them.
        const tiltX = (((j >>> 11) % 100) / 100 - 0.5) * 0.14;
        const tiltZ = (((j >>> 17) % 100) / 100 - 0.5) * 0.14;
        const wide = 0.82 + ((j >>> 23) % 100) / 100 * 0.42;
        e.set(tiltX, yaw, tiltZ);
        q.setFromEuler(e);
        m.compose(
          new THREE.Vector3(x, terrainHeight(x, z) + h / 2 - 0.4, z),
          q,
          new THREE.Vector3(wide, h, wide * (0.9 + ((j >>> 5) % 100) / 100 * 0.2)),
        );
        rocks.setMatrixAt(n, m);
        // Taller spires trend cooler, shorter ones warmer — it is the cheapest
        // cue that the field has near and far in it, and it survives fog, which
        // a hue-only scatter does not.
        const t = (h - 3.4) / 5.2;
        tint.copy(rockBase).lerp(t > 0.5 ? rockCool : rockWarm, Math.abs(t - 0.5) * 0.9);
        rocks.setColorAt(n, tint);
        n++;
      }
    }
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    scene.add(rocks);
  }

  // ---- ground litter -------------------------------------------------------
  // Scattered stones across the open floor. Not decoration: the basin is a fogged
  // plain, and without near-field detail passing the camera there is no parallax,
  // so walking reads as standing still with the fog shifting. This is the cheapest
  // fix — one instanced mesh, no per-frame work — and it is what makes movement
  // legible in an exploration game with a short view distance.
  {
    const MAX = 620;
    const stones = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.34, 0),
      // Lighter than the floor it sits on, and lighter than it used to be. This
      // was 0x39424f, chosen against a near-black rock — and the spire lift
      // above moved PALETTE.rock to exactly that value, so the litter would
      // have become the same colour as the thing it exists to contrast with.
      // A ground stone's whole job is to pass the camera and be SEEN passing.
      new THREE.MeshStandardMaterial({ color: 0x5a6472, roughness: 1, flatShading: true }),
      MAX,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    // Deterministic scatter from the cell index, so the same seed lays out the
    // same stones on every reload without consuming the sim's rng stream.
    for (let cz = 1; cz < grid - 1 && n < MAX; cz++) {
      for (let cx = 1; cx < grid - 1 && n < MAX; cx++) {
        if (sim.world.blocked[cz * grid + cx]) continue;
        const j = ((cx * 2654435761) ^ (cz * 40503)) >>> 0;
        if (j % 5 !== 0) continue; // ~20% of open cells get one
        const ox = (((j >>> 3) % 100) / 100 - 0.5) * CELL;
        const oz = (((j >>> 11) % 100) / 100 - 0.5) * CELL;
        const { x, z } = cellToWorld(cx, cz, grid);
        const s = 0.5 + ((j >>> 17) % 100) / 140;
        q.setFromAxisAngle(up, ((j >>> 5) % 360) * (Math.PI / 180));
        m.compose(
          new THREE.Vector3(x + ox, terrainHeight(x + ox, z + oz) + 0.08 * s, z + oz),
          q,
          new THREE.Vector3(s, s * 0.6, s),
        );
        stones.setMatrixAt(n++, m);
      }
    }
    stones.count = n; // don't draw unused instances at the origin
    stones.instanceMatrix.needsUpdate = true;
    scene.add(stones);
  }

  // ---- camp ---------------------------------------------------------------
  {
    const camp = new THREE.Group();
    const { x, z } = sim.world.camp;
    camp.position.set(x, terrainHeight(x, z), z);
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.16, 6, 6),
      new THREE.MeshStandardMaterial({ color: 0x555f6d, roughness: 0.8 }),
    );
    mast.position.y = 3;
    camp.add(mast);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 14, 12),
      new THREE.MeshBasicMaterial({ color: PALETTE.camp }),
    );
    beacon.position.y = 6.2;
    camp.add(beacon);
    camp.add(new THREE.PointLight(PALETTE.camp, 1.1, 26, 1.7).translateY(6.2));
    scene.add(camp);
  }

  // ---- monoliths, pylons, figures: pooled and rebuilt from perception ------
  const monolithGeo = new THREE.BoxGeometry(1.5, 7.4, 1.1);
  const ringGeo = new THREE.TorusGeometry(PYLON_RADIUS, 0.09, 6, 40);
  const pool = { monoliths: new Map(), pylons: new Map(), figures: new Map(), items: new Map(), trees: new Map(), stones: new Map(), sites: new Map(), fires: new Map(), falls: new Map(), marks: new Map() };

  function makeMonolith() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      monolithGeo,
      new THREE.MeshStandardMaterial({ color: PALETTE.monolith, roughness: 0.85, flatShading: true }),
    );
    body.position.y = 3.7;
    body.rotation.z = 0.06;
    g.add(body);
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 12, 10),
      new THREE.MeshBasicMaterial({ color: PALETTE.monolithLogged }),
    );
    cap.position.y = 7.7;
    cap.visible = false;
    g.add(cap);
    g.userData = { body, cap };
    scene.add(g);
    return g;
  }

  function makePylon() {
    const g = new THREE.Group();
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.5, 4.6, 8),
      new THREE.MeshStandardMaterial({ color: PALETTE.pylon, roughness: 0.7, metalness: 0.2 }),
    );
    col.position.y = 2.3;
    g.add(col);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 16, 12),
      new THREE.MeshBasicMaterial({ color: PALETTE.pylonLive }),
    );
    core.position.y = 5.0;
    g.add(core);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: PALETTE.pylonLive, transparent: true, opacity: 0.28 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.25;
    g.add(ring);
    const glow = new THREE.PointLight(PALETTE.pylonLive, 1.4, 22, 1.7);
    glow.position.y = 5.0;
    g.add(glow);
    g.userData = { core, ring, glow };
    scene.add(g);
    return g;
  }

  // FIVE DISTINCT BUILDS, one per roster slot. Every companion was the same
  // capsule in the same colour, so at any distance past a few metres the party
  // was five identical grey shapes and "who is that over there" had no answer.
  //
  // Silhouette carries the difference, not colour — heights, widths, a pack, a
  // hood. brain: the-game-the-recursion#E12 found two independently-authored
  // entity palettes landing on the red-green confusion axis at nearly identical
  // luminance, where only the silhouettes separated them. So the shapes differ
  // first and the tints are a secondary cue, checked for luminance spread — the
  // first pass put slots 3 and 5 within 0.7 luminance of each other ON that
  // axis, which is precisely E12's case, so slot 5 was darkened until every
  // pair clears a real margin.
  const BUILDS = [
    { r: 0.34, h: 1.05, head: 0.25, tint: 0x8d97a8, pack: true,  hood: false }, // 1 broad, packed
    { r: 0.27, h: 0.86, head: 0.22, tint: 0xb9a58c, pack: false, hood: false }, // 2 slight
    { r: 0.33, h: 1.16, head: 0.24, tint: 0x7f8d84, pack: false, hood: true  }, // 3 tall, hooded
    { r: 0.30, h: 0.78, head: 0.26, tint: 0xa89aa6, pack: true,  hood: false }, // 4 short, packed
    { r: 0.36, h: 0.98, head: 0.23, tint: 0x6a5f4a, pack: false, hood: false }, // 5 stocky
  ];

  function makeFigure(item) {
    const g = new THREE.Group();
    // `index` is 1-based on companions and 0 on the lead; a phantom has none, so
    // it falls through to slot 0's build and reads as a real member — which is
    // the point of a phantom.
    const b = BUILDS[Math.max(0, ((item?.index ?? 1) - 1)) % BUILDS.length];
    const mat = new THREE.MeshStandardMaterial({ color: b.tint, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(b.r, b.h, 6, 10), mat);
    body.position.y = 0.55 + b.h / 2;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(b.head, 12, 10), mat);
    head.position.y = 0.55 + b.h + b.head * 1.3;
    g.add(head);
    if (b.hood) {
      const hood = new THREE.Mesh(new THREE.ConeGeometry(b.head * 1.5, b.head * 2.1, 7), mat);
      hood.position.y = head.position.y + b.head * 0.5;
      g.add(hood);
    }
    if (b.pack) {
      const pack = new THREE.Mesh(new THREE.BoxGeometry(b.r * 1.5, b.h * 0.7, b.r * 0.9), mat);
      pack.position.set(0, 0.55 + b.h * 0.55, -b.r * 1.1);
      g.add(pack);
    }
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    );
    light.position.set(b.r * 0.9, 0.55 + b.h * 0.75, 0.22);
    g.add(light);
    g.userData = { mat, light, tint: b.tint, bob: Math.random() * 6.283, lastX: 0, lastZ: 0 };
    scene.add(g);
    return g;
  }

  /**
   * THE TRAINER, as a person.
   *
   * This was a 3.2-unit pole with a glowing octahedron on top and nothing else
   * — the marker WAS the character. Its own comment said the marker existed so
   * the objective would not "point at one of six identical figures standing in
   * a field", but campParty() stands the companions around the spawn yard at
   * the WEST end and the trainer is at the EAST end, so there was never a
   * figure there to mark. A player walked eighty metres to a lamp on a stick.
   *
   * Built distinct from BUILDS on every axis a silhouette carries, because the
   * one thing he must never read as is a sixth crew member:
   *   - TALLER than the tallest build (1.16) by a clear margin
   *   - a COAT: a tapered cylinder to the ground, where every companion is a
   *     capsule that stops at the shins
   *   - a flat WIDE BRIM, which is the read at distance — no build has one,
   *     and a cone hood is the nearest thing and looks nothing like it
   *   - the LANTERN in his hand rather than floating over him, so the light
   *     that makes him findable is a thing he is carrying
   * He is also the only figure in the game with no `tint` from the palette's
   * body range, so he cannot be mistaken for a companion under fog either.
   */
  let trainerMark = null;
  function ensureTrainerMark(at) {
    if (!at) { if (trainerMark) trainerMark.visible = false; return; }
    if (!trainerMark) {
      const g = new THREE.Group();
      const cloth = new THREE.MeshStandardMaterial({ color: 0x3c4a44, roughness: 0.95, flatShading: true });
      const dark = new THREE.MeshStandardMaterial({ color: 0x241f1a, roughness: 1, flatShading: true });
      const skin = new THREE.MeshStandardMaterial({ color: 0x9a8b78, roughness: 0.85 });

      // A long coat, narrow at the shoulder and flared to the ground.
      const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.52, 1.72, 8), cloth);
      coat.position.y = 0.86;
      g.add(coat);
      // Shoulders, so the coat has somebody in it.
      const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.18, 0.34), cloth);
      shoulders.position.y = 1.72;
      g.add(shoulders);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), skin);
      head.position.y = 1.98;
      g.add(head);
      // THE BRIM. This is the whole silhouette at eighty metres.
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.045, 12), dark);
      brim.position.y = 2.12;
      g.add(brim);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.24, 10), dark);
      crown.position.y = 2.24;
      g.add(crown);

      // The lantern, held out at his side.
      // ON HIS LEFT, and further out than it was. At local +x 0.5 the lantern
      // sat behind his own coat from half the angles you can stand at — it is
      // the thing that makes him findable down eighty metres of path, and it
      // was invisible in every screenshot taken of him. Local -x puts it on
      // the side a player walking in from the west actually sees, and 0.62
      // clears the coat's flare at that height (0.38 at y=1.12).
      const LAMP_X = -0.62;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.5, 6), cloth);
      arm.position.set(LAMP_X * 0.62, 1.5, 0.05);
      arm.rotation.z = -0.35;
      g.add(arm);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 4, 8), dark);
      hook.position.set(LAMP_X, 1.28, 0.05);
      g.add(hook);
      const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.19, 0), new THREE.MeshBasicMaterial({ color: 0xffd489 }));
      lamp.position.set(LAMP_X, 1.12, 0.05);
      g.add(lamp);
      const glow = new THREE.PointLight(0xffc879, 1.6, 16, 2);
      glow.position.set(LAMP_X, 1.12, 0.05);
      g.add(glow);

      g.userData.lamp = lamp;
      scene.add(g);
      trainerMark = g;
    }
    trainerMark.visible = true;
    trainerMark.position.set(at.x, terrainHeight(at.x, at.z), at.z);
    // Face down the path, toward the spawn end the player walks in from.
    trainerMark.rotation.y = Math.PI * 0.5;
    // A slow pulse on the lantern, so it reads as lit rather than as a decal.
    const t = performance.now() / 1000;
    trainerMark.userData.lamp.scale.setScalar(1 + Math.sin(t * 1.7) * 0.12);
  }

  // A deadfall: three trunks down across the ground, low enough to read as an
  // obstacle rather than a wall and solid enough that you believe it stops you.
  function makeFall() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1, flatShading: true });
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, CELL * 2.6, 5), mat);
      log.rotation.z = Math.PI / 2;
      log.position.set(0, 0.45 + i * 0.34, (i - 1) * 0.7);
      log.rotation.y = (i - 1) * 0.18;
      g.add(log);
    }
    return g;
  }

  // A fire: a low cone of flame over a ring of stones, plus the light it throws.
  // Everything that says how healthy it is — how tall, how bright, how far the
  // light reaches — is driven off fuel below, because this game shows no meters
  // and the fire IS the readout.
  function makeFire() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.72, 0.16, 4, 9),
      new THREE.MeshStandardMaterial({ color: 0x6b6660, roughness: 1, flatShading: true }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    g.add(ring);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.5, 1.2, 6),
      new THREE.MeshBasicMaterial({ color: 0xffa63a }),
    );
    flame.position.y = 0.7;
    g.add(flame);
    const glow = new THREE.PointLight(0xffa03c, 2.2, 22, 2);
    glow.position.y = 1.1;
    g.add(glow);
    g.userData = { flame, glow };
    return g;
  }

  // The four site BODIES. Each says what the place is, because the chronicle
  // lets a false account swap one fact's place for another real one ("went down
  // to the ridge for water" when it was the creek) and the player can only
  // catch that if the ridge and the creek are different things to have stood
  // at. Four identical cairns made `place` — one of six perturbation kinds —
  // unreadable, which is the same failure as a tell pitched below one display
  // increment: the mechanism fires correctly into something nobody can see.
  //
  // These are BODIES ONLY. The pole and lamp above them are the active-beat
  // indicator and are built once for every site, because that pair is the
  // renderer's single statement about which beat is live and it must not start
  // doubling as identity.
  const SITE_BODIES = {
    // A sunken run of water with stones along the bank.
    creek() {
      const g = new THREE.Group();
      const water = new THREE.Mesh(
        new THREE.BoxGeometry(CELL * 2.4, 0.12, CELL * 0.9),
        new THREE.MeshStandardMaterial({ color: 0x3d5a6b, roughness: 0.25, metalness: 0.1, flatShading: true }),
      );
      water.position.y = 0.06;
      water.rotation.y = 0.32;
      g.add(water);
      creekWater = water;
      const stone = new THREE.MeshStandardMaterial({ color: 0x77726a, roughness: 0.95, flatShading: true });
      for (let i = 0; i < 6; i++) {
        const r = 0.16 + (i % 3) * 0.07;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), stone);
        const along = (i - 2.5) * 0.78;
        rock.position.set(along * Math.cos(0.32), r * 0.6, along * Math.sin(0.32) + (i % 2 ? 0.85 : -0.85));
        g.add(rock);
      }
      return g;
    },
    // Raised ground: a low outcrop you stand ON rather than beside.
    ridge() {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x6a6357, roughness: 1, flatShading: true });
      for (let i = 0; i < 3; i++) {
        const slab = new THREE.Mesh(new THREE.CylinderGeometry(1.5 - i * 0.38, 1.75 - i * 0.38, 0.42, 6), mat);
        slab.position.y = 0.21 + i * 0.38;
        slab.rotation.y = i * 0.5;
        g.add(slab);
      }
      return g;
    },
    // Downed timber, in the same vocabulary as a basin deadfall so the two read
    // as the same KIND of thing in two places.
    deadfall() {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1, flatShading: true });
      for (let i = 0; i < 3; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, CELL * 2.1, 5), mat);
        log.rotation.z = Math.PI / 2;
        log.position.set(0, 0.38 + i * 0.3, (i - 1) * 0.62);
        log.rotation.y = (i - 1) * 0.22;
        g.add(log);
      }
      return g;
    },
    // The camp's own hearth: a ring of stones, unlit. The BURNING fire is a
    // separate object the player builds (makeFire); this is the place it goes.
    fire() {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x6b6660, roughness: 1, flatShading: true });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), mat);
        rock.position.set(Math.cos(a) * 0.8, 0.14, Math.sin(a) * 0.8);
        g.add(rock);
      }
      const ash = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 0.06, 8),
        new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 1 }),
      );
      ash.position.y = 0.03;
      g.add(ash);
      return g;
    },
  };

  /**
   * A worksite: a body that says WHICH place, under a pole and lamp that say
   * whether the current beat is here.
   *
   * It is a PLACE MARKER, not a prompt — it stands there all day whether or
   * not the current beat happens here, because the player has to be able to
   * learn where the creek is before they are sent to it. The ACTIVE one is lit;
   * the rest are unlit stone. That difference is the only thing the renderer
   * says about the day, and it says it in the world rather than on the HUD.
   */
  function makeSite(site) {
    const g = new THREE.Group();
    // An unknown id gets the old cairn rather than nothing — a site that fails
    // to draw is worse than one that draws generically, and tests/woods.mjs
    // asserts every real id has a body so this branch stays unreachable there.
    const body = SITE_BODIES[site && site.id];
    if (body) {
      g.add(body());
    } else {
      const cairn = new THREE.Mesh(
        new THREE.ConeGeometry(0.62, 0.9, 5),
        new THREE.MeshStandardMaterial({ color: 0x6d6a63, roughness: 0.95, flatShading: true }),
      );
      cairn.position.y = 0.45;
      g.add(cairn);
    }
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 2.1, 5),
      new THREE.MeshStandardMaterial({ color: 0x3a3128, roughness: 0.9 }),
    );
    pole.position.y = 1.5;
    g.add(pole);
    const lamp = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22, 0),
      new THREE.MeshBasicMaterial({ color: 0xffd489 }),
    );
    lamp.position.y = 2.5;
    g.add(lamp);
    const glow = new THREE.PointLight(0xffc879, 0, 14, 2);
    glow.position.y = 2.5;
    g.add(glow);
    g.userData = { lamp, glow };
    scene.add(g);
    return g;
  }

  /**
   * What a beat LEAVES. Until 0.26 a beat resolved as a subtitle and nothing
   * else, so a false account that swapped "the tent" for "the fire" was a
   * memory test of a line of text. Now the tent stands, the firewood is
   * stacked, the birch is down, and the thing the account names is a thing the
   * player walked past for the rest of the day.
   *
   * One body per mark id (woods.js MARK_AT / dayMarks). tests/readability.mjs
   * holds that every object a false account can name has one here.
   */
  const MARK_BODIES = {
    firewood() {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x6e5236, roughness: 1, flatShading: true });
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 4 - row; i++) {
          const log = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 1.5, 6), mat);
          log.rotation.x = Math.PI / 2;
          log.position.set((i - (3 - row) / 2) * 0.36, 0.17 + row * 0.3, 0);
          g.add(log);
        }
      }
      return g;
    },
    water() {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x7d8c96, roughness: 0.45, metalness: 0.5, flatShading: true });
      for (let i = 0; i < 2; i++) {
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.24, 0.62, 8), mat);
        can.position.set(i * 0.62 - 0.31, 0.31, i * 0.12);
        g.add(can);
        const handle = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 4, 10, Math.PI), mat);
        handle.position.set(i * 0.62 - 0.31, 0.62, i * 0.12);
        g.add(handle);
      }
      return g;
    },
    tent() {
      const g = new THREE.Group();
      const canvasMat = new THREE.MeshStandardMaterial({ color: 0xb49a68, roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
      const L = 2.6, H = 1.55, W = 1.1;
      const slope = Math.hypot(W, H);
      for (const side of [-1, 1]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(L, 0.05, slope), canvasMat);
        panel.position.set(0, H / 2, side * W / 2);
        panel.rotation.x = side * Math.atan2(H, W);
        g.add(panel);
      }
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.9 });
      for (const end of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, H + 0.2, 5), poleMat);
        pole.position.set(end * L / 2, (H + 0.2) / 2, 0);
        g.add(pole);
      }
      // End-on to the hearth, so the A of it is what you see from the fire.
      g.rotation.y = Math.PI / 2;
      return g;
    },
    // Two states: leaning until it is cut, then down with a stump. A birch that
    // only appears once it is down would prove nothing about the day.
    birch() {
      const g = new THREE.Group();
      const bark = new THREE.MeshStandardMaterial({ color: 0xe4e0d4, roughness: 0.8, flatShading: true });
      const leaf = new THREE.MeshStandardMaterial({ color: 0x8a9a4a, roughness: 0.85, flatShading: true });
      const standing = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.19, 5.2, 6), bark);
      trunk.position.y = 2.6;
      standing.add(trunk);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 0), leaf);
      crown.position.y = 5.2;
      crown.scale.set(1, 1.3, 1);
      standing.add(crown);
      standing.rotation.z = -0.42;   // it LEANS — that is the whole reason it has to come down
      g.add(standing);
      const down = new THREE.Group();
      const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.4, 6), bark);
      stump.position.y = 0.2;
      down.add(stump);
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 4.8, 6), bark);
      log.rotation.z = Math.PI / 2;
      log.position.set(2.7, 0.2, 0.3);
      down.add(log);
      const brush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 0), leaf);
      brush.position.set(5.3, 0.45, 0.3);
      brush.scale.set(1.3, 0.6, 1);
      down.add(brush);
      g.add(down);
      g.userData = { standing, down };
      return g;
    },
    // The hearth's fire: burning once lit, embers by morning. The site body
    // under it is the unlit ring; this is only what burns in it.
    fire() {
      const g = new THREE.Group();
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 6), new THREE.MeshBasicMaterial({ color: 0xffa63a }));
      flame.position.y = 0.6;
      g.add(flame);
      const embers = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.08, 8), new THREE.MeshBasicMaterial({ color: 0xa8401a }));
      embers.position.y = 0.08;
      g.add(embers);
      const glow = new THREE.PointLight(0xffa03c, 2.0, 20, 2);
      glow.position.y = 1.0;
      g.add(glow);
      g.userData = { flame, embers, glow };
      return g;
    },
  };

  function makeMark(item) {
    const make = MARK_BODIES[item && item.id];
    const g = make ? make() : new THREE.Group();
    g.userData = { ...(g.userData || {}) };
    scene.add(g);
    return g;
  }

  function makeItem() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.34, 0),
      new THREE.MeshStandardMaterial({ color: PALETTE.itemFlare, roughness: 0.5, flatShading: true }),
    );
    body.position.y = 0.5;
    g.add(body);
    const glow = new THREE.PointLight(PALETTE.itemFlare, 0.9, 9, 2);
    glow.position.y = 0.5;
    g.add(glow);
    g.userData = { body, glow };
    scene.add(g);
    return g;
  }

  // A literal tree: brown trunk, green foliage — unmistakably not one of the
  // dark rock-spire obstacles (see PALETTE.treeLeaf's own comment).
  function makeTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 1.6, 6),
      new THREE.MeshStandardMaterial({ color: PALETTE.treeTrunk, roughness: 0.9 }),
    );
    trunk.position.y = 0.8;
    g.add(trunk);
    const leaves = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 2.1, 7),
      new THREE.MeshStandardMaterial({ color: PALETTE.treeLeaf, roughness: 0.85, flatShading: true }),
    );
    leaves.position.y = 2.3;
    g.add(leaves);
    g.userData = {};
    scene.add(g);
    return g;
  }

  // A small cluster of rock chunks — lighter and more compact than a rock
  // spire, and distinct from the purely decorative ground litter.
  function makeStoneDeposit() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: PALETTE.stoneDeposit, roughness: 0.8, flatShading: true });
    const offsets = [
      [0, 0, 0, 0.36],
      [0.28, 0.05, -0.1, 0.24],
      [-0.22, 0.02, 0.18, 0.22],
    ];
    for (const [ox, oy, oz, s] of offsets) {
      const chunk = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), mat);
      chunk.position.set(ox, oy + s * 0.6, oz);
      g.add(chunk);
    }
    g.userData = {};
    scene.add(g);
    return g;
  }

  function syncPool(map, list, factory) {
    const seen = new Set();
    for (const item of list) {
      seen.add(item.id);
      let obj = map.get(item.id);
      if (!obj) {
        // The ITEM is passed so a factory can vary by whose it is. makeFigure
        // needs it to pick a build per roster slot; the others ignore it.
        obj = factory(item);
        map.set(item.id, obj);
      }
      obj.visible = true;
      obj.userData.item = item;
    }
    for (const [id, obj] of map) if (!seen.has(id)) obj.visible = false;
    return map;
  }

  const tmpColor = new THREE.Color();
  let elapsed = 0;

  /**
   * Draw the basin as ONE mind perceives it.
   *
   * `opts.eye` is the character whose head the camera sits in (defaults to the
   * lead, so single-player callers are unchanged). `opts.viewport` is a
   * {x,y,w,h} rect in device pixels for couch co-op split-screen; omitted, the
   * whole canvas is used.
   *
   * Couch co-op calls this once PER PLAYER per frame, with that player's own
   * percept — which is the whole reason the two halves of the screen can
   * legitimately disagree about what is in the basin. Pass dt only on the
   * first call of a frame: `elapsed` is shared scene-animation time, and
   * advancing it once per viewport would run the world at 2x for two players.
   */
  function update(percept, dt, view, opts = {}) {
    elapsed += dt;
    const eye = opts.eye || sim.player;
    const vp = opts.viewport || null;
    // The night is a WORLD fact, so it is read without a character: a fire keeps
    // the night off the mind standing in it (nightFactor(sim, ch)), it does not
    // hold the sky up. The local light a fire throws is drawn with the fire.
    const night = nightFactor(sim);
    const look = weatherLook();
    if (look) {
      sky.color.setHex(look.hemi);
      sun.color.setHex(look.sun);
    }
    sky.intensity = (look ? look.hemiI : dayLit.sky) * (1 - 0.72 * night);
    sun.intensity = (look ? look.sunI : dayLit.sun) * (1 - 0.85 * night);
    // The rim falls FURTHER than the sun at night. It is a sky light, and the
    // point of the dark is that shape stops being free — what separates two
    // silhouettes after dusk should be the lamp you are carrying.
    rim.intensity = dayLit.rim * (1 - 0.93 * night);
    scene.fog.density = dayLit.fog * (1 + 0.9 * night);
    lamp.intensity = dayLit.lamp * (1 + 0.55 * night);
    // The sky darkens toward the horizon colour's own shadow rather than to
    // black: a night sky that is pure black has no horizon, and losing the
    // horizon is what made the old nights read as a void instead of a place.
    if (look) {
      skyMat.uniforms.low.value.setHex(look.sky[0]).multiplyScalar(1 - 0.82 * night);
      skyMat.uniforms.high.value.setHex(look.sky[1]).multiplyScalar(1 - 0.6 * night);
    } else {
      skyMat.uniforms.low.value.copy(SKY.low).multiplyScalar(1 - 0.82 * night);
      skyMat.uniforms.high.value.copy(SKY.high).multiplyScalar(1 - 0.6 * night);
    }
    skyDome.position.set(eye.x, 0, eye.z);
    if (scene.background && scene.background.isColor) {
      scene.background.copy(skyMat.uniforms.low.value);
    }
    const dis = distortion(percept, sim);

    if (vp) {
      renderer.setScissorTest(true);
      renderer.setViewport(vp.x, vp.y, vp.w, vp.h);
      renderer.setScissor(vp.x, vp.y, vp.w, vp.h);
      camera.aspect = vp.w / vp.h || 1;
    } else {
      renderer.setScissorTest(false);
      const w = canvas.width, h = canvas.height;
      renderer.setViewport(0, 0, w, h);
      camera.aspect = (canvas.clientWidth || w) / (canvas.clientHeight || h) || 1;
    }

    // ---- camera ----
    const px = eye.x;
    const pz = eye.z;
    rig.position.set(px, terrainHeight(px, pz) + EYE_HEIGHT, pz);
    rig.rotation.y = view.yaw;
    camera.rotation.x = view.pitch;
    // Sway and roll scale with distortion: the lead's own tell, before anything
    // in the world has visibly changed.
    camera.rotation.z = Math.sin(percept.swayPhase * 1.7) * 0.045 * dis;
    camera.position.y = Math.sin(percept.swayPhase * 2.3) * 0.06 * dis;
    // Derived from the CURRENT aspect every frame, so a resize or a co-op
    // split (which halves each viewport's aspect) re-derives instead of
    // inheriting a lens shaped for a different window. The hallucination's
    // breathing rides on top as a delta.
    camera.fov = verticalFov(camera.aspect, hfov) + Math.sin(percept.swayPhase * 0.9) * 5 * dis;
    camera.updateProjectionMatrix();

    // ---- fog / colour drift ----
    // PER FRAME, from the basin palette — which silently undid the camp's
    // daylight every single frame. Setting the fog once at build time was not
    // enough; anything set at build must also be respected here or it lasts
    // exactly one frame. The camp still drifts as the lead goes, just from its
    // own colours and its own baseline density.
    const baseFog = look ? look.fog : isCamp ? 0x8fa2b4 : PALETTE.fog;
    const baseDensity = look ? look.fogDensity : isCamp ? 0.006 : 0.014;
    if (look) {
      windU.uWindT.value = elapsed;
      windU.uSway.value = look.sway;
      if (campLeaf) campLeaf.color.copy(leafBase).lerp(tmpColor.setHex(0xdfe8ee), 0.55 * look.frost);
      // The ground: frost lifts it pale, rain darkens it. Emissive rather than
      // colour because the grass is vertex-coloured and colour can only darken.
      ground.material.color.setScalar(look.rain ? 0.72 : 1);
      ground.material.emissive.setHex(0x9fb0c2).multiplyScalar(0.32 * look.frost);
      // "Cold enough that the water skinned over" — so it has, where you can see it.
      if (creekWater) {
        creekWater.material.color.copy(creekBase).lerp(tmpColor.setHex(0xd6e4ec), 0.8 * look.frost);
        creekWater.material.roughness = look.frost ? 0.6 : 0.25;
      }
    }
    updateWeatherParticles(look, eye, elapsed);
    tmpColor.set(baseFog).lerp(new THREE.Color(PALETTE.fogLost), dis);
    scene.fog.color.copy(tmpColor);
    scene.background = tmpColor;
    scene.fog.density = baseDensity + dis * 0.018; // it closes in as the lead goes
    lamp.intensity = 1.9 - dis * 0.6;

    // ---- markers ----
    syncPool(pool.monoliths, perceivedMonoliths(percept, sim), makeMonolith);
    for (const obj of pool.monoliths.values()) {
      if (!obj.visible) continue;
      const m = obj.userData.item;
      obj.position.set(m.x, terrainHeight(m.x, m.z), m.z);
      obj.userData.cap.visible = !!m.logged;
      obj.userData.body.material.color.set(m.logged ? PALETTE.monolithLogged : PALETTE.monolith);
    }

    // ---- pylons ----
    syncPool(pool.pylons, perceivedPylons(percept, sim), makePylon);
    for (const obj of pool.pylons.values()) {
      if (!obj.visible) continue;
      const p = obj.userData.item;
      obj.position.set(p.x, terrainHeight(p.x, p.z), p.z);
      // NOTE: `looksLive` — not `charge > 0`. A spent pylon can read as full to a
      // hallucinating lead, and that lie has to survive all the way to the pixel.
      const live = p.looksLive;
      const frac = p.spent ? 0 : 1; // one-shot: a pylon is lit or it is out
      const shown = live ? Math.max(0.25, frac) : 0;
      obj.userData.core.material.color.set(live ? PALETTE.pylonLive : PALETTE.pylonDead);
      obj.userData.core.scale.setScalar(0.7 + shown * 0.5 + Math.sin(elapsed * 2 + p.x) * 0.04);
      obj.userData.glow.intensity = live ? 0.5 + shown * 1.4 : 0.05;
      obj.userData.ring.material.opacity = live ? 0.12 + shown * 0.22 : 0.05;
      obj.userData.ring.material.color.set(live ? PALETTE.pylonLive : PALETTE.pylonDead);
    }

    // ---- ground items — kind SHOWN can be a lie, but the mesh itself never is:
    // a phantom pickup has no world object at all (see perceivedWorldItems) ----
    syncPool(pool.items, perceivedWorldItems(percept, sim), makeItem);
    for (const obj of pool.items.values()) {
      if (!obj.visible) continue;
      const it = obj.userData.item;
      const bob = 0.5 + Math.sin(elapsed * 2.4 + it.x + it.z) * 0.06;
      obj.position.set(it.x, terrainHeight(it.x, it.z) + bob, it.z);
      const color = ITEM_COLOR[it.shownKind] || PALETTE.itemFlare;
      obj.userData.body.material.color.set(color);
      obj.userData.glow.color.set(color);
    }

    // ---- trees and stone deposits — read straight from the sim, not
    // perception: neither one is ever a lie (see state.js's own comment on
    // RESOURCE_SIGHT_RANGE), so there is nothing here for percept.js to filter ----
    syncPool(pool.trees, sim.trees.filter((t) => t.discovered && !t.chopped), makeTree);
    for (const obj of pool.trees.values()) {
      if (!obj.visible) continue;
      const t = obj.userData.item;
      obj.position.set(t.x, terrainHeight(t.x, t.z), t.z);
    }
    syncPool(pool.stones, sim.stones.filter((s) => s.discovered && !s.mined), makeStoneDeposit);
    for (const obj of pool.stones.values()) {
      if (!obj.visible) continue;
      const s = obj.userData.item;
      obj.position.set(s.x, terrainHeight(s.x, s.z), s.z);
    }

    // The trainer's lantern. Camp only — `sim.trainer` exists nowhere else.
    ensureTrainerMark(sim.trainer && !sim.reachedTrainer ? sim.trainer : null);

    // The day's worksites. Camp only, and only once a day has been started —
    // `world.sites` exists nowhere else and `sim.woods` gates the lighting.
    // THE FIRE THIS EYE SEES — percept.shownFire, never sim.fire. A far-gone
    // mind is shown a whole fire where there is none, and it has to be drawn
    // exactly like a real one or the difference is the tell.
    // Deadfalls still standing. Not lied about — a deadfall is geometry you walk
    // into, and percept.js lies about what things ARE, never about whether the
    // ground is solid.
    const standing = (sim.deadfalls || []).filter((d) => !d.cleared);
    syncPool(pool.falls, standing, makeFall);
    for (const obj of pool.falls.values()) {
      obj.position.y = terrainHeight(obj.position.x, obj.position.z);
      const d = standing.find((x) => Math.abs(x.x - obj.position.x) < 0.01 && Math.abs(x.z - obj.position.z) < 0.01);
      if (d) obj.rotation.y = d.horiz ? 0 : Math.PI / 2;
    }
    const shownFire = percept.shownFire;
    syncPool(pool.fires, shownFire ? [{ id: "fire", x: shownFire.x, z: shownFire.z }] : [], makeFire);
    // GUARDED ON shownFire, not on the pool being non-empty. The fire a mind
    // sees can vanish between frames — recovery ends the fabrication outright —
    // and the pool is not guaranteed to be empty on the same frame, so reading
    // fuel off a null here threw the moment a hallucination ended.
    for (const obj of shownFire ? pool.fires.values() : []) {
      obj.position.y = terrainHeight(obj.position.x, obj.position.z);
      const f = Math.max(0, Math.min(1, shownFire.fuel / 100));
      const { flame, glow } = obj.userData;
      // Height and light both fall with the fuel, and a spent fire keeps a low
      // ember rather than vanishing — you can still see where it was.
      flame.scale.set(0.45 + f * 0.75, 0.3 + f * 1.1, 0.45 + f * 0.75);
      flame.material.color.setHex(f > 0.35 ? 0xffa63a : 0xd2541c);
      glow.intensity = 0.25 + f * 2.6;
      glow.distance = 8 + f * 16;
    }
    syncPool(pool.sites, sim.world.sites || [], makeSite);
    const activeSite = sim.woods?.activeSiteId || null;
    for (const obj of pool.sites.values()) {
      if (!obj.visible) continue;
      const site = obj.userData.item;
      obj.position.set(site.x, terrainHeight(site.x, site.z), site.z);
      const lit = site.id === activeSite;
      obj.userData.glow.intensity = lit ? 1.5 : 0;
      obj.userData.lamp.material.color.set(lit ? 0xffd489 : 0x4a4a48);
      obj.userData.lamp.scale.setScalar(lit ? 1 + Math.sin(elapsed * 1.7) * 0.14 : 0.85);
    }

    // ---- what the day has left behind (THE WOODS) ----
    // Read off `sim.woods` every frame — woods.beat and woods.phase are already
    // save state, so a reload redraws exactly this and there is no second list.
    const sites = sim.world.sites || [];
    const marks = dayMarks(sim.woods).filter((m) => m.done || m.id === "birch");
    syncPool(pool.marks, marks, makeMark);
    for (const obj of pool.marks.values()) {
      if (!obj.visible) continue;
      const m = obj.userData.item;
      const site = sites.find((x) => x.id === m.site);
      if (!site) { obj.visible = false; continue; }
      const x = site.x + m.dcx * CELL, z = site.z + m.dcz * CELL;
      obj.position.set(x, terrainHeight(x, z), z);
      const u = obj.userData;
      if (u.standing) { u.standing.visible = !m.done; u.down.visible = m.done; }
      if (u.flame) {
        u.flame.visible = !m.spent;
        u.flame.scale.y = 1 + Math.sin(elapsed * 9) * 0.08;
        u.glow.intensity = m.spent ? 0.35 : 2.0;
      }
    }

    // ---- companions (real and otherwise) ----
    syncPool(pool.figures, perceivedCompanions(percept, sim), makeFigure);
    for (const obj of pool.figures.values()) {
      if (!obj.visible) continue;
      const c = obj.userData.item;
      const moved = Math.hypot(c.x - obj.userData.lastX, c.z - obj.userData.lastZ);
      obj.userData.lastX = c.x;
      obj.userData.lastZ = c.z;
      obj.userData.bob += moved * 2.6;
      obj.position.set(c.x, terrainHeight(c.x, c.z) + Math.abs(Math.sin(obj.userData.bob)) * 0.07, c.z);
      // A companion who is with you looks at you. One who has gone does not —
      // they are drawn on their own heading, walking at something you can't
      // see. That difference is legible at a distance where the body colour
      // has already fogged out, and it is the only tell that survives the
      // whole length of an episode.
      const dx = px - c.x;
      const dz = pz - c.z;
      obj.rotation.y = c.hallucinating && !c.phantom ? c.facing || 0 : Math.atan2(dx, dz);
      if (c.monstrous) {
        // A lie about identity, not position — the figure keeps its real
        // spot and facing, only reads wrong for a beat. Wrong proportions
        // (looms taller and wider) rather than just a new colour, so it
        // reads as "not them" at a glance, not merely "them, but red."
        obj.scale.set(1.15, 1.6, 1.1);
        obj.userData.mat.color.set(PALETTE.monster);
        obj.userData.light.material.color.set(PALETTE.monsterEye);
      } else {
        obj.scale.set(1, 1, 1);
        obj.userData.mat.color.set(c.hallucinating ? PALETTE.bodyLost : PALETTE.body);
        obj.userData.light.material.color.set(c.hallucinating ? 0xff8a94 : 0xffd9a0);
      }
    }

    renderer.render(scene, camera);
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    // Re-apply the pixel ratio EVERY resize, not once at construction. It is
    // not a property of the machine: it changes when the user alters Windows
    // display scaling, when they zoom the browser, and when the window is
    // dragged to a monitor with a different DPI. Set once, it goes stale, and
    // `setSize(w, h, false)` then allocates a drawing buffer at the wrong
    // resolution for the CSS box it is stretched across.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h || 1;
    camera.fov = verticalFov(camera.aspect, hfov);
    camera.updateProjectionMatrix();
  }

  /**
   * Project a world point to CSS pixel coordinates against the canvas's own
   * bounding rect, for HUD elements (fixed-position DOM, not WebGL) that need
   * to line up with something in the 3D scene — e.g. a collected-resource fly
   * animation starting where the tree/deposit actually stood. `visible` is
   * false once the point is behind the camera, where the projected x/y are
   * meaningless (they'd otherwise mirror to the wrong side of the screen).
   */
  function worldToScreen(x, y, z, vp = null) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    const rect = canvas.getBoundingClientRect();
    // In split-screen the camera was last set up for ONE viewport, so the NDC
    // it produces maps into that viewport's slice of the canvas, not the whole
    // thing. `vp` is in device pixels (what Three wants); the DOM overlay is in
    // CSS pixels, hence the ratio. Its y-origin is bottom-left, the DOM's is
    // top-left, so the flip below is not the same flip as the NDC one.
    let left = rect.left, top = rect.top, width = rect.width, height = rect.height;
    if (vp) {
      const sx = rect.width / (canvas.width || rect.width);
      const sy = rect.height / (canvas.height || rect.height);
      left = rect.left + vp.x * sx;
      top = rect.top + (canvas.height - vp.y - vp.h) * sy;
      width = vp.w * sx;
      height = vp.h * sy;
    }
    return {
      x: left + (v.x * 0.5 + 0.5) * width,
      y: top + (-v.y * 0.5 + 0.5) * height,
      visible: v.z < 1,
    };
  }
  window.addEventListener("resize", resize);

  // A system-zoom change does NOT always fire `resize` — the CSS viewport can
  // keep the same dimensions while devicePixelRatio moves under it (dragging
  // the window to a monitor with different scaling is the clearest case). The
  // only reliable notification is a resolution media query, which has to be
  // re-armed after every change because it matches one exact ratio. Without
  // this the buffer resolution silently goes stale mid-session.
  let dprQuery = null;
  const onDprChange = () => {
    armDprWatch();
    resize();
  };
  function armDprWatch() {
    if (typeof window.matchMedia !== "function") return;
    if (dprQuery) dprQuery.removeEventListener?.("change", onDprChange);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener?.("change", onDprChange);
  }
  armDprWatch();
  resize();

  /**
   * Tear this renderer down. Needed once a run can outlive a single world — a
   * campaign's next basin is entirely new geometry (terrain, rock instancing,
   * monolith/pylon/item meshes), so advancing a level builds a fresh
   * createRenderer() rather than repointing this one, and the old one must
   * free its GPU resources instead of leaking them.
   */
  function dispose() {
    window.removeEventListener("resize", resize);
    dprQuery?.removeEventListener?.("change", onDprChange);
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      for (const m of mats) m.dispose();
    });
    renderer.dispose();
  }

  /** Set the horizontal field of view in degrees; clamped to a sane band. */
  function setFov(deg) {
    hfov = Math.max(70, Math.min(110, Number(deg) || DEFAULT_HFOV));
    camera.fov = verticalFov(camera.aspect, hfov);
    camera.updateProjectionMatrix();
    return hfov;
  }

  return { renderer, scene, camera, rig, update, resize, dispose, terrainHeight, worldToScreen, setFov, get hfov() { return hfov; }, PALETTE };
}
