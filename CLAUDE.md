# daydream-chess

A live, local web app. You play **White** against a tiny GPT that plays **Black**. The model is
trained only on game transcripts and never sees a board, so it *guesses* moves by sampling. A
validator (`python-chess`) accepts the first legal guess and rejects the rest. The engine classifies
each rejected guess (`wrong_board` / `phantom`) and includes them in the turn record. If no legal move
is found within the resample `cap`, the turn fails to wake and the game ends in **"sleep."**

**Current build vs. the Plan.** The full vision (`docs/Plan.md`) renders the rejected guesses as dim
**"dream"** boards before the accepted move **"wakes"** to sharpness. The v1 UI deliberately **drops
the dream/wake animation for now**: it renders only the accepted move on a clean, Lichess-style board
and shows the game as a move log. The engine still emits full turn records (dreams included), so the
animation can return later with no contract change. Temperature/cap are **no longer user controls** —
each new game rolls them randomly on the client.

**The model does not exist yet.** The engine runs against a `MockProposer` (a UCI sampler with real
`python-chess` validation) standing in for it behind a clean interface. The real checkpoint swaps in
later by replacing the proposer — nothing else changes. So most work today is on the engine and UI.

## Architecture — three parts, one seam

```
model (daydream-chess-nanogpt, NOT BUILT)  →  engine (server/, Python)  →  ui (web/, React)
        emits a .pt checkpoint                 proposer + validator           consumes turn
                                               + turn-record emitter          records; renders
                                               over a WebSocket               board + move log
```

The three parts are coupled **only** through the **turn record**, carried over a WebSocket message
protocol. **This contract is frozen.** Read `docs/architecture.md` before changing anything that
crosses the seam. The UI must never reach into engine internals, and the engine must never assume how
the UI renders.

## Where things live

- `server/` — Python engine. `engine.py` (pure logic: classify + move loop), `proposer.py`
  (`MockProposer` + the seam where the real model loads), `game.py` (board + history + status),
  `app.py` (FastAPI `/ws`), `demo.py` (headless self-game), `test_engine.py`.
- `web/` — React 19 + Vite frontend. Frontend conventions live in `web/CLAUDE.md`. Orchestration is in
  `web/src/App.jsx`; board/log/components in `web/src/components/`; the WS client + demo fixtures in
  `web/src/lib/`. cburnett SVG pieces (Lichess, GPL) live in `web/public/piece/cburnett/`.
- `docs/` — design and operational docs (read the relevant file before working):
  - `Plan.md` — the design runbook: the WHY, and the **locked decisions**. Read before proposing
    architectural changes; do not re-litigate anything marked locked.
  - `architecture.md` — the frozen seam: WebSocket protocol, turn-record schema, render tiers.
  - `running.md` — run, test, and verify each half and the full stack; how to swap in the real model.

## How to run / verify

Python deps live in a venv at `.venv` (use `.venv/bin/python`, `.venv/bin/uvicorn` directly).

- Engine tests: `.venv/bin/python -m pytest server/ -q`
- Engine demo (headless, proves the loop & contract): `.venv/bin/python -m server.demo`
- Engine server: `.venv/bin/uvicorn server.app:app --port 8000`
- UI: `cd web && npm install && npm run dev` (port 8080; auto-falls back to **demo mode** if no server)
- Full stack (one command): `./run.sh` — starts the engine on `:8000`, waits for it, then opens the UI
  on `:8080` connected live. Ctrl-C stops both; `OPEN=0 ./run.sh` skips opening the browser.

When you change anything on the seam, verify it with a real WebSocket round-trip, not only unit tests.
See `docs/running.md`.

## Conventions

- `python-chess` is the single source of truth for legality. Do not reimplement chess rules in the UI.
- The engine owns move classification (`woke` / `wrong_board` / `phantom`); the UI only reads `kind`.
  Keep that logic on the engine side of the seam. (The v1 UI currently ignores `attempts`/dreams and
  renders only `accepted`; the engine still emits them.)
- Game history uses `side: "human" | "model"` (not `"white" | "black"`) — human is White, model is
  Black. The UI keys White off `side === "human"`.
- The UI no longer sends `set_controls`; it picks random `temperature`/`cap` per game and passes them
  in `new_game`. The server still accepts `set_controls` for future use.
- Linting/formatting are handled by tools (Python: keep it simple; web: eslint + prettier) — don't
  hand-police style.
