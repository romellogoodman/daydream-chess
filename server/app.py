"""FastAPI app exposing the daydream-chess WebSocket protocol.

Endpoint: ``ws://localhost:8000/ws``. One :class:`Game` per connection.
See the frozen contract for message shapes. Also serves ``GET /health``.
"""

from __future__ import annotations

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .game import STATUS_PLAYING, Game

app = FastAPI(title="daydream-chess engine")

# Permissive CORS — not needed for WS but harmless, and lets future HTTP probes
# (and the /health check) work from any origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"ok": True}


def _game_over_msg(game: Game) -> dict | None:
    """Build a game_over message if the game has ended, else None."""
    status = game.status()
    if status == STATUS_PLAYING:
        return None
    return {"type": "game_over", "status": status, "winner": game.winner()}


async def _run_model_turn(ws: WebSocket, game: Game) -> None:
    """Compute Black's turn, send the turn_record, then either game_over or a
    fresh state handing the turn back to White."""
    record = game.model_turn()
    await ws.send_json(record)
    over = _game_over_msg(game)
    if over is not None:
        # sleep is sent AFTER the failing turn_record (handled here since the
        # record was just sent above).
        await ws.send_json(over)
    else:
        # Hand the turn back to White: the UI needs turn + fresh legal_moves.
        await ws.send_json(game.state())


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    game = Game()
    try:
        while True:
            msg = await ws.receive_json()
            mtype = msg.get("type")

            if mtype == "new_game":
                state = game.new_game(
                    temperature=msg.get("temperature"),
                    cap=msg.get("cap"),
                )
                await ws.send_json(state)

            elif mtype == "set_controls":
                game.set_controls(
                    temperature=msg.get("temperature"),
                    cap=msg.get("cap"),
                )
                # No state echo required by the contract for set_controls.

            elif mtype == "human_move":
                ok, state = game.apply_human_move(msg.get("uci", ""))
                if not ok:
                    await ws.send_json({"type": "move_rejected", "uci": msg.get("uci", "")})
                    continue
                # Send state (BEFORE computing the model turn).
                await ws.send_json(state)
                # If White's move ended the game, report and skip the model turn.
                over = _game_over_msg(game)
                if over is not None:
                    await ws.send_json(over)
                    continue
                # Otherwise compute and send Black's turn.
                await _run_model_turn(ws, game)

            else:
                await ws.send_json({"type": "error", "message": f"unknown type: {mtype!r}"})

    except WebSocketDisconnect:
        return
