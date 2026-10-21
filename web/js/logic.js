// Game rules for 3D Snake. No rendering or browser code lives here, so the rules
// can be tested on their own (see tests/web/logic.test.mjs) and the leaderboard
// server can replay a game to check its score (see api/score.js).
//
// The game advances in fixed 1/60 s steps ("ticks") and keeps every timer as a whole
// number of ticks, so the same seed and the same recorded inputs always produce
// exactly the same game, in any browser and on the server.

export const GRID_SIZE = 14;
export const TICKS_PER_SECOND = 60;
// Ticks per cell at the start, and the fastest the speed ramp goes
export const DIFFICULTIES = {
  EASY: { ticksPerCell: 18, minTicksPerCell: 12, obstacleGroups: 3, maxBombs: 1 },
  MEDIUM: { ticksPerCell: 14, minTicksPerCell: 9, obstacleGroups: 5, maxBombs: 2 },
  HARD: { ticksPerCell: 10, minTicksPerCell: 7, obstacleGroups: 8, maxBombs: 3 },
};
export const DAILY_DIFFICULTY = "MEDIUM";
export const COUNTDOWN_STEP_TICKS = 42;
export const COUNTDOWN_TICKS = COUNTDOWN_STEP_TICKS * 3;
export const OBSTACLE_FADE_TICKS = 90;
export const POINTS_PER_LEVEL = 10;
export const POWER_UPS = ["star", "slow", "shrink", "ghost"];
// Ticks each timed power-up lasts
export const EFFECT_TICKS = { doublePoints: 600, slow: 480, ghost: 900 };
// Longest game the leaderboard server will replay (two hours of play)
export const MAX_GAME_TICKS = 2 * 60 * 60 * TICKS_PER_SECOND;

const TICK_SECONDS = 1 / TICKS_PER_SECOND;
const MAX_STEPS_PER_UPDATE = 6;
const APPLES_PER_SPEED_STEP = 3;
const POWER_UP_WEIGHTS = { star: 3, slow: 2, shrink: 2, ghost: 2 };
const APPLES_PER_POWER_UP = 5;
const SHRINK_SEGMENTS = 3;
const BLOCKS_PER_GROUP = 5;
const OBSTACLE_ATTEMPTS = 50;
const MIN_SAFE_CELLS_AHEAD = 3;
const SAFE_TICKS_AHEAD = 48;
const MAX_QUEUED_TURNS = 2;
const BOMB_SPAWN_TICKS = 600;
const BOMB_LIFETIME_TICKS = 300;
const DANGER_DISTANCE = 3;
// The opening layout keeps a longer clear lane so a new player isn't instantly boxed in
const START_RUNWAY = 7;
const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export const keyOf = ([x, y]) => y * GRID_SIZE + x;
const positionOf = (key) => [key % GRID_SIZE, Math.floor(key / GRID_SIZE)];
const samePosition = (a, b) => Boolean(a && b) && a[0] === b[0] && a[1] === b[1];
const wrap = (x, y) => [((x % GRID_SIZE) + GRID_SIZE) % GRID_SIZE, ((y % GRID_SIZE) + GRID_SIZE) % GRID_SIZE];
const keysOf = (...lists) => new Set(lists.flat().map(keyOf));
const isUnitStep = ([dx, dy]) => Number.isInteger(dx) && Number.isInteger(dy) && Math.abs(dx) + Math.abs(dy) === 1;

function allCells() {
  const cells = [];
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 0; y < GRID_SIZE; y++) {
      cells.push([x, y]);
    }
  }
  return cells;
}

// Repeatable random numbers (mulberry32), so a seed always gives the same game
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function dailySeed(dateText) {
  let hash = 2166136261;
  for (const character of `snake3d-${dateText}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
}

// Arrow keys and swipes follow the board direction closest to where the camera looks
export function getArrowDirections(cameraAngleDegrees) {
  const snapped = (Math.round(cameraAngleDegrees / 90) * 90 * Math.PI) / 180;
  const upX = -Math.round(Math.sin(snapped)) || 0;
  const upY = -Math.round(Math.cos(snapped)) || 0;
  return {
    up: [upX, upY],
    down: [-upX || 0, -upY || 0],
    left: [-upY || 0, upX],
    right: [upY, -upX || 0],
  };
}

export function freeCellsConnected(blockedKeys) {
  const freeKeys = allCells().map(keyOf).filter((key) => !blockedKeys.has(key));
  if (freeKeys.length === 0) {
    return true;
  }
  const visited = new Set([freeKeys[0]]);
  const stack = [freeKeys[0]];
  while (stack.length) {
    const [x, y] = positionOf(stack.pop());
    for (const [dx, dy] of NEIGHBORS) {
      const neighborKey = keyOf(wrap(x + dx, y + dy));
      if (!blockedKeys.has(neighborKey) && !visited.has(neighborKey)) {
        visited.add(neighborKey);
        stack.push(neighborKey);
      }
    }
  }
  return visited.size === freeKeys.length;
}

export class Game {
  constructor(difficulty, random = Math.random, mode = "classic") {
    this.difficulty = difficulty;
    this.settings = DIFFICULTIES[difficulty];
    this.random = random;
    this.mode = mode;
    this.reset();
  }

  reset() {
    const center = Math.floor(GRID_SIZE / 2);
    this.snake = [[center, center]];
    this.previousSnake = [[center, center]];
    this.direction = [1, 0];
    this.previousDirection = [1, 0];
    this.directionQueue = [];
    this.applesEaten = 0;
    // Ticks left on each timed power-up; 0 means off
    this.effects = { doublePoints: 0, slow: 0, ghost: 0 };
    this.ticksPerCell = this.settings.ticksPerCell;
    this.food = null;
    this.powerUp = null;
    this.foodCount = 0;
    this.bombs = [];
    this.bombTicks = 0;
    this.obstacles = [];
    this.pendingObstacles = [];
    this.pendingTicks = 0;
    this.score = 0;
    // Ticks run so far (only while playing), and ticks since the snake last moved
    this.tick = 0;
    this.moveTimer = 0;
    // Real time not yet turned into ticks; only used to draw smooth movement
    this.accumulator = 0;
    this.state = "PLAYING";
    this.countdown = COUNTDOWN_TICKS;
    this.endCause = null;
    this.events = [];
    // Every input that changed the game, as [tick, dx, dy]; [tick, 0, 0] is a resume
    this.inputs = [];
    this.generateObstacles(false);
    this.generateFood();
  }

  get doublePoints() {
    return this.effects.doublePoints > 0;
  }

  get level() {
    return 1 + Math.floor(this.score / POINTS_PER_LEVEL);
  }

  get secondsPerCell() {
    return this.ticksPerCell / TICKS_PER_SECOND;
  }

  choose(list) {
    return list[Math.floor(this.random() * list.length)];
  }

  emit(type, details = {}) {
    this.events.push({ type, ...details });
  }

  takeEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  // The speed ramps up one step every few apples, down to a floor per difficulty;
  // the star speeds it up further and slow motion slows it down
  updateSpeed() {
    let ticks = Math.max(this.settings.minTicksPerCell, this.settings.ticksPerCell - Math.floor(this.applesEaten / APPLES_PER_SPEED_STEP));
    if (this.effects.doublePoints > 0) {
      ticks = Math.round((ticks * 4) / 5);
    }
    if (this.effects.slow > 0) {
      ticks = Math.round((ticks * 3) / 2);
    }
    this.ticksPerCell = Math.max(3, ticks);
  }

  safeCellsAhead() {
    // Faster snakes get a longer clear runway so there is always time to react
    return Math.max(MIN_SAFE_CELLS_AHEAD, Math.ceil(SAFE_TICKS_AHEAD / this.ticksPerCell));
  }

  safeZone(cellsAhead = this.safeCellsAhead()) {
    const [headX, headY] = this.snake[0];
    const zone = new Set();
    for (const [dx, dy] of NEIGHBORS) {
      zone.add(keyOf(wrap(headX + dx, headY + dy)));
    }
    for (const [dx, dy] of [this.direction, ...this.directionQueue]) {
      for (let i = 1; i <= cellsAhead; i++) {
        zone.add(keyOf(wrap(headX + dx * i, headY + dy * i)));
      }
    }
    return zone;
  }

  itemKeys() {
    return [this.food, this.powerUp && this.powerUp.position].filter(Boolean).map(keyOf);
  }

  lastQueuedDirection() {
    return this.directionQueue.length ? this.directionQueue[this.directionQueue.length - 1] : this.direction;
  }

  // Turns are buffered and checked against the previous turn, so fast inputs
  // can never reverse the snake into its own body
  queueDirection(newDirection) {
    if (this.state !== "PLAYING" || this.directionQueue.length >= MAX_QUEUED_TURNS || !isUnitStep(newDirection)) {
      return false;
    }
    const [lastX, lastY] = this.lastQueuedDirection();
    if ((newDirection[0] === lastX && newDirection[1] === lastY) || (newDirection[0] === -lastX && newDirection[1] === -lastY)) {
      return false;
    }
    this.directionQueue.push(newDirection);
    this.inputs.push([this.tick, newDirection[0], newDirection[1]]);
    this.emit("turn");
    return true;
  }

  // First-person steering: turn relative to the current heading
  turn(side) {
    const [dx, dy] = this.lastQueuedDirection();
    return this.queueDirection(side === "left" ? [-dy || 0, dx] : [dy, -dx || 0]);
  }

  availablePositions(otherItem, minDistanceFromObstacles) {
    const blocked = keysOf(this.snake, this.obstacles, this.pendingObstacles, this.bombs);
    if (otherItem) {
      blocked.add(keyOf(otherItem));
    }
    return allCells().filter((cell) => !blocked.has(keyOf(cell)) &&
      this.obstacles.every(([ox, oy]) => Math.abs(cell[0] - ox) + Math.abs(cell[1] - oy) >= minDistanceFromObstacles));
  }

  pickItemPosition(otherItem, minDistanceFromObstacles) {
    let positions = this.availablePositions(otherItem, minDistanceFromObstacles);
    if (!positions.length) {
      // Crowded board: allow cells next to obstacles rather than spawning nothing
      positions = this.availablePositions(otherItem, 0);
    }
    return positions.length ? this.choose(positions) : null;
  }

  generateFood() {
    this.food = this.pickItemPosition(this.powerUp && this.powerUp.position, 2);
  }

  pickPowerUpType() {
    const total = POWER_UPS.reduce((sum, type) => sum + POWER_UP_WEIGHTS[type], 0);
    let roll = this.random() * total;
    for (const type of POWER_UPS) {
      roll -= POWER_UP_WEIGHTS[type];
      if (roll < 0) {
        return type;
      }
    }
    return POWER_UPS[0];
  }

  generatePowerUp(type = this.pickPowerUpType()) {
    const position = this.pickItemPosition(this.food, 4);
    this.powerUp = position ? { type, position } : null;
  }

  countFreeCells() {
    return GRID_SIZE * GRID_SIZE - keysOf(this.snake, this.obstacles).size;
  }

  buildObstacleGroups(blockedKeys) {
    const available = new Set(allCells().map(keyOf).filter((key) => !blockedKeys.has(key)));
    const layout = [];
    for (let group = 0; group < this.settings.obstacleGroups && available.size; group++) {
      const first = this.choose([...available].sort((a, b) => a - b));
      available.delete(first);
      const blocks = [first];
      for (let block = 1; block < BLOCKS_PER_GROUP; block++) {
        const [lastX, lastY] = positionOf(blocks[blocks.length - 1]);
        const neighbors = NEIGHBORS
          .map(([dx, dy]) => [lastX + dx, lastY + dy])
          .filter(([x, y]) => x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE && available.has(keyOf([x, y])))
          .map(keyOf);
        if (!neighbors.length) {
          break;
        }
        const next = this.choose(neighbors);
        blocks.push(next);
        available.delete(next);
      }
      layout.push(...blocks);
    }
    return layout;
  }

  generateObstacles(fadeIn = true) {
    const blocked = keysOf(this.snake, this.bombs);
    const cellsAhead = fadeIn ? this.safeCellsAhead() : Math.max(this.safeCellsAhead(), START_RUNWAY);
    for (const key of [...this.safeZone(cellsAhead), ...this.itemKeys()]) {
      blocked.add(key);
    }
    let layout = [];
    for (let attempt = 0; attempt < OBSTACLE_ATTEMPTS; attempt++) {
      const candidate = this.buildObstacleGroups(blocked);
      // Reject layouts that wall off pockets where food or the snake could get trapped
      if (freeCellsConnected(new Set(candidate))) {
        layout = candidate;
        break;
      }
    }
    const positions = layout.map(positionOf);
    if (fadeIn) {
      // The old layout disappears and the new one fades in, harmless until solid
      this.obstacles = [];
      this.pendingObstacles = positions;
      this.pendingTicks = 0;
      this.emit("obstacles");
    } else {
      this.obstacles = positions;
      this.pendingObstacles = [];
    }
  }

  updatePendingObstacles() {
    if (!this.pendingObstacles.length) {
      return;
    }
    this.pendingTicks += 1;
    if (this.pendingTicks < OBSTACLE_FADE_TICKS) {
      return;
    }
    // Blocks the snake is on, or about to reach, wait until it has passed
    const blocked = keysOf(this.snake, this.bombs);
    for (const key of [...this.safeZone(), ...this.itemKeys()]) {
      blocked.add(key);
    }
    const stillPending = [];
    for (const position of this.pendingObstacles) {
      if (blocked.has(keyOf(position))) {
        stillPending.push(position);
      } else {
        this.obstacles.push(position);
      }
    }
    this.pendingObstacles = stillPending;
  }

  generateBombs() {
    const blocked = keysOf(this.snake, this.obstacles, this.pendingObstacles);
    for (const key of [...this.safeZone(), ...this.itemKeys()]) {
      blocked.add(key);
    }
    this.bombs = [];
    for (let i = 0; i < this.settings.maxBombs; i++) {
      const positions = allCells().filter((cell) => !blocked.has(keyOf(cell)));
      if (!positions.length) {
        break;
      }
      const bomb = this.choose(positions);
      this.bombs.push(bomb);
      blocked.add(keyOf(bomb));
    }
    if (this.bombs.length) {
      this.emit("bombs");
    }
  }

  updateBombs() {
    this.bombTicks += 1;
    if (this.bombTicks > BOMB_SPAWN_TICKS) {
      this.generateBombs();
      this.bombTicks = 0;
    }
    if (this.bombs.length && this.bombTicks > BOMB_LIFETIME_TICKS) {
      this.bombs = [];
    }
  }

  updateEffects() {
    let speedChanged = false;
    for (const name of Object.keys(this.effects)) {
      if (this.effects[name] <= 0) {
        continue;
      }
      this.effects[name] -= 1;
      if (this.effects[name] === 0) {
        speedChanged = true;
        this.emit("effectEnd", { effect: name });
      }
    }
    if (speedChanged) {
      this.updateSpeed();
    }
  }

  // Turns real elapsed time into whole ticks; leftover time waits for the next frame
  update(deltaTime) {
    if (this.state !== "PLAYING") {
      this.accumulator = 0;
      return;
    }
    this.accumulator += deltaTime;
    let steps = 0;
    while (this.accumulator >= TICK_SECONDS && this.state === "PLAYING") {
      this.accumulator -= TICK_SECONDS;
      this.step();
      steps += 1;
      if (steps >= MAX_STEPS_PER_UPDATE) {
        // A long stall (tab in the background, slow device): drop the backlog
        this.accumulator = 0;
      }
    }
  }

  // One fixed 1/60 s step of the game
  step() {
    if (this.state !== "PLAYING") {
      return;
    }
    this.tick += 1;
    if (this.countdown > 0) {
      const before = Math.ceil(this.countdown / COUNTDOWN_STEP_TICKS);
      this.countdown -= 1;
      const after = Math.ceil(this.countdown / COUNTDOWN_STEP_TICKS);
      if (after !== before) {
        this.emit(after === 0 ? "go" : "tick");
      }
      return;
    }
    this.moveTimer += 1;
    if (this.moveTimer >= this.ticksPerCell) {
      this.moveTimer = 0;
      this.move();
      if (this.state !== "PLAYING") {
        return;
      }
      if (!this.food) {
        this.generateFood();
      }
    }
    this.updateBombs();
    this.updateEffects();
    this.updatePendingObstacles();
  }

  // Ghost lets the snake smash through one block or bomb
  useGhost(head) {
    if (this.effects.ghost <= 0) {
      return false;
    }
    this.effects.ghost = 0;
    this.obstacles = this.obstacles.filter((position) => !samePosition(position, head));
    this.bombs = this.bombs.filter((position) => !samePosition(position, head));
    this.emit("ghostSave", { position: head });
    return true;
  }

  applyPowerUp(type, head) {
    if (type === "star") {
      this.effects.doublePoints = EFFECT_TICKS.doublePoints;
    } else if (type === "slow") {
      this.effects.slow = EFFECT_TICKS.slow;
    } else if (type === "ghost") {
      this.effects.ghost = EFFECT_TICKS.ghost;
    } else if (type === "shrink") {
      const removed = this.snake.splice(Math.max(1, this.snake.length - SHRINK_SEGMENTS));
      this.emit("shrink", { positions: removed });
    }
    this.updateSpeed();
    this.emit("powerUp", { powerUp: type, position: head });
  }

  move() {
    if (this.state !== "PLAYING") {
      return;
    }
    this.previousSnake = this.snake.map((position) => [...position]);
    this.previousDirection = this.direction;
    if (this.directionQueue.length) {
      this.direction = this.directionQueue.shift();
    }
    const [headX, headY] = this.snake[0];
    const head = wrap(headX + this.direction[0], headY + this.direction[1]);
    const powerUp = this.powerUp && samePosition(head, this.powerUp.position) ? this.powerUp.type : null;
    const growing = samePosition(head, this.food) || (powerUp !== null && powerUp !== "shrink");
    // The tail moves out of the way this step unless the snake is growing
    const body = growing ? this.snake : this.snake.slice(0, -1);
    if (body.some((position) => samePosition(position, head))) {
      this.endGame(false, "self", head);
      return;
    }
    if (this.bombs.some((position) => samePosition(position, head)) && !this.useGhost(head)) {
      this.endGame(false, "bomb", head);
      return;
    }
    if (this.obstacles.some((position) => samePosition(position, head)) && !this.useGhost(head)) {
      this.endGame(false, "obstacle", head);
      return;
    }
    this.snake.unshift(head);
    if (samePosition(head, this.food)) {
      const previousScore = this.score;
      const previousLevel = this.level;
      this.score += this.doublePoints ? 2 : 1;
      this.applesEaten += 1;
      this.foodCount += 1;
      this.food = null;
      this.updateSpeed();
      this.generateFood();
      if (this.foodCount === APPLES_PER_POWER_UP) {
        this.generatePowerUp();
        this.foodCount = 0;
      }
      this.emit("eat", { position: head });
      // Compare thresholds crossed, so double points can't jump over a multiple
      if (Math.floor(this.score / 5) > Math.floor(previousScore / 5)) {
        this.generateObstacles();
      }
      if (this.level > previousLevel) {
        this.emit("levelUp", { level: this.level });
      }
    } else if (powerUp) {
      this.powerUp = null;
      if (powerUp === "shrink") {
        this.snake.pop();
      }
      this.applyPowerUp(powerUp, head);
    } else {
      this.snake.pop();
    }
    if (this.countFreeCells() === 0) {
      this.endGame(true, null, head);
    }
  }

  endGame(won, cause, position) {
    this.state = won ? "WON" : "GAME_OVER";
    this.endCause = cause;
    this.previousSnake = this.snake.map((cell) => [...cell]);
    this.directionQueue = [];
    this.pendingObstacles = [];
    this.bombs = [];
    this.food = null;
    this.powerUp = null;
    this.effects = { doublePoints: 0, slow: 0, ghost: 0 };
    this.emit(won ? "win" : "gameOver", { position });
  }

  // Restarts the countdown; recorded, because the countdown is part of the game's timeline
  resume() {
    if (this.isFinished()) {
      return false;
    }
    this.state = "PLAYING";
    this.countdown = COUNTDOWN_TICKS;
    this.inputs.push([this.tick, 0, 0]);
    return true;
  }

  togglePause() {
    if (this.state === "PLAYING") {
      this.state = "PAUSED";
    } else if (this.state === "PAUSED") {
      this.resume();
    }
  }

  pause() {
    if (this.state === "PLAYING") {
      this.state = "PAUSED";
    }
  }

  isFinished() {
    return this.state === "GAME_OVER" || this.state === "WON";
  }

  // How far the snake has glided from its previous cells toward its current ones
  moveProgress() {
    return Math.max(0, Math.min(1, (this.moveTimer + this.accumulator / TICK_SECONDS) / this.ticksPerCell));
  }

  drawnSnake() {
    const progress = this.moveProgress();
    return this.snake.map(([x, y], i) => {
      const [previousX, previousY] = i < this.previousSnake.length ? this.previousSnake[i] : [x, y];
      let dx = x - previousX;
      let dy = y - previousY;
      // Wrapping across an edge: glide out past the edge instead of sweeping across the board
      if (Math.abs(dx) > 1) {
        dx = -Math.sign(dx);
      }
      if (Math.abs(dy) > 1) {
        dy = -Math.sign(dy);
      }
      return [previousX + dx * progress, previousY + dy * progress];
    });
  }

  // Heading in radians, turning smoothly from the previous direction to the current one
  headingAngle() {
    const previousAngle = Math.atan2(this.previousDirection[1], this.previousDirection[0]);
    const currentAngle = Math.atan2(this.direction[1], this.direction[0]);
    const change = ((currentAngle - previousAngle + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    return previousAngle + change * this.moveProgress();
  }

  dangerAhead() {
    const [headX, headY] = this.snake[0];
    const [dx, dy] = this.direction;
    for (let i = 1; i <= DANGER_DISTANCE; i++) {
      const cell = wrap(headX + dx * i, headY + dy * i);
      if (this.obstacles.some((position) => samePosition(position, cell))) {
        return "obstacle";
      }
      if (this.bombs.some((position) => samePosition(position, cell))) {
        return "bomb";
      }
      if (this.snake.some((position) => samePosition(position, cell))) {
        return "body";
      }
    }
    return null;
  }
}

// Re-plays a finished game from its seed and recorded inputs. The leaderboard server
// trusts only the score this computes, never a score sent by a player.
export function replayGame({ difficulty, mode, seed, inputs, finalTick }) {
  if (!DIFFICULTIES[difficulty] || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
      !Number.isInteger(finalTick) || finalTick < 1 || finalTick > MAX_GAME_TICKS || !Array.isArray(inputs)) {
    return { ok: false, reason: "invalid game" };
  }
  // Every input must be [tick, dx, dy] with whole numbers in range, in time order
  let lastTick = 0;
  for (const input of inputs) {
    if (!Array.isArray(input) || input.length !== 3 || !input.every(Number.isInteger) ||
        input[0] < lastTick || input[0] > finalTick || Math.abs(input[1]) > 1 || Math.abs(input[2]) > 1) {
      return { ok: false, reason: "invalid inputs" };
    }
    lastTick = input[0];
  }
  const game = new Game(difficulty, seededRandom(seed), mode);
  let index = 0;
  while (true) {
    while (index < inputs.length && inputs[index][0] === game.tick) {
      const [, dx, dy] = inputs[index];
      index += 1;
      const accepted = dx === 0 && dy === 0 ? game.resume() : game.queueDirection([dx, dy]);
      if (!accepted) {
        return { ok: false, reason: "input does not match the game" };
      }
    }
    if (game.isFinished() || game.tick >= finalTick) {
      break;
    }
    game.step();
    game.events.length = 0;
  }
  if (index !== inputs.length) {
    return { ok: false, reason: "inputs after the game ended" };
  }
  if (!game.isFinished() || game.tick !== finalTick) {
    return { ok: false, reason: "game did not end where claimed" };
  }
  return { ok: true, score: game.score, state: game.state, tick: game.tick, level: game.level, apples: game.applesEaten };
}
