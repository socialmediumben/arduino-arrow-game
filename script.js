let port;
let writer;
let score = 0;
let strikes = 0;
const MAX_STRIKES = 3;

let highScore = parseInt(localStorage.getItem('arcade_highscore')) || 0;

// Game engine variables
let gameLoopId;
let lastTimestamp = 0;
let activeNotes = [];
let isPlaying = false;
let nextSpawnTime = 0;
const pressedKeys = new Set();

const laneConfig = [
  { id: 'lane-joystick', isJoystick: true, symbol: '🕹️' },
  { id: 'lane-a', key: 'a', symbol: 'A' },
  { id: 'lane-b', key: 'b', symbol: 'B' }
];

const arrowOptions = [
  { key: 'arrowup', symbol: '⇧' },
  { key: 'arrowdown', symbol: '⇩' },
  { key: 'arrowleft', symbol: '⇦' },
  { key: 'arrowright', symbol: '⇨' }
];

const TRACK_HEIGHT = 600; 
const TARGET_Y = 500; // Target boxes are at bottom: 20px. 600 - 20 - 80 height = 500.
const HIT_WINDOW_HALF = 80; // +/- 80 pixels is exactly the threshold of visually "touching" the box

// UI Elements
const connectScreen = document.getElementById('connect-screen');
const gameScreen = document.getElementById('game-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const connectBtn = document.getElementById('connect-btn');
const skipBtn = document.getElementById('skip-btn');
const scoreEl = document.getElementById('score');
const strikesEl = document.getElementById('strikes');
const finalScoreEl = document.getElementById('final-score');
const restartBtn = document.getElementById('restart-btn');
const lanesContainer = document.getElementById('game-lanes');
const menuHighScoreEl = document.getElementById('menu-high-score');
const gameOverBestEl = document.getElementById('game-over-best');

if (menuHighScoreEl) menuHighScoreEl.innerText = highScore;

// --- Screen Switching Utilities ---
function switchScreen(activeScreen) {
  [connectScreen, gameScreen, gameOverScreen].forEach(s => s.classList.remove('active'));
  activeScreen.classList.add('active');
}

// --- Serial Connection Events ---
connectBtn.addEventListener('click', async () => {
  if (!navigator.serial) {
    alert("Sorry! The Web Serial API is NOT supported in this browser. Use Google Chrome or Microsoft Edge desktop.");
    return;
  }
  
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    writer = port.writable.getWriter();
    
    readLoop();
    startGame();
  } catch (err) {
    if (!err.message.includes('No port selected')) {
      alert('Failed to connect to Arduino!\n\nReason: ' + err.message + '\n\nMake sure the Arduino IDE Serial Monitor is CLOSED!');
    }
  }
});

skipBtn.addEventListener('click', () => {
  port = null;
  writer = null;
  startGame();
});

restartBtn.addEventListener('click', startGame);

// --- Background Data Logger ---
async function readLoop() {
  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
  const reader = textDecoder.readable.getReader();
  
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.trim()) {
        console.log("%c[ESP32 HW]: " + value.trim(), "color: #22c55e; font-weight: bold; font-size: 14px;");
      }
    }
  } catch (error) {
    console.error("Error reading from serial:", error);
  } finally {
    reader.releaseLock();
  }
}

// --- Frame by Frame Game Engine ---
function startGame() {
  score = 0;
  strikes = 0;
  updateHUD();
  
  // Clean up old notes
  activeNotes.forEach(n => n.element.remove());
  activeNotes = [];
  pressedKeys.clear();
  
  isPlaying = true;
  lastTimestamp = performance.now();
  nextSpawnTime = lastTimestamp + 2000; // First note falls after 2 seconds
  
  switchScreen(gameScreen);
  
  // Wipe any potentially running ghost loop
  cancelAnimationFrame(gameLoopId);
  gameLoopId = requestAnimationFrame(gameLoop);
}

function updateHUD() {
  scoreEl.innerText = score;
  strikesEl.innerText = strikes;
}

function gameLoop(timestamp) {
  if (!isPlaying) return;
  lastTimestamp = timestamp;

  // 1. Spawning
  if (timestamp >= nextSpawnTime) {
     spawnNote(timestamp);
     // Target a fun frequency (e.g., spawn a note every 500ms to 900ms)
     nextSpawnTime = timestamp + 500 + (Math.random() * 400); 
  }

  // 2. Physics & Movement
  for (let i = activeNotes.length - 1; i >= 0; i--) {
     let note = activeNotes[i];
     let timeAlive = timestamp - note.spawnTime;
     let currentY = (timeAlive / note.duration) * TRACK_HEIGHT;

     // 3. OOB (Out of Bounds) / Miss check
     if (currentY > TARGET_Y + HIT_WINDOW_HALF) {
         note.element.remove();
         activeNotes.splice(i, 1);
         registerStrike();
         continue; // skip the visual update
     }

     // Visual update
     note.element.style.transform = `translateY(${currentY}px)`;
  }

  if (isPlaying) {
    gameLoopId = requestAnimationFrame(gameLoop);
  }
}

function spawnNote(spawnTime) {
  let lane = laneConfig[Math.floor(Math.random() * laneConfig.length)];
  let actualKey = lane.key;
  let actualSymbol = lane.symbol;

  if (lane.isJoystick) {
    let randArrow = arrowOptions[Math.floor(Math.random() * arrowOptions.length)];
    actualKey = randArrow.key;
    actualSymbol = randArrow.symbol;
  }
  
  let el = document.createElement('div');
  el.classList.add('note');
  el.innerText = actualSymbol;
  document.getElementById(lane.id).appendChild(el);

  // Speed randomly ranges between 2000ms and 4000ms (averaging 3 seconds)
  let duration = 2000 + (Math.random() * 2000);
  
  activeNotes.push({
    element: el,
    laneId: lane.id,
    key: actualKey,
    spawnTime: spawnTime,
    duration: duration,
    handled: false
  });
}

function registerStrike() {
  strikes++;
  updateHUD();
  
  // Flash the border red
  lanesContainer.style.borderColor = 'var(--danger)';
  setTimeout(() => { if(lanesContainer) lanesContainer.style.borderColor = 'var(--glass-border)'; }, 200);

  if (strikes >= MAX_STRIKES) {
    failSequence();
  }
}

async function failSequence() {
  isPlaying = false;
  cancelAnimationFrame(gameLoopId);
  
  // Send 'T' over serial to Arduino
  try {
    if (writer) {
      const encoder = new TextEncoder();
      await writer.write(encoder.encode('T'));
    }
  } catch(err) {
    console.error('Failed to send data to Arduino:', err);
  }

  // Update High Score tracking
  if (score > highScore) {
     highScore = score;
     localStorage.setItem('arcade_highscore', highScore);
     if (menuHighScoreEl) menuHighScoreEl.innerText = highScore;
  }

  finalScoreEl.innerText = score;
  if (gameOverBestEl) gameOverBestEl.innerText = highScore;
  switchScreen(gameOverScreen);
}

// --- Player Input Handling ---
window.addEventListener('keyup', (e) => {
  let key = e.key.toLowerCase();
  pressedKeys.delete(key);
  
  // Turn off visual light-up effect
  let lane;
  if (key.includes('arrow')) lane = laneConfig.find(l => l.isJoystick);
  else lane = laneConfig.find(l => l.key === key);

  if (lane) {
    document.getElementById(lane.id).classList.remove('active-press');
  }
});

window.addEventListener('keydown', (e) => {
  let key = e.key.toLowerCase();
  
  // Arcady Fullscreen Toggle
  if (key === 'x') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(err=>console.log(err));
    else document.exitFullscreen();
    return;
  }
  
  // Global Enter
  if (key === 'enter') {
    if (connectScreen.classList.contains('active')) connectBtn.click();
    else if (gameOverScreen.classList.contains('active')) restartBtn.click();
    return;
  }

  // Halt strictly here if not in the game loop
  if (!isPlaying) return;

  // Prevent unwanted scrolling when hitting game keys
  if (key.includes('arrow') || ['a','b'].includes(key)) {
     e.preventDefault(); 
  }
  
  // Debounce key hold
  if (pressedKeys.has(key)) return; 
  pressedKeys.add(key);

  let lane;
  if (key.includes('arrow')) lane = laneConfig.find(l => l.isJoystick);
  else lane = laneConfig.find(l => l.key === key);

  if (!lane) return; // Non-game keys do absolutely nothing

  // Give the UI lane a flashy effect so the player knows the button works
  document.getElementById(lane.id).classList.add('active-press');

  // --- Collision Engine ---
  const now = performance.now();
  let hitIndex = -1;
  let lowestY = -1; // We track lowest Y to hit the bottom-most note exclusively

  // Search exclusively for unhandled notes in the lane the player just pressed
  for (let i = 0; i < activeNotes.length; i++) {
     let note = activeNotes[i];
     if (note.key === key && !note.handled) {
        let currentY = ((now - note.spawnTime) / note.duration) * TRACK_HEIGHT;
        if (currentY > lowestY) {
           lowestY = currentY;
           hitIndex = i;
        }
     }
  }

  // Resolve Logic
  if (hitIndex !== -1) {
     let note = activeNotes[hitIndex];
     let currentY = ((now - note.spawnTime) / note.duration) * TRACK_HEIGHT;
     
     // Is it inside the hitbox boundary constraints?
     if (Math.abs(currentY - TARGET_Y) <= HIT_WINDOW_HALF) {
        // HIT!
        score++;
        updateHUD();
        note.handled = true;
        
        // Beautiful visual feedback before removal
        note.element.style.background = 'var(--success)';
        note.element.style.opacity = '0';
        note.element.style.transform += ' scale(1.5)';
        note.element.style.transition = 'all 0.15s ease-out';
        
        setTimeout(() => note.element.remove(), 150);
        activeNotes.splice(hitIndex, 1);
        return; // Break out, don't trigger strike
     }
  }

  // If the player pressed a game button, but no note was in the hitbox, it's a strike!
  registerStrike();
});
