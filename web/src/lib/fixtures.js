// Canned server messages for DEMO MODE. The MockSocket replays these in
// response to client messages so the whole UI is developable without a server.
//
// Every render path is exercised:
//   - turn 1: multiple wrong_board dreams, then woke
//   - turn 2: a phantom dream + wrong_board, then woke
//   - turn 3: fail-to-wake (woke:false) -> game_over status "sleep"
//
// FENs are real positions. White (human) plays the moves listed; the model's
// turn_records follow each.

// Standard start position.
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// After 1. e4
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
// After 1. e4 c5 (model wakes to c5 — the Sicilian)
const AFTER_E4_C5 =
  "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2";
// After 2. Nf3
const AFTER_NF3 =
  "rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2";
// After 2... d6 (model wakes to d6)
const AFTER_D6 =
  "rnbqkbnr/pp2pppp/3p4/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3";
// After 3. d4
const AFTER_D4 =
  "rnbqkbnr/pp2pppp/3p4/2p5/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq d3 0 3";

// A couple of dream FENs (illegal/imagined boards) — still structurally valid
// FENs so the dream renders correctly.
const DREAM_BISHOP_OUT =
  "rnbqk1nr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"; // bishop vanished (illegal)
const DREAM_QUEEN_OUT =
  "rn1qkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

export const FIXTURES = {
  // Initial state after new_game.
  initialState: {
    type: "state",
    ply: 0,
    fen: START_FEN,
    turn: "white",
    legal_moves: [
      "a2a3",
      "a2a4",
      "b2b3",
      "b2b4",
      "c2c3",
      "c2c4",
      "d2d3",
      "d2d4",
      "e2e3",
      "e2e4",
      "f2f3",
      "f2f4",
      "g2g3",
      "g2g4",
      "h2h3",
      "h2h4",
      "b1a3",
      "b1c3",
      "g1f3",
      "g1h3",
    ],
    status: "playing",
    history: [],
  },

  // Keyed by the human uci that triggers this turn. Each entry is the
  // sequence of server messages that follow that human move: a state
  // reflecting the human move, then the model's turn_record, then (if the
  // game continues) another state for the human's next turn — and at the end
  // a game_over.
  turns: {
    // 1. e4 -> model dreams (two wrong boards) then wakes to ...c5
    e2e4: [
      {
        type: "state",
        ply: 1,
        fen: AFTER_E4,
        turn: "black",
        legal_moves: [],
        status: "playing",
        history: [{ ply: 1, side: "human", uci: "e2e4", fen_after: AFTER_E4 }],
      },
      {
        type: "turn_record",
        ply: 2,
        side: "model",
        fen_before: AFTER_E4,
        temperature: 0.8,
        cap: 24,
        attempts: [
          {
            n: 0,
            uci: "f8c5",
            legal: false,
            kind: "wrong_board",
            fen_after: DREAM_BISHOP_OUT,
            from_occupied: true,
          },
          {
            n: 1,
            uci: "d8a5",
            legal: false,
            kind: "wrong_board",
            fen_after: DREAM_QUEEN_OUT,
            from_occupied: true,
          },
          {
            n: 2,
            uci: "e7e5",
            legal: false,
            kind: "phantom",
            fen_after: null,
            from_occupied: false,
          },
          {
            n: 3,
            uci: "c7c5",
            legal: true,
            kind: "woke",
            fen_after: AFTER_E4_C5,
            from_occupied: true,
          },
        ],
        accepted: "c7c5",
        woke: true,
        samples_used: 4,
      },
      {
        type: "state",
        ply: 2,
        fen: AFTER_E4_C5,
        turn: "white",
        legal_moves: [
          "g1f3",
          "g1e2",
          "g1h3",
          "b1c3",
          "b1a3",
          "f1e2",
          "f1d3",
          "f1c4",
          "f1b5",
          "f1a6",
          "d1e2",
          "d1f3",
          "d1g4",
          "d1h5",
          "e1e2",
          "d2d3",
          "d2d4",
          "c2c3",
          "c2c4",
        ],
        status: "playing",
        history: [
          { ply: 1, side: "human", uci: "e2e4", fen_after: AFTER_E4 },
          { ply: 2, side: "model", uci: "c7c5", fen_after: AFTER_E4_C5 },
        ],
      },
    ],

    // 2. Nf3 -> model dreams (a phantom move) then wakes to ...d6
    g1f3: [
      {
        type: "state",
        ply: 3,
        fen: AFTER_NF3,
        turn: "black",
        legal_moves: [],
        status: "playing",
        history: [
          { ply: 1, side: "human", uci: "e2e4", fen_after: AFTER_E4 },
          { ply: 2, side: "model", uci: "c7c5", fen_after: AFTER_E4_C5 },
          { ply: 3, side: "human", uci: "g1f3", fen_after: AFTER_NF3 },
        ],
      },
      {
        type: "turn_record",
        ply: 4,
        side: "model",
        fen_before: AFTER_NF3,
        temperature: 0.8,
        cap: 24,
        attempts: [
          {
            n: 0,
            uci: "e5e4",
            legal: false,
            kind: "phantom",
            fen_after: null,
            from_occupied: false,
          },
          {
            n: 1,
            uci: "f6e4",
            legal: false,
            kind: "phantom",
            fen_after: null,
            from_occupied: false,
          },
          {
            n: 2,
            uci: "b8c6",
            legal: false,
            kind: "wrong_board",
            fen_after: AFTER_NF3, // imagined no-op-ish dream board
            from_occupied: true,
          },
          {
            n: 3,
            uci: "d7d6",
            legal: true,
            kind: "woke",
            fen_after: AFTER_D6,
            from_occupied: true,
          },
        ],
        accepted: "d7d6",
        woke: true,
        samples_used: 4,
      },
      {
        type: "state",
        ply: 4,
        fen: AFTER_D6,
        turn: "white",
        legal_moves: [
          "d2d4",
          "d2d3",
          "f1e2",
          "f1d3",
          "f1c4",
          "f1b5",
          "b1c3",
          "f3g5",
          "f3e5",
          "f3d4",
          "f3h4",
          "e1e2",
        ],
        status: "playing",
        history: [
          { ply: 1, side: "human", uci: "e2e4", fen_after: AFTER_E4 },
          { ply: 2, side: "model", uci: "c7c5", fen_after: AFTER_E4_C5 },
          { ply: 3, side: "human", uci: "g1f3", fen_after: AFTER_NF3 },
          { ply: 4, side: "model", uci: "d7d6", fen_after: AFTER_D6 },
        ],
      },
    ],

    // 3. d4 -> the model NEVER wakes. All dreams, no legal move accepted.
    d2d4: [
      {
        type: "state",
        ply: 5,
        fen: AFTER_D4,
        turn: "black",
        legal_moves: [],
        status: "playing",
        history: [
          { ply: 1, side: "human", uci: "e2e4", fen_after: AFTER_E4 },
          { ply: 2, side: "model", uci: "c7c5", fen_after: AFTER_E4_C5 },
          { ply: 3, side: "human", uci: "g1f3", fen_after: AFTER_NF3 },
          { ply: 4, side: "model", uci: "d7d6", fen_after: AFTER_D6 },
          { ply: 5, side: "human", uci: "d2d4", fen_after: AFTER_D4 },
        ],
      },
      {
        type: "turn_record",
        ply: 6,
        side: "model",
        fen_before: AFTER_D4,
        temperature: 0.8,
        cap: 24,
        attempts: [
          {
            n: 0,
            uci: "c5d4",
            legal: false,
            kind: "wrong_board",
            fen_after: AFTER_D4,
            from_occupied: true,
          },
          {
            n: 1,
            uci: "g8e7",
            legal: false,
            kind: "phantom",
            fen_after: null,
            from_occupied: false,
          },
          {
            n: 2,
            uci: "h8h5",
            legal: false,
            kind: "wrong_board",
            fen_after: AFTER_D4,
            from_occupied: true,
          },
          {
            n: 3,
            uci: "e8e6",
            legal: false,
            kind: "phantom",
            fen_after: null,
            from_occupied: false,
          },
          {
            n: 4,
            uci: "a1a4",
            legal: false,
            kind: "wrong_board",
            fen_after: AFTER_D4,
            from_occupied: false,
          },
        ],
        accepted: null,
        woke: false,
        samples_used: 5,
      },
      {
        type: "game_over",
        status: "sleep",
        winner: null,
      },
    ],
  },
};
