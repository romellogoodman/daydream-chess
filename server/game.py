"""Game state holder for daydream-chess.

One ``Game`` per connection. Human plays White, the model plays Black. The
class wraps a ``chess.Board`` plus history/controls and exposes the small set of
operations the WebSocket layer needs.
"""

from __future__ import annotations

from typing import Optional

import chess

from .engine import classify, history_entry, play_model_turn
from .proposer import MockProposer, Proposer

# Status enum values per the contract.
STATUS_PLAYING = "playing"
STATUS_CHECKMATE = "checkmate"
STATUS_STALEMATE = "stalemate"
STATUS_INSUFFICIENT = "insufficient"
STATUS_SLEEP = "sleep"


class Game:
    def __init__(self, temperature: float = 0.8, cap: int = 24, proposer: Optional[Proposer] = None):
        self.temperature = temperature
        self.cap = cap
        # A fresh proposer per game so each game's jitter (and thus dream flavour)
        # differs. Allow injection for tests / future ModelProposer.
        self._proposer: Proposer = proposer if proposer is not None else MockProposer()
        self.board = chess.Board()
        self.history: list[dict] = []
        self._slept = False  # set when the model failed to wake

    # ----- lifecycle -------------------------------------------------------

    def new_game(self, temperature: Optional[float] = None, cap: Optional[int] = None) -> dict:
        """Reset to the start position. Optionally update controls."""
        if temperature is not None:
            self.temperature = temperature
        if cap is not None:
            self.cap = cap
        self.board = chess.Board()
        self.history = []
        self._slept = False
        # Fresh proposer → fresh per-game jitter seed.
        self._proposer = MockProposer()
        return self.state()

    def set_controls(self, temperature: Optional[float] = None, cap: Optional[int] = None) -> None:
        if temperature is not None:
            self.temperature = temperature
        if cap is not None:
            self.cap = cap

    # ----- moves -----------------------------------------------------------

    def apply_human_move(self, uci: str) -> tuple[bool, Optional[dict]]:
        """Apply White's move. Returns (ok, state) — state is None if rejected."""
        try:
            move = chess.Move.from_uci(uci)
        except (ValueError, chess.InvalidMoveError):
            return False, None
        if move not in self.board.legal_moves:
            return False, None
        self.board.push(move)
        self.history.append(
            history_entry(self.board.ply(), "human", uci, self.board.fen())
        )
        return True, self.state()

    def model_turn(self) -> dict:
        """Compute Black's turn via the resample loop. Returns the turn_record.

        On a wake the accepted move is pushed onto the board and recorded in
        history. On a fail-to-wake the board is left untouched and the game
        enters the ``sleep`` status.
        """
        ply = self.board.ply() + 1
        record = play_model_turn(
            self.board, self._proposer, self.temperature, self.cap, ply
        )
        if record["woke"]:
            self.history.append(
                history_entry(self.board.ply(), "model", record["accepted"], self.board.fen())
            )
        else:
            self._slept = True
        return record

    # ----- introspection ---------------------------------------------------

    def status(self) -> str:
        """Map the current board (and sleep flag) to the status enum."""
        if self._slept:
            return STATUS_SLEEP
        if self.board.is_checkmate():
            return STATUS_CHECKMATE
        if self.board.is_stalemate():
            return STATUS_STALEMATE
        if self.board.is_insufficient_material():
            return STATUS_INSUFFICIENT
        return STATUS_PLAYING

    def winner(self) -> Optional[str]:
        """Winner for a game_over message: only checkmate has one."""
        if self.board.is_checkmate():
            # The side to move is checkmated → the other side won.
            return "white" if self.board.turn == chess.BLACK else "black"
        return None

    def state(self) -> dict:
        turn = "white" if self.board.turn == chess.WHITE else "black"
        return {
            "type": "state",
            "ply": self.board.ply(),
            "fen": self.board.fen(),
            "turn": turn,
            "legal_moves": [m.uci() for m in self.board.legal_moves],
            "status": self.status(),
            "history": self.history,
        }
