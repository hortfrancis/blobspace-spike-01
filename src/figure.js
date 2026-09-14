import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

// A person: the stick figure from threejs-experiments-01/05, which is the
// "Happy chappy" preset from 03, with a shirt coloured by id so people can
// tell each other apart.
//
// The figure is built once as a template. Each person is a clone, which
// shares the template's geometry and ink, and gets a shirt of their own.

const body = {
  headRadius: 0.23,
  headSquash: 1.1,
  skin: "#ffffff",
  torsoHeight: 0.49,
  torsoWidth: 0.165,
  waist: 0.96,
  legLength: 0.5,
  legThickness: 0.015,
  stance: 0.05,
  armLength: 0.5,
  armThickness: 0.015,
  armSplay: 0.25,
  outline: 1.1,
  ink: "#000000",
  walkSwing: 0.9,
};

// The speed at which the stride is full. main.js walks at this speed.
const FULL_STRIDE_SPEED = 3.5;

const inkMaterial = new THREE.MeshBasicMaterial({ color: body.ink });
const skinMaterial = new THREE.MeshBasicMaterial({ color: body.skin });
const outlineMaterial = new THREE.MeshBasicMaterial({ color: body.ink, side: THREE.BackSide });
// Replaced on every clone.
const placeholderShirt = new THREE.MeshBasicMaterial();

const template = new THREE.Group();

// The fill, and a slightly larger copy rendered inside out in ink, which
// reads as an outline without a post-processing pass.
function inked(geometry, material) {
  const part = new THREE.Group();

  const fill = new THREE.Mesh(geometry, material);
  fill.castShadow = true;
  if (material === placeholderShirt) fill.userData.shirt = true;
  part.add(fill);

  const shell = new THREE.Mesh(geometry, outlineMaterial);
  shell.scale.setScalar(body.outline);
  part.add(shell);

  return part;
}

function noodle(points, radius) {
  const curve = new THREE.CatmullRomCurve3(points);
  const limb = new THREE.Group();

  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, radius, 8, false), inkMaterial);
  tube.castShadow = true;
  limb.add(tube);

  for (const t of [0, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), inkMaterial);
    cap.position.copy(curve.getPoint(t));
    cap.castShadow = true;
    limb.add(cap);
  }

  return limb;
}

// Named, so each clone can find its own joints to animate.
function joint(name, x, y) {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.set(x, y, 0);
  template.add(pivot);
  return pivot;
}

const hipY = body.legLength + 0.02;
const torsoY = hipY + body.torsoHeight / 2 - 0.04;
const torsoTop = torsoY + body.torsoHeight / 2;
const shoulderY = torsoTop - 0.08;
const headY = torsoTop + body.headRadius * body.headSquash - 0.06;

const V = (x, y, z) => new THREE.Vector3(x, y, z);

joint("leftLeg", -body.torsoWidth * 0.45, hipY).add(
  noodle(
    [V(0, 0, 0), V(-body.stance * 0.6, -body.legLength / 2, 0.01), V(-body.stance, -body.legLength, 0)],
    body.legThickness,
  ),
);
joint("rightLeg", body.torsoWidth * 0.45, hipY).add(
  noodle(
    [V(0, 0, 0), V(body.stance * 0.6, -body.legLength / 2, 0.01), V(body.stance, -body.legLength, 0)],
    body.legThickness,
  ),
);
joint("leftArm", -body.torsoWidth * 0.72, shoulderY).add(
  noodle(
    [V(0, 0, 0), V(-body.armSplay * 0.7, -body.armLength / 2, 0.02), V(-body.armSplay, -body.armLength, 0)],
    body.armThickness,
  ),
);
joint("rightArm", body.torsoWidth * 0.72, shoulderY).add(
  noodle(
    [V(0, 0, 0), V(body.armSplay * 0.7, -body.armLength / 2, 0.02), V(body.armSplay, -body.armLength, 0)],
    body.armThickness,
  ),
);

const w = body.torsoWidth;
const h = body.torsoHeight;
const profile = new THREE.SplineCurve([
  new THREE.Vector2(0.001, -h / 2),
  new THREE.Vector2(w * 0.65, -h * 0.475),
  new THREE.Vector2(w * 0.93, -h * 0.35),
  new THREE.Vector2(w, -h * 0.17),
  new THREE.Vector2(w * body.waist, h * 0.03),
  new THREE.Vector2(w * 0.95, h * 0.23),
  new THREE.Vector2(w * 0.74, h * 0.43),
  new THREE.Vector2(0.001, h / 2),
]).getPoints(48);

for (const point of profile) point.x = Math.max(point.x, 0.001);

const torso = inked(new THREE.LatheGeometry(profile, 40), placeholderShirt);
torso.position.y = torsoY;
template.add(torso);

const templateHead = new THREE.Group();
templateHead.name = "head";
templateHead.position.y = headY;
template.add(templateHead);

const ball = inked(new THREE.SphereGeometry(body.headRadius, 32, 24), skinMaterial);
ball.scale.y = body.headSquash;
templateHead.add(ball);

// Eyes and mouth face +z, which is the direction a yaw of zero points.
const r = body.headRadius;
const eyeGeometry = new THREE.SphereGeometry(r * 0.13, 12, 8);
for (const side of [-1, 1]) {
  const eye = new THREE.Mesh(eyeGeometry, inkMaterial);
  eye.position.set(side * r * 0.34, r * 0.2 * body.headSquash, r * 0.88);
  templateHead.add(eye);
}

const mouth = new THREE.Mesh(new THREE.SphereGeometry(r * 0.15, 12, 8), inkMaterial);
mouth.position.set(0, -r * 0.24 * body.headSquash, r * 0.94);
mouth.scale.set(1.1, 0.5, 0.4);
templateHead.add(mouth);

export function createFigure({ id, name, you }) {
  const root = template.clone();

  const shirt = new THREE.MeshBasicMaterial({ color: colourFor(id) });
  root.traverse((part) => {
    if (part.userData.shirt) part.material = shirt;
  });

  const leftLeg = root.getObjectByName("leftLeg");
  const rightLeg = root.getObjectByName("rightLeg");
  const leftArm = root.getObjectByName("leftArm");
  const rightArm = root.getObjectByName("rightArm");
  const head = root.getObjectByName("head");

  // The name hangs from its top edge at the figure's feet, below it on screen,
  // leaving the air above the head for speech.
  const label = document.createElement("div");
  label.className = "name";
  label.textContent = you ? `${name} (you)` : name;
  const tag = new CSS2DObject(label);
  tag.center.set(0.5, 0);
  root.add(tag);

  let phase = 0;
  let chatter = 0;

  return {
    root,
    // What speech is anchored to.
    head,

    place(x, z, yaw) {
      root.position.x = x;
      root.position.z = z;
      root.rotation.y = yaw;
    },

    // 05's walk: legs and arms swing with the distance covered, the body bobs
    // with each step and breathes when still, and talking jiggles the head.
    animate(speed, delta, elapsed) {
      const stride = Math.min(speed / FULL_STRIDE_SPEED, 1);
      phase += speed * 3.2 * delta;
      const swing = Math.sin(phase) * body.walkSwing * stride;

      leftLeg.rotation.x = swing;
      rightLeg.rotation.x = -swing;
      leftArm.rotation.x = -swing * 0.8;
      rightArm.rotation.x = swing * 0.8;

      root.position.y = Math.abs(Math.sin(phase)) * 0.05 * stride + Math.sin(elapsed * 1.6) * 0.008;

      chatter = Math.max(0, chatter - delta * 3.5);
      head.position.y = headY + Math.sin(elapsed * 34) * 0.022 * chatter;
    },

    // Each character spoken tops the jiggle back up.
    chatter() {
      chatter = 1;
    },

    // CSS2DRenderer does not remove an object's element when the object leaves
    // the scene, and the shirt is this figure's alone.
    dispose() {
      label.remove();
      shirt.dispose();
    },
  };
}

// The same id gives the same colour in every tab.
function colourFor(id) {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((hash % 360) / 360, 0.7, 0.5);
}
