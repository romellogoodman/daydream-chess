import { parseFen, pieceAsset, colorOf } from "../lib/chess.js";

// The board renderer. Lichess-inspired: brown squares, cburnett pieces,
// minimal edge coordinates, dots for legal destinations, a faint last-move
// highlight. White (human) at the bottom, rank 8 at top.
//
// Props:
//   fen          FEN string to render
//   selected     square name currently selected (white piece), or null
//   destinations Set of legal destination squares to highlight
//   lastMove     { from, to } to softly mark the most recent move
//   onSquare     (square) => void  click handler (no-op when locked)
function Board({
  fen,
  selected = null,
  destinations = new Set(),
  lastMove = null,
  onSquare = () => {},
}) {
  const board = parseFen(fen);

  return (
    <div className="board">
      <div className="board__grid">
        {board.map((row, rankIdx) =>
          row.map((cell, fileIdx) => {
            const isDark = (fileIdx + rankIdx) % 2 === 1;
            const isSelected = cell.square === selected;
            const isDest = destinations.has(cell.square);
            const isLast =
              lastMove &&
              (cell.square === lastMove.from || cell.square === lastMove.to);
            const piece = cell.piece;
            const isCapture = isDest && !!piece;
            const classes = [
              "board__square",
              isDark ? "board__square--dark" : "board__square--light",
              isSelected && "board__square--selected",
              isLast && "board__square--last",
              isCapture && "board__square--capture",
            ]
              .filter(Boolean)
              .join(" ");

            // Lichess-style coordinate tints in the corner squares.
            const file = cell.square[0];
            const rank = cell.square[1];
            const showFile = rankIdx === 7; // bottom edge
            const showRank = fileIdx === 7; // right edge

            return (
              <button
                key={cell.square}
                type="button"
                className={classes}
                onClick={() => onSquare(cell.square)}
                aria-label={cell.square}
              >
                {showRank && (
                  <span className="board__coord board__coord--rank">
                    {rank}
                  </span>
                )}
                {showFile && (
                  <span className="board__coord board__coord--file">
                    {file}
                  </span>
                )}
                {isDest && !piece && (
                  <span className="board__dot" aria-hidden="true" />
                )}
                {piece && (
                  <span
                    className={`board__piece board__piece--${colorOf(piece)}`}
                    style={{ backgroundImage: `url(${pieceAsset(piece)})` }}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default Board;
