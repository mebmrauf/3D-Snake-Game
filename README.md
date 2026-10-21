# 🐍 3D Snake Game

A modern take on the classic Snake game - reimagined in 3D using Python and OpenGL. This game includes immersive visuals, multiple camera modes (including first-person), dynamic difficulty settings, obstacles, bombs, and special effects, all packed into a single Python file.

---

## 🎯 Features

* **3D-style gameplay** using OpenGL (with lighting, shadows, and depth)
* **First-person and third-person camera views**
* **Difficulty selection**: Easy (3.3 cells/s), Medium (4.3 cells/s), Hard (6.3 cells/s)
* **Dynamic elements**: food, bombs, special power-ups, and obstacles
* **Polished UI**: menu panels with hover buttons, a HUD panel (score, high score, difficulty, speed), a pause screen, and a 3-2-1 countdown before play starts or resumes
* **Smooth movement**: the snake and first-person camera glide between cells
* **Visual effects**: glowing special food, rotating camera, grid coloring

---

## 🖥️ Technologies Used

* Python 3
* PyOpenGL
* GLUT (OpenGL Utility Toolkit)
* OpenGL Shading and Rendering

---

## 🌍 Play in the Browser (any device)

The `web/` folder is a browser version of the game built with [Three.js](https://threejs.org). It runs on phones, tablets and computers with no install, and has the same rules, Bangla support, and extras: swipe controls, sound effects, shadows and particles.

**Play online:** https://3d-snake-game-web.vercel.app/

* **Phones and tablets:** swipe to steer, tap ⟲ ⟳ to turn the camera and 👁 for first-person view.
* **Computers:** the same keys as the desktop version, plus `M` to mute.
* **Install it like an app:** open the link, then choose *Add to Home Screen* (iPhone: Share menu; Android: browser menu). It opens full-screen and also works offline.
* High scores, difficulty, language, sound and vibration settings are saved in the browser.

Extra features in the web version:

* **Power-ups** every 5th apple: ⭐ double points and speed, ⏳ slow motion, ✂️ shrink (lose 3 tail segments), 👻 ghost (smash through one block or bomb).
* **Levels and worlds:** every 10 points is a new level with a new theme: Meadow, Desert, Ice, Night, Lava and Space.
* **Speed ramp:** each apple makes the snake a little faster, up to a cap per difficulty.
* **Daily challenge:** one shared starting board per day (Medium difficulty), with its own best score.
* **First-game tutorial**, **phone vibration** (Android), and **colorblind-friendly** blocks: blocks still forming have yellow-black hazard stripes and an outline, not just a different color.

### How the site is published

The site is hosted on [Vercel](https://vercel.com): every push to `main` deploys the game (`web/`) and its server functions (`api/`). GitHub Actions runs the tests on every push (`.github/workflows/ci.yml`).

### Running the web version locally

```bash
python3 -m http.server 8123 --directory web
```

Then open http://localhost:8123. Run the web rules and API tests with `npm test`.

---

## 🏆 Accounts & Online Leaderboard (Vercel + Neon)

On the live site, players can create an account (email and password, through [Neon Auth](https://neon.com/docs/auth)) to save their games. Anyone can still play as a guest; signing in is offered on the game-over screen, and signing in right then saves that game. Without the server (for example when `web/` is opened on its own), these features simply stay hidden.

* **Leaderboard:** the top 10 players for each difficulty and for each day's Daily Challenge, each player once with their best score.
* **Account page:** best score per difficulty, the last 20 games, and stats: games played, apples eaten, best level and daily challenge streak.

```
Game (web/) ──► Vercel functions (api/) ──► Neon Postgres + Neon Auth
```

**How it stays secure**

* **Scores can't be faked.** The game runs in fixed 1/60-second steps, so a board seed plus the recorded turns always replays to the same game. The server picks the seed when a game starts, and when it ends it **replays the whole game** with the same rules code (`web/js/logic.js`). Only the replayed score is saved. Each game can be saved once, not sooner than it could have been played, and within 3 hours.
* **Who you are comes from Neon Auth, never from the browser.** Neon Auth stores the passwords; the game never sees them after sign-in. The server checks the session with Neon Auth on every save.
* **Sign-in goes through this site** (`/api/auth/...`), so the session cookie is first-party (HttpOnly, Secure, SameSite=Lax) and works in Safari, which blocks third-party cookies. Only sign-up, sign-in, sign-out and session checks are forwarded, with only the fields they need.
* Player names: 1–16 letters (any language), numbers, spaces, `_ . -`, always shown as plain text. Emails are never shown to other players.
* Starting games is rate-limited per player, and IP addresses are stored only as keyed hashes. Database queries are parameterized, errors never include internal details, and the site sends strict security headers (`vercel.json`).

**Setup**

1. Copy `.env.example` to `.env` and fill in your Neon connection strings and Neon Auth URL. `.env` is ignored by git; never commit it.
2. Create the tables once: `npm install`, then `npm run db:setup`.
3. Import the repository in Vercel (**Add New → Project**). Leave **Root Directory** as the repository root (not `web`) so Vercel finds `api/` and `vercel.json`; no other build settings are needed.
4. In **Vercel → Project → Settings → Environment Variables**, add `DATABASE_URL`, `DATABASE_URL_POOLED`, `NEON_AUTH_BASE_URL` and `IP_HASH_SECRET` with the same values as in `.env`, then redeploy.
5. In the **Neon dashboard → Auth → Trusted domains**, add your site's address (`https://3d-snake-game-web.vercel.app`, no trailing slash). Sign-in is refused from addresses that aren't listed.

For local development with the API, use the Vercel CLI: `npx vercel dev` (it reads `.env`). Neon Auth already trusts `localhost`.

---

## 🚀 Running the Desktop Game

```bash
pip install -r requirements.txt
python3 "3D Snake Game.py"
```

The game works with macOS's built-in GLUT as well as freeglut (Linux/Windows). On Linux, install freeglut first (for example `sudo apt install freeglut3-dev`).

Run the logic tests with:

```bash
python3 -m unittest discover -s tests
```

---

## 🕹️ Controls

| Action                   | Key(s)         |
| ------------------------ | -------------- |
| Move Snake               | Arrow keys     |
| Pause/Resume             | `P` or `Space` |
| Restart Game             | `R`            |
| Toggle First-Person View | `V`            |
| Zoom In/Out (3rd person) | `X` / `Y`      |
| Adjust Camera Height     | `W` / `S`      |
| Rotate Camera            | `A` / `D`      |
| Switch English / বাংলা    | `L`            |
| Quit Game                | `Esc`          |

> **Note**: In third-person view, arrow keys follow whichever board direction is closest to the camera's view, so they stay intuitive at any rotation. In First-Person mode, LEFT and RIGHT turn the snake relative to its current direction; DOWN is ignored so you can't turn back into yourself. Up to two turns are buffered, so quick key combos are safe.

---

## 🧠 Game Mechanics

### 🍎 Food & Growth

* Regular food increases your length and score.
* Every 5th food spawns a **special food** (a glowing blue star).
* Eating special food activates **Double Points** and **Speed Boost** for 10 seconds; another star restarts the timer.
* Fill every free cell on the board to win.
* High scores are saved per difficulty in `highscores.json`. After a game ends you can pick a new difficulty before playing again.

### 💥 Bombs & Obstacles

* Bombs are introduced over time and vary by difficulty.
* Running into a bomb or an obstacle ends the game.
* New obstacles appear as your score increases, keeping gameplay challenging.
* New obstacles rise out of the board as translucent red blocks and are harmless for 1.5 seconds; a block only turns solid once the snake is clear of it.
* Obstacles and bombs never spawn right next to the snake's head or in the clear runway ahead of it (about 0.8 seconds of travel, so longer at higher speeds), and obstacles never wall off part of the board.

### 🌐 Bangla (বাংলা) Support

* Press `L` at any time to switch every on-screen text between English and Bangla. Scores and timers use Bangla digits (০১২৩…).
* Bangla text is shaped with HarfBuzz (`uharfbuzz`) and drawn with FreeType (`freetype-py`), so conjuncts like ক্ষ and স্ন join correctly. Both are installed by `requirements.txt`.
* The font is [Noto Sans Bengali](https://github.com/notofonts/bengali) in `fonts/`, under the SIL Open Font License (`fonts/OFL.txt`).
* If the libraries or font are missing, the game still runs in English and the `L` key does nothing.
* New texts go in the `texts` table at the top of the game file, with both an `en` and a `bn` entry.

### 👁️ Camera Modes

* **Third-Person View**: Rotate and zoom to see the board from above.
* **First-Person View**: Navigate the board from the snake’s eyes, with warnings for nearby threats.

---

## 📐 Code Design

The game is structured around:

* **Modular functions**: for drawing grid, food, snake, and UI
* **State management**: including pause, play, game over, and first-person toggle
* **Real-time rendering**: using OpenGL’s double buffering and lighting
* **Event-driven input handling**: keyboard and mouse events drive gameplay

The game loop runs on a ~60 FPS GLUT timer. A game clock that stops while paused or counting down drives:

* Snake movement on a fixed rhythm (no drift from frame timing)
* Bomb spawning logic
* Obstacle fade-in
* Special effects duration

---

## 🧩 Known Limitations

* Uses legacy fixed-function OpenGL, which is deprecated on macOS (it still works, with warnings).
* Performance may vary depending on GPU and OpenGL support.

---

## 📚 Learning Opportunities

This project is ideal if you're looking to:

* Understand OpenGL in Python
* Explore game development logic (movement, collision, scoring)
* Implement UI and input systems
* Learn 3D transformations and camera perspectives

---

## 📸 Screenshots

### Web version

| | |
| --- | --- |
| ![Menu with difficulty and daily challenge](screenshot/web-menu.png) | ![Gameplay on the Meadow level with a star power-up](screenshot/web-gameplay.png) |
| Menu | Gameplay with a ⭐ power-up |
| ![Night level with the ghost power-up and striped forming blocks](screenshot/web-night-ghost.png) | ![Space level in Bangla with double points](screenshot/web-space-bangla.png) |
| Night world: 👻 ghost and striped forming blocks | Space world, in Bangla |
| ![First-person view with a danger warning](screenshot/web-first-person.png) | |
| First-person view | |

| Phone | Phone menu in Bangla |
| --- | --- |
| <img src="screenshot/web-phone.png" alt="Phone gameplay with the swipe tutorial" width="300"> | <img src="screenshot/web-phone-menu-bangla.png" alt="Phone menu in Bangla" width="300"> |

### Desktop (Python) version

| | | |
| --- | --- | --- |
| ![Start screen](screenshot/python-start.png) | ![Gameplay](screenshot/python-gameplay.png) | ![Gameplay in Bangla](screenshot/python-bangla.png) |
| Start screen | Gameplay | Bangla |

<details>
<summary>Original version (2025)</summary>

![1.png](screenshot/1.png)
![2.png](screenshot/2.png)
![3.png](screenshot/3.png)
![4.png](screenshot/4.png)
![5.png](screenshot/5.png)
![6.png](screenshot/6.png)

</details>

---

---

## 📄 License

This project is released under the [MIT License](LICENSE). The Bangla font in `fonts/` and `web/fonts/` (Noto Sans Bengali) keeps its own [SIL Open Font License](fonts/OFL.txt).
