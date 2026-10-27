/**
 * Cybersecurity 3D Digital Globe & Threat Network Scene
 * Built with Three.js for Portfolio Hero Section
 * Author: Rangga Ganupranowo Hadad
 */

(function () {
  'use strict';

  // Check WebGL availability
  function isWebGLAvailable() {
    try {
      const canvas = document.createElement('canvas');
      return !!(
        window.WebGLRenderingContext &&
        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
      );
    } catch (e) {
      return false;
    }
  }

  // Fallback activator
  function activateFallback(container) {
    if (!container) return;
    container.classList.add('fallback-active');
    const fallbackEl = document.getElementById('hero-3d-fallback');
    if (fallbackEl) {
      fallbackEl.setAttribute('aria-hidden', 'false');
    }
    console.warn('[Hero 3D] WebGL not available or Three.js failed. Fallback activated.');
  }

  // Create sharp, luminous circular particle texture via in-memory canvas
  function createPointTexture(colorInner, colorOuter) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const center = size / 2;
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.2, colorInner || 'rgba(0, 245, 212, 1)');
    gradient.addColorStop(0.55, colorOuter || 'rgba(56, 189, 248, 0.45)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center, center, center, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  function initHero3DScene() {
    const container = document.getElementById('hero-3d-container');
    const canvas = document.getElementById('hero-3d-canvas');
    const heroSection = document.getElementById('hero');

    if (!container || !canvas || !heroSection) return;

    if (typeof window.THREE === 'undefined' || !isWebGLAvailable()) {
      activateFallback(container);
      return;
    }

    // Motion preference check
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let prefersReducedMotion = motionQuery.matches;

    motionQuery.addEventListener('change', (e) => {
      prefersReducedMotion = e.matches;
      if (prefersReducedMotion) {
        targetRotX = baseTiltX;
        targetRotY = baseTiltY;
        currentRotX = baseTiltX;
        currentRotY = baseTiltY;
        if (globeGroup) {
          globeGroup.rotation.x = baseTiltX;
          globeGroup.rotation.y = baseTiltY;
        }
      }
    });

    // Dimensions
    let width = container.clientWidth || window.innerWidth;
    let height = container.clientHeight || window.innerHeight;

    // Three.js Scene Setup
    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 0, 6.2);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance'
      });
    } catch (err) {
      activateFallback(container);
      return;
    }

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);

    // Color definitions (Cybersecurity Dark + Cyan & Sky Blue)
    const COLOR_CYAN = 0x00f5d4;
    const COLOR_SKY = 0x38bdf8;
    const COLOR_DEEP_BLUE = 0x0284c7;

    // Master Groups
    const masterGroup = new THREE.Group();
    const globeGroup = new THREE.Group();
    const particlesGroup = new THREE.Group();
    masterGroup.add(globeGroup);
    masterGroup.add(particlesGroup);
    scene.add(masterGroup);

    // Initial Globe Tilt
    const baseTiltX = 0.22;
    const baseTiltY = 0.35;
    globeGroup.rotation.x = baseTiltX;
    globeGroup.rotation.y = baseTiltY;
    globeGroup.rotation.z = -0.12;

    // Globe Radius based on screen width
    let isMobile = width < 768;
    let isTablet = width >= 768 && width <= 992;
    const globeRadius = isMobile ? 1.75 : 2.25;

    // Position adjustment: Offset slightly to the right on desktop, centered on mobile
    function updateLayoutPositions() {
      if (width > 992) {
        globeGroup.position.set(1.4, 0.05, 0);
        camera.position.set(0, 0, 6.0);
      } else if (width > 768) {
        globeGroup.position.set(0.7, 0.1, 0);
        camera.position.set(0, 0, 6.4);
      } else {
        globeGroup.position.set(0, 0.25, 0);
        camera.position.set(0, 0, 6.8);
      }
    }
    updateLayoutPositions();

    /* ----------------------------------------------------------------------
       1. Fibonacci Point Cloud Sphere (Cyber Global Nodes)
       ---------------------------------------------------------------------- */
    const pointCount = isMobile ? 320 : 640;
    const nodePositions = [];
    const nodeColors = [];
    const nodeVectors = [];

    const color1 = new THREE.Color(COLOR_CYAN);
    const color2 = new THREE.Color(COLOR_SKY);
    const color3 = new THREE.Color(0x67e8f9);

    for (let i = 0; i < pointCount; i++) {
      // Golden spiral distribution
      const phi = Math.acos(1 - (2 * (i + 0.5)) / pointCount);
      const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);

      const x = globeRadius * Math.sin(phi) * Math.cos(theta);
      const y = globeRadius * Math.cos(phi);
      const z = globeRadius * Math.sin(phi) * Math.sin(theta);

      nodePositions.push(x, y, z);
      const vec = new THREE.Vector3(x, y, z);
      nodeVectors.push(vec);

      // Color variation between cyan and sky blue
      const ratio = Math.random();
      const nodeColor = ratio > 0.65 ? color1 : ratio > 0.3 ? color2 : color3;
      nodeColors.push(nodeColor.r, nodeColor.g, nodeColor.b);
    }

    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.Float32BufferAttribute(nodePositions, 3));
    nodeGeo.setAttribute('color', new THREE.Float32BufferAttribute(nodeColors, 3));

    const cyanTexture = createPointTexture('rgba(0, 245, 212, 1)', 'rgba(56, 189, 248, 0.5)');
    const nodeMat = new THREE.PointsMaterial({
      size: isMobile ? 0.11 : 0.13,
      vertexColors: true,
      map: cyanTexture,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const nodesMesh = new THREE.Points(nodeGeo, nodeMat);
    globeGroup.add(nodesMesh);

    /* ----------------------------------------------------------------------
       2. Geodesic Inner Wireframe Shield
       ---------------------------------------------------------------------- */
    const innerGeo = new THREE.IcosahedronGeometry(globeRadius * 0.985, 2);
    const innerMat = new THREE.MeshBasicMaterial({
      color: COLOR_DEEP_BLUE,
      wireframe: true,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending
    });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    globeGroup.add(innerMesh);

    /* ----------------------------------------------------------------------
       3. Surface Network Connections (Interconnected Telemetry Links)
       ---------------------------------------------------------------------- */
    const lineIndices = [];
    const maxNeighborDist = globeRadius * 0.44;
    const minNeighborDist = globeRadius * 0.12;
    const maxConnections = isMobile ? 80 : 160;
    let connectionsCount = 0;

    for (let i = 0; i < nodeVectors.length && connectionsCount < maxConnections; i++) {
      for (let j = i + 1; j < nodeVectors.length && connectionsCount < maxConnections; j++) {
        const dist = nodeVectors[i].distanceTo(nodeVectors[j]);
        if (dist > minNeighborDist && dist < maxNeighborDist && Math.random() < 0.28) {
          lineIndices.push(
            nodeVectors[i].x, nodeVectors[i].y, nodeVectors[i].z,
            nodeVectors[j].x, nodeVectors[j].y, nodeVectors[j].z
          );
          connectionsCount++;
        }
      }
    }

    const linesGeo = new THREE.BufferGeometry();
    linesGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineIndices, 3));
    const linesMat = new THREE.LineBasicMaterial({
      color: COLOR_CYAN,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending
    });
    const linesMesh = new THREE.LineSegments(linesGeo, linesMat);
    globeGroup.add(linesMesh);

    /* ----------------------------------------------------------------------
       4. Great Circle Data Telemetry Arcs with Traveling Packet Pulses
       ---------------------------------------------------------------------- */
    const arcsGroup = new THREE.Group();
    const arcCount = isMobile ? 3 : 5;
    const packetTrackers = [];

    // Select distinct hub pairs on opposite / distant regions
    const hubPairs = [
      { from: 12, to: 85 },
      { from: 45, to: 160 },
      { from: 90, to: 240 },
      { from: 130, to: 310 },
      { from: 210, to: 70 }
    ];

    for (let i = 0; i < Math.min(arcCount, hubPairs.length); i++) {
      const idxA = hubPairs[i].from % nodeVectors.length;
      const idxB = hubPairs[i].to % nodeVectors.length;
      const pA = nodeVectors[idxA];
      const pB = nodeVectors[idxB];

      // Midpoint elevated above the sphere
      const mid = pA.clone().add(pB).multiplyScalar(0.5);
      const elevation = globeRadius * 1.35;
      mid.normalize().multiplyScalar(elevation);

      const curve = new THREE.QuadraticBezierCurve3(pA, mid, pB);
      const curvePoints = curve.getPoints(36);
      const arcGeo = new THREE.BufferGeometry().setFromPoints(curvePoints);
      const arcMat = new THREE.LineBasicMaterial({
        color: i % 2 === 0 ? COLOR_CYAN : COLOR_SKY,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending
      });
      const arcLine = new THREE.Line(arcGeo, arcMat);
      arcsGroup.add(arcLine);

      // Traveling telemetry packet on this arc
      const packetGeo = new THREE.BufferGeometry();
      packetGeo.setAttribute('position', new THREE.Float32BufferAttribute([pA.x, pA.y, pA.z], 3));
      const packetMat = new THREE.PointsMaterial({
        size: 0.16,
        color: 0xffffff,
        map: cyanTexture,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const packetPoint = new THREE.Points(packetGeo, packetMat);
      arcsGroup.add(packetPoint);

      packetTrackers.push({
        curve: curve,
        mesh: packetPoint,
        progress: (i / arcCount),
        speed: 0.0035 + (i * 0.0008)
      });
    }
    globeGroup.add(arcsGroup);

    /* ----------------------------------------------------------------------
       5. Pulsing Gateway Defense Hubs (Beacon Nodes)
       ---------------------------------------------------------------------- */
    const gatewayIndices = [12, 45, 90, 130, 210, 85, 160, 240];
    const beaconPoints = [];
    gatewayIndices.forEach((idx) => {
      if (nodeVectors[idx]) {
        beaconPoints.push(nodeVectors[idx]);
      }
    });

    const beaconGeo = new THREE.BufferGeometry();
    const beaconPos = [];
    beaconPoints.forEach((v) => beaconPos.push(v.x, v.y, v.z));
    beaconGeo.setAttribute('position', new THREE.Float32BufferAttribute(beaconPos, 3));

    const beaconTexture = createPointTexture('rgba(0, 245, 212, 1)', 'rgba(0, 229, 255, 0.8)');
    const beaconMat = new THREE.PointsMaterial({
      size: isMobile ? 0.22 : 0.28,
      color: 0x00f5d4,
      map: beaconTexture,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const beaconMesh = new THREE.Points(beaconGeo, beaconMat);
    globeGroup.add(beaconMesh);

    /* ----------------------------------------------------------------------
       6. Orbital Security Perimeter Rings
       ---------------------------------------------------------------------- */
    function createPerimeterRing(radius, rotX, rotY, color, opacity) {
      const segments = 84;
      const pts = [];
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: opacity,
        blending: THREE.AdditiveBlending
      });
      const ring = new THREE.Line(geo, mat);
      ring.rotation.x = rotX;
      ring.rotation.y = rotY;
      return ring;
    }

    const ring1 = createPerimeterRing(globeRadius * 1.22, 1.35, 0.3, COLOR_CYAN, 0.28);
    const ring2 = createPerimeterRing(globeRadius * 1.38, -0.65, 0.8, COLOR_SKY, 0.18);
    const ring3 = createPerimeterRing(globeRadius * 1.52, 0.2, -0.5, COLOR_DEEP_BLUE, 0.12);

    globeGroup.add(ring1);
    globeGroup.add(ring2);
    globeGroup.add(ring3);

    /* ----------------------------------------------------------------------
       7. Ambient Floating Cyber Star Dust / Particle Field
       ---------------------------------------------------------------------- */
    const dustCount = isMobile ? 120 : 220;
    const dustPositions = [];
    const dustColors = [];

    for (let i = 0; i < dustCount; i++) {
      const dx = (Math.random() - 0.5) * 16;
      const dy = (Math.random() - 0.5) * 10;
      const dz = (Math.random() - 0.6) * 10 - 1.5;

      dustPositions.push(dx, dy, dz);

      const isCyan = Math.random() > 0.4;
      const dColor = isCyan ? color1 : color2;
      dustColors.push(dColor.r, dColor.g, dColor.b);
    }

    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dustPositions, 3));
    dustGeo.setAttribute('color', new THREE.Float32BufferAttribute(dustColors, 3));

    const dustMat = new THREE.PointsMaterial({
      size: 0.08,
      vertexColors: true,
      map: cyanTexture,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const dustMesh = new THREE.Points(dustGeo, dustMat);
    particlesGroup.add(dustMesh);

    /* ----------------------------------------------------------------------
       8. Mouse Interaction with Smooth Damping (Lerp)
       ---------------------------------------------------------------------- */
    let mouseX = 0;
    let mouseY = 0;
    let targetRotX = baseTiltX;
    let targetRotY = baseTiltY;
    let currentRotX = baseTiltX;
    let currentRotY = baseTiltY;

    function onPointerMove(e) {
      if (prefersReducedMotion) return;
      // Normalized between -1 and 1
      mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      mouseY = -(e.clientY / window.innerHeight) * 2 + 1;

      targetRotY = baseTiltY + mouseX * 0.45;
      targetRotX = baseTiltX - mouseY * 0.32;
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true });

    /* ----------------------------------------------------------------------
       9. Responsive Resize Handler
       ---------------------------------------------------------------------- */
    function onWindowResize() {
      width = container.clientWidth || window.innerWidth;
      height = container.clientHeight || window.innerHeight;
      isMobile = width < 768;
      isTablet = width >= 768 && width <= 992;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      updateLayoutPositions();
    }

    window.addEventListener('resize', onWindowResize);

    /* ----------------------------------------------------------------------
       10. IntersectionObserver to Halt Render Loop when Offscreen
       ---------------------------------------------------------------------- */
    let isHeroVisible = true;
    let animationFrameId = null;

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            isHeroVisible = entry.isIntersecting;
            if (isHeroVisible && !animationFrameId) {
              lastTimestamp = performance.now();
              animationFrameId = requestAnimationFrame(animate);
            }
          });
        },
        { threshold: 0.02 }
      );
      observer.observe(heroSection);
    }

    /* ----------------------------------------------------------------------
       11. Main Render Loop
       ---------------------------------------------------------------------- */
    let lastTimestamp = performance.now();
    let pulseTimer = 0;

    function animate(timestamp) {
      if (!isHeroVisible) {
        animationFrameId = null;
        return;
      }

      animationFrameId = requestAnimationFrame(animate);

      const delta = Math.min((timestamp - lastTimestamp) / 1000, 0.1);
      lastTimestamp = timestamp;
      pulseTimer += delta;

      if (!prefersReducedMotion) {
        // Continuous slow ambient rotation
        globeGroup.rotation.y += delta * 0.12;
        targetRotY += delta * 0.12;

        // Smooth mouse damping (Lerp)
        currentRotX += (targetRotX - currentRotX) * 0.05;
        currentRotY += (targetRotY - currentRotY) * 0.05;
        globeGroup.rotation.x = currentRotX;
        globeGroup.rotation.y = currentRotY;

        // Parallax depth on background particles
        particlesGroup.position.x += (mouseX * 0.35 - particlesGroup.position.x) * 0.04;
        particlesGroup.position.y += (mouseY * 0.25 - particlesGroup.position.y) * 0.04;

        // Counter-rotate perimeter rings
        ring1.rotation.z += delta * 0.06;
        ring2.rotation.z -= delta * 0.04;
        ring3.rotation.z += delta * 0.03;

        // Animate traveling telemetry packets along curves
        packetTrackers.forEach((tracker) => {
          tracker.progress += tracker.speed;
          if (tracker.progress > 1) tracker.progress = 0;
          const pos = tracker.curve.getPoint(tracker.progress);
          const posAttr = tracker.mesh.geometry.attributes.position;
          posAttr.setXYZ(0, pos.x, pos.y, pos.z);
          posAttr.needsUpdate = true;
        });

        // Pulsing gateway beacons
        const pulseScale = 0.24 + Math.sin(pulseTimer * 3.2) * 0.06;
        beaconMat.size = isMobile ? pulseScale * 0.8 : pulseScale;
      }

      renderer.render(scene, camera);
    }

    // Start initial frame
    animationFrameId = requestAnimationFrame(animate);
  }

  // Initialize once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHero3DScene);
  } else {
    initHero3DScene();
  }
})();
