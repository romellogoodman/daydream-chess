# Architecture & the frozen seam

The three components (`model` → `engine` → `ui`) meet at exactly one place: the **turn record**,
delivered over a small WebSocket message protocol. This document is the authoritative contract.
For the rationale behind these choices, see `docs/Plan.md` §2–§3 and the locked decisions in §4.

> **Frozen.** Changing any field below is a breaking change to both `server/` and `web/`. If you must
> change it, update both halves and re-run the live round-trip in `running.md`.

## Components

- **model** — `daydream-chess-nanogpt`, not yet built. Trained offline on UCI move transcripts;
  emits a single `.pt` checkpoint. The engine loads it through the proposer interface.
- **engine** — `server/`, Python. Holds the proposer and `python-chess`. Runs the move loop,
  validates, classifies each rejected guess, emits turn records. Today the proposer is a `MockProposer`.
- **ui** — `web/`, React + Vite. Consumes turn records and renders the dream/wake animation. Never
  touches engine internals.

Human plays **White**, model plays **Black** (locked, `docs/Plan.md` §4).

## WebSocket protocol

Endpoint: `ws://localhost:8000/ws`. Every message is a JSON object with a `type` field.

### Client → Server
| type | fields | meaning |
|---|---|---|
| `new_game` | `temperature: number`, `cap: int` | Reset to the start position. Human=White, model=Black. |
| `human_move` | `uci: string` | White's move, e.g. `"e2e4"`, promotion `"e7e8q"`. |
| `set_controls` | `temperature: number`, `cap: int` | Update knobs for subsequent model turns. No reply. *(The v1 UI does not send this — it rolls random `temperature`/`cap` per game and passes them in `new_game`. The server still accepts it.)* |

### Server → Client
| type | meaning |
|---|---|
| `state` | Full snapshot. Sent after `new_game`, after each accepted `human_move` (before the model turn), and **after the model turn** (handing the turn back to White) when the game continues. |
| `move_rejected` | White's move was illegal (`{ uci }`); state does not advance, UI retries. |
| `turn_record` | The model's (Black's) turn. The seam object — schema below. |
| `game_over` | Terminal: `{ status, winner }`. `status: "sleep"` ⇔ model failed to wake. |

**Message sequence for one full round** (human move → model reply):
```
human_move  ──►  state (turn: black)        # human's move applied
            ──►  turn_record                # model's guesses + accepted move
            ──►  state (turn: white)         # turn handed back, fresh legal_moves
```
That trailing `state` is required: the `turn_record` alone carries no `legal_moves`, so without it the
UI has no legal moves for White and stays locked. If the model fails to wake, the `turn_record`
(`woke: false`) is followed by `game_over` (`status: "sleep"`) instead of a `state`. If White's own move
ends the game, the first `state` is followed directly by `game_over` and no model turn runs.

`state` shape:
```jsonc
{
  "type": "state",
  "ply": 1,
  "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
  "turn": "white" | "black",
  "legal_moves": ["e7e5", "g8f6", ...],   // UCI legal moves for the side to move; UI validates/highlights with this
  "status": "playing" | "checkmate" | "stalemate" | "insufficient" | "sleep",
  "history": [ { "ply": 1, "side": "human" | "model", "uci": "e2e4", "fen_after": "..." } ]
}
```

`game_over` shape: `{ "type": "game_over", "status": "checkmate"|"stalemate"|"insufficient"|"sleep", "winner": "white"|"black"|null }`.
`winner` is non-null only for checkmate.

## The turn record (the seam object)

One per model turn. The full vision animates `attempts` in order (dreams, then the wake). **The v1 UI
ignores `attempts` and renders only `accepted`** — but the engine still emits the complete record, so
the dream animation can be added later with no contract change.

```jsonc
{
  "type": "turn_record",
  "ply": 7,                       // half-move index of THIS model move
  "side": "model",
  "fen_before": "r1bqkbnr/...",   // true position the model reasons from
  "temperature": 0.8,
  "cap": 24,
  "attempts": [
    { "n": 0, "uci": "f8c5", "legal": false, "kind": "wrong_board", "fen_after": "r1bq.../...", "from_occupied": true },
    { "n": 1, "uci": "e7e5", "legal": false, "kind": "phantom",     "fen_after": null,          "from_occupied": false },
    { "n": 2, "uci": "g8f6", "legal": true,  "kind": "woke",        "fen_after": "r1bqkb1r/...", "from_occupied": true }
  ],
  "accepted": "g8f6",             // uci of the legal move, or null if failed to wake
  "woke": true,                   // false ⇒ turn died, game ends in sleep
  "samples_used": 3
}
```

Rules:
- `attempts` is ordered by sample index `n` (0-based). If `woke`, the **last** attempt is the accepted
  move with `kind: "woke"`.
- `accepted: null` + `woke: false` is the fail-to-wake ending. It is a terminal state, not an error.
  The engine sends the failing `turn_record`, then `game_over` with `status: "sleep"`.

## Render tiers — classification (engine owns this; UI only reads `kind`)

- **`woke`** — the move is legal in the real position. The move that actually happens.
- **`wrong_board`** — illegal, *but* the from-square holds one of the model's own (Black) pieces, so
  the move can be **force-applied** (move that piece to the destination ignoring legality) into a
  coherent but wrong `fen_after`. `from_occupied: true`. These are the legible false beliefs — the
  beautiful ones.
- **`phantom`** — illegal *and* not force-applyable: the from-square is empty or holds a White piece
  (the model imagined a piece that isn't its own / isn't there). `fen_after: null`; the UI draws a
  ghost arrow instead of a board. `from_occupied: false`.

Engine notes for `wrong_board` FENs: force-applied FENs set side-to-move to White and clear
castling/en-passant rights (meaningless in an illegal position) so every FEN is unambiguously
parseable by `chess.Board(fen)`. Malformed UCI is treated defensively as `phantom`, never a crash.

## The temperature/cap dynamic (why temperature must be > 0)

Each resample draws independently from the *same* context; variety comes only from temperature
(`docs/Plan.md` §6.2). At `temperature ≈ 0` the proposer returns the same move every time — if that
move is illegal, the cap is guaranteed to be hit and the turn always sleeps. Higher temperature widens
the dream halo. The UI enforces a slider floor of 0.3. The `MockProposer` reproduces this with
temperature-scaled softmax over move logits (legal > wrong_board > phantom base preference).
