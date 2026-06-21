import { useState } from "react";

// The exhibitable artifact: a running record of the real game. Each model turn
// shows the accepted move and, collapsibly, the dreams that preceded it — the
// moves it almost made. Labeling leans a little poetic.

const KIND_LABEL = {
  wrong_board: "dreamed a board that wasn't there",
  phantom: "reached for a piece that wasn't there",
  woke: "woke, and played",
};

function MoveNumber({ ply }) {
  const moveNo = Math.ceil(ply / 2);
  const isWhite = ply % 2 === 1;
  return (
    <span className="game-log__move-no">
      {moveNo}
      {isWhite ? "." : "…"}
    </span>
  );
}

function DreamList({ attempts }) {
  const dreams = attempts.filter((a) => a.kind !== "woke");
  if (dreams.length === 0) return null;
  return (
    <ol className="game-log__dreams">
      {dreams.map((a) => (
        <li key={a.n} className={`game-log__dream game-log__dream--${a.kind}`}>
          <span className="game-log__dream-uci">{a.uci}</span>
          <span className="game-log__dream-kind">{KIND_LABEL[a.kind]}</span>
        </li>
      ))}
    </ol>
  );
}

function ModelEntry({ entry }) {
  const [open, setOpen] = useState(false);
  const dreamCount = entry.attempts.filter((a) => a.kind !== "woke").length;
  const woke = entry.woke;

  return (
    <li className="game-log__entry game-log__entry--model">
      <MoveNumber ply={entry.ply} />
      <div className="game-log__body">
        <button
          type="button"
          className="game-log__accepted"
          onClick={() => dreamCount > 0 && setOpen((o) => !o)}
          aria-expanded={open}
          data-has-dreams={dreamCount > 0}
        >
          <span className="game-log__uci">
            {woke ? entry.accepted : "never woke"}
          </span>
          {dreamCount > 0 && (
            <span className="game-log__dream-badge">
              {open ? "hide" : "see"} {dreamCount}{" "}
              {dreamCount === 1 ? "dream" : "dreams"}
            </span>
          )}
        </button>
        {open && <DreamList attempts={entry.attempts} />}
      </div>
    </li>
  );
}

function HumanEntry({ entry }) {
  return (
    <li className="game-log__entry game-log__entry--human">
      <MoveNumber ply={entry.ply} />
      <div className="game-log__body">
        <span className="game-log__uci">{entry.uci}</span>
      </div>
    </li>
  );
}

function GameLog({ entries }) {
  return (
    <section className="game-log" aria-label="Game record">
      <h2 className="game-log__title">the record</h2>
      {entries.length === 0 ? (
        <p className="game-log__empty">Nothing has happened yet.</p>
      ) : (
        <ol className="game-log__list">
          {entries.map((entry) =>
            entry.side === "model" ? (
              <ModelEntry key={entry.ply} entry={entry} />
            ) : (
              <HumanEntry key={entry.ply} entry={entry} />
            )
          )}
        </ol>
      )}
    </section>
  );
}

export default GameLog;
