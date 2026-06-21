# daydream-chess

A live, local web app. You play **White** against a tiny GPT that plays **Black**. The model is
trained only on game transcripts and never sees a board, so it *guesses* moves by sampling. A
validator accepts the first legal guess; every rejected guess is rendered as a dim **"dream"** board
— a wrong picture of the position — before the accepted move **"wakes"** to full sharpness. If no
legal move is found within the resample `cap`, the turn fails to wake and the game ends in **"sleep."**
The wrong boards are the content of the piece, not an error to hide.

**The model does not exist yet.** The engine runs against a `MockProposer` (a UCI sampler with real
`python-chess` validation) standing in for it behind a clean interface. The real checkpoint swaps in
later by replacing the proposer — nothing else changes. So most work today is on the engine and UI.

## Architecture — three parts, one seam

```
model (daydream-chess-nanogpt, NOT BUILT)  →  engine (server/, Python)  →  ui (web/, React)
        emits a .pt checkpoint                 proposer + validator           consumes turn
                                               + turn-record emitter          records, renders
                                               over a WebSocket               dream / wake
```

The three parts are coupled **only** through the **turn record**, carried over a WebSocket message
protocol. **This contract is frozen.** Read `agent_docs/architecture.md` before changing anything that
crosses the seam. The UI must never reach into engine internals, and the engine must never assume how
the UI renders.

## Where things live

- `server/` — Python engine. `engine.py` (pure logic: classify + move loop), `proposer.py`
  (`MockProposer` + the seam where the real model loads), `game.py` (board + history + status),
  `app.py` (FastAPI `/ws`), `demo.py` (headless self-game), `test_engine.py`.
- `web/` — React 19 + Vite frontend. Frontend conventions live in `web/CLAUDE.md`. The animation
  engine and orchestration are in `web/src/App.jsx`; demo-mode fixtures in `web/src/lib/`.
- `docs/Plan.md` — the design runbook: the WHY, and the **locked decisions**. Read it before
  proposing architectural changes; do not re-litigate anything marked locked.
- `agent_docs/` — operational how-to (read the relevant file before working):
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
See `agent_docs/running.md`.

## Conventions

- `python-chess` is the single source of truth for legality. Do not reimplement chess rules in the UI.
- The engine owns move classification (`woke` / `wrong_board` / `phantom`); the UI only reads `kind`.
  Keep that logic on the engine side of the seam.
- Linting/formatting are handled by tools (Python: keep it simple; web: eslint + prettier) — don't
  hand-police style.
