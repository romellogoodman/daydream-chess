import { useEffect, useRef, useState, useCallback } from "react";
import "./App.scss";

import Board from "./components/Board.jsx";
import GameLog from "./components/GameLog.jsx";
import Controls, {
  TEMPERATURE_DEFAULT,
  CAP_DEFAULT,
} from "./components/Controls.jsx";
import { connectSocket } from "./lib/socket.js";
import { parseUci, parseFen, colorOf } from "./lib/chess.js";

// --- Animation timing constants (tune these to taste) ---------------------
// Per-step durations for the dream/wake engine. Each wrong_board / phantom
// attempt is "held" on screen for HOLD_MS, then released before the next.
const ANIM = {
  WRONG_BOARD_HOLD_MS: 600, // dim dream board flashed, then released
  PHANTOM_HOLD_MS: 650, // ghost arrow held over the real board
  RELEASE_GAP_MS: 140, // brief blank/settle between dreams
  WAKE_SETTLE_MS: 500, // pause to let the wake "land" before unlocking
};

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const ENDINGS = {
  checkmate: {
    title: "Checkmate.",
    line: "The board resolves. Someone has won.",
  },
  stalemate: {
    title: "Stalemate.",
    line: "No move remains. The game holds its breath.",
  },
  insufficient: {
    title: "Insufficient material.",
    line: "Not enough left on the board to end it. A draw.",
  },
  sleep: {
    title: "It fell asleep.",
    line: "The model dreamed and dreamed and never woke. The game stops here, mid-thought.",
  },
};

function App() {
  // --- core game state ---
  const [fen, setFen] = useState(START_FEN);
  const [turn, setTurn] = useState("white");
  const [legalMoves, setLegalMoves] = useState([]);
  const [status, setStatus] = useState("playing");
  const [history, setHistory] = useState([]);
  const [ending, setEnding] = useState(null); // { status, winner } | null

  // --- controls ---
  const [temperature, setTemperature] = useState(TEMPERATURE_DEFAULT);
  const [cap, setCap] = useState(CAP_DEFAULT);

  // --- connection ---
  const [connMode, setConnMode] = useState("connecting"); // connecting|connected|demo
  const socketRef = useRef(null);

  // --- selection (human input) ---
  const [selected, setSelected] = useState(null);
  const [lastMove, setLastMove] = useState(null);

  // --- animation / dream display ---
  // dream = { fen, mood } overrides what the board shows during animation.
  const [dream, setDream] = useState(null); // { fen } when showing a wrong_board
  const [phantom, setPhantom] = useState(null); // { from, to } for a phantom arrow
  const [dreaming, setDreaming] = useState(false); // model turn animating -> lock input
  const [dreamMeta, setDreamMeta] = useState(null); // { samplesUsed, cap, n }
  const timersRef = useRef([]);
  // Rich model log entries keyed by ply, captured from turn_records so the
  // dreams survive a subsequent `state` rebuild.
  const modelEntriesRef = useRef({});

  const sleep = (ms) =>
    new Promise((resolve) => {
      const id = setTimeout(resolve, ms);
      timersRef.current.push(id);
    });

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  // --- animation engine: step through a turn_record's attempts in order ---
  const animateTurn = useCallback(async (record) => {
    setDreaming(true);
    setSelected(null);

    for (const attempt of record.attempts) {
      setDreamMeta({
        samplesUsed: attempt.n + 1,
        cap: record.cap,
        n: attempt.n,
      });

      if (attempt.kind === "wrong_board") {
        setPhantom(null);
        setDream({ fen: attempt.fen_after });
        await sleep(ANIM.WRONG_BOARD_HOLD_MS);
        setDream(null);
        await sleep(ANIM.RELEASE_GAP_MS);
      } else if (attempt.kind === "phantom") {
        setDream(null);
        const { from, to } = parseUci(attempt.uci);
        setPhantom({ from, to });
        await sleep(ANIM.PHANTOM_HOLD_MS);
        setPhantom(null);
        await sleep(ANIM.RELEASE_GAP_MS);
      } else if (attempt.kind === "woke") {
        // Snap to the real, sharp board.
        setDream(null);
        setPhantom(null);
        const { from, to } = parseUci(attempt.uci);
        setFen(attempt.fen_after);
        setLastMove({ from, to });
        await sleep(ANIM.WAKE_SETTLE_MS);
      }
    }

    setDreamMeta(null);
    setDreaming(false);
  }, []);

  // --- message handler ---
  const handleMessage = useCallback(
    (msg) => {
      switch (msg.type) {
        case "state":
          setFen(msg.fen);
          setTurn(msg.turn);
          setLegalMoves(msg.legal_moves || []);
          setStatus(msg.status);
          setHistory(buildLog(msg.history, modelEntriesRef.current));
          if (msg.history && msg.history.length) {
            const last = msg.history[msg.history.length - 1];
            setLastMove(parseUci(last.uci));
          }
          break;

        case "move_rejected":
          // White's move was illegal; clear selection, let them retry.
          setSelected(null);
          break;

        case "turn_record": {
          // Append the model turn to the log immediately, then animate the
          // board. The rich entry is cached so a later `state` keeps the
          // dreams. (The subsequent `state` will reconcile if needed.)
          const entry = modelLogEntry(msg);
          modelEntriesRef.current[entry.ply] = entry;
          setHistory((prev) => [...prev, entry]);
          animateTurn(msg);
          break;
        }

        case "game_over":
          setStatus(msg.status);
          setEnding({ status: msg.status, winner: msg.winner });
          break;

        default:
          break;
      }
    },
    [animateTurn]
  );

  // --- connect on mount ---
  useEffect(() => {
    const socket = connectSocket();
    socketRef.current = socket;
    socket.onStatus((s) => {
      if (s === "demo") setConnMode("demo");
      else if (s === "connected") setConnMode("connected");
    });
    socket.onMessage(handleMessage);
    // Kick off a fresh game once we know how we connected.
    socket.onStatus((s) => {
      if (s === "demo" || s === "connected") {
        socket.send({
          type: "new_game",
          temperature: TEMPERATURE_DEFAULT,
          cap: CAP_DEFAULT,
        });
      }
    });
    return () => {
      clearTimers();
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- human input ---
  const destinations = useDestinations(selected, legalMoves);
  const inputLocked = dreaming || turn !== "white" || status !== "playing";

  const onSquare = useCallback(
    (square) => {
      if (inputLocked) return;
      const board = parseFen(fen);
      const cell = board.flat().find((c) => c.square === square);
      const pieceColor = cell && colorOf(cell.piece);

      if (selected) {
        // Clicking the same square deselects.
        if (square === selected) {
          setSelected(null);
          return;
        }
        // Clicking another own piece reselects.
        if (pieceColor === "white") {
          setSelected(square);
          return;
        }
        // Otherwise attempt a move from selected -> square.
        const uci = buildUci(selected, square, fen);
        if (legalMoves.includes(uci)) {
          // Optimistically clear selection; server confirms via state.
          setSelected(null);
          socketRef.current.send({ type: "human_move", uci });
        } else {
          // Illegal locally — just clear selection.
          setSelected(null);
        }
        return;
      }

      // No selection yet: only select own (white) pieces.
      if (pieceColor === "white") setSelected(square);
    },
    [inputLocked, fen, selected, legalMoves]
  );

  // --- control handlers ---
  const sendControls = (t, c) => {
    if (socketRef.current) {
      socketRef.current.send({ type: "set_controls", temperature: t, cap: c });
    }
  };
  const onTemperatureChange = (t) => {
    setTemperature(t);
    sendControls(t, cap);
  };
  const onCapChange = (c) => {
    setCap(c);
    sendControls(temperature, c);
  };
  const onNewGame = () => {
    clearTimers();
    setDream(null);
    setPhantom(null);
    setDreaming(false);
    setDreamMeta(null);
    setSelected(null);
    setLastMove(null);
    setEnding(null);
    setStatus("playing");
    setFen(START_FEN);
    setHistory([]);
    modelEntriesRef.current = {};
    socketRef.current.send({ type: "new_game", temperature, cap });
  };

  // --- derived display state ---
  const displayFen = dream ? dream.fen : fen;
  const boardMood = dream ? "dream" : "sharp";

  return (
    <main className={`app${dreaming ? " app--dreaming" : ""}`}>
      <header className="app__header">
        <h1 className="app__title">daydream chess</h1>
        <p className="app__subtitle">
          you play white. it dreams in black, and sometimes it wakes.
        </p>
      </header>

      {connMode === "demo" && (
        <div className="app__banner" role="status">
          running on canned dreams — no server found, replaying fixtures
        </div>
      )}

      <div className="app__layout">
        <div className="app__stage">
          <div className="app__board-wrap">
            <Board
              fen={displayFen}
              mood={boardMood}
              selected={selected}
              destinations={destinations}
              lastMove={lastMove}
              phantom={phantom}
              onSquare={onSquare}
            />
            {ending && <Ending ending={ending} onNewGame={onNewGame} />}
          </div>

          <StatusLine
            dreaming={dreaming}
            dreamMeta={dreamMeta}
            turn={turn}
            status={status}
            ending={ending}
          />
        </div>

        <aside className="app__side">
          <Controls
            temperature={temperature}
            cap={cap}
            disabled={dreaming}
            onTemperatureChange={onTemperatureChange}
            onCapChange={onCapChange}
            onNewGame={onNewGame}
          />
          <GameLog entries={history} />
        </aside>
      </div>
    </main>
  );
}

// A quiet status line beneath the board.
function StatusLine({ dreaming, dreamMeta, turn, status, ending }) {
  let text;
  if (ending) {
    text = null; // the Ending overlay carries the message
  } else if (dreaming) {
    text = dreamMeta
      ? `dreaming · attempt ${dreamMeta.samplesUsed} of up to ${dreamMeta.cap}`
      : "dreaming…";
  } else if (status !== "playing") {
    text = null;
  } else {
    text = turn === "white" ? "your move" : "it is thinking…";
  }

  return (
    <div className={`status-line${dreaming ? " status-line--dreaming" : ""}`}>
      {dreaming && <span className="status-line__pulse" aria-hidden="true" />}
      {text && <span className="status-line__text">{text}</span>}
    </div>
  );
}

// Terminal ending overlay. Sleep is presented as its own quiet ending.
function Ending({ ending, onNewGame }) {
  const info = ENDINGS[ending.status] || {
    title: "The game is over.",
    line: "",
  };
  const isSleep = ending.status === "sleep";
  const winnerLine =
    ending.winner === "white"
      ? "You win."
      : ending.winner === "black"
        ? "The model wins."
        : null;

  return (
    <div
      className={`ending${isSleep ? " ending--sleep" : ""}`}
      role="dialog"
      aria-label="Game over"
    >
      <div className="ending__card">
        <h2 className="ending__title">{info.title}</h2>
        <p className="ending__line">{info.line}</p>
        {winnerLine && !isSleep && (
          <p className="ending__winner">{winnerLine}</p>
        )}
        <button type="button" className="ending__new-game" onClick={onNewGame}>
          begin again
        </button>
      </div>
    </div>
  );
}

// --- helpers --------------------------------------------------------------

// Build the highlightable destination set for the selected square.
function useDestinations(selected, legalMoves) {
  if (!selected) return new Set();
  const dests = new Set();
  for (const uci of legalMoves) {
    if (uci.slice(0, 2) === selected) dests.add(uci.slice(2, 4));
  }
  return dests;
}

// Build a uci string for a human move, auto-queening pawn promotions.
// TODO: replace auto-queen with a real promotion picker.
function buildUci(from, to, fen) {
  const board = parseFen(fen);
  const cell = board.flat().find((c) => c.square === from);
  const piece = cell && cell.piece;
  const isPawn = piece && piece.toLowerCase() === "p";
  const toRank = to[1];
  if (isPawn && (toRank === "8" || toRank === "1")) {
    return `${from}${to}q`;
  }
  return `${from}${to}`;
}

// Convert a server history array into log entries. Human entries carry uci;
// model entries (added live from turn_records) carry their attempts. When a
// `state` arrives we rebuild from history but preserve any richer model
// entries already present is not trivial, so we keep model entries minimal
// here and rely on the live turn_record append for dream detail.
function buildLog(history, modelEntries = {}) {
  if (!history) return [];
  return history.map((h) => {
    if (h.side === "model") {
      // Prefer the rich entry captured from the turn_record (with dreams).
      const rich = modelEntries[h.ply];
      if (rich) return rich;
      return {
        ply: h.ply,
        side: "model",
        uci: h.uci,
        attempts: [],
        accepted: h.uci,
        woke: true,
      };
    }
    return { ply: h.ply, side: h.side, uci: h.uci };
  });
}

function modelLogEntry(record) {
  return {
    ply: record.ply,
    side: "model",
    uci: record.accepted,
    accepted: record.accepted,
    attempts: record.attempts,
    woke: record.woke,
    temperature: record.temperature,
    cap: record.cap,
    samplesUsed: record.samples_used,
  };
}

export default App;
