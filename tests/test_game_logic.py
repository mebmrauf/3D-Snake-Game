import importlib.util
import os
import random
import tempfile
import unittest

gamePath = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "3D Snake Game.py")
spec = importlib.util.spec_from_file_location("snake_game", gamePath)
game = importlib.util.module_from_spec(spec)
spec.loader.exec_module(game)

RIGHT, LEFT, UP, DOWN = (1, 0), (-1, 0), (0, 1), (0, -1)


class GameTestCase(unittest.TestCase):
    def setUp(self):
        random.seed(1)
        self.tempDir = tempfile.TemporaryDirectory()
        game.highScoreFile = os.path.join(self.tempDir.name, "highscores.json")
        game.highScores = {}
        game.changeBackgroundColor = lambda: None
        game.difficultyLevel = "HARD"
        game.resetGame()
        game.obstaclesPositions = []
        game.bombs = []
        game.foodPosition = None
        game.specialFoodPosition = None
        game.gameState = "PLAYING"

    def tearDown(self):
        game.language = "en"
        self.tempDir.cleanup()

    def setSnake(self, positions, direction):
        game.snakePositions = list(positions)
        game.snakeDirection = direction
        game.directionQueue = []


class GameLogicTest(GameTestCase):
    def test_fast_turns_cannot_reverse_into_body(self):
        self.setSnake([(5, 5), (4, 5), (3, 5)], RIGHT)
        game.queueDirection(UP)
        game.queueDirection(LEFT)
        game.moveSnake()
        game.moveSnake()
        self.assertEqual(game.gameState, "PLAYING")
        self.assertEqual(game.snakePositions[0], (4, 6))

    def test_direct_reverse_is_ignored(self):
        self.setSnake([(5, 5), (4, 5)], RIGHT)
        game.queueDirection(LEFT)
        game.moveSnake()
        self.assertEqual(game.gameState, "PLAYING")
        self.assertEqual(game.snakePositions[0], (6, 5))

    def test_first_person_down_is_ignored(self):
        self.setSnake([(5, 5), (4, 5)], RIGHT)
        game.isFirstPersonMode = True
        game.specialKeyListener(game.GLUT_KEY_DOWN, 0, 0)
        self.assertEqual(game.directionQueue, [])

    def test_moving_into_tail_cell_is_allowed(self):
        self.setSnake([(5, 5), (5, 6), (4, 6), (4, 5)], LEFT)
        game.moveSnake()
        self.assertEqual(game.gameState, "PLAYING")

    def test_moving_into_tail_while_growing_is_fatal(self):
        self.setSnake([(5, 5), (5, 6), (4, 6), (4, 5)], LEFT)
        game.specialFoodPosition = (4, 5)
        game.moveSnake()
        self.assertEqual(game.gameState, "GAME_OVER")

    def test_snake_does_not_grow_without_food(self):
        self.setSnake([(5, 5), (4, 5)], RIGHT)
        game.moveSnake()
        self.assertEqual(len(game.snakePositions), 2)

    def test_special_food_never_spawns_on_food(self):
        game.foodPosition = (2, 2)
        for i in range(200):
            game.generateSpecialFood()
            self.assertNotEqual(game.specialFoodPosition, game.foodPosition)

    def test_food_falls_back_when_obstacles_crowd_the_board(self):
        game.obstaclesPositions = [(x, y) for x in range(game.gridSize) for y in range(game.gridSize) if (x + y) % 2 == 0]
        self.setSnake([(0, 1)], RIGHT)
        game.generateFood()
        self.assertIsNotNone(game.foodPosition)

    def test_obstacles_respect_safe_zone_and_stay_connected(self):
        for i in range(30):
            self.setSnake([(game.gridSize - 1, 3)], RIGHT)
            game.bombs = [(0, 0)]
            safeZone = game.getSafeZone()
            game.generateObstacles()
            obstacles = game.obstaclesPositions
            self.assertEqual(len(obstacles), len(set(obstacles)))
            self.assertFalse(set(obstacles) & safeZone)
            self.assertNotIn((0, 0), obstacles)
            self.assertIn((0, 3), safeZone)
            self.assertTrue(game.areFreeCellsConnected(set(obstacles)))

    def test_bombs_avoid_safe_zone(self):
        for i in range(30):
            self.setSnake([(5, 5)], RIGHT)
            game.generateBombs()
            self.assertFalse(set(game.bombs) & game.getSafeZone())

    def test_filling_the_board_wins(self):
        cells = [(x, 0) for x in range(game.gridSize)]
        game.obstaclesPositions = [(x, y) for x in range(game.gridSize) for y in range(1, game.gridSize)]
        self.setSnake(list(reversed(cells[:-1])), RIGHT)
        game.foodPosition = cells[-1]
        game.moveSnake()
        self.assertEqual(game.gameState, "WON")

    def test_double_points_cannot_skip_obstacle_threshold(self):
        calls = []
        original = game.generateObstacles
        game.generateObstacles = lambda: calls.append(True)
        try:
            self.setSnake([(5, 5)], RIGHT)
            game.score = 4
            game.doublePointsActive = True
            game.foodPosition = (6, 5)
            game.moveSnake()
        finally:
            game.generateObstacles = original
        self.assertEqual(game.score, 6)
        self.assertEqual(len(calls), 1)

    def test_second_star_resets_timer_without_stacking_speed(self):
        self.setSnake([(5, 5)], RIGHT)
        game.doublePointsActive = True
        game.doublePointsElapsedTime = 7
        game.snakeSpeed = game.getBaseSpeed() * game.specialSpeedMultiplier
        game.specialFoodPosition = (6, 5)
        game.moveSnake()
        self.assertEqual(game.doublePointsElapsedTime, 0)
        self.assertAlmostEqual(game.snakeSpeed, game.getBaseSpeed() * game.specialSpeedMultiplier)

    def test_arrow_keys_follow_nearest_camera_angle(self):
        self.assertEqual(game.getArrowDirections(89), game.getArrowDirections(90))
        self.assertEqual(game.getArrowDirections(359), game.getArrowDirections(0))
        self.assertEqual(game.getArrowDirections(0)[game.GLUT_KEY_UP], DOWN)
        self.assertEqual(game.getArrowDirections(0)[game.GLUT_KEY_RIGHT], LEFT)
        self.assertEqual(game.getArrowDirections(180)[game.GLUT_KEY_UP], UP)
        self.assertEqual(game.getArrowDirections(180)[game.GLUT_KEY_RIGHT], RIGHT)

    def test_restart_ignored_on_start_screen(self):
        game.gameState = "START"
        game.keyboardListener(b'r', 0, 0)
        self.assertEqual(game.gameState, "START")

    def test_high_score_is_saved(self):
        game.score = 12
        game.gameOver()
        self.assertTrue(game.isNewHighScore)
        game.highScores = {}
        game.loadHighScores()
        self.assertEqual(game.highScores["HARD"], 12)

    def test_mouse_uses_window_scale(self):
        game.windowWidth, game.windowHeight = 2000, 1600
        try:
            self.assertEqual(game.convertCoordinate(2000, 0), (1000, 800))
        finally:
            game.windowWidth, game.windowHeight = 1000, 800


class PacingTest(GameTestCase):
    def test_difficulty_speeds_step_evenly_and_slower_than_before(self):
        speeds = [game.difficultySpeeds[level] for level in ("EASY", "MEDIUM", "HARD")]
        self.assertAlmostEqual(speeds[0] - speeds[1], speeds[1] - speeds[2], places=2)
        self.assertGreaterEqual(speeds[2], 0.15)

    def test_safe_zone_grows_with_speed(self):
        game.snakeSpeed = game.difficultySpeeds["EASY"]
        easyCells = game.getSafeCellsAhead()
        game.snakeSpeed = game.difficultySpeeds["HARD"] * game.specialSpeedMultiplier
        self.assertGreater(game.getSafeCellsAhead(), easyCells)

    def test_countdown_holds_the_snake(self):
        self.setSnake([(5, 5)], RIGHT)
        game.startCountdown()
        game.advanceGame(game.countdownDuration - 0.01)
        game.advanceGame(0.005)
        self.assertEqual(game.snakePositions[0], (5, 5))

    def test_steps_keep_a_fixed_rhythm(self):
        self.setSnake([(1, 5)], RIGHT)
        game.countdownRemaining = 0
        game.gameClock = 0
        game.snakeLastMoveTime = 0
        # Frames of 16ms: steps must not drift later than every snakeSpeed seconds
        for i in range(int(round(game.snakeSpeed * 10 / 0.016))):
            game.advanceGame(0.016)
        self.assertGreaterEqual(game.snakePositions[0][0], 1 + 9)

    def test_resume_starts_countdown(self):
        game.countdownRemaining = 0
        game.gameState = "PLAYING"
        game.keyboardListener(b'p', 0, 0)
        game.keyboardListener(b'p', 0, 0)
        self.assertEqual(game.gameState, "PLAYING")
        self.assertGreater(game.countdownRemaining, 0)

    def test_new_game_starts_with_clear_lane(self):
        for seed in range(30):
            random.seed(seed)
            game.resetGame()
            headX, headY = game.snakePositions[0]
            for i in range(1, game.startRunway + 1):
                self.assertNotIn(((headX + i) % game.gridSize, headY), game.obstaclesPositions)

    def test_new_obstacles_are_harmless_until_solid(self):
        self.setSnake([(5, 5)], RIGHT)
        game.generateObstacles()
        self.assertEqual(game.obstaclesPositions, [])
        self.assertTrue(game.pendingObstacles)
        game.updatePendingObstacles(game.obstacleFadeInDuration + 0.1)
        self.assertTrue(game.obstaclesPositions)
        self.assertFalse(set(game.obstaclesPositions) & (set(game.snakePositions) | game.getSafeZone()))

    def test_pending_obstacle_waits_while_snake_is_on_it(self):
        self.setSnake([(5, 5), (4, 5)], RIGHT)
        game.pendingObstacles = [(4, 5)]
        game.updatePendingObstacles(game.obstacleFadeInDuration + 0.1)
        self.assertEqual(game.pendingObstacles, [(4, 5)])
        self.assertNotIn((4, 5), game.obstaclesPositions)

    def test_snake_glides_between_cells(self):
        self.setSnake([(5, 5)], RIGHT)
        game.countdownRemaining = 0
        game.gameClock = 0
        game.snakeLastMoveTime = 0
        game.advanceGame(game.snakeSpeed)
        game.advanceGame(game.snakeSpeed / 2)
        headX, headY = game.getDrawnSnakePositions()[0]
        self.assertAlmostEqual(headX, 5.5, places=1)


class LanguageTest(unittest.TestCase):
    def tearDown(self):
        game.language = "en"

    def test_every_text_has_both_languages(self):
        for key, translations in game.texts.items():
            self.assertEqual(set(translations), {"en", "bn"}, key)

    def test_numbers_use_bangla_digits(self):
        game.language = "bn"
        self.assertEqual(game.tr("score", score=120), "স্কোর: ১২০")
        game.language = "en"
        self.assertEqual(game.tr("score", score=120), "Score: 120")

    def test_l_key_toggles_language(self):
        if not game.isBanglaAvailable():
            self.skipTest("Bangla font or shaping libraries not installed")
        game.keyboardListener(b'l', 0, 0)
        self.assertEqual(game.language, "bn")
        game.keyboardListener(b'l', 0, 0)
        self.assertEqual(game.language, "en")

    def test_mixed_text_splits_into_runs(self):
        self.assertEqual(game.splitTextRuns("আবার শুরু করতে R চাপুন!"),
                         [(True, "আবার শুরু করতে "), (False, "R "), (True, "চাপুন!")])

    def test_conjuncts_are_shaped(self):
        if not game.isBanglaAvailable():
            self.skipTest("Bangla font or shaping libraries not installed")
        # ক + ্ + ষ must join into fewer glyphs than code points
        infos, positions = game.shapeBanglaText("ক্ষ", 21)
        self.assertLess(len(infos), 3)
        width, height, descent, advance, rgba = game.getBanglaImage("সহজ", 21, (0.0, 0.0, 0.0))
        self.assertEqual(len(rgba), width * height * 4)
        self.assertTrue(any(rgba[3::4]))


if __name__ == "__main__":
    unittest.main()
