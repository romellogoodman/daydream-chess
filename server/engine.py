"""Pure, headless engine logic for daydream-chess.

No FastAPI here on purpose: everything in this module operates on a
``chess.Board`` and plain dicts so it can be unit-tested and reused.

The two public entry points are :func:`classify` (turn one UCI string into an
attempt dict) and :func:`play_model_turn` (run the resample loop and build the
full ``turn_record`` dict described in the contract).
"""

from __future__ import annotations

from typing import Optional

import chess


# Attempt "kind" classifications (see contract §3).
KIND_WOKE = "woke"
KIND_WRONG_BOARD = "wrong_board"
KIND_PHANTOM = "phantom"


def _force_apply_fen(board: chess.Board, move: chess.Move) -> str:
    """Build a coherent-but-illegal FEN for a ``wrong_board`` dream.

    We directly edit a copy of the piece map: clear the from-square, drop the
    moving piece on the to-square (capturing whatever sat there, including the
    model's own pieces). Promotions place the promoted piece instead.

    Side-to-move is forced to White so the dream board reads as "Black just
    moved" — exactly how a real, legal Black move would leave the position.
    """
    dream = board.copy(stack=False)
    piece = dream.piece_at(move.from_square)

    dream.remove_piece_at(move.from_square)
    if move.promotion is not None:
        piece = chess.Piece(move.promotion, piece.color)
    dream.set_piece_at(move.to_square, piece)

    # The dream is "Black just moved" → White to move. Castling/en-passant
    # rights are meaningless for an illegal position, so clear them to keep the
    # FEN clean and unambiguously parseable.
    dream.turn = chess.WHITE
    dream.clear_stack()
    dream.castling_rights = chess.BB_EMPTY
    dream.ep_square = None
    return dream.fen()


def classify(board: chess.Board, uci: str) -> dict:
    """Classify one proposed UCI move against the real ``board``.

    Returns an attempt dict (without ``n``, which the caller assigns):
    ``{uci, legal, kind, fen_after, from_occupied}``.

    Defensive: a UCI string that does not parse is treated as a phantom rather
    than raising.
    """
    # Malformed / unparseable UCI → phantom (the model imagined nonsense).
    try:
        move = chess.Move.from_uci(uci)
    except (ValueError, chess.InvalidMoveError):
        return {
            "uci": uci,
            "legal": False,
            "kind": KIND_PHANTOM,
            "fen_after": None,
            "from_occupied": False,
        }

    if move in board.legal_moves:
        applied = board.copy(stack=False)
        applied.push(move)
        return {
            "uci": uci,
            "legal": True,
            "kind": KIND_WOKE,
            "fen_after": applied.fen(),
            "from_occupied": True,
        }

    # Illegal. Is it force-applyable? Only if the from-square holds one of the
    # model's OWN (Black) pieces.
    piece = board.piece_at(move.from_square)
    if piece is not None and piece.color == chess.BLACK:
        return {
            "uci": uci,
            "legal": False,
            "kind": KIND_WRONG_BOARD,
            "fen_after": _force_apply_fen(board, move),
            "from_occupied": True,
        }

    # From-square empty or holds a White piece → phantom.
    return {
        "uci": uci,
        "legal": False,
        "kind": KIND_PHANTOM,
        "fen_after": None,
        "from_occupied": False,
    }


def history_entry(ply: int, side: str, uci: str, fen_after: str) -> dict:
    """Build one history list entry per the contract's `state.history` shape."""
    return {"ply": ply, "side": side, "uci": uci, "fen_after": fen_after}


def play_model_turn(
    board: chess.Board,
    proposer,
    temperature: float,
    cap: int,
    ply: int,
) -> dict:
    """Run the resample loop for the model's (Black's) turn.

    Samples up to ``cap`` proposals; accepts the FIRST legal one and pushes it
    onto ``board``. Rejected proposals become "dream" attempts. If nothing legal
    arrives within ``cap`` samples the turn fails to wake.

    Returns the ``turn_record`` dict (contract §3). Mutates ``board`` only when
    the turn wakes (the accepted move is pushed).
    """
    fen_before = board.fen()
    attempts: list[dict] = []

    for n in range(cap):
        uci = proposer.sample_move(board, temperature)
        attempt = classify(board, uci)
        attempt = {"n": n, **attempt}
        attempts.append(attempt)

        if attempt["legal"]:
            board.push(chess.Move.from_uci(uci))
            return {
                "type": "turn_record",
                "ply": ply,
                "side": "model",
                "fen_before": fen_before,
                "temperature": temperature,
                "cap": cap,
                "attempts": attempts,
                "accepted": uci,
                "woke": True,
                "samples_used": len(attempts),
            }

    # Exhausted the cap without a legal move → failed to wake (sleep).
    return {
        "type": "turn_record",
        "ply": ply,
        "side": "model",
        "fen_before": fen_before,
        "temperature": temperature,
        "cap": cap,
        "attempts": attempts,
        "accepted": None,
        "woke": False,
        "samples_used": len(attempts),
    }
