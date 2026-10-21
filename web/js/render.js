// Draws the game with Three.js. Reads game state but never changes it.
import * as THREE from "three";
import { GRID_SIZE, OBSTACLE_FADE_IN } from "./logic.js";

const CELL = 40;
const HALF = CELL / 2;
const BOARD = GRID_SIZE * CELL;
const OFFSET = BOARD / 2;
const BOARD_THICKNESS = 12;
const MAX_PARTICLES = 90;

// One theme per level, cycling. The board color tints a light/dark checker texture.
export const THEMES = [
  { id: "meadow", sky: 0xa1e9ff, board: 0xb8cc60, side: 0x3d5a2e, obstacle: 0x8c929c, light: 1.0, stars: 0 },
  { id: "desert", sky: 0xffd8a8, board: 0xf2cf8a, side: 0x9c6b32, obstacle: 0xa0705a, light: 1.05, stars: 0 },
  { id: "ice", sky: 0xdff4ff, board: 0xdcefff, side: 0x5c9bbd, obstacle: 0x8fb4cf, light: 1.0, stars: 0 },
  { id: "night", sky: 0x1b2244, board: 0x7ab497, side: 0x1a3328, obstacle: 0x7d84a8, light: 0.6, stars: 0.7 },
  { id: "lava", sky: 0x3a1410, board: 0xc0674a, side: 0x2a0f0a, obstacle: 0x595959, light: 0.8, stars: 0 },
  { id: "space", sky: 0x05061a, board: 0x7c80c8, side: 0x15162e, obstacle: 0xa3a4cc, light: 0.75, stars: 1 },
];

const COLORS = {
  head: 0x16d65a,
  body: 0x12bf4c,
  tail: 0x0b8a36,
  boosted: 0x5e9abc,
  slow: 0x2ec4b6,
  apple: 0xe8262a,
};

const POWER_UP_GLOW = { star: 0x4f8bff, slow: 0x2ed3c6, shrink: 0xb05cff, ghost: 0xffffff };

export function themeForLevel(level) {
  return THEMES[(level - 1) % THEMES.length];
}

// Board cell (x, y) to a 3D point. Board y runs toward -Z so the camera and
// arrow-key math match the desktop game.
function toWorld(x, y, height = HALF) {
  return new THREE.Vector3(x * CELL - OFFSET + HALF, height, -(y * CELL - OFFSET + HALF));
}

function standardMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...options });
}

function glowMaterial(color, options = {}) {
  return standardMaterial(color, { emissive: color, emissiveIntensity: 0.5, roughness: 0.3, ...options });
}

function canvasTexture(size, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d"), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeStar() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? 22 : 10;
    const angle = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) {
      shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    } else {
      shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 6, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 2 });
  geometry.center();
  return new THREE.Mesh(geometry, glowMaterial(0x2f7dff));
}

function makeHourglass() {
  const group = new THREE.Group();
  const glass = glowMaterial(0x2ed3c6, { transparent: true, opacity: 0.85 });
  const frame = standardMaterial(0xc9a24a, { metalness: 0.5, roughness: 0.3 });
  for (const side of [-1, 1]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(12, 16, 20), glass);
    cone.position.y = side * 8;
    cone.rotation.x = side > 0 ? Math.PI : 0;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 3, 24), frame);
    cap.position.y = side * 17;
    group.add(cone, cap);
  }
  return group;
}

function makeGem() {
  return new THREE.Mesh(new THREE.OctahedronGeometry(17), glowMaterial(0xa64dff, { flatShading: true }));
}

function makeGhost() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(15, 24, 16), glowMaterial(0xffffff, { transparent: true, opacity: 0.75, emissiveIntensity: 0.35 }));
  body.scale.y = 1.15;
  const eyeMaterial = standardMaterial(0x1b1b2a);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(3, 10, 8), eyeMaterial);
    eye.position.set(side * 5, 4, 13);
    group.add(eye);
  }
  group.add(body);
  return group;
}

export class Renderer {
  constructor(canvas) {
    const isSmallScreen = Math.min(window.innerWidth, window.innerHeight) < 600;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 5, 5000);
    this.cameraAngle = 180;
    this.cameraDistance = 500;
    this.cameraHeight = 400;
    this.firstPerson = false;
    this.shakeAmount = 0;
    this.boardCorners = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, z]) => new THREE.Vector3(x * OFFSET, 0, z * OFFSET));

    // Theme colors ease from the current values toward the target theme
    this.theme = {
      sky: new THREE.Color(THEMES[0].sky),
      board: new THREE.Color(THEMES[0].board),
      side: new THREE.Color(THEMES[0].side),
      obstacle: new THREE.Color(THEMES[0].obstacle),
      light: THEMES[0].light,
      stars: THEMES[0].stars,
    };
    this.targetTheme = THEMES[0];
    this.scene.background = this.theme.sky;

    this.addLights(isSmallScreen ? 1024 : 2048);
    this.addStars();
    this.addBoard();
    this.addSnakeParts();
    this.addItems();
    this.bombMeshes = [];
    this.obstacleMeshes = [];
    this.pendingMeshes = [];
    this.addParticles();
  }

  addLights(shadowSize) {
    this.hemisphere = new THREE.HemisphereLight(0xffffff, 0x4a6a3a, 1.1);
    this.scene.add(this.hemisphere);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.8);
    this.sun.position.set(220, 520, 160);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.camera.left = -420;
    this.sun.shadow.camera.right = 420;
    this.sun.shadow.camera.top = 420;
    this.sun.shadow.camera.bottom = -420;
    this.sun.shadow.camera.near = 100;
    this.sun.shadow.camera.far = 1200;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun);
  }

  addStars() {
    const positions = [];
    for (let i = 0; i < 700; i++) {
      const direction = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.05, Math.random() - 0.5).normalize();
      positions.push(...direction.multiplyScalar(2000).toArray());
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this.starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false, transparent: true, opacity: 0 });
    this.scene.add(new THREE.Points(geometry, this.starMaterial));
  }

  addBoard() {
    const pixelsPerCell = 32;
    const texture = canvasTexture(GRID_SIZE * pixelsPerCell, (context) => {
      for (let x = 0; x < GRID_SIZE; x++) {
        for (let y = 0; y < GRID_SIZE; y++) {
          context.fillStyle = (x + y) % 2 === 0 ? "#bdbdbd" : "#ffffff";
          context.fillRect(x * pixelsPerCell, y * pixelsPerCell, pixelsPerCell, pixelsPerCell);
        }
      }
    });
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.boardSideMaterial = standardMaterial(this.theme.side, { roughness: 0.9 });
    this.boardTopMaterial = standardMaterial(this.theme.board, { map: texture, roughness: 0.9 });
    const side = this.boardSideMaterial;
    const board = new THREE.Mesh(new THREE.BoxGeometry(BOARD, BOARD_THICKNESS, BOARD), [side, side, this.boardTopMaterial, side, side, side]);
    board.position.y = -BOARD_THICKNESS / 2;
    board.receiveShadow = true;
    this.scene.add(board);

    this.obstacleMaterial = standardMaterial(this.theme.obstacle, { roughness: 0.8 });
    this.obstacleGeometry = new THREE.BoxGeometry(34, 34, 34);
    // Blocks still forming get hazard stripes and an outline, so they read as
    // different from solid blocks by pattern, not only by color
    this.hazardTexture = canvasTexture(64, (context, size) => {
      context.fillStyle = "#1d1d1d";
      context.fillRect(0, 0, size, size);
      context.fillStyle = "#ffc400";
      for (let offset = -size; offset < size * 2; offset += 32) {
        context.beginPath();
        context.moveTo(offset, 0);
        context.lineTo(offset + 16, 0);
        context.lineTo(offset + 16 - size, size);
        context.lineTo(offset - size, size);
        context.closePath();
        context.fill();
      }
    });
    this.obstacleEdges = new THREE.EdgesGeometry(this.obstacleGeometry);
  }

  addSnakeParts() {
    this.segmentGeometry = new THREE.SphereGeometry(20, 24, 16);
    this.segmentMeshes = [];
    this.head = new THREE.Group();
    this.headMaterial = standardMaterial(COLORS.head, { transparent: true });
    const skull = new THREE.Mesh(new THREE.SphereGeometry(22, 28, 20), this.headMaterial);
    skull.castShadow = true;
    this.head.add(skull);
    const eyeWhite = standardMaterial(0xffffff, { roughness: 0.3 });
    const pupil = standardMaterial(0x111111, { roughness: 0.2 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 10), eyeWhite);
      eye.position.set(12, 12, side * 10);
      const eyePupil = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 8), pupil);
      eyePupil.position.set(4, 1.5, 0);
      eye.add(eyePupil);
      this.head.add(eye);
    }
    this.tongue = new THREE.Mesh(new THREE.ConeGeometry(2.5, 12, 8), standardMaterial(0xd11a2a));
    this.tongue.rotation.z = -Math.PI / 2;
    this.tongue.position.set(24, -4, 0);
    this.head.add(this.tongue);
    this.scene.add(this.head);
  }

  addItems() {
    this.apple = new THREE.Group();
    const fruit = new THREE.Mesh(new THREE.SphereGeometry(17, 28, 20), standardMaterial(COLORS.apple, { roughness: 0.35 }));
    fruit.scale.y = 0.92;
    fruit.castShadow = true;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2, 9, 8), standardMaterial(0x6b3e1c));
    stem.position.y = 18;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(5, 10, 8), standardMaterial(0x3fae3a));
    leaf.scale.set(1.4, 0.35, 0.8);
    leaf.position.set(5, 19, 0);
    leaf.rotation.z = 0.5;
    this.apple.add(fruit, stem, leaf);
    this.scene.add(this.apple);

    this.powerUpModels = { star: makeStar(), slow: makeHourglass(), shrink: makeGem(), ghost: makeGhost() };
    this.powerUpHolder = new THREE.Group();
    for (const model of Object.values(this.powerUpModels)) {
      model.traverse((part) => { part.castShadow = true; });
      this.powerUpHolder.add(model);
    }
    this.powerUpLight = new THREE.PointLight(0xffffff, 0, 160);
    this.powerUpHolder.add(this.powerUpLight);
    this.scene.add(this.powerUpHolder);
    // A glowing ring on the floor marks the power-up's cell; floating above the
    // board, it could otherwise look like it sits on a block in front of it
    this.powerUpRing = new THREE.Mesh(
      new THREE.RingGeometry(13, 18, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.powerUpRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.powerUpRing);
  }

  addParticles() {
    const geometry = new THREE.BoxGeometry(5, 5, 5);
    this.particles = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const mesh = new THREE.Mesh(geometry, standardMaterial(0xffffff, { emissiveIntensity: 0.4 }));
      mesh.visible = false;
      this.scene.add(mesh);
      this.particles.push({ mesh, velocity: new THREE.Vector3(), life: 0 });
    }
  }

  burst(position, color, count = 18) {
    const origin = toWorld(position[0], position[1]);
    let started = 0;
    for (const particle of this.particles) {
      if (particle.life > 0) {
        continue;
      }
      particle.life = 0.7;
      particle.mesh.visible = true;
      particle.mesh.position.copy(origin);
      particle.mesh.material.color.set(color);
      particle.mesh.material.emissive.set(color);
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 120;
      particle.velocity.set(Math.cos(angle) * speed, 140 + Math.random() * 120, Math.sin(angle) * speed);
      if (++started >= count) {
        break;
      }
    }
  }

  shake(amount = 14) {
    this.shakeAmount = amount;
  }

  setLevel(level) {
    this.targetTheme = themeForLevel(level);
  }

  resize() {
    const canvas = this.renderer.domElement;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  ensureMeshes(list, count, create) {
    while (list.length < count) {
      const mesh = create();
      this.scene.add(mesh);
      list.push(mesh);
    }
    list.forEach((mesh, i) => { mesh.visible = i < count; });
  }

  updateTheme(deltaTime) {
    const blend = Math.min(1, deltaTime * 1.5);
    const target = this.targetTheme;
    this.theme.sky.lerp(new THREE.Color(target.sky), blend);
    this.theme.board.lerp(new THREE.Color(target.board), blend);
    this.theme.side.lerp(new THREE.Color(target.side), blend);
    this.theme.obstacle.lerp(new THREE.Color(target.obstacle), blend);
    this.theme.light += (target.light - this.theme.light) * blend;
    this.theme.stars += (target.stars - this.theme.stars) * blend;
    this.boardTopMaterial.color.copy(this.theme.board);
    this.boardSideMaterial.color.copy(this.theme.side);
    this.obstacleMaterial.color.copy(this.theme.obstacle);
    this.hemisphere.intensity = 1.1 * this.theme.light;
    this.sun.intensity = 1.8 * this.theme.light;
    this.starMaterial.opacity = this.theme.stars;
  }

  updateCamera(game, deltaTime) {
    const aspect = this.camera.aspect;
    if (this.firstPerson && game && !game.isFinished()) {
      // A wider horizontal view in first person, also on tall phone screens
      const horizontalFov = THREE.MathUtils.degToRad(100);
      this.camera.fov = Math.min(110, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(horizontalFov / 2) / aspect)));
      const [headX, headY] = game.drawnSnake()[0];
      const heading = game.headingAngle();
      const eye = toWorld(headX, headY, HALF + 20);
      this.camera.position.copy(eye);
      this.camera.lookAt(eye.x + Math.cos(heading) * 400, HALF, eye.z - Math.sin(heading) * 400);
    } else {
      // On tall phone screens, widen the view first (up to a limit) so the whole board
      // fits across, and only then pull the camera back
      const minHorizontalFov = THREE.MathUtils.degToRad(62);
      const neededFov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(minHorizontalFov / 2) / aspect));
      this.camera.fov = Math.min(85, Math.max(60, neededFov));
      this.camera.updateProjectionMatrix();
      const angle = THREE.MathUtils.degToRad(this.cameraAngle);
      // Back the camera off until all four board corners are on screen
      for (let fit = 1, step = 0; step < 20; step++, fit *= 1.06) {
        this.camera.position.set(
          this.cameraDistance * fit * Math.sin(angle),
          this.cameraHeight * fit,
          -this.cameraDistance * fit * Math.cos(angle),
        );
        this.camera.lookAt(0, 0, 0);
        this.camera.updateMatrixWorld();
        if (this.boardCorners.every((corner) => {
          const projected = corner.clone().project(this.camera);
          return Math.abs(projected.x) <= 0.96 && Math.abs(projected.y) <= 0.9;
        })) {
          break;
        }
      }
    }
    if (this.shakeAmount > 0.1) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmount;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmount;
      this.shakeAmount *= Math.pow(0.02, deltaTime);
    }
    this.camera.updateProjectionMatrix();
  }

  updateSnake(game, time) {
    const visible = Boolean(game) && !(this.firstPerson && !game.isFinished());
    this.head.visible = visible;
    if (!visible) {
      this.ensureMeshes(this.segmentMeshes, 0);
      return;
    }
    const positions = game.drawnSnake();
    this.head.position.copy(toWorld(positions[0][0], positions[0][1], HALF + 2));
    this.head.rotation.y = game.headingAngle();
    this.tongue.scale.x = 0.6 + 0.4 * Math.abs(Math.sin(time * 8));

    let headColor = COLORS.head;
    let bodyColor = COLORS.body;
    let tailColor = COLORS.tail;
    if (game.effects.doublePoints > 0) {
      headColor = bodyColor = tailColor = COLORS.boosted;
    } else if (game.effects.slow > 0) {
      headColor = bodyColor = tailColor = COLORS.slow;
    }
    // A ghostly, flickering snake while the ghost power-up is ready
    const opacity = game.effects.ghost > 0 ? 0.45 + 0.1 * Math.sin(time * 6) : 1;
    this.headMaterial.color.set(headColor);
    this.headMaterial.opacity = opacity;

    const bodyCount = positions.length - 1;
    this.ensureMeshes(this.segmentMeshes, bodyCount, () => {
      const mesh = new THREE.Mesh(this.segmentGeometry, standardMaterial(COLORS.body, { transparent: true }));
      mesh.castShadow = true;
      return mesh;
    });
    const body = new THREE.Color(bodyColor);
    const tail = new THREE.Color(tailColor);
    for (let i = 0; i < bodyCount; i++) {
      const [x, y] = positions[i + 1];
      const mesh = this.segmentMeshes[i];
      // Segments taper and darken toward the tail
      const along = bodyCount > 1 ? i / (bodyCount - 1) : 1;
      const size = 1 - 0.25 * along;
      mesh.scale.setScalar(size);
      mesh.position.copy(toWorld(x, y, 20 * size));
      mesh.material.color.copy(body).lerp(tail, along);
      mesh.material.opacity = opacity;
    }
  }

  updateItems(game, time) {
    const food = game ? game.food : null;
    this.apple.visible = Boolean(food);
    if (food) {
      this.apple.position.copy(toWorld(food[0], food[1], 18 + Math.sin(time * 3) * 3));
      this.apple.rotation.y = time * 0.8;
    }

    const powerUp = game ? game.powerUp : null;
    this.powerUpHolder.visible = Boolean(powerUp);
    this.powerUpRing.visible = Boolean(powerUp);
    if (powerUp) {
      this.powerUpRing.position.copy(toWorld(powerUp.position[0], powerUp.position[1], 0.6));
      this.powerUpRing.material.color.set(POWER_UP_GLOW[powerUp.type]);
      this.powerUpRing.material.opacity = 0.55 + 0.35 * Math.sin(time * 4);
      this.powerUpRing.scale.setScalar(1 + 0.08 * Math.sin(time * 4));
      for (const [type, model] of Object.entries(this.powerUpModels)) {
        model.visible = type === powerUp.type;
      }
      const [x, y] = powerUp.position;
      this.powerUpHolder.position.copy(toWorld(x, y, 26 + Math.sin(time * 2.5) * 4));
      this.powerUpHolder.rotation.y = time * 2;
      const glow = 0.5 + 0.5 * Math.sin(time * 4);
      this.powerUpLight.color.set(POWER_UP_GLOW[powerUp.type]);
      this.powerUpLight.intensity = 2000 + glow * 4000;
    }

    const bombs = game ? game.bombs : [];
    this.ensureMeshes(this.bombMeshes, bombs.length, () => {
      const bomb = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.SphereGeometry(14, 24, 16), standardMaterial(0x23252b, { roughness: 0.3, metalness: 0.6 }));
      shell.castShadow = true;
      const fuse = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 8, 6), standardMaterial(0x8a6a3a));
      fuse.position.y = 16;
      const spark = new THREE.Mesh(new THREE.SphereGeometry(4.5, 10, 8), standardMaterial(0xff7a1a, { emissive: 0xff5a00, emissiveIntensity: 1.5 }));
      spark.position.y = 21;
      spark.name = "spark";
      bomb.add(shell, fuse, spark);
      return bomb;
    });
    bombs.forEach(([x, y], i) => {
      const bomb = this.bombMeshes[i];
      bomb.position.copy(toWorld(x, y, 14));
      bomb.getObjectByName("spark").scale.setScalar(0.7 + 0.5 * Math.abs(Math.sin(time * 12 + i)));
    });

    const obstacles = game ? game.obstacles : [];
    this.ensureMeshes(this.obstacleMeshes, obstacles.length, () => {
      const block = new THREE.Mesh(this.obstacleGeometry, this.obstacleMaterial);
      block.castShadow = true;
      block.receiveShadow = true;
      return block;
    });
    obstacles.forEach(([x, y], i) => this.obstacleMeshes[i].position.copy(toWorld(x, y, 17)));

    // New obstacles rise out of the board with hazard stripes until they turn solid
    const pending = game ? game.pendingObstacles : [];
    this.ensureMeshes(this.pendingMeshes, pending.length, () => {
      const group = new THREE.Group();
      const box = new THREE.Mesh(this.obstacleGeometry, standardMaterial(0xffffff, { map: this.hazardTexture, transparent: true, opacity: 0.6, depthWrite: false }));
      box.name = "box";
      const outline = new THREE.LineSegments(this.obstacleEdges, new THREE.LineBasicMaterial({ color: 0xffffff }));
      group.add(box, outline);
      return group;
    });
    const growth = game ? Math.max(0.08, Math.min(1, game.pendingElapsed / OBSTACLE_FADE_IN)) : 1;
    pending.forEach(([x, y], i) => {
      const group = this.pendingMeshes[i];
      group.scale.set(1, growth, 1);
      group.position.copy(toWorld(x, y, 17 * growth));
      group.getObjectByName("box").material.opacity = 0.45 + 0.2 * Math.sin(time * 8);
    });
  }

  updateParticles(deltaTime) {
    for (const particle of this.particles) {
      if (particle.life <= 0) {
        continue;
      }
      particle.life -= deltaTime;
      particle.velocity.y -= 600 * deltaTime;
      particle.mesh.position.addScaledVector(particle.velocity, deltaTime);
      particle.mesh.rotation.x += deltaTime * 8;
      particle.mesh.scale.setScalar(Math.max(0.01, particle.life / 0.7));
      if (particle.life <= 0) {
        particle.mesh.visible = false;
      }
    }
  }

  render(game, deltaTime, time) {
    this.updateTheme(deltaTime);
    this.updateCamera(game, deltaTime);
    this.updateSnake(game, time);
    this.updateItems(game, time);
    this.updateParticles(deltaTime);
    this.renderer.render(this.scene, this.camera);
  }
}
