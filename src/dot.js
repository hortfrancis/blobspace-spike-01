import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

// Step two's stand-in for a person: a ball with a nose, so you can see which
// way it faces, and a name above it. Step three swaps in the figure from 05.

const ballGeometry = new THREE.SphereGeometry(0.28, 24, 16);
const noseGeometry = new THREE.SphereGeometry(0.07, 12, 8);
const noseMaterial = new THREE.MeshStandardMaterial({ color: "#101014" });

export function createDot({ id, name, you }) {
  const root = new THREE.Group();

  const ball = new THREE.Mesh(
    ballGeometry,
    new THREE.MeshStandardMaterial({ color: colourFor(id), roughness: 0.6 }),
  );
  ball.position.y = 0.28;
  ball.castShadow = true;
  root.add(ball);

  // Faces +z, which is the direction a yaw of zero points.
  const nose = new THREE.Mesh(noseGeometry, noseMaterial);
  nose.position.set(0, 0.3, 0.27);
  root.add(nose);

  const label = document.createElement("div");
  label.className = "name";
  label.textContent = you ? `${name} (you)` : name;
  const tag = new CSS2DObject(label);
  tag.position.y = 0.85;
  root.add(tag);

  // CSS2DRenderer does not remove an object's element when the object leaves
  // the scene, so whoever removes the dot has to call this.
  root.userData.dispose = () => label.remove();

  return root;
}

// The same id gives the same colour in every tab.
function colourFor(id) {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((hash % 360) / 360, 0.65, 0.55);
}
