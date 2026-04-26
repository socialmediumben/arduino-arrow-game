let port;
let writer;
let score = 0;
let currentTargetIndex = 0;
let timerTimeout;

const connectScreen = document.getElementById('connect-screen');
const gameScreen = document.getElementById('game-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const connectBtn = document.getElementById('connect-btn');
const directionContainer = document.getElementById('direction-container');
const actionContainer = document.getElementById('action-container');
const timerBar = document.getElementById('timer-bar');
const scoreEl = document.getElementById('score');
const finalScoreEl = document.getElementById('final-score');
const restartBtn = document.getElementById('restart-btn');

// Defining the 4 directions
const arrows = [
  { key: 'ArrowUp', symbol: '⇧' },
  { key: 'ArrowDown', symbol: '⇩' },
  { key: 'ArrowLeft', symbol: '⇦' },
  { key: 'ArrowRight', symbol: '⇨' }
];

const actions = [
  { key: 'a', symbol: 'A' },
  { key: 'b', symbol: 'B' }
];

let currentDirectionTarget = null;
let currentActionTarget = null;
const pressedKeys = new Set();
const validGameKeys = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'a', 'b'];

const TIME_LIMIT_MS = 1000;

function switchScreen(activeScreen) {
  [connectScreen, gameScreen, gameOverScreen].forEach(screen => {
    screen.classList.remove('active');
  });
  activeScreen.classList.add('active');
}

connectBtn.addEventListener('click', async () => {
  if (!navigator.serial) {
    alert("Sorry! The Web Serial API is not supported in this browser. You must use Google Chrome or Microsoft Edge on a desktop computer to connect to the Arduino.");
    return;
  }
  
  try {
    // Request a port and open a connection
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    writer = port.writable.getWriter();
    
    // Start listening to the ESP32 in the background
    readLoop();
    
    // Switch to game and start
    switchScreen(gameScreen);
    score = 0;
    updateScore();
    nextRound();
  } catch (err) {
    console.error('Serial Connection Failed:', err);
    
    // Only show alert if they didn't just casually cancel the popup
    if (!err.message.includes('No port selected')) {
      alert('Failed to connect to Arduino!\n\nReason: ' + err.message + '\n\nMake sure the Arduino IDE Serial Monitor is CLOSED! Only one program can use the port at a time.');
    }
  }
});

function nextRound() {
  // Clear any existing timer
  clearTimeout(timerTimeout);
  
  // Pick random targets
  currentDirectionTarget = arrows[Math.floor(Math.random() * arrows.length)];
  currentActionTarget = actions[Math.floor(Math.random() * actions.length)];
  
  directionContainer.innerText = currentDirectionTarget.symbol;
  actionContainer.innerText = currentActionTarget.symbol;
  
  // Animate the containers for visual feedback
  directionContainer.classList.remove('pop-animation');
  actionContainer.classList.remove('pop-animation');
  void directionContainer.offsetWidth; // trigger reflow
  void actionContainer.offsetWidth;
  directionContainer.classList.add('pop-animation');
  actionContainer.classList.add('pop-animation');

  // Reset and start timer bar animation
  timerBar.style.transition = 'none';
  timerBar.style.width = '100%';
  
  // Small delay to allow browser to render the full width before transitioning
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      timerBar.style.transition = `width ${TIME_LIMIT_MS}ms linear`;
      timerBar.style.width = '0%';
    });
  });

  // Fail condition if time runs out
  timerTimeout = setTimeout(() => {
    failSequence();
  }, TIME_LIMIT_MS);
}

// handleKeydown removed in favor of global listener

function updateScore() {
  scoreEl.innerText = score;
}

async function failSequence() {
  clearTimeout(timerTimeout);
  currentActionTarget = null;
  currentDirectionTarget = null;
  pressedKeys.clear();
  
  // Send 'T' over serial to Arduino
  try {
    if (writer) {
      const encoder = new TextEncoder();
      const data = encoder.encode('T');
      await writer.write(data);
    }
  } catch (err) {
    console.error('Failed to send data to Arduino:', err);
  }

  finalScoreEl.innerText = score;
  switchScreen(gameOverScreen);
}

restartBtn.addEventListener('click', () => {
  score = 0;
  updateScore();
  switchScreen(gameScreen);
  nextRound();
});

// Continuously read data coming FROM the ESP32 and log it to the browser console
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

// Event listeners for tracking pressed keys and fullscreen/arcade controls
window.addEventListener('keyup', (e) => {
  pressedKeys.delete(e.key.toLowerCase());
});

window.addEventListener('keydown', (e) => {
  // Fullscreen toggle ('x' or 'X')
  if (e.key.toLowerCase() === 'x') {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => console.log(err));
    } else {
      document.exitFullscreen();
    }
  }

  // Handle arcade Enter key
  if (e.key === 'Enter') {
    if (connectScreen.classList.contains('active')) {
      connectBtn.click();
    } else if (gameOverScreen.classList.contains('active')) {
      restartBtn.click();
    }
    return;
  }

  // Only check game logic if actively playing
  if (!gameScreen.classList.contains('active') || !currentDirectionTarget || !currentActionTarget) return;

  const key = e.key.toLowerCase();
  
  if (key.includes('arrow') || validGameKeys.includes(key)) {
      e.preventDefault();
  }

  pressedKeys.add(key);

  const dirKey = currentDirectionTarget.key.toLowerCase();
  const actKey = currentActionTarget.key.toLowerCase();

  // Instant fail if a wrong game key is pressed
  if (validGameKeys.includes(key) && key !== dirKey && key !== actKey) {
    failSequence();
    return;
  }

  // Check win condition
  if (pressedKeys.has(dirKey) && pressedKeys.has(actKey)) {
    pressedKeys.clear();
    score++;
    updateScore();
    nextRound();
  }
});
