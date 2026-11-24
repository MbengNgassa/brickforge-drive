import * as THREE from 'three';
import { COLORS, PARTS_MAP, PLATE_HEIGHT, STUD_SIZE } from './catalog';
import type { BrickPartId } from './types';

const materialCache = new Map<string, THREE.MeshPhysicalMaterial>();
const darkRubberMat = new THREE.MeshStandardMaterial({
  color: 0x191d24,
  roughness: 0.86,
  metalness: 0.05,
});
const darkMetalMat = new THREE.MeshStandardMaterial({
  color: 0x353c48,
  roughness: 0.35,
  metalness: 0.82,
});
const brightChromeMat = new THREE.MeshStandardMaterial({
  color: 0xe2eaf4,
  roughness: 0.16,
  metalness: 0.92,
});
const headlightGlowMat = new THREE.MeshStandardMaterial({
  color: 0xfffce0,
  emissive: 0xffe885,
  emissiveIntensity: 2.2,
  roughness: 0.12,
  metalness: 0.1,
});
const taillightGlowMat = new THREE.MeshStandardMaterial({
  color: 0xff3b3b,
  emissive: 0xff1e1e,
  emissiveIntensity: 2.2,
  roughness: 0.15,
  metalness: 0.1,
});
const thrusterCoreMat = new THREE.MeshStandardMaterial({
  color: 0x8af2ff,
  emissive: 0x22d3ee,
  emissiveIntensity: 2.8,
  roughness: 0.1,
});
const studGeo = new THREE.CylinderGeometry(STUD_SIZE * 0.3, STUD_SIZE * 0.31, 0.13, 14);
const studCapGeo = new THREE.CylinderGeometry(STUD_SIZE * 0.25, STUD_SIZE * 0.3, 0.03, 14);

export function getBrickMaterial(hex: string, forceTranslucent = false): THREE.MeshPhysicalMaterial {
  const key = `${hex}_${forceTranslucent ? 't' : 'o'}`;
  const existing = materialCache.get(key);
  if (existing) return existing;

  const colorDef = COLORS.find((c) => c.hex.toLowerCase() === hex.toLowerCase());
  const isTranslucent = forceTranslucent || Boolean(colorDef?.translucent);
  const isMetallic = Boolean(colorDef?.metallic);

  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(hex),
    roughness: isTranslucent ? 0.07 : isMetallic ? 0.22 : 0.2,
    metalness: isMetallic ? 0.86 : 0.04,
    clearcoat: isTranslucent ? 1.0 : 0.85,
    clearcoatRoughness: isTranslucent ? 0.05 : 0.12,
    transparent: isTranslucent,
    opacity: isTranslucent ? 0.56 : 1.0,
    reflectivity: 0.9,
  });
  materialCache.set(key, mat);
  return mat;
}

function addStuds(
  group: THREE.Group,
  w: number,
  d: number,
  topY: number,
  mat: THREE.Material
): void {
  const startX = -((w - 1) * STUD_SIZE) / 2;
  const startZ = -((d - 1) * STUD_SIZE) / 2;
  for (let ix = 0; ix < w; ix++) {
    for (let iz = 0; iz < d; iz++) {
      const stud = new THREE.Mesh(studGeo, mat);
      stud.position.set(startX + ix * STUD_SIZE, topY + 0.065, startZ + iz * STUD_SIZE);
      stud.castShadow = true;
      stud.receiveShadow = true;
      group.add(stud);

      const cap = new THREE.Mesh(studCapGeo, mat);
      cap.position.set(startX + ix * STUD_SIZE, topY + 0.135, startZ + iz * STUD_SIZE);
      group.add(cap);
    }
  }
}

function createWedgeGeometry(width: number, height: number, depth: number, frontLipRatio = 0.22): THREE.ExtrudeGeometry {
  // Profile in XY (extruded along X width, then rotated so slope drops toward +Z)
  const shape = new THREE.Shape();
  const halfD = depth / 2;
  const halfH = height / 2;
  const lipH = -halfH + height * frontLipRatio;
  const topFlatZ = -halfD + Math.min(STUD_SIZE * 0.9, depth * 0.35);

  shape.moveTo(-halfD, -halfH);
  shape.lineTo(halfD, -halfH);
  shape.lineTo(halfD, lipH);
  shape.lineTo(topFlatZ, halfH);
  shape.lineTo(-halfD, halfH);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 1,
  });
  // Extrude goes along +Z; rotate -90° around Y so shape's X maps to +Z and extrude depth maps to X
  geo.translate(0, 0, -width / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

const wedgeGeoCache = new Map<string, THREE.ExtrudeGeometry>();
function getCachedWedgeGeo(w: number, h: number, d: number, lip = 0.22): THREE.ExtrudeGeometry {
  const key = `${w.toFixed(2)}_${h.toFixed(2)}_${d.toFixed(2)}_${lip}`;
  let geo = wedgeGeoCache.get(key);
  if (!geo) {
    geo = createWedgeGeometry(w, h, d, lip);
    wedgeGeoCache.set(key, geo);
  }
  return geo;
}

function createWheelMesh(
  partId: 'wheel_street' | 'wheel_offroad' | 'wheel_monster',
  rimColor: string
): THREE.Group {
  const root = new THREE.Group();
  const spinGroup = new THREE.Group();
  spinGroup.name = 'wheel_spin';

  const isMonster = partId === 'wheel_monster';
  const isOffroad = partId === 'wheel_offroad';

  const radius = isMonster ? 1.12 : isOffroad ? 0.88 : 0.74;
  const width = isMonster ? 1.12 : isOffroad ? 0.88 : 0.72;

  // Axle bracket inside brick footprint
  const hubBox = new THREE.Mesh(
    new THREE.BoxGeometry(STUD_SIZE * 1.4, PLATE_HEIGHT * 1.6, STUD_SIZE * 0.9),
    darkMetalMat
  );
  hubBox.position.y = PLATE_HEIGHT * 0.4;
  hubBox.castShadow = true;
  root.add(hubBox);

  // Main tire cylinder (axle along X)
  const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 24);
  tireGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, darkRubberMat);
  tire.castShadow = true;
  tire.receiveShadow = true;
  spinGroup.add(tire);

  // Sculpted tread lugs for off-road & monster tires (matches Screenshot 1!)
  if (isOffroad || isMonster) {
    const lugCount = isMonster ? 16 : 14;
    const lugGeo = new THREE.BoxGeometry(width * 0.96, isMonster ? 0.16 : 0.11, isMonster ? 0.22 : 0.16);
    for (let i = 0; i < lugCount; i++) {
      const angle = (i / lugCount) * Math.PI * 2;
      const lug = new THREE.Mesh(lugGeo, darkRubberMat);
      lug.position.set(0, Math.cos(angle) * radius, Math.sin(angle) * radius);
      lug.rotation.x = angle;
      lug.castShadow = true;
      spinGroup.add(lug);
    }
  } else {
    // Street tire sidewall bevel ring
    const ringGeo = new THREE.TorusGeometry(radius * 0.78, 0.06, 8, 22);
    ringGeo.rotateY(Math.PI / 2);
    const rL = new THREE.Mesh(ringGeo, darkRubberMat);
    rL.position.x = width * 0.45;
    const rR = new THREE.Mesh(ringGeo, darkRubberMat);
    rR.position.x = -width * 0.45;
    spinGroup.add(rL, rR);
  }

  // Rim & spokes in chosen color
  const rimMat = getBrickMaterial(rimColor);
  const rimRadius = radius * 0.54;
  const rimGeo = new THREE.CylinderGeometry(rimRadius, rimRadius, width * 1.04, 16);
  rimGeo.rotateZ(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeo, rimMat);
  spinGroup.add(rim);

  // Center lug cap
  const capGeo = new THREE.CylinderGeometry(rimRadius * 0.34, rimRadius * 0.34, width * 1.1, 10);
  capGeo.rotateZ(Math.PI / 2);
  const cap = new THREE.Mesh(capGeo, darkMetalMat);
  spinGroup.add(cap);

  // Spokes (visible rotation feedback!)
  const spokeGeo = new THREE.BoxGeometry(width * 1.07, rimRadius * 1.72, rimRadius * 0.22);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(spokeGeo, brightChromeMat);
    spoke.rotation.x = (i * Math.PI) / 3;
    spinGroup.add(spoke);
  }

  spinGroup.position.y = -PLATE_HEIGHT * 0.15;
  root.add(spinGroup);
  return root;
}

/**
 * Builds a complete, high-craft 3D Three.js Group for any brick part in the catalog.
 * Centered at (0, 0, 0) in local brick space with +Z facing forward.
 */
export function createBrickMesh(partId: BrickPartId, colorHex: string): THREE.Group {
  const part = PARTS_MAP[partId];
  const group = new THREE.Group();
  const W = part.w * STUD_SIZE - 0.03;
  const H = part.h * PLATE_HEIGHT - 0.012;
  const D = part.d * STUD_SIZE - 0.03;
  const mat = getBrickMaterial(colorHex, Boolean(part.isTranslucent));

  if (partId === 'wheel_street' || partId === 'wheel_offroad' || partId === 'wheel_monster') {
    return createWheelMesh(partId, colorHex);
  }

  if (partId === 'slope_2x2' || partId === 'slope_2x3') {
    const wedge = new THREE.Mesh(getCachedWedgeGeo(W, H, D, 0.24), mat);
    wedge.castShadow = true;
    wedge.receiveShadow = true;
    group.add(wedge);
    // Row of studs on the rear flat crest
    addStuds(group, part.w, 1, H / 2, mat);
    // Shift those studs to rear row
    for (let i = 1; i < group.children.length; i++) {
      group.children[i].position.z -= ((part.d - 1) * STUD_SIZE) / 2;
    }
    return group;
  }

  if (partId === 'windshield_2x4') {
    const glassMat = getBrickMaterial(colorHex, true);
    const frameW = W;
    const frameH = H;
    const frameD = D;
    const glass = new THREE.Mesh(getCachedWedgeGeo(frameW, frameH, frameD, 0.16), glassMat);
    glass.castShadow = true;
    glass.receiveShadow = true;
    group.add(glass);

    // Sleek dark base frame strip
    const baseTrim = new THREE.Mesh(
      new THREE.BoxGeometry(frameW * 1.01, PLATE_HEIGHT * 0.45, frameD * 1.01),
      darkMetalMat
    );
    baseTrim.position.y = -frameH / 2 + PLATE_HEIGHT * 0.22;
    group.add(baseTrim);
    return group;
  }

  if (partId === 'fender_1x4') {
    // Arch fender with cutout look
    const topBar = new THREE.Mesh(new THREE.BoxGeometry(W, PLATE_HEIGHT * 1.2, D), mat);
    topBar.position.y = H / 2 - PLATE_HEIGHT * 0.6;
    topBar.castShadow = true;
    topBar.receiveShadow = true;
    group.add(topBar);

    const legGeo = new THREE.BoxGeometry(W, H - PLATE_HEIGHT * 1.1, STUD_SIZE * 0.85);
    const frontLeg = new THREE.Mesh(legGeo, mat);
    frontLeg.position.set(0, -PLATE_HEIGHT * 0.55, D / 2 - STUD_SIZE * 0.44);
    frontLeg.castShadow = true;
    const rearLeg = new THREE.Mesh(legGeo, mat);
    rearLeg.position.set(0, -PLATE_HEIGHT * 0.55, -D / 2 + STUD_SIZE * 0.44);
    rearLeg.castShadow = true;
    group.add(frontLeg, rearLeg);
    addStuds(group, part.w, part.d, H / 2, mat);
    return group;
  }

  if (partId === 'seat_2x2') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(W, PLATE_HEIGHT * 1.1, D), mat);
    base.position.y = -H / 2 + PLATE_HEIGHT * 0.55;
    base.castShadow = true;
    base.receiveShadow = true;
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(W * 0.94, H * 0.88, STUD_SIZE * 0.46), mat);
    backrest.position.set(0, PLATE_HEIGHT * 0.18, -D / 2 + STUD_SIZE * 0.28);
    backrest.rotation.x = -0.14;
    backrest.castShadow = true;
    const bolsterL = new THREE.Mesh(new THREE.BoxGeometry(0.14, PLATE_HEIGHT * 1.5, D * 0.72), mat);
    bolsterL.position.set(-W / 2 + 0.08, -PLATE_HEIGHT * 0.2, 0.05);
    const bolsterR = bolsterL.clone();
    bolsterR.position.x = W / 2 - 0.08;
    group.add(base, backrest, bolsterL, bolsterR);
    return group;
  }

  if (partId === 'steering_1x2') {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(W, PLATE_HEIGHT * 1.3, D), mat);
    dash.position.y = -H / 2 + PLATE_HEIGHT * 0.65;
    dash.castShadow = true;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.48, 10), darkMetalMat);
    column.position.set(0, 0.05, 0.04);
    column.rotation.x = 0.65;
    const wheelRing = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.055, 8, 18), getBrickMaterial('#f0f3f7'));
    wheelRing.position.set(0, 0.22, -0.12);
    wheelRing.rotation.x = -0.78;
    wheelRing.castShadow = true;
    group.add(dash, column, wheelRing);
    return group;
  }

  if (partId === 'headlight_1x2' || partId === 'taillight_1x2') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const glowMat = partId === 'headlight_1x2' ? headlightGlowMat : taillightGlowMat;
    const dir = partId === 'headlight_1x2' ? 1 : -1;
    const lampGeo = new THREE.BoxGeometry(STUD_SIZE * 0.68, H * 0.62, 0.1);
    const lampL = new THREE.Mesh(lampGeo, glowMat);
    lampL.position.set(-STUD_SIZE * 0.48, 0, dir * (D / 2 + 0.03));
    const lampR = new THREE.Mesh(lampGeo, glowMat);
    lampR.position.set(STUD_SIZE * 0.48, 0, dir * (D / 2 + 0.03));
    group.add(lampL, lampR);
    addStuds(group, part.w, part.d, H / 2, mat);
    return group;
  }

  if (partId === 'spoiler_1x4') {
    const pylonGeo = new THREE.BoxGeometry(0.18, H * 0.82, D * 0.72);
    const pL = new THREE.Mesh(pylonGeo, darkMetalMat);
    pL.position.set(-W * 0.34, -PLATE_HEIGHT * 0.1, 0);
    pL.castShadow = true;
    const pR = new THREE.Mesh(pylonGeo, darkMetalMat);
    pR.position.set(W * 0.34, -PLATE_HEIGHT * 0.1, 0);
    pR.castShadow = true;

    const wing = new THREE.Mesh(new THREE.BoxGeometry(W * 1.08, PLATE_HEIGHT * 0.6, D * 1.15), mat);
    wing.position.set(0, H / 2 - PLATE_HEIGHT * 0.25, -0.05);
    wing.rotation.x = 0.14;
    wing.castShadow = true;

    const endplateGeo = new THREE.BoxGeometry(0.08, PLATE_HEIGHT * 1.6, D * 1.25);
    const epL = new THREE.Mesh(endplateGeo, mat);
    epL.position.set(-W * 0.54, H / 2 - PLATE_HEIGHT * 0.25, -0.05);
    const epR = epL.clone();
    epR.position.x = W * 0.54;
    group.add(pL, pR, wing, epL, epR);
    return group;
  }

  if (partId === 'thruster_jet') {
    // Iconic glowing twin/large plasma jet engine inspired by Screenshot 3!
    const housing = new THREE.Mesh(new THREE.BoxGeometry(W * 0.88, H * 0.9, D * 0.55), mat);
    housing.position.z = D * 0.2;
    housing.castShadow = true;
    group.add(housing);

    const barrelGeo = new THREE.CylinderGeometry(STUD_SIZE * 0.42, STUD_SIZE * 0.54, D * 0.72, 16);
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, darkMetalMat);
    barrel.position.set(0, 0, -D * 0.12);
    barrel.castShadow = true;
    group.add(barrel);

    // Chrome exhaust collar
    const collarGeo = new THREE.TorusGeometry(STUD_SIZE * 0.5, 0.06, 8, 18);
    const collar = new THREE.Mesh(collarGeo, brightChromeMat);
    collar.position.set(0, 0, -D * 0.46);
    group.add(collar);

    // Glowing plasma core inside nozzle
    const coreGeo = new THREE.CircleGeometry(STUD_SIZE * 0.44, 16);
    coreGeo.rotateY(Math.PI);
    const core = new THREE.Mesh(coreGeo, thrusterCoreMat);
    core.position.set(0, 0, -D * 0.45);
    core.name = 'thruster_core';
    group.add(core);

    // Animated jet flame cone (hidden or idle-pulsing until boost activates!)
    const flameOuterGeo = new THREE.ConeGeometry(STUD_SIZE * 0.52, 2.8, 14, 1, true);
    flameOuterGeo.rotateX(-Math.PI / 2);
    flameOuterGeo.translate(0, 0, -1.4);
    const flameOuter = new THREE.Mesh(
      flameOuterGeo,
      new THREE.MeshBasicMaterial({
        color: 0x38e8ff,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    flameOuter.position.set(0, 0, -D * 0.46);
    flameOuter.scale.set(0.55, 0.55, 0.22);
    flameOuter.name = 'thruster_flame';

    const flameInnerGeo = new THREE.ConeGeometry(STUD_SIZE * 0.28, 1.8, 10, 1, true);
    flameInnerGeo.rotateX(-Math.PI / 2);
    flameInnerGeo.translate(0, 0, -0.9);
    const flameInner = new THREE.Mesh(
      flameInnerGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    flameOuter.add(flameInner);
    group.add(flameOuter);
    return group;
  }

  if (partId === 'bumper_ram') {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(W * 1.04, H * 0.85, D * 0.88), mat);
    bar.castShadow = true;
    bar.receiveShadow = true;
    const bullBar = new THREE.Mesh(new THREE.BoxGeometry(W * 1.08, H * 0.34, 0.16), darkMetalMat);
    bullBar.position.set(0, 0.05, D / 2 + 0.06);
    bullBar.castShadow = true;
    const postGeo = new THREE.BoxGeometry(0.16, H * 0.92, 0.2);
    const postL = new THREE.Mesh(postGeo, darkMetalMat);
    postL.position.set(-W * 0.32, 0.04, D / 2 + 0.04);
    const postR = postL.clone();
    postR.position.x = W * 0.32;
    group.add(bar, bullBar, postL, postR);
    addStuds(group, part.w, part.d, H / 2, mat);
    return group;
  }

  if (partId === 'spike_plow') {
    const plow = new THREE.Mesh(getCachedWedgeGeo(W * 1.06, H, D, 0.15), mat);
    plow.castShadow = true;
    plow.receiveShadow = true;
    group.add(plow);

    // 5 metallic demolition spikes projecting forward (+Z)!
    const spikeGeo = new THREE.ConeGeometry(0.14, 0.62, 8);
    spikeGeo.rotateX(Math.PI / 2);
    for (let i = -2; i <= 2; i++) {
      const spike = new THREE.Mesh(spikeGeo, brightChromeMat);
      spike.position.set(i * (W * 0.22), -H * 0.12, D / 2 + 0.22);
      spike.castShadow = true;
      group.add(spike);
    }
    return group;
  }

  if (partId === 'armor_plate') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    // Bolted steel rib accents
    const rib = new THREE.Mesh(new THREE.BoxGeometry(W * 1.03, H * 0.22, D * 1.03), darkMetalMat);
    group.add(rib);
    addStuds(group, part.w, part.d, H / 2, mat);
    return group;
  }

  // Standard bricks, plates, and smooth tiles
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Subtle dark bevel seam line near base for crisp brick-on-brick definition
  const seam = new THREE.Mesh(
    new THREE.BoxGeometry(W + 0.008, 0.025, D + 0.008),
    darkMetalMat
  );
  seam.position.y = -H / 2 + 0.02;
  group.add(seam);

  if (part.hasStudsTop) {
    addStuds(group, part.w, part.d, H / 2, mat);
  }

  return group;
}

/**
 * Procedural CanvasTextures so the entire 3D world renders richly with ZERO external image fetches (100% offline PWA!).
 */
export function createAsphaltTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#2b303a';
  ctx.fillRect(0, 0, 512, 512);

  // Fine asphalt grain
  for (let i = 0; i < 14000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 32 + Math.floor(Math.random() * 34);
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Red/white racing kerbs on left & right edges
  const kerbW = 28;
  for (let y = 0; y < 512; y += 64) {
    ctx.fillStyle = (y / 64) % 2 === 0 ? '#e03131' : '#f1f5f9';
    ctx.fillRect(0, y, kerbW, 64);
    ctx.fillRect(512 - kerbW, y, kerbW, 64);
  }

  // Crisp white shoulder lines
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(kerbW + 8, 0, 6, 512);
  ctx.fillRect(512 - kerbW - 14, 0, 6, 512);

  // Dashed yellow racing center line
  ctx.fillStyle = '#facc15';
  for (let y = 16; y < 512; y += 84) {
    ctx.fillRect(252, y, 8, 44);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function createCanyonGroundTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#c86b3c';
  ctx.fillRect(0, 0, 512, 512);

  // Layered warm desert terracotta variation
  for (let i = 0; i < 6500; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 178 + Math.floor(Math.random() * 44);
    const g = 88 + Math.floor(Math.random() * 36);
    const b = 46 + Math.floor(Math.random() * 24);
    ctx.fillStyle = `rgba(${r},${g},${b},0.45)`;
    ctx.fillRect(x, y, 6 + Math.random() * 14, 4 + Math.random() * 8);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(28, 28);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createArenaFloorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#363b47';
  ctx.fillRect(0, 0, 512, 512);

  // Concrete panels
  ctx.strokeStyle = 'rgba(18,22,28,0.45)';
  ctx.lineWidth = 4;
  for (let i = 0; i <= 512; i += 128) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  for (let i = 0; i < 9000; i++) {
    const v = 44 + Math.floor(Math.random() * 28);
    ctx.fillStyle = `rgba(${v},${v + 3},${v + 8},0.35)`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 3, 3);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function createGarageFloorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#5c6675';
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = '#47505e';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 508, 508);

  // Subtle studio floor tile sheen
  const grad = ctx.createLinearGradient(0, 0, 512, 512);
  grad.addColorStop(0, 'rgba(255,255,255,0.08)');
  grad.addColorStop(1, 'rgba(0,0,0,0.08)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
