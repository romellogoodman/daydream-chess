// Tiny FEN parsing + rendering helpers for daydream-chess.
// NO move generation — the server provides legal_moves. We only parse/render.

// Unicode glyphs. Keyed by FEN char (uppercase = White, lowercase = Black).
const GLYPHS = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

export function glyphFor(piece) {
  return GLYPHS[piece] || "";
}

export function colorOf(piece) {
  if (!piece) return null;
  return piece === piece.toUpperCase() ? "white" : "black";
}

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

// Convert a square name ("e4") to { file, rank } 0-indexed where
// file 0 = 'a' and rank 0 = '8' (top of a White-at-bottom board).
export function squareToCoords(square) {
  const file = FILES.indexOf(square[0]);
  const rank = 8 - parseInt(square[1], 10); // '8' -> row 0, '1' -> row 7
  return { file, rank };
}

export function coordsToSquare(file, rank) {
  return `${FILES[file]}${8 - rank}`;
}

// Parse the piece-placement field of a FEN into an 8x8 array of rows.
// Row 0 is rank 8 (top), row 7 is rank 1 (bottom) — i.e. White at the bottom.
// Each cell is { piece, square } where piece is a FEN char or null.
export function parseFen(fen) {
  const placement = fen.split(" ")[0];
  const rows = placement.split("/");
  const board = [];
  for (let rank = 0; rank < 8; rank++) {
    const cells = [];
    let file = 0;
    for (const char of rows[rank]) {
      if (/\d/.test(char)) {
        const empty = parseInt(char, 10);
        for (let i = 0; i < empty; i++) {
          cells.push({ piece: null, square: coordsToSquare(file, rank) });
          file++;
        }
      } else {
        cells.push({ piece: char, square: coordsToSquare(file, rank) });
        file++;
      }
    }
    board.push(cells);
  }
  return board;
}

// Whose move it is, from the FEN active-color field.
export function turnFromFen(fen) {
  return fen.split(" ")[1] === "w" ? "white" : "black";
}

// Split a uci string into { from, to, promotion }.
export function parseUci(uci) {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : null,
  };
}
