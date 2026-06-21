import { parseFen, glyphFor, colorOf } from "../lib/chess.js";
import GhostArrow from "./GhostArrow.jsx";

// The board renderer. Same markup renders both "sharp" (real) and "dream"
// (dim/hazy/blurred/desaturated) — the look is driven entirely by the `mood`
// modifier in SCSS.
//
// Props:
//   fen          FEN string to render
//   mood         "sharp" | "dream"            (default "sharp")
//   selected     square name currently selected (white piece), or null
//   destinations Set of legal destination squares to highlight
//   lastMove     { from, to } to softly mark the most recent real move
//   phantom      { from, to } to draw a ghost arrow over the board, or null
//   onSquare     (square) => void  click handler (no-op when dreaming/locked)
function Board({
  fen,
  mood = "sharp",
  selected = null,
  destinations = new Set(),
  lastMove = null,
  phantom = null,
  onSquare = () => {},
}) {
  const board = parseFen(fen);

  return (
    <div className={`board board--${mood}`}>
      <div className="board__veil" aria-hidden="true" />
      <div className="board__grid">
        {board.map((row, rankIdx) =>
          row.map((cell) => {
            const isDark = (cell.square.charCodeAt(0) + rankIdx) % 2 === 1;
            const isSelected = cell.square === selected;
            const isDest = destinations.has(cell.square);
            const isLast =
              lastMove &&
              (cell.square === lastMove.from || cell.square === lastMove.to);
            const piece = cell.piece;
            const classes = [
              "board__square",
              isDark ? "board__square--dark" : "board__square--light",
              isSelected && "board__square--selected",
              isDest && "board__square--dest",
              isLast && "board__square--last",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                key={cell.square}
                type="button"
                className={classes}
                onClick={() => onSquare(cell.square)}
                tabIndex={mood === "sharp" ? 0 : -1}
                aria-label={cell.square}
              >
                {isDest && !piece && (
                  <span className="board__dot" aria-hidden="true" />
                )}
                {piece && (
                  <span
                    className={`board__piece board__piece--${colorOf(piece)}`}
                  >
                    {glyphFor(piece)}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
      {phantom && <GhostArrow from={phantom.from} to={phantom.to} />}
    </div>
  );
}

export default Board;
