from OpenGL.GL import *
from OpenGL.GLUT import *
from OpenGL.GLU import *
import random
import time
import math
import json
import os

# Bangla text needs real shaping (conjuncts, vowel signs), which GLUT fonts can't do
try:
    import freetype
    import uharfbuzz
except ImportError:
    freetype = None
    uharfbuzz = None

# Game state variables
gridSize = 14
cellSize = 40
halfCellSize = cellSize/2
gridLength = gridSize * cellSize
gridOffset = gridLength / 2
neighborDirections = [(-1, 0), (1, 0), (0, -1), (0, 1)]

# Window size; the HUD is laid out in a fixed 1000x800 space and scaled to the window
windowWidth = 1000
windowHeight = 800
hudWidth = 1000
hudHeight = 800
frameIntervalMs = 16

# Camera-related variables
cameraDistance = 500
cameraHeight = 400
cameraAngle = 180
fovY = 60
isFirstPersonMode = False
firstPersonYOffset = 20
firstPersonDistance = 10

# Controls for camera movement
zoomSpeed = 20
rotationSpeed = 2

# Snake variables
snakePositions = [(gridSize//2, gridSize//2)]
snakeDirection = (1, 0)
directionQueue = []
maxQueuedTurns = 2
# Seconds per cell for each difficulty, in even steps
difficultySpeeds = {"EASY": 0.30, "MEDIUM": 0.23, "HARD": 0.16}
snakeSpeed = 0.23
snakeLastMoveTime = 0
foodCount = 0
minSafeCellsAhead = 3
safeSecondsAhead = 0.8
startRunway = 7
# Where the snake was before its last step, so drawing can glide between cells
previousSnakePositions = list(snakePositions)
previousSnakeDirection = snakeDirection

# Game clock only runs while playing (not paused or counting down)
gameClock = 0
lastFrameTime = 0
countdownDuration = 2.1
countdownRemaining = 0

# Food variables
foodPosition = None
specialFoodPosition = None
foodSizeMultiplier = 1.3
specialFoodSizeMultiplier = 1.5
specialSpeedMultiplier = 0.8
doublePointsActive = False
doublePointsDuration = 10
doublePointsElapsedTime = 0

# Bomb variables
bombs = []
bombSpawnInterval = 10
bombLifetime = 5
bombelapsedTime = 0

# Obstacles; new ones fade in and stay harmless until they turn solid
obstaclesPositions = []
pendingObstacles = []
pendingObstacleElapsed = 0
obstacleFadeInDuration = 1.5
obstacleGenerationAttempts = 50

# Mouse position in HUD coordinates, for button hover
mouseHudX = -1
mouseHudY = -1

# Background
backgroundColor = (0.631, 0.914, 1)

# Game state
gameState = "START"
difficultyLevel = ""
score = 0

# High scores, kept per difficulty next to the game file
highScoreFile = os.path.join(os.path.dirname(os.path.abspath(__file__)), "highscores.json")
highScores = {}
isNewHighScore = False

# Created once the OpenGL context exists
gridDisplayList = None
quadric = None

# Button x, y is the top-left corner in HUD coordinates
buttons = {
    "play": {"x": 875, "y": 785, "width": 110, "height": 38, "textKey": "play"},
    "pause": {"x": 875, "y": 785, "width": 110, "height": 38, "textKey": "pause"},
    "easy": {"x": 260, "y": 280, "width": 140, "height": 45, "textKey": "difficulty_EASY"},
    "medium": {"x": 430, "y": 280, "width": 140, "height": 45, "textKey": "difficulty_MEDIUM"},
    "hard": {"x": 600, "y": 280, "width": 140, "height": 45, "textKey": "difficulty_HARD"},
    "start": {"x": 400, "y": 200, "width": 200, "height": 52, "textKey": "startGame"},
}

# UI colors
uiTextColor = (0.1, 0.15, 0.12)
uiMutedColor = (0.3, 0.36, 0.33)
uiPanelColor = (1.0, 1.0, 1.0, 0.82)
uiBorderColor = (0.2, 0.35, 0.25, 0.9)

# Language
language = "en"
banglaFontPath = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts", "NotoSansBengali-Regular.ttf")
banglaDigits = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")
banglaFonts = {}
banglaImageCache = {}

texts = {
    "title": {"en": "3D SNAKE GAME", "bn": "৩ডি স্নেক গেম"},
    "instructions": {"en": "Instructions:", "bn": "নির্দেশনা:"},
    "instructionArrows": {"en": "- Use Arrow Keys to control the snake", "bn": "- অ্যারো কী দিয়ে সাপ নিয়ন্ত্রণ করুন"},
    "instructionApples": {"en": "- Eat apples to grow longer", "bn": "- আপেল খেয়ে সাপকে লম্বা করুন"},
    "instructionStars": {"en": "- Collect special blue stars for double points and a speed boost", "bn": "- দ্বিগুণ পয়েন্ট ও বাড়তি গতির জন্য নীল তারা সংগ্রহ করুন"},
    "instructionPause": {"en": "- Press P or Space to pause/resume", "bn": "- থামাতে বা চালাতে P অথবা Space চাপুন"},
    "instructionRestart": {"en": "- Press R to restart the game", "bn": "- আবার শুরু করতে R চাপুন"},
    "instructionView": {"en": "- Press V to toggle first-person mode", "bn": "- ফার্স্ট-পারসন মোড চালু বা বন্ধ করতে V চাপুন"},
    "instructionDifficulty": {"en": "- Please select a difficulty level to enable the Start Game button", "bn": "- 'খেলা শুরু' বোতাম চালু করতে একটি কঠিনতার স্তর বেছে নিন"},
    "instructionLanguage": {"en": "- Press L to switch to বাংলা", "bn": "- English-এ যেতে L চাপুন"},
    "cameraControls": {"en": "Camera Controls:", "bn": "ক্যামেরা নিয়ন্ত্রণ:"},
    "cameraZoom": {"en": "- X/Y keys: Zoom in/out", "bn": "- X/Y কী: জুম ইন/আউট"},
    "cameraHeight": {"en": "- W/S keys: Adjust camera height", "bn": "- W/S কী: ক্যামেরার উচ্চতা বদলান"},
    "cameraRotate": {"en": "- A/D keys: Rotate camera (arrows follow the nearest 90° view)", "bn": "- A/D কী: ক্যামেরা ঘোরান (অ্যারো কী কাছের ৯০° দিক মেনে চলে)"},
    "cameraFirstPerson": {"en": "- In first-person mode: LEFT/RIGHT to turn", "bn": "- ফার্স্ট-পারসন মোডে ঘুরতে LEFT/RIGHT"},
    "selectDifficulty": {"en": "Select Difficulty:", "bn": "কঠিনতা বেছে নিন:"},
    "difficulty_EASY": {"en": "Easy", "bn": "সহজ"},
    "difficulty_MEDIUM": {"en": "Medium", "bn": "মাঝারি"},
    "difficulty_HARD": {"en": "Hard", "bn": "কঠিন"},
    "startGame": {"en": "Start Game", "bn": "খেলা শুরু"},
    "playAgain": {"en": "Play Again", "bn": "আবার খেলুন"},
    "play": {"en": "Play", "bn": "চালাও"},
    "pause": {"en": "Pause", "bn": "থামাও"},
    "paused": {"en": "PAUSED", "bn": "বিরতি"},
    "resumeHint": {"en": "Press P or Space to resume", "bn": "চালাতে P অথবা Space চাপুন"},
    "speed": {"en": "Speed: {speed} cells/s", "bn": "গতি: {speed} ঘর/সেকেন্ড"},
    "thirdPersonView": {"en": "Third-Person View", "bn": "থার্ড-পারসন ভিউ"},
    "firstPersonView": {"en": "First-Person View", "bn": "ফার্স্ট-পারসন ভিউ"},
    "youWin": {"en": "YOU WIN!", "bn": "আপনি জিতেছেন!"},
    "gameOver": {"en": "GAME OVER", "bn": "খেলা শেষ"},
    "finalScore": {"en": "Final Score: {score}", "bn": "চূড়ান্ত স্কোর: {score}"},
    "newHighScore": {"en": "New High Score!", "bn": "নতুন সর্বোচ্চ স্কোর!"},
    "highScore": {"en": "High Score: {score}", "bn": "সর্বোচ্চ স্কোর: {score}"},
    "score": {"en": "Score: {score}", "bn": "স্কোর: {score}"},
    "difficulty": {"en": "Difficulty: {level}", "bn": "কঠিনতা: {level}"},
    "cameraAngle": {"en": "Camera Angle: {angle}°", "bn": "ক্যামেরার কোণ: {angle}°"},
    "cameraAngleSnapped": {"en": "Camera Angle: {angle}° (arrows follow {snapped}°)", "bn": "ক্যামেরার কোণ: {angle}° (অ্যারো কী {snapped}° মেনে চলে)"},
    "doublePoints": {"en": "DOUBLE POINTS: {seconds}s", "bn": "দ্বিগুণ পয়েন্ট: {seconds} সেকেন্ড"},
    "firstPersonToggle": {"en": "Press 'V' to toggle view", "bn": "ভিউ বদলাতে 'V' চাপুন"},
    "firstPersonTurn": {"en": "Use LEFT/RIGHT to turn", "bn": "ঘুরতে LEFT/RIGHT ব্যবহার করুন"},
    "dangerObstacle": {"en": "DANGER AHEAD: OBSTACLE!", "bn": "সামনে বিপদ: বাধা!"},
    "dangerBomb": {"en": "DANGER AHEAD: BOMB!", "bn": "সামনে বিপদ: বোমা!"},
    "dangerBody": {"en": "DANGER AHEAD: SNAKE BODY!", "bn": "সামনে বিপদ: সাপের শরীর!"},
    "languageHint": {"en": "L: বাংলা", "bn": "L: English"},
}

def isBanglaAvailable():
    return freetype is not None and uharfbuzz is not None and os.path.exists(banglaFontPath)

def tr(key, **values):
    # Numbers passed in are shown with Bangla digits when the game is in Bangla
    if language == "bn":
        values = {name: str(value).translate(banglaDigits) for name, value in values.items()}
    return texts[key][language].format(**values)

def toggleLanguage():
    global language
    if language == "en" and isBanglaAvailable():
        language = "bn"
    else:
        language = "en"

def changeBackgroundColor():
    global backgroundColor
    backgroundColor = (random.uniform(0.4, 1.0), random.uniform(0.4, 1.0), random.uniform(0.4, 1.0))
    glClearColor(*backgroundColor, 1.0)

def convertCoordinate(x, y):
    a = x * hudWidth / windowWidth
    b = (windowHeight - y) * hudHeight / windowHeight
    return a, b

def convertWorldCoordinate(x, y):
    actualX = x * cellSize - gridOffset + halfCellSize
    actualY = y * cellSize - gridOffset + halfCellSize

    return actualX, actualY

def wrapPosition(x, y):
    return (x % gridSize, y % gridSize)

def isGameFinished():
    return gameState in ("GAME_OVER", "WON")

def getBaseSpeed():
    return difficultySpeeds.get(difficultyLevel, difficultySpeeds["MEDIUM"])

def getSafeCellsAhead():
    # Faster snakes get a longer clear runway so there is always time to react
    return max(minSafeCellsAhead, math.ceil(safeSecondsAhead / snakeSpeed))

def getLastQueuedDirection():
    if directionQueue:
        return directionQueue[-1]
    return snakeDirection

def queueDirection(newDirection):
    # Turns are buffered and checked against the previous turn, so fast key
    # presses can never reverse the snake into its own body
    if len(directionQueue) >= maxQueuedTurns:
        return
    lastX, lastY = getLastQueuedDirection()
    if newDirection == (lastX, lastY) or newDirection == (-lastX, -lastY):
        return
    directionQueue.append(newDirection)

def getSafeZone(cellsAhead=None):
    # Cells around the head and straight ahead, kept clear of new obstacles and bombs
    if cellsAhead is None:
        cellsAhead = getSafeCellsAhead()
    headX, headY = snakePositions[0]
    safeZone = set()
    for dx, dy in neighborDirections:
        safeZone.add(wrapPosition(headX + dx, headY + dy))
    for dirX, dirY in [snakeDirection] + directionQueue:
        for i in range(1, cellsAhead + 1):
            safeZone.add(wrapPosition(headX + dirX * i, headY + dirY * i))
    return safeZone

def getAvailablePositions(otherFoodPosition, minDistFromObstacles):
    global snakePositions, obstaclesPositions
    availablePositions = []
    for x in range(gridSize):
        for y in range(gridSize):
            position = (x, y)
            if position in snakePositions:
                continue
            if position in obstaclesPositions or position in pendingObstacles:
                continue
            if position in bombs:
                continue
            if position == otherFoodPosition:
                continue
            isValidDistance = True
            for obstacleX, obstacleY in obstaclesPositions:
                distance = abs(x - obstacleX) + abs(y - obstacleY)
                if distance < minDistFromObstacles:
                    isValidDistance = False
                    break
            if isValidDistance:
                availablePositions.append(position)
    return availablePositions

def pickFoodPosition(otherFoodPosition, minDistFromObstacles):
    availablePositions = getAvailablePositions(otherFoodPosition, minDistFromObstacles)
    if not availablePositions:
        # Crowded board: allow cells next to obstacles rather than spawning nothing
        availablePositions = getAvailablePositions(otherFoodPosition, 0)
    if availablePositions:
        return random.choice(availablePositions)
    return None

def generateFood():
    global foodPosition
    foodPosition = pickFoodPosition(specialFoodPosition, 2)

def generateSpecialFood():
    global specialFoodPosition
    specialFoodPosition = pickFoodPosition(foodPosition, 4)

def countFreeCells():
    return gridSize * gridSize - len(set(snakePositions) | set(obstaclesPositions))

def areFreeCellsConnected(blockedPositions):
    freeCells = [(x, y) for x in range(gridSize) for y in range(gridSize) if (x, y) not in blockedPositions]
    if not freeCells:
        return True
    visited = {freeCells[0]}
    stack = [freeCells[0]]
    while stack:
        x, y = stack.pop()
        for dx, dy in neighborDirections:
            neighbor = wrapPosition(x + dx, y + dy)
            if neighbor not in blockedPositions and neighbor not in visited:
                visited.add(neighbor)
                stack.append(neighbor)
    return len(visited) == len(freeCells)

def buildObstacleGroups(numOfObstacleGroups, blocksPerGroup, blockedPositions):
    availablePositions = set((x, y) for x in range(gridSize) for y in range(gridSize)) - blockedPositions
    groupsPositions = []
    for i in range(numOfObstacleGroups):
        if not availablePositions:
            break
        firstBlock = random.choice(sorted(availablePositions))
        availablePositions.remove(firstBlock)
        groupPositions = [firstBlock]
        for j in range(blocksPerGroup - 1):
            lastX, lastY = groupPositions[-1]
            neighbors = []
            for dx, dy in neighborDirections:
                neighbor = (lastX + dx, lastY + dy)
                if neighbor in availablePositions:
                    neighbors.append(neighbor)
            if neighbors:
                nextBlock = random.choice(neighbors)
                groupPositions.append(nextBlock)
                availablePositions.remove(nextBlock)
            else:
                break
        groupsPositions.extend(groupPositions)
    return groupsPositions

def generateObstacles(fadeIn=True):
    global obstaclesPositions, pendingObstacles, pendingObstacleElapsed
    numOfObstacleGroups = 3
    blocksPerGroup = 5
    if difficultyLevel == "MEDIUM":
        numOfObstacleGroups = 5
    elif difficultyLevel == "HARD":
        numOfObstacleGroups = 8

    # The opening layout keeps a longer clear lane so a new player isn't instantly boxed in
    cellsAhead = getSafeCellsAhead() if fadeIn else max(getSafeCellsAhead(), startRunway)
    blockedPositions = set(snakePositions) | set(bombs) | getSafeZone(cellsAhead)
    if foodPosition:
        blockedPositions.add(foodPosition)
    if specialFoodPosition:
        blockedPositions.add(specialFoodPosition)

    for attempt in range(obstacleGenerationAttempts):
        candidatePositions = buildObstacleGroups(numOfObstacleGroups, blocksPerGroup, blockedPositions)
        # Reject layouts that wall off pockets where food or the snake could get trapped
        if areFreeCellsConnected(set(candidatePositions)):
            break
    else:
        candidatePositions = []
    if fadeIn:
        # The old layout disappears and the new one fades in, harmless until solid
        obstaclesPositions = []
        pendingObstacles = candidatePositions
        pendingObstacleElapsed = 0
    else:
        obstaclesPositions = candidatePositions
        pendingObstacles = []

def updatePendingObstacles(deltaTime):
    global pendingObstacleElapsed, pendingObstacles
    if not pendingObstacles:
        return
    pendingObstacleElapsed += deltaTime
    if pendingObstacleElapsed < obstacleFadeInDuration:
        return
    # Blocks the snake is on, or about to reach, wait until it has passed
    blockedPositions = set(snakePositions) | getSafeZone()
    stillPending = []
    for position in pendingObstacles:
        if position in blockedPositions or position == foodPosition or position == specialFoodPosition or position in bombs:
            stillPending.append(position)
        else:
            obstaclesPositions.append(position)
    pendingObstacles = stillPending

def generateBombs():
    global bombs
    maximumNoOfBombs = 1
    if difficultyLevel == "MEDIUM":
        maximumNoOfBombs = 2
    elif difficultyLevel == "HARD":
        maximumNoOfBombs = 3
    bombs = []
    safeZone = getSafeZone()
    # Generate new bombs
    for i in range(maximumNoOfBombs):
        occupiedPositions = snakePositions.copy()
        if foodPosition:
            occupiedPositions.append(foodPosition)
        if specialFoodPosition:
            occupiedPositions.append(specialFoodPosition)
        occupiedPositions.extend(bombs)
        occupiedPositions.extend(obstaclesPositions)
        occupiedPositions.extend(pendingObstacles)
        availablePositions = []
        for x in range(gridSize):
            for y in range(gridSize):
                position = (x, y)
                if position not in occupiedPositions and position not in safeZone:
                    availablePositions.append(position)
        if availablePositions:
            bombs.append(random.choice(availablePositions))

def updateBombs(deltaTime):
    global bombs, bombelapsedTime
    if isGameFinished():
        bombs = []
        return
    bombelapsedTime += deltaTime
    if bombelapsedTime > bombSpawnInterval:
        generateBombs()
        bombelapsedTime = 0
    if bombs and bombelapsedTime > bombLifetime:
        bombs = []

def drawBombs():
    global bombs
    for bombPosition  in bombs:
        x, y = bombPosition
        actualX, actualY = convertWorldCoordinate(x, y)
        glPushMatrix()
        glTranslatef(actualX, actualY, halfCellSize)
        glColor3f(0.0, 0.0, 0.0)
        glutSolidSphere(cellSize * 0.35, 16, 16)
        glPushMatrix()
        glTranslatef(0, 0, cellSize * 0.25)
        glColor3f(1.0, 0.0, 0.0)  # Red
        glutSolidSphere(cellSize * 0.15, 8, 8)
        glPopMatrix()
        glPopMatrix()


def resetGame():
    global snakePositions, snakeDirection, directionQueue, previousSnakePositions, previousSnakeDirection, foodPosition, specialFoodPosition, foodCount, score, gameState, snakeSpeed, snakeLastMoveTime, gameClock, bombs, bombelapsedTime, doublePointsActive, doublePointsElapsedTime, isFirstPersonMode, isNewHighScore
    doublePointsActive = False
    doublePointsElapsedTime = 0
    bombs = []
    bombelapsedTime = 0
    isFirstPersonMode = False
    isNewHighScore = False

    snakePositions = [(gridSize // 2, gridSize // 2)]
    snakeDirection = (1, 0)
    directionQueue = []
    previousSnakePositions = list(snakePositions)
    previousSnakeDirection = snakeDirection
    snakeSpeed = getBaseSpeed()
    foodPosition = None
    specialFoodPosition = None
    generateObstacles(fadeIn=False)
    generateFood()
    foodCount = 0
    score = 0
    gameClock = 0
    snakeLastMoveTime = 0
    gameState = "PLAYING"
    startCountdown()

def startCountdown():
    global countdownRemaining
    countdownRemaining = countdownDuration


def moveSnake():
    global snakePositions, snakeDirection, previousSnakePositions, previousSnakeDirection, foodPosition, specialFoodPosition, score, foodCount, doublePointsActive, doublePointsElapsedTime, snakeSpeed
    if gameState != "PLAYING":
        return
    previousSnakePositions = list(snakePositions)
    previousSnakeDirection = snakeDirection
    if directionQueue:
        snakeDirection = directionQueue.pop(0)
    headX, headY = snakePositions[0]
    directionX, directionY = snakeDirection
    newHead = wrapPosition(headX + directionX, headY + directionY)
    isGrowing = newHead == foodPosition or newHead == specialFoodPosition
    # The tail moves out of the way this tick unless the snake is growing
    bodyToCheck = snakePositions if isGrowing else snakePositions[:-1]
    if newHead in bodyToCheck:
        gameOver()
        return
    if newHead in bombs:
        bombs.clear()
        gameOver()
        return
    if newHead in obstaclesPositions:
        gameOver()
        return
    snakePositions.insert(0, newHead)
    if newHead == foodPosition:
        pointsToAdd = 2 if doublePointsActive else 1
        previousScore = score
        score += pointsToAdd
        foodCount += 1
        foodPosition = None
        generateFood()
        if foodCount == 5:
            generateSpecialFood()
            foodCount = 0
        # Compare thresholds crossed, so double points can't jump over a multiple
        if score // 5 > previousScore // 5:
            generateObstacles()
        if score // 7 > previousScore // 7:
            changeBackgroundColor()
    elif newHead == specialFoodPosition:
        doublePointsActive = True
        doublePointsElapsedTime = 0
        snakeSpeed = getBaseSpeed() * specialSpeedMultiplier
        specialFoodPosition = None
    else:
        snakePositions.pop()
    if countFreeCells() == 0:
        gameOver(won=True)

def gameOver(won=False):
    global gameState, foodPosition, specialFoodPosition, doublePointsActive, isFirstPersonMode, directionQueue, previousSnakePositions, pendingObstacles, bombs
    gameState = "WON" if won else "GAME_OVER"
    previousSnakePositions = list(snakePositions)
    pendingObstacles = []
    bombs = []
    foodPosition = None
    specialFoodPosition = None
    doublePointsActive = False
    isFirstPersonMode = False
    directionQueue = []
    recordHighScore()

def loadHighScores():
    global highScores
    try:
        with open(highScoreFile) as file:
            loadedScores = json.load(file)
        highScores = loadedScores if isinstance(loadedScores, dict) else {}
    except (OSError, ValueError):
        highScores = {}

def recordHighScore():
    global isNewHighScore
    if score > highScores.get(difficultyLevel, 0):
        highScores[difficultyLevel] = score
        isNewHighScore = True
        try:
            with open(highScoreFile, "w") as file:
                json.dump(highScores, file)
        except OSError:
            pass

def gameStateChange(oldState, newState):
    # Resuming gives the player a countdown before the snake moves again
    if oldState == "PAUSED" and newState == "PLAYING":
        startCountdown()

def drawObstacles():
    for x, y in obstaclesPositions:
        actualX, actualY = convertWorldCoordinate(x, y)
        glPushMatrix()
        glTranslatef(actualX, actualY, halfCellSize)
        glColor3f(0.5, 0.5, 0.5)
        glutSolidCube(cellSize * 0.8)
        glPopMatrix()

def drawPendingObstacles():
    # Translucent, pulsing blocks that rise out of the board while they fade in
    if not pendingObstacles:
        return
    growth = min(1.0, pendingObstacleElapsed / obstacleFadeInDuration)
    alpha = 0.25 + 0.2 * math.sin(time.time() * 10)
    glEnable(GL_BLEND)
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
    glDepthMask(GL_FALSE)
    for x, y in pendingObstacles:
        actualX, actualY = convertWorldCoordinate(x, y)
        blockHeight = cellSize * 0.8 * max(growth, 0.1)
        glPushMatrix()
        glTranslatef(actualX, actualY, blockHeight / 2)
        glScalef(1, 1, blockHeight / (cellSize * 0.8))
        glColor4f(0.9, 0.3, 0.2, alpha)
        glutSolidCube(cellSize * 0.8)
        glPopMatrix()
    glDepthMask(GL_TRUE)
    glDisable(GL_BLEND)


def buildGridDisplayList():
    # The board never changes, so it is compiled once instead of re-sent every frame
    global gridDisplayList
    boardThickness = 10
    gridDisplayList = glGenLists(1)
    glNewList(gridDisplayList, GL_COMPILE)
    for x in range(gridSize):
        for y in range(gridSize):
            if (x + y) % 2 == 0:
                glColor3f(0.29, 0.435, 0.235)
            else:
                glColor3f(0.486, 0.541, 0.255)
            actualX = x * cellSize - gridOffset
            actualY = y * cellSize - gridOffset
            glPushMatrix()
            glTranslatef(actualX + halfCellSize, actualY + halfCellSize, -boardThickness)
            glBegin(GL_QUADS)
            glNormal3f(0, 0, 1)
            glVertex3f(-halfCellSize, -halfCellSize, boardThickness)
            glVertex3f(halfCellSize, -halfCellSize, boardThickness)
            glVertex3f(halfCellSize, halfCellSize, boardThickness)
            glVertex3f(-halfCellSize, halfCellSize, boardThickness)

            # Side walls only on the board's outer edge; inner ones are hidden
            # and just show up as thin dark lines between rows
            if y == 0:
                glNormal3f(0, -1, 0)
                glVertex3f(-halfCellSize, -halfCellSize, 0)
                glVertex3f(halfCellSize, -halfCellSize, 0)
                glVertex3f(halfCellSize, -halfCellSize, boardThickness)
                glVertex3f(-halfCellSize, -halfCellSize, boardThickness)

            if x == gridSize - 1:
                glNormal3f(1, 0, 0)
                glVertex3f(halfCellSize, -halfCellSize, 0)
                glVertex3f(halfCellSize, halfCellSize, 0)
                glVertex3f(halfCellSize, halfCellSize, boardThickness)
                glVertex3f(halfCellSize, -halfCellSize, boardThickness)

            if y == gridSize - 1:
                glNormal3f(0, 1, 0)
                glVertex3f(halfCellSize, halfCellSize, 0)
                glVertex3f(-halfCellSize, halfCellSize, 0)
                glVertex3f(-halfCellSize, halfCellSize, boardThickness)
                glVertex3f(halfCellSize, halfCellSize, boardThickness)

            if x == 0:
                glNormal3f(-1, 0, 0)
                glVertex3f(-halfCellSize, halfCellSize, 0)
                glVertex3f(-halfCellSize, -halfCellSize, 0)
                glVertex3f(-halfCellSize, -halfCellSize, boardThickness)
                glVertex3f(-halfCellSize, halfCellSize, boardThickness)
            glEnd()
            glPopMatrix()
    glEndList()

def drawGrid():
    glCallList(gridDisplayList)

def getDrawnSnakePositions():
    # Each segment glides from where it was before the last step to where it is now
    progress = getMoveProgress()
    drawnPositions = []
    for i, (x, y) in enumerate(snakePositions):
        if i < len(previousSnakePositions):
            previousX, previousY = previousSnakePositions[i]
        else:
            previousX, previousY = x, y
        dx, dy = x - previousX, y - previousY
        # Wrapping across an edge: glide out past the edge instead of sweeping across the board
        if abs(dx) > 1:
            dx = -math.copysign(1, dx)
        if abs(dy) > 1:
            dy = -math.copysign(1, dy)
        drawnPositions.append((previousX + dx * progress, previousY + dy * progress))
    return drawnPositions

def drawSnake():
    if not snakePositions:
        return
    drawnPositions = getDrawnSnakePositions()
    headX, headY = drawnPositions[0]
    drawSnakeBodyParts(headX, headY, "head")
    for i in range(1, len(drawnPositions)-1):
        x, y = drawnPositions[i]
        drawSnakeBodyParts(x, y, "body")
    if len(drawnPositions) > 1:
        tailX, tailY = drawnPositions[-1]
        drawSnakeBodyParts(tailX, tailY, "tail")

def drawSnakeBodyParts(x, y, partsType):
    actualX, actualY = convertWorldCoordinate(x, y)
    glPushMatrix()
    glTranslatef(actualX, actualY, halfCellSize)
    if partsType == "head":
        drawSnakeHead()
    elif partsType == "body":
        if doublePointsActive:
            glColor3f(0.369, 0.604, 0.737)
        else:
            glColor3f(0.0, 0.8, 0.2)
        glutSolidSphere(cellSize * 0.5, 16, 16)
    elif partsType == "tail":
        if doublePointsActive:
            glColor3f(0.369, 0.604, 0.737)
        else:
            glColor3f(0.0, 0.6, 0.1)
        glutSolidSphere(cellSize * 0.4, 16, 16)
    glPopMatrix()


def drawSnakeHead():
    if doublePointsActive:
        glColor3f(0.369, 0.604, 0.737)
    else:
        glColor3f(0.0, 0.9, 0.2)
    glutSolidSphere(cellSize * 0.55, 16, 16)
    directionX, directionY = snakeDirection
    if directionX == 1:
        headAngle = 0
    elif directionX == -1:
        headAngle = 180
    elif directionY == 1:
        headAngle = 90
    else:
        headAngle = 270
    glRotatef(headAngle, 0, 0, 1)

    glPushMatrix()
    glTranslatef(cellSize * 0.3, cellSize * 0.25, cellSize * 0.3)
    glColor3f(1.0, 1.0, 1.0)
    glutSolidSphere(cellSize * 0.12, 8, 8)

    glTranslatef(cellSize * 0.06, 0, cellSize * 0.06)
    glColor3f(0.0, 0.0, 0.0)
    glutSolidSphere(cellSize * 0.06, 8, 8)
    glPopMatrix()

    glPushMatrix()
    glTranslatef(cellSize * 0.3, -cellSize * 0.25, cellSize * 0.3)
    glColor3f(1.0, 1.0, 1.0)
    glutSolidSphere(cellSize * 0.12, 8, 8)

    glTranslatef(cellSize * 0.06, 0, cellSize * 0.06)
    glColor3f(0.0, 0.0, 0.0)
    glutSolidSphere(cellSize * 0.06, 8, 8)
    glPopMatrix()

    glColor3f(0.9, 0.0, 0.0)
    glPushMatrix()
    glTranslatef(cellSize * 0.45, 0, 0)
    glRotatef(90, 0, 1, 0)
    glutSolidSphere(cellSize * 0.12, 12, 8)
    glPopMatrix()

def drawFood():
    if foodPosition:
        x, y = foodPosition
        actualX, actualY = convertWorldCoordinate(x, y)
        appleRadius = cellSize * 0.35 * foodSizeMultiplier
        glPushMatrix()
        glTranslatef(actualX, actualY, halfCellSize)
        glColor3f(1.0, 0.1, 0.1)
        glutSolidSphere(appleRadius, 16, 16)

        # Upright stem; gluCylinder works with every GLUT, unlike freeglut's glutSolidCylinder
        glPushMatrix()
        glColor3f(0.5, 0.25, 0.0)
        glTranslatef(0, 0, appleRadius * 0.85)
        gluCylinder(quadric, cellSize * 0.05 * foodSizeMultiplier, cellSize * 0.04 * foodSizeMultiplier, cellSize * 0.15 * foodSizeMultiplier, 8, 2)
        glPopMatrix()
        glPopMatrix()


def drawOutwardTriangle(a, b, c):
    # Wind each face away from the origin so back-face culling and lighting both work
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    normal = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
    centroid = ((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3)
    if sum(n * p for n, p in zip(normal, centroid)) < 0:
        b, c = c, b
        normal = (-normal[0], -normal[1], -normal[2])
    length = math.sqrt(sum(n * n for n in normal)) or 1
    glNormal3f(normal[0] / length, normal[1] / length, normal[2] / length)
    glVertex3f(*a)
    glVertex3f(*b)
    glVertex3f(*c)

def drawSpecialFood():
    if specialFoodPosition:
        x, y = specialFoodPosition
        actualX, actualY = convertWorldCoordinate(x, y)
        glPushMatrix()
        glTranslatef(actualX, actualY, halfCellSize)
        glRotatef(time.time() * 60 % 360, 0, 0, 1)

        blueGlow = 0.5 + 0.5 * math.sin(time.time() * 3.0)
        glColor3f(0.1, blueGlow, 1.0)
        starPoints = 5
        outerRadius = cellSize * 0.4 * specialFoodSizeMultiplier
        innerRadius = cellSize * 0.2 * specialFoodSizeMultiplier
        height = cellSize * 0.2 * specialFoodSizeMultiplier
        glBegin(GL_TRIANGLES)
        for i in range(starPoints * 2):
            angle1 = math.pi * i / starPoints
            angle2 = math.pi * (i + 1) / starPoints

            radius1 = outerRadius if i % 2 == 0 else innerRadius
            radius2 = outerRadius if (i + 1) % 2 == 0 else innerRadius

            x1 = radius1 * math.cos(angle1)
            y1 = radius1 * math.sin(angle1)
            x2 = radius2 * math.cos(angle2)
            y2 = radius2 * math.sin(angle2)

            # Top and bottom faces (center to adjacent points)
            drawOutwardTriangle((0, 0, height), (x1, y1, height / 2), (x2, y2, height / 2))
            drawOutwardTriangle((0, 0, -height), (x1, y1, -height / 2), (x2, y2, -height / 2))

            # Side faces (top to bottom)
            drawOutwardTriangle((x1, y1, height / 2), (x1, y1, -height / 2), (x2, y2, height / 2))
            drawOutwardTriangle((x2, y2, height / 2), (x1, y1, -height / 2), (x2, y2, -height / 2))
        glEnd()
        glPopMatrix()

def updateDoublePointsStatus(deltaTime):
    global doublePointsActive, doublePointsElapsedTime, snakeSpeed
    if doublePointsActive:
        doublePointsElapsedTime += deltaTime
        if doublePointsElapsedTime > doublePointsDuration:
            doublePointsActive = False
            doublePointsElapsedTime = 0
            snakeSpeed = getBaseSpeed()

def checkForwardPath():
    if not isFirstPersonMode:
        return None

    headX, headY = snakePositions[0]
    dirX, dirY = snakeDirection
    dangerDistance = 3
    for i in range(1, dangerDistance + 1):
        checkX = (headX + dirX * i) % gridSize
        checkY = (headY + dirY * i) % gridSize

        if (checkX, checkY) in obstaclesPositions:
            return "OBSTACLE"
        elif (checkX, checkY) in bombs:
            return "BOMB"
        elif (checkX, checkY) in snakePositions:
            return "BODY"
    return None

def getVisibleButtons():
    if gameState == "START" or isGameFinished():
        visibleButtons = ["easy", "medium", "hard"]
        if difficultyLevel != "":
            visibleButtons.append("start")
        return visibleButtons
    elif gameState == "PLAYING":
        return ["pause"]
    elif gameState == "PAUSED":
        return ["play"]
    return []

def beginOverlay():
    # 2D HUD drawing: fixed virtual screen, no depth test so the 3D scene can't hide it
    glMatrixMode(GL_PROJECTION)
    glPushMatrix()
    glLoadIdentity()
    gluOrtho2D(0, hudWidth, 0, hudHeight)
    glMatrixMode(GL_MODELVIEW)
    glPushMatrix()
    glLoadIdentity()
    glDisable(GL_DEPTH_TEST)
    glDisable(GL_LIGHTING)

def endOverlay():
    glPopMatrix()
    glMatrixMode(GL_PROJECTION)
    glPopMatrix()
    glMatrixMode(GL_MODELVIEW)
    glEnable(GL_DEPTH_TEST)

def getRoundedRectPoints(x, y, width, height, radius):
    radius = min(radius, width / 2, height / 2)
    corners = [(x + width - radius, y + height - radius, 0), (x + radius, y + height - radius, 90),
               (x + radius, y + radius, 180), (x + width - radius, y + radius, 270)]
    points = []
    for cornerX, cornerY, startAngle in corners:
        for step in range(7):
            angle = math.radians(startAngle + step * 15)
            points.append((cornerX + radius * math.cos(angle), cornerY + radius * math.sin(angle)))
    return points

def drawRoundedRect(x, y, width, height, radius, fillColor, borderColor=None):
    # x, y is the bottom-left corner; colors are RGBA
    points = getRoundedRectPoints(x, y, width, height, radius)
    glEnable(GL_BLEND)
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
    glColor4f(*fillColor)
    glBegin(GL_POLYGON)
    for pointX, pointY in points:
        glVertex2f(pointX, pointY)
    glEnd()
    if borderColor:
        glColor4f(*borderColor)
        glLineWidth(2.0)
        glBegin(GL_LINE_LOOP)
        for pointX, pointY in points:
            glVertex2f(pointX, pointY)
        glEnd()
    glDisable(GL_BLEND)

def isMouseOver(button):
    return (button["x"] <= mouseHudX <= button["x"] + button["width"] and
            button["y"] - button["height"] <= mouseHudY <= button["y"])

def drawButtons():
    beginOverlay()
    for buttonName in getVisibleButtons():
        button = buttons[buttonName]
        isSelected = buttonName.upper() == difficultyLevel
        isHovered = isMouseOver(button)
        textColor = uiTextColor
        if buttonName == "start":
            fillColor = (0.25, 0.55, 0.88, 1.0) if isHovered else (0.16, 0.45, 0.78, 1.0)
            textColor = (1.0, 1.0, 1.0)
        elif isSelected:
            fillColor = (0.22, 0.68, 0.34, 1.0) if isHovered else (0.16, 0.6, 0.28, 1.0)
            textColor = (1.0, 1.0, 1.0)
        elif isHovered:
            fillColor = (0.82, 0.94, 0.84, 0.95)
        else:
            fillColor = (0.97, 0.98, 0.97, 0.92)
        drawRoundedRect(button["x"], button["y"] - button["height"], button["width"], button["height"], 10, fillColor, uiBorderColor)

        textKey = button["textKey"]
        if buttonName == "start" and isGameFinished():
            textKey = "playAgain"
        buttonText = tr(textKey)
        textX = button["x"] + (button["width"] - measureText(buttonText)) / 2
        textY = button["y"] - button["height"]/2 - 6
        drawText(textX, textY, buttonText, color=textColor)
    endOverlay()

def drawStrokeText(centerX, y, text, height, color):
    # GLUT stroke fonts are vector glyphs, so they can be drawn at any size
    scale = height / 119.05
    width = sum(glutStrokeWidth(GLUT_STROKE_ROMAN, ord(ch)) for ch in text) * scale
    glEnable(GL_BLEND)
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
    glEnable(GL_LINE_SMOOTH)
    glColor3f(*color)
    glLineWidth(1.0)
    # Many drivers (macOS included) ignore wide lines, so thickness comes from
    # redrawing the strokes with small offsets around a circle
    thickness = max(1.0, height / 18)
    offsets = [(0.0, 0.0)]
    for ring in (thickness / 2, thickness):
        for step in range(12):
            angle = math.radians(step * 30)
            offsets.append((ring * math.cos(angle), ring * math.sin(angle)))
    for offsetX, offsetY in offsets:
        glPushMatrix()
        glTranslatef(centerX - width / 2 + offsetX, y + offsetY, 0)
        glScalef(scale, scale, 1)
        for ch in text:
            glutStrokeCharacter(GLUT_STROKE_ROMAN, ord(ch))
        glPopMatrix()
    glDisable(GL_LINE_SMOOTH)
    glDisable(GL_BLEND)

def drawBigText(centerX, y, text, height, color):
    if any(isBanglaCharacter(ch) for ch in text) and isBanglaAvailable():
        pixelSize = int(height * 1.3)
        drawText(centerX - measureText(text, banglaPixelSize=pixelSize) / 2, y, text, color=color, banglaPixelSize=pixelSize)
    else:
        drawStrokeText(centerX, y, text, height, color)

def drawCenteredText(centerX, y, text, font=GLUT_BITMAP_HELVETICA_18, color=None):
    drawText(centerX - measureText(text, font) / 2, y, text, font, color or uiTextColor)

def isBanglaCharacter(ch):
    return "ঀ" <= ch <= "৿" or ch in "।॥‌‍"

def splitTextRuns(text):
    # Bangla runs are shaped with the Bangla font; everything else uses the GLUT font,
    # because the Bangla font has no Latin letters. Spaces and !? stay with the run before them.
    runs = []
    for ch in text:
        isBangla = isBanglaCharacter(ch)
        if ch in " !?" and runs:
            isBangla = runs[-1][0]
        if runs and runs[-1][0] == isBangla:
            runs[-1][1] += ch
        else:
            runs.append([isBangla, ch])
    return [(isBangla, run) for isBangla, run in runs]

def getBanglaPixelSize(font):
    # Bangla glyphs need a little more height than the Latin GLUT fonts to stay readable
    if font == GLUT_BITMAP_HELVETICA_12:
        return 15
    elif font == GLUT_BITMAP_TIMES_ROMAN_24:
        return 28
    return 21

def getBanglaFonts(pixelSize):
    if pixelSize not in banglaFonts:
        freetypeFace = freetype.Face(banglaFontPath)
        freetypeFace.set_pixel_sizes(0, pixelSize)
        harfbuzzFont = uharfbuzz.Font(uharfbuzz.Face(uharfbuzz.Blob.from_file_path(banglaFontPath)))
        harfbuzzFont.scale = (pixelSize * 64, pixelSize * 64)
        banglaFonts[pixelSize] = (freetypeFace, harfbuzzFont)
    return banglaFonts[pixelSize]

def shapeBanglaText(text, pixelSize):
    freetypeFace, harfbuzzFont = getBanglaFonts(pixelSize)
    buffer = uharfbuzz.Buffer()
    buffer.add_str(text)
    buffer.guess_segment_properties()
    uharfbuzz.shape(harfbuzzFont, buffer, {})
    return buffer.glyph_infos, buffer.glyph_positions

def getBanglaImage(text, pixelSize, color):
    # Returns (width, height, descent, advance, rgbaBytes) with rows bottom-up for glDrawPixels
    cacheKey = (text, pixelSize, color)
    if cacheKey in banglaImageCache:
        return banglaImageCache[cacheKey]
    freetypeFace, harfbuzzFont = getBanglaFonts(pixelSize)
    infos, positions = shapeBanglaText(text, pixelSize)
    ascent = math.ceil(freetypeFace.size.ascender / 64)
    descent = math.ceil(-freetypeFace.size.descender / 64)
    height = ascent + descent

    glyphs = []
    penX = 0
    width = 0
    for info, position in zip(infos, positions):
        freetypeFace.load_glyph(info.codepoint, freetype.FT_LOAD_RENDER)
        glyph = freetypeFace.glyph
        bitmap = glyph.bitmap
        left = round(penX + position.x_offset / 64) + glyph.bitmap_left
        top = ascent - round(position.y_offset / 64) - glyph.bitmap_top
        glyphs.append((left, top, bitmap.width, bitmap.rows, bitmap.pitch, bytes(bitmap.buffer)))
        width = max(width, left + bitmap.width)
        penX += position.x_advance / 64
    advance = math.ceil(penX)
    width = max(width, advance, 1)

    coverage = bytearray(width * height)
    for left, top, glyphWidth, glyphRows, pitch, buffer in glyphs:
        for row in range(glyphRows):
            y = top + row
            if not 0 <= y < height:
                continue
            for column in range(glyphWidth):
                x = left + column
                value = buffer[row * pitch + column]
                if value and 0 <= x < width:
                    index = y * width + x
                    coverage[index] = max(coverage[index], value)

    red, green, blue = (int(channel * 255) for channel in color)
    rgba = bytearray()
    for y in range(height - 1, -1, -1):
        for value in coverage[y * width:(y + 1) * width]:
            rgba += bytes((red, green, blue, value))
    banglaImageCache[cacheKey] = (width, height, descent, advance, bytes(rgba))
    return banglaImageCache[cacheKey]

def drawBanglaRun(text, pixelSize, color):
    width, height, descent, advance, rgba = getBanglaImage(text, pixelSize, color)
    glEnable(GL_BLEND)
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
    # glBitmap with no image only moves the raster position: down to the image's bottom
    # edge, then back up and past the run, just like GLUT characters advance it
    glBitmap(0, 0, 0, 0, 0, -descent, None)
    glDrawPixels(width, height, GL_RGBA, GL_UNSIGNED_BYTE, rgba)
    glBitmap(0, 0, 0, 0, advance, descent, None)
    glDisable(GL_BLEND)

def measureText(text, font=GLUT_BITMAP_HELVETICA_18, banglaPixelSize=None):
    pixelSize = banglaPixelSize or getBanglaPixelSize(font)
    width = 0
    for isBangla, run in splitTextRuns(text):
        if isBangla and isBanglaAvailable():
            width += getBanglaImage(run, pixelSize, (0.0, 0.0, 0.0))[3]
        else:
            width += sum(glutBitmapWidth(font, ord(ch)) for ch in run)
    return width

def drawText(x, y, text, font=GLUT_BITMAP_HELVETICA_18, color=(0.0, 0.0, 0.0), banglaPixelSize=None):
    # The raster color is latched by glRasterPos, so the color must be set first
    glColor3f(*color)
    glRasterPos2f(x, y)
    pixelSize = banglaPixelSize or getBanglaPixelSize(font)
    for isBangla, run in splitTextRuns(text):
        if isBangla:
            if isBanglaAvailable():
                drawBanglaRun(run, pixelSize, color)
        else:
            for ch in run:
                glutBitmapCharacter(font, ord(ch))

def drawHudPanel():
    if gameState not in ("PLAYING", "PAUSED"):
        return
    lines = [(tr("firstPersonView") if isFirstPersonMode else tr("thirdPersonView"), GLUT_BITMAP_HELVETICA_12, uiMutedColor),
             (tr("score", score=score), GLUT_BITMAP_HELVETICA_18, uiTextColor),
             (tr("highScore", score=highScores.get(difficultyLevel, 0)), GLUT_BITMAP_HELVETICA_12, uiTextColor),
             (tr("difficulty", level=tr("difficulty_" + difficultyLevel)), GLUT_BITMAP_HELVETICA_12, uiTextColor),
             (tr("speed", speed=f"{1 / snakeSpeed:.1f}"), GLUT_BITMAP_HELVETICA_12, uiTextColor)]
    if isFirstPersonMode:
        lines.append((tr("firstPersonToggle"), GLUT_BITMAP_HELVETICA_12, uiMutedColor))
        lines.append((tr("firstPersonTurn"), GLUT_BITMAP_HELVETICA_12, uiMutedColor))
    else:
        if cameraAngle % 90 == 0:
            angleStatus = tr("cameraAngle", angle=cameraAngle % 360)
        else:
            snappedAngle = round(cameraAngle / 90) * 90 % 360
            angleStatus = tr("cameraAngleSnapped", angle=cameraAngle % 360, snapped=snappedAngle)
        lines.append((angleStatus, GLUT_BITMAP_HELVETICA_12, uiMutedColor))
    if doublePointsActive:
        remainingTime = doublePointsDuration - doublePointsElapsedTime
        if remainingTime > 0:
            lines.append((tr("doublePoints", seconds=f"{remainingTime:.1f}"), GLUT_BITMAP_HELVETICA_18, (0.1, 0.35, 0.8)))

    lineHeights = [26 if font == GLUT_BITMAP_HELVETICA_18 else 20 for text, font, color in lines]
    panelWidth = max(measureText(text, font) for text, font, color in lines) + 28
    panelHeight = sum(lineHeights) + 16
    panelTop = hudHeight - 10
    beginOverlay()
    drawRoundedRect(10, panelTop - panelHeight, panelWidth, panelHeight, 12, uiPanelColor, uiBorderColor)
    y = panelTop - 8
    for (text, font, color), lineHeight in zip(lines, lineHeights):
        y -= lineHeight
        drawText(24, y + 6, text, font, color)
    endOverlay()

def drawGameOverScreen():
    if not isGameFinished():
        return
    beginOverlay()
    drawRoundedRect(230, 120, 540, 570, 18, uiPanelColor, uiBorderColor)
    if gameState == "WON":
        drawBigText(500, 625, tr("youWin"), 40, (0.12, 0.55, 0.25))
    else:
        drawBigText(500, 625, tr("gameOver"), 40, (0.8, 0.15, 0.12))
    drawCenteredText(500, 575, tr("finalScore", score=score))
    if isNewHighScore:
        drawCenteredText(500, 545, tr("newHighScore"), color=(0.12, 0.55, 0.25))
    else:
        drawCenteredText(500, 545, tr("highScore", score=highScores.get(difficultyLevel, 0)), color=uiMutedColor)
    drawCenteredText(500, 305, tr("selectDifficulty"))
    endOverlay()

def drawLanguageHint():
    if not isBanglaAvailable():
        return
    beginOverlay()
    drawText(10, 12, tr("languageHint"), GLUT_BITMAP_HELVETICA_12, uiTextColor)
    endOverlay()

def drawFirstPersonOverlay():
    beginOverlay()
    glColor3f(1.0, 1.0, 1.0)
    glLineWidth(2.0)
    glBegin(GL_LINES)
    glVertex2f(495, 400)
    glVertex2f(505, 400)
    glVertex2f(500, 395)
    glVertex2f(500, 405)
    glEnd()
    endOverlay()

def drawPauseOverlay():
    if gameState != "PAUSED":
        return
    beginOverlay()
    drawRoundedRect(0, 0, hudWidth, hudHeight, 0, (0.0, 0.0, 0.0, 0.45))
    drawBigText(500, 410, tr("paused"), 56, (1.0, 1.0, 1.0))
    drawCenteredText(500, 360, tr("resumeHint"), color=(1.0, 1.0, 1.0))
    endOverlay()

def drawCountdownOverlay():
    if gameState != "PLAYING" or countdownRemaining <= 0:
        return
    stepLength = countdownDuration / 3
    number = str(math.ceil(countdownRemaining / stepLength))
    if language == "bn":
        number = number.translate(banglaDigits)
    # Each number shrinks a little as its second runs out
    stepProgress = 1 - (countdownRemaining % stepLength) / stepLength
    beginOverlay()
    drawRoundedRect(430, 360, 140, 140, 70, (0.0, 0.0, 0.0, 0.4))
    drawBigText(500, 400, number, 70 - 16 * stepProgress, (1.0, 1.0, 1.0))
    endOverlay()

def drawStartScreen():
    beginOverlay()
    drawRoundedRect(190, 120, 620, 650, 18, uiPanelColor, uiBorderColor)
    drawBigText(500, 712, tr("title"), 34, (0.12, 0.45, 0.22))
    drawText(230, 672, tr("instructions"), GLUT_BITMAP_HELVETICA_18, uiTextColor)
    instructionKeys = ["instructionArrows", "instructionApples", "instructionStars", "instructionPause",
                       "instructionRestart", "instructionView", "instructionDifficulty"]
    if isBanglaAvailable():
        instructionKeys.append("instructionLanguage")
    for i, key in enumerate(instructionKeys):
        drawText(240, 648 - i * 19, tr(key), GLUT_BITMAP_HELVETICA_12, uiTextColor)
    drawText(230, 482, tr("cameraControls"), GLUT_BITMAP_HELVETICA_18, uiTextColor)
    cameraKeys = ["cameraZoom", "cameraHeight", "cameraRotate", "cameraFirstPerson"]
    for i, key in enumerate(cameraKeys):
        drawText(240, 458 - i * 19, tr(key), GLUT_BITMAP_HELVETICA_12, uiTextColor)
    drawCenteredText(500, 305, tr("selectDifficulty"))
    endOverlay()

def drawDangerWarning():
    dangerType = checkForwardPath()
    if dangerType == "OBSTACLE":
        warning = tr("dangerObstacle")
    elif dangerType == "BOMB":
        warning = tr("dangerBomb")
    elif dangerType == "BODY":
        warning = tr("dangerBody")
    else:
        return
    beginOverlay()
    warningWidth = measureText(warning) + 40
    drawRoundedRect(500 - warningWidth / 2, 478, warningWidth, 40, 12, (0.85, 0.1, 0.1, 0.85))
    drawCenteredText(500, 492, warning, color=(1.0, 1.0, 1.0))
    endOverlay()

def setup_camera():
    glMatrixMode(GL_PROJECTION)
    glLoadIdentity()
    gluPerspective(fovY, windowWidth / windowHeight, 5, 2000)
    glMatrixMode(GL_MODELVIEW)
    glLoadIdentity()
    angleRad = math.radians(cameraAngle)

    cameraX = cameraDistance * math.sin(angleRad)
    cameraY = cameraDistance * math.cos(angleRad)
    cameraZ = cameraHeight

    gluLookAt(cameraX, cameraY, cameraZ,
              0, 0, 0,
              0, 0, 1)

def setup_first_person_camera():
    glMatrixMode(GL_PROJECTION)
    glLoadIdentity()
    gluPerspective(90, windowWidth / windowHeight, 1, 2000)
    glMatrixMode(GL_MODELVIEW)
    glLoadIdentity()
    headX, headY = getDrawnSnakePositions()[0]
    # Turn the view smoothly from the previous heading to the current one
    previousAngle = math.atan2(previousSnakeDirection[1], previousSnakeDirection[0])
    currentAngle = math.atan2(snakeDirection[1], snakeDirection[0])
    angleChange = (currentAngle - previousAngle + math.pi) % (2 * math.pi) - math.pi
    viewAngle = previousAngle + angleChange * getMoveProgress()
    dirX, dirY = math.cos(viewAngle), math.sin(viewAngle)
    actualHeadX, actualHeadY = convertWorldCoordinate(headX, headY)
    lookX = actualHeadX + dirX * cellSize * firstPersonDistance
    lookY = actualHeadY + dirY * cellSize * firstPersonDistance
    gluLookAt(actualHeadX, actualHeadY, halfCellSize + firstPersonYOffset,
              lookX, lookY, halfCellSize,
              0, 0, 1)

def getArrowDirections(angle):
    # Arrow keys follow the board axis closest to where the camera is looking
    snappedAngle = math.radians(round(angle / 90) * 90)
    upX = -round(math.sin(snappedAngle))
    upY = -round(math.cos(snappedAngle))
    return {
        GLUT_KEY_UP: (upX, upY),
        GLUT_KEY_DOWN: (-upX, -upY),
        GLUT_KEY_LEFT: (-upY, upX),
        GLUT_KEY_RIGHT: (upY, -upX),
    }

def quitGame():
    # glutLeaveMainLoop is freeglut-only; macOS's built-in GLUT has no way to leave the loop
    if bool(glutLeaveMainLoop):
        glutLeaveMainLoop()
    else:
        os._exit(0)

def keyboardListener(key, x, y):
    global gameState, cameraDistance, cameraAngle, cameraHeight, isFirstPersonMode
    oldState = gameState
    if key == b'r':
        if gameState != "START":
            resetGame()
    elif key == b'p' or key == b' ':
        if gameState == "PLAYING":
            gameState = "PAUSED"
        elif gameState == "PAUSED":
            gameState = "PLAYING"
    elif key == b'v':
        if gameState in ("PLAYING", "PAUSED"):
            isFirstPersonMode = not isFirstPersonMode
    elif key == b'x':
        if not isFirstPersonMode:
            cameraDistance = max(100, cameraDistance - zoomSpeed)
    elif key == b'y':
        if not isFirstPersonMode:
            cameraDistance = min(1000, cameraDistance + zoomSpeed)
    elif key == b'w':
        if not isFirstPersonMode:
            cameraHeight = min(800, cameraHeight + zoomSpeed)
    elif key == b's':
        if not isFirstPersonMode:
            cameraHeight = max(100, cameraHeight - zoomSpeed)
    elif key == b'a':
        if not isFirstPersonMode:
            cameraAngle = (cameraAngle + rotationSpeed) % 360
    elif key == b'd':
        if not isFirstPersonMode:
            cameraAngle = (cameraAngle - rotationSpeed) % 360
    elif key == b'l':
        toggleLanguage()
    elif key == b'\x1b':
        quitGame()
    if oldState != gameState:
        gameStateChange(oldState, gameState)

def specialKeyListener(key, x, y):
    if gameState != "PLAYING":
        return

    if isFirstPersonMode:
        dirX, dirY = getLastQueuedDirection()
        if key == GLUT_KEY_LEFT:
            queueDirection((-dirY, dirX))
        elif key == GLUT_KEY_RIGHT:
            queueDirection((dirY, -dirX))
        # UP keeps going straight; DOWN would turn back into the body, so it is ignored
    else:
        arrowDirections = getArrowDirections(cameraAngle)
        if key in arrowDirections:
            queueDirection(arrowDirections[key])

def mouseListener(button, state, x, y):
    if button == GLUT_LEFT_BUTTON and state == GLUT_DOWN:
        global gameState, difficultyLevel
        oldState = gameState
        mouseX, mouseY = convertCoordinate(x, y)
        for buttonName in getVisibleButtons():
            button = buttons[buttonName]
            if (button["x"] <= mouseX <= button["x"] + button["width"] and
                button["y"] - button["height"] <= mouseY <= button["y"]):
                if buttonName == "play":
                    gameState = "PLAYING"
                elif buttonName == "pause":
                    gameState = "PAUSED"
                elif buttonName == "start":
                    resetGame()
                elif buttonName in ["easy", "medium", "hard"]:
                    difficultyLevel = buttonName.upper()
                    print(f"Difficulty set to {difficultyLevel}")
                glutPostRedisplay()
                if oldState != gameState:
                    gameStateChange(oldState, gameState)
                return True
        return False

def advanceGame(deltaTime):
    global countdownRemaining, gameClock, snakeLastMoveTime
    if gameState != "PLAYING":
        return
    if countdownRemaining > 0:
        countdownRemaining = max(0, countdownRemaining - deltaTime)
        return
    gameClock += deltaTime
    if gameClock - snakeLastMoveTime >= snakeSpeed:
        moveSnake()
        # Steps keep a fixed rhythm instead of drifting with frame timing,
        # but a very late frame doesn't trigger a burst of catch-up steps
        snakeLastMoveTime += snakeSpeed
        if gameClock - snakeLastMoveTime >= snakeSpeed:
            snakeLastMoveTime = gameClock
        if foodPosition is None and gameState == "PLAYING":
            generateFood()
    updateBombs(deltaTime)
    updateDoublePointsStatus(deltaTime)
    updatePendingObstacles(deltaTime)

def getMoveProgress():
    # How far the snake has glided from its previous cells toward its current ones
    if snakeSpeed <= 0:
        return 1.0
    return max(0.0, min(1.0, (gameClock - snakeLastMoveTime) / snakeSpeed))

def timer(value):
    global lastFrameTime
    currentTime = time.time()
    # Long gaps (window dragged, machine asleep) are clamped so the game doesn't jump ahead
    deltaTime = min(currentTime - lastFrameTime, 0.1) if lastFrameTime else 0
    lastFrameTime = currentTime
    advanceGame(deltaTime)
    glutPostRedisplay()
    # A timer instead of an idle callback caps the frame rate instead of pinning a CPU core
    glutTimerFunc(frameIntervalMs, timer, 0)

def reshape(width, height):
    global windowWidth, windowHeight
    windowWidth = max(width, 1)
    windowHeight = max(height, 1)
    glViewport(0, 0, windowWidth, windowHeight)

def display():
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)

    isFirstPersonView = isFirstPersonMode and (gameState == "PLAYING" or gameState == "PAUSED")
    if isFirstPersonView:
        setup_first_person_camera()
    else:
        setup_camera()

    glEnable(GL_DEPTH_TEST)
    glDepthFunc(GL_LESS)
    setup_lighting()

    if gameState == "START":
        drawStartScreen()
    else:
        drawGrid()
        drawObstacles()
        drawFood()
        drawSpecialFood()
        drawBombs()
        if not isFirstPersonMode:
            drawSnake()
        drawPendingObstacles()

    glDisable(GL_LIGHTING)
    if isFirstPersonView:
        drawFirstPersonOverlay()
        drawDangerWarning()
    drawHudPanel()
    drawGameOverScreen()
    drawCountdownOverlay()
    drawPauseOverlay()
    drawButtons()
    drawLanguageHint()
    glutSwapBuffers()

def passiveMotionListener(x, y):
    global mouseHudX, mouseHudY
    mouseHudX, mouseHudY = convertCoordinate(x, y)

def setup_lighting():
    glEnable(GL_LIGHTING)
    glEnable(GL_LIGHT0)
    glLightfv(GL_LIGHT0, GL_AMBIENT, [0.3, 0.3, 0.3, 1.0])
    glLightfv(GL_LIGHT0, GL_DIFFUSE, [1.0, 1.0, 1.0, 1.0])
    glLightfv(GL_LIGHT0, GL_POSITION, [0.0, 0.0, 500.0, 1.0])
    glEnable(GL_COLOR_MATERIAL)
    glColorMaterial(GL_FRONT, GL_AMBIENT_AND_DIFFUSE)

def initialize():
    global difficultyLevel, quadric
    glClearColor(*backgroundColor, 1.0)
    glEnable(GL_DEPTH_TEST)
    glShadeModel(GL_SMOOTH)
    glEnable(GL_CULL_FACE)
    glCullFace(GL_BACK)
    # Keeps lighting right on the scaled-up fading obstacles
    glEnable(GL_NORMALIZE)
    setup_lighting()
    buildGridDisplayList()
    quadric = gluNewQuadric()
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1)
    difficultyLevel = ""

def main():
    loadHighScores()
    glutInit()
    glutInitDisplayMode(GLUT_DOUBLE | GLUT_RGB | GLUT_DEPTH)
    glutInitWindowSize(windowWidth, windowHeight)
    glutCreateWindow(b"3D Snake Game")
    glutDisplayFunc(display)
    glutReshapeFunc(reshape)
    glutKeyboardFunc(keyboardListener)
    glutSpecialFunc(specialKeyListener)
    glutMouseFunc(mouseListener)
    glutPassiveMotionFunc(passiveMotionListener)
    initialize()
    glutTimerFunc(frameIntervalMs, timer, 0)
    glutMainLoop()

if __name__ == "__main__":
    main()
