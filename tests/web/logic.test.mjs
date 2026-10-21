import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  Game, GRID_SIZE, DIFFICULTIES, COUNTDOWN_DURATION, OBSTACLE_FADE_IN, EFFECT_DURATIONS, POWER_UPS,
  getArrowDirections, freeCellsConnected, keyOf, seededRandom as dailyRandom, dailySeed,
} from "../../web/js/logic.js";

const RIGHT = [1, 0], LEFT = [-1, 0], UP = [0, 1], DOWN = [0, -1];

// Small seeded random so obstacle layouts are reproducible
function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

let game;

function setSnake(positions, direction) {
  game.snake = positions.map((position) => [...position]);
  game.previousSnake = game.snake.map((position) => [...position]);
  game.direction = direction;
  game.directionQueue = [];
}

beforeEach(() => {
  game = new Game("HARD", seededRandom(1));
  game.obstacles = [];
  game.pendingObstacles = [];
  game.bombs = [];
  game.food = null;
  game.powerUp = null;
  game.countdown = 0;
});

test("fast turns cannot reverse into the body", () => {
  setSnake([[5, 5], [4, 5], [3, 5]], RIGHT);
  game.queueDirection(UP);
  game.queueDirection(LEFT);
  game.move();
  game.move();
  assert.equal(game.state, "PLAYING");
  assert.deepEqual(game.snake[0], [4, 6]);
});

test("a direct reverse is ignored", () => {
  setSnake([[5, 5], [4, 5]], RIGHT);
  assert.equal(game.queueDirection(LEFT), false);
  game.move();
  assert.deepEqual(game.snake[0], [6, 5]);
});

test("first-person turns are relative to the heading", () => {
  setSnake([[5, 5]], RIGHT);
  game.turn("left");
  assert.deepEqual(game.directionQueue, [UP]);
  game.turn("left");
  assert.deepEqual(game.directionQueue, [UP, LEFT]);
});

test("moving into the tail's cell is allowed", () => {
  setSnake([[5, 5], [5, 6], [4, 6], [4, 5]], LEFT);
  game.move();
  assert.equal(game.state, "PLAYING");
});

test("moving into the tail while growing is fatal", () => {
  setSnake([[5, 5], [5, 6], [4, 6], [4, 5]], LEFT);
  game.powerUp = { type: "star", position: [4, 5] };
  game.move();
  assert.equal(game.state, "GAME_OVER");
  assert.equal(game.endCause, "self");
});

test("the snake does not grow without food", () => {
  setSnake([[5, 5], [4, 5]], RIGHT);
  game.move();
  assert.equal(game.snake.length, 2);
});

test("the snake wraps around the board edge", () => {
  setSnake([[GRID_SIZE - 1, 3]], RIGHT);
  game.move();
  assert.deepEqual(game.snake[0], [0, 3]);
});

test("eating food scores and grows", () => {
  setSnake([[5, 5]], RIGHT);
  game.food = [6, 5];
  game.move();
  assert.equal(game.score, 1);
  assert.equal(game.snake.length, 2);
  assert.ok(game.takeEvents().some((event) => event.type === "eat"));
});

test("power-ups never spawn on the food", () => {
  game.food = [2, 2];
  for (let i = 0; i < 200; i++) {
    game.generatePowerUp();
    assert.notDeepEqual(game.powerUp.position, game.food);
  }
});

test("obstacles respect the safe zone and never wall off the board", () => {
  for (let i = 0; i < 30; i++) {
    setSnake([[GRID_SIZE - 1, 3]], RIGHT);
    game.bombs = [[0, 0]];
    const safeZone = game.safeZone();
    game.generateObstacles(false);
    const keys = game.obstacles.map(keyOf);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.every((key) => !safeZone.has(key)));
    assert.ok(!keys.includes(keyOf([0, 0])));
    assert.ok(safeZone.has(keyOf([0, 3])), "safe zone wraps across the edge");
    assert.ok(freeCellsConnected(new Set(keys)));
  }
});

test("a new game starts with a long clear lane ahead", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const freshGame = new Game("HARD", seededRandom(seed));
    const [headX, headY] = freshGame.snake[0];
    for (let i = 1; i <= 7; i++) {
      const cell = [(headX + i) % GRID_SIZE, headY];
      assert.ok(!freshGame.obstacles.some(([x, y]) => x === cell[0] && y === cell[1]));
    }
  }
});

test("new obstacles are harmless until they turn solid", () => {
  setSnake([[5, 5]], RIGHT);
  game.generateObstacles();
  assert.equal(game.obstacles.length, 0);
  assert.ok(game.pendingObstacles.length > 0);
  game.updatePendingObstacles(OBSTACLE_FADE_IN + 0.1);
  assert.ok(game.obstacles.length > 0);
});

test("a fading obstacle waits while the snake is on it", () => {
  setSnake([[5, 5], [4, 5]], RIGHT);
  game.pendingObstacles = [[4, 5]];
  game.updatePendingObstacles(OBSTACLE_FADE_IN + 0.1);
  assert.deepEqual(game.pendingObstacles, [[4, 5]]);
});

test("bombs avoid the safe zone", () => {
  for (let i = 0; i < 30; i++) {
    setSnake([[5, 5]], RIGHT);
    game.generateBombs();
    const safeZone = game.safeZone();
    assert.ok(game.bombs.every((bomb) => !safeZone.has(keyOf(bomb))));
  }
});

test("filling the board wins", () => {
  const row = Array.from({ length: GRID_SIZE }, (_, x) => [x, 0]);
  game.obstacles = [];
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 1; y < GRID_SIZE; y++) {
      game.obstacles.push([x, y]);
    }
  }
  setSnake(row.slice(0, -1).reverse(), RIGHT);
  game.food = row[row.length - 1];
  game.move();
  assert.equal(game.state, "WON");
});

test("double points cannot skip the obstacle threshold", () => {
  let calls = 0;
  game.generateObstacles = () => { calls += 1; };
  setSnake([[5, 5]], RIGHT);
  game.score = 4;
  game.effects.doublePoints = 5;
  game.food = [6, 5];
  game.move();
  assert.equal(game.score, 6);
  assert.equal(calls, 1);
});

test("a second star restarts the timer without stacking speed", () => {
  setSnake([[5, 5]], RIGHT);
  game.effects.doublePoints = 3;
  game.updateSpeed();
  game.powerUp = { type: "star", position: [6, 5] };
  game.move();
  assert.equal(game.effects.doublePoints, EFFECT_DURATIONS.doublePoints);
  assert.ok(Math.abs(game.secondsPerCell - DIFFICULTIES.HARD.secondsPerCell * 0.8) < 1e-9);
});

test("the speed ramps up with each apple and stops at the floor", () => {
  setSnake([[5, 5]], RIGHT);
  const start = game.secondsPerCell;
  game.applesEaten = 3;
  game.updateSpeed();
  assert.ok(game.secondsPerCell < start);
  game.applesEaten = 500;
  game.updateSpeed();
  assert.equal(game.secondsPerCell, DIFFICULTIES.HARD.minSecondsPerCell);
});

test("slow motion slows the snake until it runs out", () => {
  setSnake([[5, 5]], RIGHT);
  const normal = game.secondsPerCell;
  game.powerUp = { type: "slow", position: [6, 5] };
  game.move();
  assert.ok(game.secondsPerCell > normal);
  game.updateEffects(EFFECT_DURATIONS.slow + 0.1);
  assert.ok(Math.abs(game.secondsPerCell - normal) < 1e-9);
});

test("shrink removes tail segments but keeps the head", () => {
  setSnake([[5, 5], [4, 5], [3, 5], [2, 5], [1, 5], [0, 5]], RIGHT);
  game.powerUp = { type: "shrink", position: [6, 5] };
  game.move();
  assert.equal(game.snake.length, 3);
  setSnake([[5, 5], [4, 5]], RIGHT);
  game.powerUp = { type: "shrink", position: [6, 5] };
  game.move();
  assert.deepEqual(game.snake, [[6, 5]]);
});

test("ghost smashes through one block, then is used up", () => {
  setSnake([[5, 5]], RIGHT);
  game.effects.ghost = EFFECT_DURATIONS.ghost;
  game.obstacles = [[6, 5], [7, 5]];
  game.move();
  assert.equal(game.state, "PLAYING");
  assert.deepEqual(game.obstacles, [[7, 5]]);
  game.move();
  assert.equal(game.state, "GAME_OVER");
});

test("every power-up type can appear", () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    seen.add(game.pickPowerUpType());
  }
  assert.deepEqual([...seen].sort(), [...POWER_UPS].sort());
});

test("reaching 10 points is a level up", () => {
  setSnake([[5, 5]], RIGHT);
  game.score = 9;
  game.food = [6, 5];
  game.move();
  assert.equal(game.level, 2);
  assert.ok(game.takeEvents().some((event) => event.type === "levelUp" && event.level === 2));
});

test("a daily challenge gives everyone the same board that day", () => {
  const layout = (date) => new Game("MEDIUM", dailyRandom(dailySeed(date)), "daily").obstacles.map(keyOf).join();
  assert.equal(layout("2026-10-21"), layout("2026-10-21"));
  assert.notEqual(layout("2026-10-21"), layout("2026-10-22"));
});

test("difficulty speeds step evenly", () => {
  const [easy, medium, hard] = ["EASY", "MEDIUM", "HARD"].map((level) => DIFFICULTIES[level].secondsPerCell);
  assert.ok(Math.abs((easy - medium) - (medium - hard)) < 1e-9);
});

test("the countdown holds the snake", () => {
  setSnake([[5, 5]], RIGHT);
  game.countdown = COUNTDOWN_DURATION;
  game.update(COUNTDOWN_DURATION - 0.01);
  game.update(0.005);
  assert.deepEqual(game.snake[0], [5, 5]);
});

test("steps keep a fixed rhythm at 60 frames per second", () => {
  setSnake([[1, 5]], RIGHT);
  const frames = Math.round((game.secondsPerCell * 10) / (1 / 60));
  for (let i = 0; i < frames; i++) {
    game.update(1 / 60);
  }
  assert.ok(game.snake[0][0] >= 1 + 9);
});

test("resuming starts a countdown", () => {
  game.togglePause();
  assert.equal(game.state, "PAUSED");
  game.togglePause();
  assert.equal(game.state, "PLAYING");
  assert.equal(game.countdown, COUNTDOWN_DURATION);
});

test("the snake glides between cells", () => {
  setSnake([[5, 5]], RIGHT);
  game.update(game.secondsPerCell);
  game.update(game.secondsPerCell / 2);
  const [headX] = game.drawnSnake()[0];
  assert.ok(Math.abs(headX - 5.5) < 0.05);
});

test("arrow keys follow the nearest camera angle", () => {
  assert.deepEqual(getArrowDirections(89), getArrowDirections(90));
  assert.deepEqual(getArrowDirections(359), getArrowDirections(0));
  assert.deepEqual(getArrowDirections(0).up, DOWN);
  assert.deepEqual(getArrowDirections(0).right, LEFT);
  assert.deepEqual(getArrowDirections(180).up, UP);
  assert.deepEqual(getArrowDirections(180).right, RIGHT);
});

test("blocks, items and bombs never share a cell during play", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const fuzzGame = new Game(["EASY", "MEDIUM", "HARD"][seed % 3], seededRandom(seed));
    fuzzGame.countdown = 0;
    const steer = seededRandom(seed * 7 + 1);
    for (let frame = 0; frame < 3000 && fuzzGame.state === "PLAYING"; frame++) {
      if (steer() < 0.08) {
        fuzzGame.turn(steer() < 0.5 ? "left" : "right");
      }
      fuzzGame.update(1 / 30);
      const blocks = new Set([...fuzzGame.obstacles, ...fuzzGame.pendingObstacles].map(keyOf));
      assert.equal(blocks.size, fuzzGame.obstacles.length + fuzzGame.pendingObstacles.length, "blocks overlap");
      const items = [fuzzGame.food, fuzzGame.powerUp && fuzzGame.powerUp.position, ...fuzzGame.bombs].filter(Boolean);
      for (const item of items) {
        assert.ok(!blocks.has(keyOf(item)), `item on a block (seed ${seed}, frame ${frame})`);
      }
      if (fuzzGame.food && fuzzGame.powerUp) {
        assert.notEqual(keyOf(fuzzGame.food), keyOf(fuzzGame.powerUp.position));
      }
    }
  }
});

test("danger ahead is reported", () => {
  setSnake([[5, 5]], RIGHT);
  game.obstacles = [[7, 5]];
  assert.equal(game.dangerAhead(), "obstacle");
});
