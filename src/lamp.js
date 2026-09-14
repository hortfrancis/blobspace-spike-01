import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { scene } from "./world.js";

// Step five: one object whose state everyone shares.
//
// The lamp is 06's, and so are the reach, the prompt, the swell when it is in
// reach and the box you cannot walk through. What is new is who decides: the
// room. Pressing Enter changes the lamp here at once and asks the room for
// that state, and the room tells everyone, so it is on for all or for none.

const REACH = 1.2;
const HALF_SIZE = 0.2;
const BODY_RADIUS = 0.28; // a dot's radius, from dot.js

const OFF_COLOUR = "#6d6a60";
const ON_COLOUR = "#ffd98a";

const ink = new THREE.MeshBasicMaterial({ color: "#000000" });
const outline = new THREE.MeshBasicMaterial({ color: "#000000", side: THREE.BackSide });

const group = new THREE.Group();
group.position.set(-2.6, 0, -1.4);
scene.add(group);

const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.6, 10), ink);
post.position.y = 0.8;
post.castShadow = true;
group.add(post);

const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.07, 14), ink);
foot.position.y = 0.035;
foot.castShadow = true;
group.add(foot);

// An inked shape, as 06 draws them: the fill, and a slightly larger copy
// rendered inside out in black for the outline.
const bulbGeometry = new THREE.SphereGeometry(0.17, 20, 14);
const bulbMaterial = new THREE.MeshBasicMaterial({ color: OFF_COLOUR });
const bulb = new THREE.Group();
bulb.position.y = 1.68;
bulb.add(new THREE.Mesh(bulbGeometry, bulbMaterial));
const shell = new THREE.Mesh(bulbGeometry, outline);
shell.scale.setScalar(1.1);
bulb.add(shell);
group.add(bulb);

// Range matters more than brightness: a point light falls off to nothing at
// its distance, which is what gives the pool of light an edge.
const light = new THREE.PointLight("#ffc76b", 0, 5, 1.6);
light.position.y = 1.68;
group.add(light);

const element = document.createElement("div");
element.className = "prompt";
const key = document.createElement("span");
key.className = "key";
key.textContent = "⏎"; // the return symbol, as it appears on a key cap
const what = document.createElement("span");
element.append(key, what);
const prompt = new CSS2DObject(element);
prompt.position.y = 2.1;
// Hidden through the object, not the element: CSS2DRenderer rewrites each
// element's display on every frame from its object's visibility, so hiding
// the element directly, as 06 did, lasts only until the next render.
prompt.visible = false;
group.add(prompt);

let on = false;
let focus = 0;

export const lamp = {
  get on() {
    return on;
  },

  set(value) {
    on = value;
    light.intensity = on ? 4.5 : 0;
    bulbMaterial.color.set(on ? ON_COLOUR : OFF_COLOUR);
  },

  // Distance on the floor only, as in 06.
  inReach(position) {
    return Math.hypot(position.x - group.position.x, position.z - group.position.z) < REACH;
  },

  // The swell and the prompt are this viewer's alone: they show that the lamp
  // is in your reach, which is nobody else's business.
  update(position, delta) {
    const target = this.inReach(position) ? 1 : 0;
    focus += (target - focus) * (1 - Math.exp(-16 * delta));
    group.scale.setScalar(1 + focus * 0.07);

    const visible = focus > 0.02;
    prompt.visible = visible;
    if (visible) {
      element.style.opacity = String(focus);
      what.textContent = on ? "Turn the lamp off" : "Turn the lamp on";
    }
  },

  // 06's collision for one upright box: grow it by the dot's radius, which
  // turns the dot into a point, and push the point out along whichever axis
  // moves it least, so walking into the lamp slides past it.
  pushOut(position) {
    const half = HALF_SIZE + BODY_RADIUS;
    const dx = position.x - group.position.x;
    const dz = position.z - group.position.z;
    if (Math.abs(dx) >= half || Math.abs(dz) >= half) return;

    if (half - Math.abs(dx) < half - Math.abs(dz)) {
      position.x = group.position.x + (dx < 0 ? -half : half);
    } else {
      position.z = group.position.z + (dz < 0 ? -half : half);
    }
  },
};
