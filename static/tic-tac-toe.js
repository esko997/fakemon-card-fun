import { loadShell, say } from "./shell.js";

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
const board = Array(9).fill("");
const turnLabel = document.getElementById("turn");
const again = document.getElementById("again");
let turn = "X";
let result = null;
let winningLine = [];
let robotTimer = null;

const squares = board.map((_, index) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "square";
  button.onclick = () => {
    if (turn !== "X" || result || board[index]) return;
    place(index);
    if (!result) scheduleRobot();
  };
  return button;
});
document.getElementById("board").replaceChildren(...squares);

function render() {
  squares.forEach((button, index) => {
    const mark = board[index];
    button.textContent = mark;
    button.dataset.mark = mark;
    button.classList.toggle("winning", winningLine.includes(index));
    button.disabled = Boolean(mark || result || turn !== "X");
    button.setAttribute("aria-label", `Row ${Math.floor(index / 3) + 1}, column ${index % 3 + 1}: ${mark ? `${mark}, ${mark === "X" ? "you" : "Robo"}` : "empty"}`);
  });
  turnLabel.textContent = result === "X" ? "You got three in a row!" :
    result === "O" ? "Robo got three in a row!" :
    result === "draw" ? "It's a draw!" :
    turn === "X" ? "Your turn! Tap an empty square." : "Robo's turn...";
  again.textContent = result ? "Play again" : "Start again";
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

function scheduleRobot() {
  if (robotTimer !== null || result || turn !== "O") return;
  robotTimer = setTimeout(() => {
    robotTimer = null;
    if (result || turn !== "O") return;
    const empty = board.flatMap((mark, index) => mark ? [] : [index]);
    // Equal chance for every empty square: no winning, blocking or positional strategy.
    place(empty[Math.floor(Math.random() * empty.length)]);
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
document.getElementById("rules-btn").onclick = () => say(
  "Tic-Tac-Toe! You are X, and Robo is O. You go first. Tap an empty square. " +
  "Get three of your marks in a row, across, down, or diagonally. Robo picks a random empty square."
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
