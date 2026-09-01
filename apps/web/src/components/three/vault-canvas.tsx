'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * The hero's 3D world, in imperative three — the same shape the shader canvases
 * use (a `running` prop the visibility gate drives), so it inherits the hero's
 * lazy-mount, pause-offscreen and reduced-motion guarantees. Nothing here mounts
 * under reduced motion; the static `.mesh-fallback` gradient carries that case.
 *
 * The metaphor is Maren's thesis, not decoration: a faceted obsidian core is the
 * Bitcoin you lock and never sell, its violet facet edges lit from within; a slow
 * ring of particles is MUSD moving on Mezo around it; a grid horizon recedes into
 * fog. Brand palette holds — violet is the one accent, with a sparse ember warmth
 * reading as BTC. Bloom does the glow; the hero's own DOM scrims do the vignette.
 */

// Brand tokens, mirrored from globals.css @theme so the scene and the page agree.
const INK = 0x08080a;
const VIOLET = 0x5b3df5;
const VIOLET_LIGHT = 0x8b77ff;
const EMBER = 0xf7931a;

const damp = (cur: number, tgt: number, lambda: number, dt: number) =>
  THREE.MathUtils.lerp(cur, tgt, 1 - Math.exp(-lambda * dt));

export function VaultCanvas({ running }: { running: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const runningRef = useRef(running);
  runningRef.current = running;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      // No WebGL — the CSS fallback beneath us is already the whole picture.
      return;
    }

    const width = () => host.clientWidth || window.innerWidth;
    const height = () => host.clientHeight || window.innerHeight;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.setSize(width(), height());
    renderer.setClearColor(INK, 0);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(INK, 0.114);

    const camera = new THREE.PerspectiveCamera(38, width() / height(), 0.1, 120);
    camera.position.set(0, 0.35, 6.4);
    camera.lookAt(0, 0.1, 0);

    // ---- The core: the Bitcoin locked in the vault --------------------------
    const coreGroup = new THREE.Group();
    scene.add(coreGroup);

    const coreGeo = new THREE.IcosahedronGeometry(1.18, 1);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x0c0c12,
      metalness: 0.92,
      roughness: 0.34,
      emissive: VIOLET,
      emissiveIntensity: 0.12,
      flatShading: true,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    coreGroup.add(core);

    // Glowing facet edges — bright enough for bloom to catch and halo.
    const edgeGeo = new THREE.EdgesGeometry(coreGeo);
    const edgeMat = new THREE.LineBasicMaterial({ color: VIOLET_LIGHT, transparent: true, opacity: 0.85 });
    const edges = new THREE.LineSegments(edgeGeo, edgeMat);
    core.add(edges);

    // Inner light: a small additive shell so the core reads as lit from within.
    const glowGeo = new THREE.IcosahedronGeometry(0.72, 1);
    const glowMat = new THREE.MeshBasicMaterial({ color: VIOLET, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    coreGroup.add(new THREE.Mesh(glowGeo, glowMat));

    // ---- Orbiting liquidity: MUSD in motion around the core -----------------
    const ORBIT = 1400;
    const orbitPos = new Float32Array(ORBIT * 3);
    const orbitSeed = new Float32Array(ORBIT); // per-point radius for a little life
    for (let i = 0; i < ORBIT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.9 + Math.random() * 2.7;
      const y = (Math.random() - 0.5) * 0.7 * (1 - (r - 1.9) / 2.7); // flatter disc, thicker inside
      orbitPos[i * 3] = Math.cos(a) * r;
      orbitPos[i * 3 + 1] = y;
      orbitPos[i * 3 + 2] = Math.sin(a) * r;
      orbitSeed[i] = r;
    }
    const orbitGeo = new THREE.BufferGeometry();
    orbitGeo.setAttribute('position', new THREE.BufferAttribute(orbitPos, 3));
    const orbitMat = new THREE.PointsMaterial({
      color: VIOLET_LIGHT,
      size: 0.028,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const orbit = new THREE.Points(orbitGeo, orbitMat);
    scene.add(orbit);

    // A sparse ember counterpoint — the BTC warmth, deliberately few.
    const EMBERS = 90;
    const emberPos = new Float32Array(EMBERS * 3);
    for (let i = 0; i < EMBERS; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2.1 + Math.random() * 2.4;
      emberPos[i * 3] = Math.cos(a) * r;
      emberPos[i * 3 + 1] = (Math.random() - 0.5) * 0.6;
      emberPos[i * 3 + 2] = Math.sin(a) * r;
    }
    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
    const emberMat = new THREE.PointsMaterial({ color: EMBER, size: 0.045, sizeAttenuation: true, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    const emberPoints = new THREE.Points(emberGeo, emberMat);
    scene.add(emberPoints);

    // Far dust for depth — barely there, fog eats most of it.
    const DUST = 700;
    const dustPos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 26;
      dustPos[i * 3 + 1] = (Math.random() - 0.5) * 16;
      dustPos[i * 3 + 2] = -3 - Math.random() * 16;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({ color: VIOLET_LIGHT, size: 0.02, sizeAttenuation: true, transparent: true, opacity: 0.35, depthWrite: false });
    scene.add(new THREE.Points(dustGeo, dustMat));

    // ---- Grid horizon: the Mezo network receding into fog -------------------
    const grid = new THREE.GridHelper(46, 46, VIOLET, VIOLET);
    const gm = grid.material as THREE.Material | THREE.Material[];
    (Array.isArray(gm) ? gm : [gm]).forEach((m) => {
      m.transparent = true;
      (m as THREE.Material & { opacity: number }).opacity = 0.16;
    });
    grid.position.y = -2.3;
    scene.add(grid);

    // ---- Lighting -----------------------------------------------------------
    scene.add(new THREE.AmbientLight(0x404058, 0.35));
    const key = new THREE.DirectionalLight(VIOLET_LIGHT, 1.3);
    key.position.set(-3, 4, 3);
    scene.add(key);
    const coreLight = new THREE.PointLight(VIOLET, 3.2, 8, 2);
    coreLight.position.set(0, 0, 0);
    scene.add(coreLight);
    const rim = new THREE.DirectionalLight(EMBER, 0.4);
    rim.position.set(3, -1, -2);
    scene.add(rim);

    // ---- Post: a restrained bloom for the glow ------------------------------
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    composer.setSize(width(), height());
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(width(), height()), 0.72, 0.85, 0.2);
    composer.addPass(bloom);

    // ---- Interaction: damped pointer + scroll parallax ----------------------
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onPointerMove = (e: PointerEvent) => {
      pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    let scrollProg = 0; // 0 at top of hero → ~1 as it leaves
    const onScroll = () => {
      scrollProg = THREE.MathUtils.clamp(window.scrollY / (window.innerHeight * 0.85), 0, 1);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    // ---- Resize -------------------------------------------------------------
    const onResize = () => {
      const w = width();
      const h = height();
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);

    // ---- Loop ---------------------------------------------------------------
    const clock = new THREE.Clock();
    let raf = 0;
    let smoothScroll = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!runningRef.current || document.hidden) return;
      const t = clock.elapsedTime;

      // Core turns slowly and breathes; edges shimmer via the inner light.
      core.rotation.y += dt * 0.14;
      core.rotation.x = Math.sin(t * 0.22) * 0.09;
      const pulse = 1 + Math.sin(t * 0.9) * 0.012;
      core.scale.setScalar(pulse);
      coreLight.intensity = 3.2 + Math.sin(t * 1.4) * 0.5;

      // Liquidity orbits; embers drift the other way for a slow shear.
      orbit.rotation.y += dt * 0.05;
      orbit.rotation.x = Math.sin(t * 0.1) * 0.04;
      emberPoints.rotation.y -= dt * 0.03;

      // Damped pointer parallax, attenuated as the hero scrolls away.
      pointer.x = damp(pointer.x, pointer.tx, 3.2, dt);
      pointer.y = damp(pointer.y, pointer.ty, 3.2, dt);
      smoothScroll = damp(smoothScroll, scrollProg, 4.5, dt);
      const atten = 1 - smoothScroll * 0.7;

      camera.position.x = damp(camera.position.x, pointer.x * 0.55 * atten, 6, dt);
      camera.position.y = damp(camera.position.y, 0.35 + pointer.y * -0.28 * atten + smoothScroll * 0.7, 6, dt);
      camera.position.z = damp(camera.position.z, 6.4 + smoothScroll * 1.8, 6, dt);
      coreGroup.position.y = -smoothScroll * 0.5;
      camera.lookAt(0, 0.1 - smoothScroll * 0.2, 0);

      composer.render();
    };
    tick();

    // ---- Teardown -----------------------------------------------------------
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('scroll', onScroll);
      ro.disconnect();
      composer.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        const drawable = o as Partial<THREE.Mesh>;
        drawable.geometry?.dispose?.();
        const mat = drawable.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
        else mat?.dispose?.();
      });
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={hostRef} className="absolute inset-0" />;
}
