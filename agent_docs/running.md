# Running, testing, verifying

Python deps are in a venv at the repo root: `.venv`. Invoke binaries directly
(`.venv/bin/python`, `.venv/bin/uvicorn`, `.venv/bin/pip`) — there is no need to "activate" it.
Node deps install under `web/node_modules`.

## Engine (`server/`)

```bash
# unit + contract tests
.venv/bin/python -m pytest server/ -q

# headless self-game — prints turn records; proves the move loop and the seam with no UI
.venv/bin/python -m server.demo

# run the server (the UI connects to this)
.venv/bin/uvicorn server.app:app --port 8000
# health check: curl http://localhost:8000/health  ->  {"ok": true}
```

The demo drives White with random legal moves and lets the `MockProposer` play Black, printing each
turn's dreams and its wake/sleep outcome. Use it to eyeball proposer behavior after tuning.

## UI (`web/`)

```bash
cd web
npm install        # first time only
npm run dev        # http://localhost:8080, opens the browser
npm run build      # production build (also a good error check)
npm run lint       # eslint
npm run format     # prettier
```

**Demo mode:** if the WebSocket can't connect within ~1.5s, the UI transparently falls back to canned
fixtures (`web/src/lib/fixtures.js`) and shows a small banner. This lets the UI run with no server.
To exercise the real engine, start the server on `:8000` first, then `npm run dev`.

The WebSocket URL comes from `import.meta.env.VITE_WS_URL` (fallback `ws://localhost:8000/ws`).
Copy `web/.env.example` → `web/.env.local` to override.

## Full-stack live check (do this after any change to the seam)

1. Start the engine: `.venv/bin/uvicorn server.app:app --port 8000`.
2. Run a WebSocket round-trip and assert the message shapes match `architecture.md`
   (`new_game` → `state`; `human_move` → `state` + `turn_record`; an illegal move → `move_rejected`).
   A throwaway client using the `websockets` package (ships with `uvicorn[standard]`) is enough.
3. Or: start the UI and play a move; confirm it is **not** in demo mode and the model dreams then wakes.

Unit tests alone do not prove the contract — the two halves were built independently against the spec,
so the round-trip is the real check.

## Animation tuning (UI)

Per-step timings are named constants in `web/src/App.jsx` (`ANIM`): how long each dream board / ghost
arrow is held, the settle gaps, the wake pause. Mock replay pacing is in `web/src/lib/socket.js`. The
central dream→sharp CSS transition lives in `.board` in `web/src/App.scss`.

> Note: at `temperature 0.8`, an opening turn can produce ~10+ dreams (high variance early). That is a
> lot of animation time. Tune via the `MockProposer` base logits in `server/proposer.py` and/or the
> `ANIM` hold durations if turns feel too long.

## Swapping in the real model (later)

When `daydream-chess-nanogpt.pt` exists, add a `ModelProposer` in `server/proposer.py` implementing the
same `sample_move(board, temperature) -> uci` interface (see the `# TODO: ModelProposer` marker), and
select it in `server/game.py`. The engine, the protocol, and the entire UI stay unchanged — that is the
point of the seam.
