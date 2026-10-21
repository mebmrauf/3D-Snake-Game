// Connects the game rules, the 3D view, the menus and the controls.
import { Game, getArrowDirections, seededRandom, dailySeed, COUNTDOWN_DURATION } from "./logic.js";
import { Renderer, themeForLevel } from "./render.js";
import { Sound } from "./sound.js";
import { tr, setLanguage, getLanguage, toLocalDigits } from "./i18n.js";

const STORAGE_PREFIX = "snake3d.";
const SWIPE_DISTANCE = 28;
const DAILY_DIFFICULTY = "MEDIUM";
const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;
const canVibrate = isTouchDevice && typeof navigator.vibrate === "function";
const POWER_UP_COLORS = { star: 0x3d8bff, slow: 0x2ed3c6, shrink: 0xb05cff, ghost: 0xffffff };

const elements = Object.fromEntries([
  "scene", "hud", "hudView", "hudScore", "hudBest", "hudLevel", "hudDifficulty", "hudSpeed", "hudEffects",
  "languageButton", "soundButton", "viewButton", "pauseButton", "cameraButtons", "rotateLeft", "rotateRight",
  "danger", "toast", "countdown", "tutorial", "tutorialIcon", "tutorialText", "menu", "instructions",
  "startButton", "dailyButton", "dailyInfo", "vibrationButton", "gameOver", "gameOverMode", "gameOverTitle",
  "gameOverReason", "finalScore", "gameOverBest", "playAgainButton", "menuButton", "pause", "resumeButton",
  "resumeHint", "pauseMenuButton",
].map((id) => [id, document.getElementById(id)]));

// Browser storage can be unavailable (private mode, blocked site data), so every access is guarded
function load(key, fallback) {
  try {
    const value = localStorage.getItem(STORAGE_PREFIX + key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Scores and settings just won't be remembered
  }
}

// The player's local date, so the daily challenge changes at their midnight
function todayText() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

let renderer;
try {
  renderer = new Renderer(elements.scene);
} catch (error) {
  // No WebGL (very old browser, or graphics turned off): explain instead of a blank page
  document.getElementById("loadingText").textContent =
    "Sorry, this browser can't show 3D graphics. Try an up-to-date Chrome, Safari, Firefox or Edge.\n" +
    "দুঃখিত, এই ব্রাউজারে ৩ডি গ্রাফিক্স চলে না। নতুন Chrome, Safari, Firefox বা Edge ব্যবহার করুন।";
  throw error;
}
const sound = new Sound();
let game = null;
let difficulty = load("difficulty", "MEDIUM");
let highScores = load("highScores", {});
let vibrationEnabled = load("vibration", true);
let tutorialStep = null;
let isNewHighScore = false;
let cameraTargetAngle = 180;
let lastFrameTime = performance.now();
let toastTimer = null;
let gameOverTimer = null;
let lastCountdownNumber = null;
let swipeStart = null;

setLanguage(load("language", "en"));
sound.muted = load("muted", false);

// Daily challenge scores are kept per day; classic scores per difficulty
function scoreKey(currentGame) {
  return currentGame.mode === "daily" ? `DAILY-${currentGame.date}` : currentGame.difficulty;
}

function vibrate(pattern) {
  if (canVibrate && vibrationEnabled) {
    navigator.vibrate(pattern);
  }
}

function setText(element, text) {
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

function themeName(level) {
  return tr(`theme_${themeForLevel(level).id}`);
}

function applyTexts() {
  document.documentElement.lang = getLanguage();
  for (const element of document.querySelectorAll("[data-i18n]")) {
    setText(element, tr(element.dataset.i18n));
  }
  const instructionKeys = isTouchDevice
    ? ["touchSteer", "touchCamera", "touchView", "ruleFood", "rulePowerUps", "ruleLevels", "ruleDanger"]
    : ["keyboardSteer", "keyboardPause", "keyboardView", "keyboardCamera", "keyboardExtras", "ruleFood", "rulePowerUps", "ruleLevels", "ruleDanger"];
  elements.instructions.replaceChildren(...instructionKeys.map((key) => {
    const item = document.createElement("li");
    item.textContent = tr(key);
    return item;
  }));
  for (const button of document.querySelectorAll(".difficulty")) {
    const level = button.dataset.difficulty;
    button.querySelector(".name").textContent = tr(`difficulty_${level}`);
    button.querySelector(".best").textContent = tr("best", { score: highScores[level] || 0 });
    button.classList.toggle("selected", level === difficulty);
    button.setAttribute("aria-pressed", String(level === difficulty));
  }
  setText(elements.dailyInfo, tr("dailyInfo", { score: highScores[`DAILY-${todayText()}`] || 0 }));
  elements.vibrationButton.classList.toggle("hidden", !canVibrate);
  setText(elements.vibrationButton, tr(vibrationEnabled ? "vibrationOn" : "vibrationOff"));
  setText(elements.languageButton, tr("languageButton"));
  elements.languageButton.setAttribute("aria-label", tr("languageLabel"));
  elements.soundButton.setAttribute("aria-label", tr("soundLabel"));
  elements.viewButton.setAttribute("aria-label", tr("viewLabel"));
  elements.pauseButton.setAttribute("aria-label", tr("pauseLabel"));
  elements.rotateLeft.setAttribute("aria-label", tr("rotateLeftLabel"));
  elements.rotateRight.setAttribute("aria-label", tr("rotateRightLabel"));
  elements.resumeHint.classList.toggle("hidden", isTouchDevice);
  setText(elements.soundButton, sound.muted ? "🔇" : "🔊");
  updateTutorial();
  if (game && game.isFinished()) {
    fillGameOverScreen();
  }
}

function toggleLanguage() {
  setLanguage(getLanguage() === "en" ? "bn" : "en");
  save("language", getLanguage());
  applyTexts();
}

function toggleSound() {
  sound.muted = !sound.muted;
  save("muted", sound.muted);
  applyTexts();
}

function toggleVibration() {
  vibrationEnabled = !vibrationEnabled;
  save("vibration", vibrationEnabled);
  vibrate(30);
  applyTexts();
}

function showToast(text) {
  setText(elements.toast, text);
  elements.toast.classList.remove("hidden");
  // Restart the entrance animation for back-to-back messages
  elements.toast.style.animation = "none";
  void elements.toast.offsetWidth;
  elements.toast.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.add("hidden"), 1800);
}

// The first game teaches steering, then eating; after that the hints never show again
function updateTutorial() {
  const visible = Boolean(tutorialStep) && game && game.state === "PLAYING";
  elements.tutorial.classList.toggle("hidden", !visible);
  if (!visible) {
    return;
  }
  if (tutorialStep === "steer") {
    setText(elements.tutorialIcon, isTouchDevice ? "👆" : "⌨️");
    elements.tutorialIcon.className = `tutorial-icon ${isTouchDevice ? "swipe" : "keys"}`;
    setText(elements.tutorialText, tr(isTouchDevice ? "tutorialSteerTouch" : "tutorialSteerKeys"));
  } else {
    setText(elements.tutorialIcon, "🐍");
    elements.tutorialIcon.className = "tutorial-icon";
    setText(elements.tutorialText, tr("tutorialEat"));
  }
}

function advanceTutorial(eventType) {
  if (tutorialStep === "steer" && eventType === "turn") {
    tutorialStep = "eat";
  } else if (tutorialStep === "eat" && eventType === "eat") {
    tutorialStep = null;
    save("tutorialDone", true);
  }
}

function selectDifficulty(level) {
  difficulty = level;
  save("difficulty", level);
  sound.play("click");
  applyTexts();
}

function setPlayingLayout(isPlaying) {
  document.body.classList.toggle("playing", isPlaying);
  for (const element of [elements.hud, elements.viewButton, elements.pauseButton, elements.cameraButtons]) {
    element.classList.toggle("hidden", !isPlaying);
  }
}

function startGame(mode = "classic") {
  sound.unlock();
  clearTimeout(gameOverTimer);
  if (mode === "daily") {
    const date = todayText();
    game = new Game(DAILY_DIFFICULTY, seededRandom(dailySeed(date)), "daily");
    game.date = date;
  } else {
    game = new Game(difficulty);
  }
  isNewHighScore = false;
  lastCountdownNumber = null;
  tutorialStep = load("tutorialDone", false) ? null : "steer";
  renderer.setLevel(1);
  // Settle the camera on the classic view behind the board
  cameraTargetAngle = Math.round((cameraTargetAngle - 180) / 360) * 360 + 180;
  elements.menu.classList.add("hidden");
  elements.gameOver.classList.add("hidden");
  elements.pause.classList.add("hidden");
  setPlayingLayout(true);
  sound.play("tick");
  updateTutorial();
}

function showMenu() {
  clearTimeout(gameOverTimer);
  game = null;
  renderer.firstPerson = false;
  renderer.setLevel(1);
  elements.gameOver.classList.add("hidden");
  elements.pause.classList.add("hidden");
  elements.menu.classList.remove("hidden");
  setPlayingLayout(false);
  applyTexts();
}

function togglePause() {
  if (!game || game.isFinished()) {
    return;
  }
  game.togglePause();
  elements.pause.classList.toggle("hidden", game.state !== "PAUSED");
  if (game.state === "PLAYING") {
    lastCountdownNumber = null;
  }
  updateTutorial();
}

function pauseGame() {
  if (game && game.state === "PLAYING") {
    togglePause();
  }
}

function toggleView() {
  if (!game || game.isFinished()) {
    return;
  }
  renderer.firstPerson = !renderer.firstPerson;
  sound.play("click");
}

function rotateCamera(degrees) {
  if (renderer.firstPerson) {
    return;
  }
  cameraTargetAngle += degrees;
}

// Screen directions ("up", "left", ...) become board directions based on the camera
function steer(screenDirection) {
  if (!game || game.state !== "PLAYING") {
    return;
  }
  if (renderer.firstPerson) {
    if (screenDirection === "left" || screenDirection === "right") {
      game.turn(screenDirection);
    }
    return;
  }
  game.queueDirection(getArrowDirections(cameraTargetAngle)[screenDirection]);
}

function fillGameOverScreen() {
  const isDaily = game.mode === "daily";
  setText(elements.gameOverMode, isDaily ? tr("dailyGameOver", { date: game.date }) : tr(`difficulty_${game.difficulty}`));
  setText(elements.gameOverTitle, tr(game.state === "WON" ? "youWin" : "gameOver"));
  setText(elements.gameOverReason, game.state === "WON" ? tr("winReason") : tr(`cause_${game.endCause}`));
  setText(elements.finalScore, tr("finalScore", { score: game.score }));
  setText(elements.gameOverBest, isNewHighScore ? tr("newHighScore") : tr("highScore", { score: highScores[scoreKey(game)] || 0 }));
}

function finishGame(won) {
  const key = scoreKey(game);
  if (game.score > (highScores[key] || 0)) {
    highScores = { ...highScores, [key]: game.score };
    save("highScores", highScores);
    isNewHighScore = true;
  }
  renderer.firstPerson = false;
  setPlayingLayout(false);
  elements.danger.classList.add("hidden");
  elements.countdown.classList.add("hidden");
  elements.tutorial.classList.add("hidden");
  // A short beat so the crash or win can be seen before the menu covers it
  gameOverTimer = setTimeout(() => {
    fillGameOverScreen();
    elements.gameOver.classList.remove("hidden");
    elements.playAgainButton.focus({ preventScroll: true });
  }, won ? 600 : 900);
}

function handleGameEvents() {
  for (const event of game.takeEvents()) {
    advanceTutorial(event.type);
    switch (event.type) {
      case "eat":
        renderer.burst(event.position, 0xff4b3e);
        sound.play("eat");
        vibrate(15);
        break;
      case "powerUp":
        renderer.burst(event.position, POWER_UP_COLORS[event.powerUp], 26);
        sound.play(event.powerUp);
        showToast(tr(`toast_${event.powerUp}`));
        vibrate([20, 40, 20]);
        break;
      case "shrink":
        for (const position of event.positions) {
          renderer.burst(position, POWER_UP_COLORS.shrink, 8);
        }
        break;
      case "ghostSave":
        renderer.burst(event.position, 0x9a9a9a, 24);
        renderer.shake(8);
        sound.play("ghostSave");
        showToast(tr("toastGhostSave"));
        vibrate(60);
        break;
      case "obstacles":
        sound.play("obstacles");
        showToast(tr("toastObstacles"));
        break;
      case "bombs":
        sound.play("bombs");
        showToast(tr("toastBombs"));
        break;
      case "levelUp":
        renderer.setLevel(event.level);
        sound.play("levelUp");
        showToast(tr("toastLevel", { level: event.level, theme: themeName(event.level) }));
        vibrate([30, 50, 30, 50, 60]);
        break;
      case "tick":
        sound.play("tick");
        break;
      case "go":
        sound.play("go");
        break;
      case "gameOver":
        renderer.shake(18);
        if (event.position) {
          renderer.burst(event.position, 0x555555, 24);
        }
        sound.play("gameOver");
        vibrate(250);
        finishGame(false);
        break;
      case "win":
        sound.play("win");
        vibrate([50, 50, 50, 50, 200]);
        finishGame(true);
        break;
    }
  }
  updateTutorial();
}

function updateHud() {
  if (!game || game.isFinished()) {
    return;
  }
  setText(elements.hudView, tr(renderer.firstPerson ? "firstPersonView" : "thirdPersonView"));
  setText(elements.hudScore, tr("score", { score: game.score }));
  setText(elements.hudBest, tr("highScore", { score: highScores[scoreKey(game)] || 0 }));
  setText(elements.hudLevel, tr("level", { level: game.level, theme: themeName(game.level) }));
  setText(elements.hudDifficulty, game.mode === "daily" ? tr("dailyMode") : tr("difficulty", { level: tr(`difficulty_${game.difficulty}`) }));
  setText(elements.hudSpeed, tr("speed", { speed: (1 / game.secondsPerCell).toFixed(1) }));
  const effectLines = Object.entries(game.effects)
    .filter(([, seconds]) => seconds > 0)
    .map(([name, seconds]) => tr(`effect_${name}`, { seconds: seconds.toFixed(1) }));
  if (elements.hudEffects.childElementCount !== effectLines.length) {
    elements.hudEffects.replaceChildren(...effectLines.map(() => document.createElement("div")));
  }
  effectLines.forEach((line, i) => setText(elements.hudEffects.children[i], line));
  setText(elements.pauseButton, game.state === "PAUSED" ? "▶" : "⏸");
  elements.cameraButtons.classList.toggle("hidden", renderer.firstPerson);

  const countingDown = game.state === "PLAYING" && game.countdown > 0;
  elements.countdown.classList.toggle("hidden", !countingDown);
  if (countingDown) {
    const number = Math.ceil(game.countdown / (COUNTDOWN_DURATION / 3));
    if (number !== lastCountdownNumber) {
      lastCountdownNumber = number;
      setText(elements.countdown, toLocalDigits(number));
      elements.countdown.classList.remove("pop");
      void elements.countdown.offsetWidth;
      elements.countdown.classList.add("pop");
    }
  }

  const danger = renderer.firstPerson && game.state === "PLAYING" && !countingDown ? game.dangerAhead() : null;
  elements.danger.classList.toggle("hidden", !danger);
  if (danger) {
    setText(elements.danger, tr({ obstacle: "dangerObstacle", bomb: "dangerBomb", body: "dangerBody" }[danger]));
  }
}

function frame(now) {
  const deltaTime = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;
  if (game) {
    game.update(deltaTime);
    handleGameEvents();
  } else {
    // The menu shows the empty board slowly turning
    cameraTargetAngle += deltaTime * 8;
  }
  // The camera eases toward its target angle, so 90° turns are smooth
  renderer.cameraAngle += (cameraTargetAngle - renderer.cameraAngle) * Math.min(1, deltaTime * 10);
  updateHud();
  renderer.render(game, deltaTime, now / 1000);
  requestAnimationFrame(frame);
}

// Keyboard
const arrowKeys = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
window.addEventListener("keydown", (event) => {
  sound.unlock();
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (arrowKeys[key]) {
    event.preventDefault();
    steer(arrowKeys[key]);
    return;
  }
  if (event.target instanceof HTMLButtonElement && (key === "Enter" || key === " ")) {
    // Let focused buttons handle their own activation
    return;
  }
  switch (key) {
    case "p":
    case " ":
      event.preventDefault();
      togglePause();
      break;
    case "Escape":
      pauseGame();
      break;
    case "r":
      if (game) {
        startGame(game.mode);
      }
      break;
    case "Enter":
      if (!game) {
        startGame();
      }
      break;
    case "v":
      toggleView();
      break;
    case "a":
      rotateCamera(2);
      break;
    case "d":
      rotateCamera(-2);
      break;
    case "w":
      renderer.cameraHeight = Math.min(800, renderer.cameraHeight + 20);
      break;
    case "s":
      renderer.cameraHeight = Math.max(100, renderer.cameraHeight - 20);
      break;
    case "x":
      renderer.cameraDistance = Math.max(150, renderer.cameraDistance - 20);
      break;
    case "y":
      renderer.cameraDistance = Math.min(1000, renderer.cameraDistance + 20);
      break;
    case "l":
      toggleLanguage();
      break;
    case "m":
      toggleSound();
      break;
  }
});

// Swipes: each time the finger travels far enough it steers, so one long
// swipe that bends can make two turns without lifting the finger
elements.scene.addEventListener("pointerdown", (event) => {
  sound.unlock();
  swipeStart = { x: event.clientX, y: event.clientY };
  elements.scene.setPointerCapture(event.pointerId);
});
elements.scene.addEventListener("pointermove", (event) => {
  if (!swipeStart) {
    return;
  }
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_DISTANCE) {
    return;
  }
  if (Math.abs(dx) > Math.abs(dy)) {
    steer(dx > 0 ? "right" : "left");
  } else {
    steer(dy > 0 ? "down" : "up");
  }
  swipeStart = { x: event.clientX, y: event.clientY };
});
for (const type of ["pointerup", "pointercancel"]) {
  elements.scene.addEventListener(type, () => { swipeStart = null; });
}

// Buttons
elements.startButton.addEventListener("click", () => startGame());
elements.dailyButton.addEventListener("click", () => startGame("daily"));
elements.playAgainButton.addEventListener("click", () => startGame(game ? game.mode : "classic"));
elements.menuButton.addEventListener("click", showMenu);
elements.pauseMenuButton.addEventListener("click", showMenu);
elements.resumeButton.addEventListener("click", togglePause);
elements.pauseButton.addEventListener("click", togglePause);
elements.viewButton.addEventListener("click", toggleView);
elements.languageButton.addEventListener("click", toggleLanguage);
elements.soundButton.addEventListener("click", () => { sound.unlock(); toggleSound(); });
elements.vibrationButton.addEventListener("click", toggleVibration);
elements.rotateLeft.addEventListener("click", () => rotateCamera(90));
elements.rotateRight.addEventListener("click", () => rotateCamera(-90));
for (const button of document.querySelectorAll(".difficulty")) {
  button.addEventListener("click", () => selectDifficulty(button.dataset.difficulty));
}

// Pause when the player switches tabs or apps, so they never come back to a crash
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseGame();
  }
});
window.addEventListener("blur", pauseGame);
// Follows the canvas's real size, which also catches phone rotation and browser bars appearing
new ResizeObserver(() => renderer.resize()).observe(elements.scene);

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {
    // Offline play just won't be available
  });
}

// Local development only: lets the browser console inspect and nudge the running game
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  window.snakeDebug = { get game() { return game; }, renderer };
}

renderer.resize();
applyTexts();
document.body.classList.remove("loading");
requestAnimationFrame(frame);
