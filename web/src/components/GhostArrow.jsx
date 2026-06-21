import { squareToCoords } from "../lib/chess.js";

// A faint ghost arrow drawn over the board from one square to another.
// Used for "phantom" dreams: the model imagined moving a piece that isn't
// there. Coordinates are in board-cell units (0..8) inside an SVG that spans
// the board via a 0..8 viewBox.
function GhostArrow({ from, to }) {
  const a = squareToCoords(from);
  const b = squareToCoords(to);
  // Center of each cell.
  const x1 = a.file + 0.5;
  const y1 = a.rank + 0.5;
  const x2 = b.file + 0.5;
  const y2 = b.rank + 0.5;

  return (
    <svg
      className="ghost-arrow"
      viewBox="0 0 8 8"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <marker
          id="ghost-arrowhead"
          markerWidth="4"
          markerHeight="4"
          refX="2.6"
          refY="2"
          orient="auto"
        >
          <path d="M0,0 L4,2 L0,4 Z" className="ghost-arrow__head" />
        </marker>
      </defs>
      <circle className="ghost-arrow__origin" cx={x1} cy={y1} r="0.32" />
      <line
        className="ghost-arrow__line"
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        markerEnd="url(#ghost-arrowhead)"
      />
    </svg>
  );
}

export default GhostArrow;
