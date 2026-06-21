import { useEffect, useRef } from "react";

// A running move log that populates as the game goes. One line per ply:
// "1.  e2e4  you" / "1…  e7e5  model". Newest lines stay in view.
// TODO: SAN — converting UCI to SAN needs a chess move-gen lib we don't ship.

function GameLog({ entries, thinking, nextPly }) {
  const scrollRef = useRef(null);

  // Keep the latest move (or the pending loader) in view as the log grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, thinking]);

  const empty = entries.length === 0 && !thinking;
  const pendingNo = Math.ceil(nextPly / 2);
  const pendingIsWhite = nextPly % 2 === 1;

  return (
    <div className="log" ref={scrollRef} aria-label="Move log">
      {empty ? (
        <p className="log__empty">No moves yet</p>
      ) : (
        <ol className="log__list">
          {entries.map((e) => {
            const no = Math.ceil(e.ply / 2);
            const isWhite = e.side === "human"; // server sides are human|model
            return (
              <li key={e.ply} className="log__line">
                <span className="log__no">
                  {no}
                  {isWhite ? "." : "…"}
                </span>
                <span className="log__move">{e.uci}</span>
                <img
                  className="log__pawn"
                  src={`/piece/cburnett/${isWhite ? "wP" : "bP"}.svg`}
                  alt={isWhite ? "you" : "model"}
                />
              </li>
            );
          })}
          {thinking && (
            <li className="log__line log__line--pending" aria-live="polite">
              <span className="log__no">
                {pendingNo}
                {pendingIsWhite ? "." : "…"}
              </span>
              <span className="log__move log__dots">
                <i />
                <i />
                <i />
              </span>
              <img
                className="log__pawn"
                src="/piece/cburnett/bP.svg"
                alt="model"
              />
            </li>
          )}
        </ol>
      )}
    </div>
  );
}

export default GameLog;
