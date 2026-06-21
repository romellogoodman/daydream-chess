import { useEffect, useRef, useState, useCallback } from "react";
import "./App.scss";

import Board from "./components/Board.jsx";
import GameLog from "./components/GameLog.jsx";
import { connectSocket } from "./lib/socket.js";
import { parseUci, parseFen, colorOf } from "./lib/chess.js";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Each game rolls its own temperature + cap — no manual controls.
const TEMP_MIN = 0.5;
const TEMP_MAX = 1.1;
const CAP_MIN = 16;
const CAP_MAX = 36;

function rollParams() {
  const temperature =
    Math.round((TEMP_MIN + Math.random() * (TEMP_MAX - TEMP_MIN)) * 100) / 100;
  const cap = CAP_MIN + Math.floor(Math.random() * (CAP_MAX - CAP_MIN + 1));
  return { temperature, cap };
}

// Terse end-state labels.
const ENDINGS = {
  checkmate: "Checkmate",
  stalemate: "Stalemate",
  insufficient: "Draw",
  sleep: "Asleep",
};

function App() {
  // --- core game state ---
  const [fen, setFen] = useState(START_FEN);
  const [turn, setTurn] = useState("white");
  const [legalMoves, setLegalMoves] = useState([]);
  const [status, setStatus] = useState("playing");
  const [history, setHistory] = useState([]);
  const [ending, setEnding] = useState(null); // { status, winner } | null

  // --- per-game params (randomized each new game) ---
  const [params, setParams] = useState(rollParams);

  // --- connection ---
  const [connMode, setConnMode] = useState("connecting"); // connecting|connected|demo
  const socketRef = useRef(null);

  // --- selection (human input) ---
  const [selected, setSelected] = useState(null);
  const [lastMove, setLastMove] = useState(null);

  // --- thinking: true between the human move and the model's reply landing ---
  const [thinking, setThinking] = useState(false);

  // --- message handler ---
  const handleMessage = useCallback((msg) => {
    switch (msg.type) {
      case "state":
        setFen(msg.fen);
        setTurn(msg.turn);
        setLegalMoves(msg.legal_moves || []);
        setStatus(msg.status);
        setHistory(buildLog(msg.history));
        if (msg.history && msg.history.length) {
          const last = msg.history[msg.history.length - 1];
          setLastMove(parseUci(last.uci));
        }
        // The model's reply has landed once we get a state with the human to
        // move again (or any state where it isn't black's turn).
        if (msg.turn !== "black") setThinking(false);
        break;

      case "move_rejected":
        // White's move was illegal; clear selection, let them retry.
        setSelected(null);
        setThinking(false);
        break;

      case "turn_record": {
        // Dreams are dropped: ignore attempts, just apply the accepted move.
        if (msg.accepted) {
          const { from, to } = parseUci(msg.accepted);
          if (msg.attempts) {
            const woke = msg.attempts.find((a) => a.kind === "woke");
            if (woke && woke.fen_after) setFen(woke.fen_after);
          }
          setLastMove({ from, to });
        }
        // A following `state` clears thinking; the game_over path handles sleep.
        break;
      }

      case "game_over":
        setStatus(msg.status);
        setEnding({ status: msg.status, winner: msg.winner });
        setThinking(false);
        break;

      default:
        break;
    }
  }, []);

  // --- connect on mount ---
  useEffect(() => {
    const socket = connectSocket();
    socketRef.current = socket;
    socket.onMessage(handleMessage);
    // Kick off a fresh game with rolled params once we know how we connected.
    socket.onStatus((s) => {
      if (s === "demo") setConnMode("demo");
      else if (s === "connected") setConnMode("connected");
      if (s === "demo" || s === "connected") {
        const p = rollParams();
        setParams(p);
        socket.send({ type: "new_game", ...p });
      }
    });
    return () => socket.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- human input ---
  const destinations = useDestinations(selected, legalMoves);
  const inputLocked = thinking || turn !== "white" || status !== "playing";

  const onSquare = useCallback(
    (square) => {
      if (inputLocked) return;
      const board = parseFen(fen);
      const cell = board.flat().find((c) => c.square === square);
      const pieceColor = cell && colorOf(cell.piece);

      if (selected) {
        if (square === selected) {
          setSelected(null);
          return;
        }
        if (pieceColor === "white") {
          setSelected(square);
          return;
        }
        const uci = buildUci(selected, square, fen);
        if (legalMoves.includes(uci)) {
          setSelected(null);
          setThinking(true);
          socketRef.current.send({ type: "human_move", uci });
        } else {
          setSelected(null);
        }
        return;
      }

      if (pieceColor === "white") setSelected(square);
    },
    [inputLocked, fen, selected, legalMoves]
  );

  // --- new game (rolls fresh random params) ---
  const onNewGame = () => {
    const p = rollParams();
    setParams(p);
    setThinking(false);
    setSelected(null);
    setLastMove(null);
    setEnding(null);
    setStatus("playing");
    setFen(START_FEN);
    setHistory([]);
    socketRef.current.send({ type: "new_game", ...p });
  };

  return (
    <main className="app">
      {connMode === "demo" && (
        <div className="app__banner" role="status">
          demo mode
        </div>
      )}

      <div className="app__layout">
        <div className="app__board-wrap">
          <Board
            fen={fen}
            selected={selected}
            destinations={destinations}
            lastMove={lastMove}
            onSquare={onSquare}
          />
          {ending && <Ending ending={ending} onNewGame={onNewGame} />}
        </div>

        <aside className="sidebar">
          <button
            type="button"
            className="sidebar__new-game"
            onClick={onNewGame}
          >
            New game
          </button>
          <StatusLine turn={turn} status={status} ending={ending} />
          <GameLog
            entries={history}
            thinking={thinking}
            nextPly={history.length + 1}
          />
          <p className="sidebar__params">
            temp {params.temperature.toFixed(2)} · cap {params.cap}
          </p>
        </aside>
      </div>
    </main>
  );
}

// A terse one-line status. Model "thinking" is shown in the log, not here.
function StatusLine({ turn, status, ending }) {
  let text;
  if (ending) {
    text = ENDINGS[ending.status] || "Game over";
  } else if (status !== "playing") {
    text = ENDINGS[status] || "Game over";
  } else {
    text = turn === "white" ? "Your move" : "";
  }

  return <p className="status-line">{text}</p>;
}

// Minimal terminal overlay with a quiet New game affordance.
function Ending({ ending, onNewGame }) {
  const label = ENDINGS[ending.status] || "Game over";
  const winnerLine =
    ending.winner === "white"
      ? "You win"
      : ending.winner === "black"
        ? "Model wins"
        : null;

  return (
    <div className="ending" role="dialog" aria-label="Game over">
      <div className="ending__card">
        <p className="ending__title">{label}</p>
        {winnerLine && <p className="ending__winner">{winnerLine}</p>}
        <button type="button" className="ending__new-game" onClick={onNewGame}>
          New game
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

// Flatten server history into simple { ply, side, uci } log entries.
function buildLog(history) {
  if (!history) return [];
  return history.map((h) => ({ ply: h.ply, side: h.side, uci: h.uci }));
}

export default App;
