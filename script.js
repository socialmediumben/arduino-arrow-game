let port;
let writer;
let score = 0;
let currentTargetIndex = 0;
let timerTimeout;
const connectScreen = document.getElementById('connect-screen');
const gameScreen = document.getElementById('game-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const connectBtn = document.getElementById('connect-btn');
const targetContainer = document.getElementById('target-container');
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
const TIME_LIMIT_MS = 1000;
function switchScreen(activeScreen) {
  [connectScreen, gameScreen, gameOverScreen].forEach(screen => {
    screen.classList.remove('active');
  });
  activeScreen.classList.add('active');
}
connectBtn.addEventListener('click', async () => {
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
    
    // Add keyboard listener
    window.addEventListener('keydown', handleKeydown);
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
  
  // Pick random arrow
  currentTargetIndex = Math.floor(Math.random() * arrows.length);
  targetContainer.innerText = arrows[currentTargetIndex].symbol;
  
  // Animate the container for visual feedback
  targetContainer.classList.remove('pop-animation');
  void targetContainer.offsetWidth; // trigger reflow
  targetContainer.classList.add('pop-animation');
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
function handleKeydown(e) {
  // We only care about arrow keys
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault();
  if (e.key === arrows[currentTargetIndex].key) {
    // Success!
    score++;
    updateScore();
    nextRound();
  } else {
    // Wrong key!
    failSequence();
  }
}
function updateScore() {
  scoreEl.innerText = score;
}
async function failSequence() {
  clearTimeout(timerTimeout);
  window.removeEventListener('keydown', handleKeydown);
  
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
  window.addEventListener('keydown', handleKeydown);
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
