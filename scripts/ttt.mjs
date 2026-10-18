import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const STATE_PATH = "data/ttt.json";
const BOARD_PATH = "assets/ttt-board.svg";
const README_PATH = "README.md";
const REPLY_PATH = join(process.env.RUNNER_TEMP ?? "/tmp", "ttt-reply.md");
const MARKER_START = "<!-- TTT:START -->";
const MARKER_END = "<!-- TTT:END -->";
const BLUNDER_RATE = Number(process.env.TTT_BLUNDER_RATE ?? 0.15);
const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];
const COLUMNS = ["A", "B", "C"];

const createState = (previous) => ({
  board: Array(9).fill(null),
  status: "playing",
  winner: null,
  line: null,
  lastHuman: null,
  lastBot: null,
  lastUser: null,
  stats: previous?.stats ?? { games: 0, human: 0, bot: 0, draws: 0 },
  players: previous?.players ?? {},
});

const ensureDir = (path) => mkdirSync(dirname(path), { recursive: true });

const loadState = () => {
  if (!existsSync(STATE_PATH)) return createState();
  try {
    return { ...createState(), ...JSON.parse(readFileSync(STATE_PATH, "utf8")) };
  } catch {
    return createState();
  }
};

const saveState = (state) => {
  ensureDir(STATE_PATH);
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
};

const cellName = (index) => `${COLUMNS[index % 3]}${Math.floor(index / 3) + 1}`;

const parseCell = (name) => {
  const upper = name.toUpperCase();
  return (Number(upper[1]) - 1) * 3 + COLUMNS.indexOf(upper[0]);
};

const emptyCells = (board) => board.flatMap((value, index) => (value ? [] : [index]));

const evaluate = (board) => {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  return board.every(Boolean) ? { winner: null, line: null } : null;
};

const minimax = (board, player, alpha, beta, depth) => {
  const result = evaluate(board);
  if (result) {
    if (result.winner === "O") return 10 - depth;
    if (result.winner === "X") return depth - 10;
    return 0;
  }
  const moves = emptyCells(board);
  if (player === "O") {
    let best = -Infinity;
    for (const move of moves) {
      board[move] = "O";
      best = Math.max(best, minimax(board, "X", alpha, beta, depth + 1));
      board[move] = null;
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }
  let best = Infinity;
  for (const move of moves) {
    board[move] = "X";
    best = Math.min(best, minimax(board, "O", alpha, beta, depth + 1));
    board[move] = null;
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];

const chooseBotMove = (board) => {
  const moves = emptyCells(board);
  if (Math.random() < BLUNDER_RATE) return pick(moves);
  let bestScore = -Infinity;
  let best = [];
  for (const move of moves) {
    board[move] = "O";
    const score = minimax(board, "X", -Infinity, Infinity, 1);
    board[move] = null;
    if (score > bestScore) {
      bestScore = score;
      best = [move];
    } else if (score === bestScore) {
      best.push(move);
    }
  }
  return pick(best);
};

const conclude = (state, result) => {
  state.status = "finished";
  state.winner = result.winner;
  state.line = result.line;
  state.stats.games += 1;
  if (result.winner === "X") state.stats.human += 1;
  else if (result.winner === "O") state.stats.bot += 1;
  else state.stats.draws += 1;
};

const playTurn = (state, cell, user) => {
  state.board[cell] = "X";
  state.lastHuman = cell;
  state.lastBot = null;
  state.lastUser = user;
  state.players[user] = (state.players[user] ?? 0) + 1;
  const afterHuman = evaluate(state.board);
  if (afterHuman) {
    conclude(state, afterHuman);
    return;
  }
  const botCell = chooseBotMove(state.board);
  state.board[botCell] = "O";
  state.lastBot = botCell;
  const afterBot = evaluate(state.board);
  if (afterBot) conclude(state, afterBot);
};

const asciiBoard = (board) =>
  [0, 1, 2]
    .map((row) =>
      [0, 1, 2]
        .map((col) => board[row * 3 + col] ?? ".")
        .join(" | ")
    )
    .join("\n---------\n");

const describeTurn = (state, user) => {
  const lines = [`@${user} played **${cellName(state.lastHuman)}**.`];
  if (state.lastBot !== null) lines.push(`The bot answered with **${cellName(state.lastBot)}**.`);
  if (state.status === "finished") {
    if (state.winner === "X") lines.push("🎉 You won this round. Impressive.");
    else if (state.winner === "O") lines.push("🤖 The bot won this round.");
    else lines.push("🤝 It's a draw.");
    lines.push("Make any move on the profile to start a new game.");
  } else {
    lines.push("Your turn again — pick another square on the profile.");
  }
  lines.push("", "```", asciiBoard(state.board), "```");
  return lines.join("\n");
};

const renderBoardSvg = (state) => {
  const centers = (index) => [(index % 3) * 120 + 60, Math.floor(index / 3) * 120 + 60];
  const marks = state.board.map((value, index) => {
    if (!value) return "";
    const [cx, cy] = centers(index);
    const fresh = index === state.lastHuman || index === state.lastBot ? " fresh" : "";
    if (value === "X") {
      return [
        `<line class="draw${fresh}" pathLength="1" x1="${cx - 28}" y1="${cy - 28}" x2="${cx + 28}" y2="${cy + 28}" stroke="url(#gx)" stroke-width="10" stroke-linecap="round"/>`,
        `<line class="draw${fresh}" pathLength="1" x1="${cx + 28}" y1="${cy - 28}" x2="${cx - 28}" y2="${cy + 28}" stroke="url(#gx)" stroke-width="10" stroke-linecap="round" style="animation-delay:.2s"/>`,
      ].join("");
    }
    return `<circle class="draw${fresh}" pathLength="1" cx="${cx}" cy="${cy}" r="30" fill="none" stroke="url(#go)" stroke-width="10" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/>`;
  });
  let winLine = "";
  if (state.line) {
    const [ax, ay] = centers(state.line[0]);
    const [bx, by] = centers(state.line[2]);
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    const ux = (dx / len) * 36;
    const uy = (dy / len) * 36;
    winLine = `<line class="win" pathLength="1" x1="${ax - ux}" y1="${ay - uy}" x2="${bx + ux}" y2="${by + uy}" stroke="#FFD166" stroke-width="7" stroke-linecap="round"/>`;
  }
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360" role="img" aria-label="Tic-tac-toe board">',
    "<defs>",
    '<linearGradient id="gx" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00DBDE"/><stop offset="1" stop-color="#7F00FF"/></linearGradient>',
    '<linearGradient id="go" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FC00FF"/><stop offset="1" stop-color="#FF8A00"/></linearGradient>',
    "</defs>",
    "<style>.draw{stroke-dasharray:1;stroke-dashoffset:0}.fresh{stroke-dashoffset:1;animation:draw .5s ease-out forwards}.win{stroke-dasharray:1;stroke-dashoffset:1;animation:draw .6s .55s ease-out forwards}@keyframes draw{to{stroke-dashoffset:0}}</style>",
    '<rect width="360" height="360" rx="18" fill="#0d1117"/>',
    '<rect x="1" y="1" width="358" height="358" rx="17" fill="none" stroke="#30363d" stroke-width="2"/>',
    '<g stroke="#30363d" stroke-width="4" stroke-linecap="round"><line x1="120" y1="24" x2="120" y2="336"/><line x1="240" y1="24" x2="240" y2="336"/><line x1="24" y1="120" x2="336" y2="120"/><line x1="24" y1="240" x2="336" y2="240"/></g>',
    marks.join(""),
    winLine,
    "</svg>",
  ].join("");
};

const renderSection = (state, repository) => {
  const issueUrl = `https://github.com/${repository}/issues/new`;
  const body = encodeURIComponent("Just press Submit new issue. The board updates in a few seconds.");
  const link = (title, label) => `[${label}](${issueUrl}?title=${encodeURIComponent(title)}&body=${body})`;
  const rows = [0, 1, 2].map((row) => {
    const cells = [0, 1, 2].map((col) => {
      const index = row * 3 + col;
      const value = state.board[index];
      if (value === "X") return "❌";
      if (value === "O") return "⭕";
      if (state.status !== "playing") return "·";
      return link(`ttt|move|${cellName(index)}`, `\`${cellName(index)}\``);
    });
    return `| **${row + 1}** | ${cells.join(" | ")} |`;
  });
  let status;
  if (state.status === "playing") status = "Your move — you are ❌, the bot is ⭕.";
  else if (state.winner === "X") status = "🎉 Humans win! Make a move to start a new game.";
  else if (state.winner === "O") status = "🤖 The bot wins! Make a move to start a new game.";
  else status = "🤝 Draw! Make a move to start a new game.";
  const { games, human, bot, draws } = state.stats;
  const leaderboard = Object.entries(state.players)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, moves], i) => `${i + 1}. [@${name}](https://github.com/${name}) — ${moves} moves`);
  const lastLine = state.lastUser ? `Last move by [@${state.lastUser}](https://github.com/${state.lastUser})` : "No moves yet — be the first.";
  return [
    MARKER_START,
    '<div align="center">',
    "",
    '<img src="assets/ttt-board.svg" width="300" alt="Tic-tac-toe board"/>',
    "",
    `**${status}**`,
    "",
    "| | A | B | C |",
    "|:-:|:-:|:-:|:-:|",
    ...rows,
    "",
    `${lastLine} · ${link("ttt|new", "🔄 Restart")}`,
    "",
    `Games **${games}** · Humans **${human}** · Bot **${bot}** · Draws **${draws}**`,
    "",
    "</div>",
    "",
    leaderboard.length ? `<details><summary>🏅 Top players</summary>\n\n${leaderboard.join("\n")}\n\n</details>` : "",
    MARKER_END,
  ].join("\n");
};

const updateReadme = (section) => {
  const readme = readFileSync(README_PATH, "utf8");
  const start = readme.indexOf(MARKER_START);
  const end = readme.indexOf(MARKER_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("README markers not found");
  }
  writeFileSync(README_PATH, readme.slice(0, start) + section + readme.slice(end + MARKER_END.length));
};

const main = () => {
  const title = (process.env.ISSUE_TITLE ?? "").trim();
  const user = process.env.ISSUE_USER ?? "unknown";
  const repository = process.env.GITHUB_REPOSITORY ?? "viniciuzbyte/viniciuzbyte";
  let state = loadState();
  let reply;
  const moveMatch = /^ttt\|move\|([a-c][1-3])$/i.exec(title);

  if (/^ttt\|new$/i.test(title)) {
    state = createState(state);
    reply = "🔄 New game started. You are ❌ — make the first move on the profile.";
  } else if (moveMatch) {
    if (state.status !== "playing") state = createState(state);
    const cell = parseCell(moveMatch[1]);
    if (state.board[cell]) {
      reply = `⚠️ **${moveMatch[1].toUpperCase()}** is already taken. Pick an empty square on the profile.\n\n\`\`\`\n${asciiBoard(state.board)}\n\`\`\``;
    } else {
      playTurn(state, cell, user);
      reply = describeTurn(state, user);
    }
  } else {
    reply = "❓ I didn't understand that command. Use the links on the profile to play.";
  }

  saveState(state);
  ensureDir(BOARD_PATH);
  writeFileSync(BOARD_PATH, renderBoardSvg(state));
  updateReadme(renderSection(state, repository));
  writeFileSync(REPLY_PATH, `${reply}\n`);
};

main();
