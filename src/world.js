import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";

// The scene, camera, lights and floor from threejs-experiments-01/05, with the
// camera locked. Drifting speech takes its direction from the camera, so
// everyone in the room has to look from the same angle.

export const GRID = 10;
export const TILE = 1;
const VIEW_SIZE = 8;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

// Draws no pixels. It moves real HTML elements to where their objects project
// on screen, which is how the name labels, and later speech, are drawn.
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.id = "labels";
document.body.appendChild(labelRenderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color("#faf6ef");

export const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
camera.position.set(20, 20, 20);
camera.lookAt(0, 0, 0);

scene.add(new THREE.AmbientLight("#cfc6b6", 1.6));

const sun = new THREE.DirectionalLight("#fffaf0", 2.2);
sun.position.set(-7, 12, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.normalBias = 0.02;
sun.shadow.camera.left = -12;
sun.shadow.camera.right = 12;
sun.shadow.camera.top = 12;
sun.shadow.camera.bottom = -12;
scene.add(sun);

const tileGeometry = new THREE.PlaneGeometry(TILE, TILE);
const lightTile = new THREE.MeshStandardMaterial({ color: "#f2ece1", roughness: 1 });
const darkTile = new THREE.MeshStandardMaterial({ color: "#e3dacb", roughness: 1 });

for (let x = 0; x < GRID; x++) {
  for (let z = 0; z < GRID; z++) {
    const tile = new THREE.Mesh(tileGeometry, (x + z) % 2 === 0 ? lightTile : darkTile);
    tile.rotation.x = -Math.PI / 2;
    tile.position.set((x - (GRID - 1) / 2) * TILE, 0, (z - (GRID - 1) / 2) * TILE);
    tile.receiveShadow = true;
    scene.add(tile);
  }
}

function resize() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = (-VIEW_SIZE * aspect) / 2;
  camera.right = (VIEW_SIZE * aspect) / 2;
  camera.top = VIEW_SIZE / 2;
  camera.bottom = -VIEW_SIZE / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
}

resize();
window.addEventListener("resize", resize);

export function render() {
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

export function onFrame(callback) {
  renderer.setAnimationLoop(callback);
}
