import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { scene, camera, worldPerPixel } from "./world.js";

// Speech as a stream of single characters, from threejs-experiments-01/05.
//
// Each character is let go above the speaker's head, drifts left across the
// screen and fades over a fixed lifetime. Type fluently and the letters pack
// into words; hesitate and the sentence spreads out and dissolves before you
// finish it.
//
// There is one speaker per person. The camera is locked, so "left on screen"
// is the same direction in the world for everyone and a sentence lies the same
// way in every tab. Letter spacing still depends on local frame timing, which
// the spec accepts: it reads as a different hand, not different words.

const PACE = 2; // drift speed, in character widths per second
const GAP = 1.05; // minimum letter spacing, in character widths
const CURL = 0.05; // upward drift, growing with age
const LIFETIME = 4.5; // seconds from spoken to gone
const RESTART = 0.9; // seconds of silence that end an utterance
const TILT = 9; // degrees of random rotation per letter
const SIZE = 22; // font size in pixels, matching .glyph in index.html
const SPAWN_HEIGHT = 1.2; // above the speaker's feet, clear of the name label
const MAX_GLYPHS = 120; // per speaker, where 05 had one global cap

const INK = new THREE.Color("#101014");
const FADE = new THREE.Color("#595959");
const blended = new THREE.Color();

const forward = new THREE.Vector3();
camera.getWorldDirection(forward);
forward.y = 0;
forward.normalize();
const screenLeft = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).negate();
const screenRight = screenLeft.clone().negate();

const anchorPoint = new THREE.Vector3();
const separation = new THREE.Vector3();

// A monospace glyph is about 0.6 of its font size wide.
const glyphWidth = () => SIZE * 0.6 * worldPerPixel();

export function createSpeaker(anchor) {
  const glyphs = [];
  let silence = Infinity;

  function remove(item) {
    item.object.removeFromParent();
    item.element.remove();
  }

  return {
    say(character) {
      const element = document.createElement("div");
      const glyph = document.createElement("span");
      glyph.className = "glyph";
      glyph.textContent = character;
      // The renderer owns the outer element's transform, so the tilt goes on
      // an inner span.
      glyph.style.transform = `rotate(${(Math.random() - 0.5) * TILT}deg)`;
      element.append(glyph);

      const object = new CSS2DObject(element);
      anchor.getWorldPosition(anchorPoint);
      object.position
        .copy(anchorPoint)
        .addScaledVector(screenRight, 0.22)
        .setY(anchorPoint.y + SPAWN_HEIGHT);

      // Within one utterance, a letter that would land on the previous one is
      // placed off its edge instead. After a pause the chain is broken and the
      // letter starts back at the speaker.
      const continuing = silence < RESTART;
      silence = 0;
      const previous = continuing ? glyphs[glyphs.length - 1] : null;
      if (previous) {
        separation.subVectors(object.position, previous.object.position);
        const clearance = separation.dot(screenRight);
        const needed = glyphWidth() * GAP;
        if (clearance < needed) object.position.addScaledVector(screenRight, needed - clearance);
      }

      scene.add(object);
      glyphs.push({ element, glyph, object, age: 0 });
      if (glyphs.length > MAX_GLYPHS) remove(glyphs.shift());
    },

    update(delta) {
      silence += delta;
      const lateral = glyphWidth() * PACE * delta;

      for (let i = glyphs.length - 1; i >= 0; i--) {
        const item = glyphs[i];
        item.age += delta;
        if (item.age >= LIFETIME) {
          remove(item);
          glyphs.splice(i, 1);
          continue;
        }

        const life = item.age / LIFETIME;
        blended.copy(INK).lerp(FADE, life);
        item.glyph.style.color = `#${blended.getHexString()}`;
        item.element.style.opacity = String(1 - life);
        item.object.position.addScaledVector(screenLeft, lateral);
        item.object.position.y += CURL * item.age * delta;
      }
    },

    dispose() {
      for (const item of glyphs) remove(item);
      glyphs.length = 0;
    },
  };
}
