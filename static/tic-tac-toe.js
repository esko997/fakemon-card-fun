import { loadShell, say } from "./shell.js";

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
const board = Array(9).fill("");
const turnLabel = document.getElementById("turn");
const again = document.getElementById("again");
const ROBO_HINTS = {
  random: "Robo picks a random empty square. You go first!",
  tricky: "Robo usually spots wins and blocks, but sometimes guesses. You go first!",
};
let mode = "robo";
let difficulty = "random";
let turn = "X";
let result = null;
let winningLine = [];
let robotTimer = null;

const squares = board.map((_, index) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "square";
  button.onclick = () => {
    if (isRobotTurn() || result || board[index]) return;
    place(index);
    if (!result) scheduleRobot();
  };
  return button;
});
document.getElementById("board").replaceChildren(...squares);

function isRobotTurn() {
  return mode === "robo" && turn === "O";
}

function playerName(mark) {
  if (mode === "two") return mark === "X" ? "Player 1" : "Player 2";
  return mark === "X" ? "You" : "Robo";
}

function render() {
  squares.forEach((button, index) => {
    const mark = board[index];
    button.textContent = mark;
    button.dataset.mark = mark;
    button.classList.toggle("winning", winningLine.includes(index));
    button.disabled = Boolean(mark || result || isRobotTurn());
    button.setAttribute("aria-label", `Row ${Math.floor(index / 3) + 1}, column ${index % 3 + 1}: ${mark ? `${mark}, ${playerName(mark)}` : "empty"}`);
  });
  turnLabel.textContent = result === "draw" ? "It's a draw!" :
    result ? `${playerName(result)} got three in a row!` :
    isRobotTurn() ? "Robo's turn..." :
    mode === "two" ? `${playerName(turn)} (${turn}) — your turn!` : "Your turn! Tap an empty square.";
  again.textContent = result ? "Play again" : "Start again";
  document.getElementById("player-x").textContent = mode === "two" ? "Player 1 is X" : "You are X";
  document.getElementById("player-o").textContent = mode === "two" ? "Player 2 is O" : "Robo is O";
  document.getElementById("robo-options").hidden = mode !== "robo";
  document.getElementById("game-hint").textContent = mode === "two"
    ? "Take turns on this tablet. Player 1 goes first!" : ROBO_HINTS[difficulty];
  for (const button of document.querySelectorAll("[data-mode]")) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  }
  for (const button of document.querySelectorAll("[data-difficulty]")) {
    button.setAttribute("aria-pressed", String(button.dataset.difficulty === difficulty));
  }
}

function place(index) {
  board[index] = turn;
  winningLine = WIN_LINES.find(([a, b, c]) => board[a] && board[a] === board[b] && board[b] === board[c]) || [];
  if (winningLine.length) result = turn;
  else if (board.every(Boolean)) result = "draw";
  else turn = turn === "X" ? "O" : "X";
  render();
  if (result) say(turnLabel.textContent);
}

function winningMove(mark, empty) {
  return empty.find(index => WIN_LINES.some(line =>
    line.includes(index) && line.every(cell => cell === index || board[cell] === mark)
  ));
}

function chooseRobotSquare(empty) {
  // Tricky notices immediate wins and threats 75% of the time. No lookahead or perfect play.
  if (difficulty === "tricky" && Math.random() < 0.75) {
    const tactical = winningMove("O", empty) ?? winningMove("X", empty);
    if (tactical !== undefined) return tactical;
  }
  // Random mode, or a Tricky guess: every empty square has an equal chance.
  return empty[Math.floor(Math.random() * empty.length)];
}

function scheduleRobot() {
  if (robotTimer !== null || result || !isRobotTurn()) return;
  robotTimer = setTimeout(() => {
    robotTimer = null;
    if (result || !isRobotTurn()) return;
    const empty = board.flatMap((mark, index) => mark ? [] : [index]);
    place(chooseRobotSquare(empty));
  }, 500);
}

function startGame() {
  clearTimeout(robotTimer);
  robotTimer = null;
  board.fill("");
  turn = "X";
  result = null;
  winningLine = [];
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  render();
}

again.onclick = startGame;
for (const button of document.querySelectorAll("[data-mode]")) {
  button.onclick = () => {
    if (mode === button.dataset.mode) return;
    mode = button.dataset.mode;
    startGame();
  };
}
for (const button of document.querySelectorAll("[data-difficulty]")) {
  button.onclick = () => {
    if (difficulty === button.dataset.difficulty) return;
    difficulty = button.dataset.difficulty;
    startGame();
  };
}
document.getElementById("rules-btn").onclick = () => say(
  "Tic-Tac-Toe! " + (mode === "two" ? "Player 1 is X, and Player 2 is O. Take turns on this tablet. Player 1 goes first. " :
    "You are X, and Robo is O. " + ROBO_HINTS[difficulty] + " ") +
  "Tap an empty square. Get three of your marks in a row, across, down, or diagonally."
);
window.addEventListener("pagehide", () => {
  clearTimeout(robotTimer);
  robotTimer = null;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
});
// Back navigation can restore a page while it was waiting for Robo's move.
window.addEventListener("pageshow", () => scheduleRobot());

startGame();
void loadShell("Tic-Tac-Toe");
