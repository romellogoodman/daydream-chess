"""Pytest tests for the engine + proposer."""

from __future__ import annotations

import chess

from .engine import (
    KIND_PHANTOM,
    KIND_WOKE,
    KIND_WRONG_BOARD,
    classify,
    play_model_turn,
)
from .proposer import Proposer


# --- classify ----------------------------------------------------------------


def test_classify_woke_legal_move():
    """A legal opening move classifies as woke with a valid fen_after."""
    board = chess.Board()
    # White to move at start; e2e4 is legal.
    attempt = classify(board, "e2e4")
    assert attempt["legal"] is True
    assert attempt["kind"] == KIND_WOKE
    assert attempt["from_occupied"] is True
    # fen_after must be a valid, parseable FEN.
    chess.Board(attempt["fen_after"])


def test_classify_wrong_board_force_apply():
    """An illegal move from a Black-occupied square is a force-applyable dream."""
    board = chess.Board()  # start; Black pieces on rank 8 / 7.
    # b8 holds the black knight. b8b5 is illegal but force-applyable.
    attempt = classify(board, "b8b5")
    assert attempt["legal"] is False
    assert attempt["kind"] == KIND_WRONG_BOARD
    assert attempt["from_occupied"] is True
    assert attempt["fen_after"] is not None
    # The forced FEN must parse and actually have the knight moved.
    dream = chess.Board(attempt["fen_after"])
    assert dream.piece_at(chess.B8) is None
    moved = dream.piece_at(chess.B5)
    assert moved is not None and moved.piece_type == chess.KNIGHT and moved.color == chess.BLACK


def test_classify_wrong_board_promotion():
    """Force-applying a promotion places the promoted piece."""
    # Black pawn on a2, but it's WHITE's turn → a2a1q is illegal-for-black yet
    # force-applyable (from-square holds a Black piece).
    board = chess.Board("4k3/8/8/8/8/8/p7/4K3 w - - 0 1")
    attempt = classify(board, "a2a1q")
    assert attempt["kind"] == KIND_WRONG_BOARD
    dream = chess.Board(attempt["fen_after"])
    promoted = dream.piece_at(chess.A1)
    assert promoted is not None and promoted.piece_type == chess.QUEEN and promoted.color == chess.BLACK


def test_classify_phantom_empty_from_square():
    """An illegal move from an empty square is a phantom (no fen_after)."""
    board = chess.Board()
    # e4 is empty at the start; e4e5 is a phantom.
    attempt = classify(board, "e4e5")
    assert attempt["legal"] is False
    assert attempt["kind"] == KIND_PHANTOM
    assert attempt["from_occupied"] is False
    assert attempt["fen_after"] is None


def test_classify_phantom_white_piece():
    """Moving a White (opponent) piece is a phantom, not force-applyable."""
    board = chess.Board()
    # e2 holds a WHITE pawn; the model (Black) can't claim it.
    attempt = classify(board, "e2e3")  # legal for white, but treat board as-is...
    # Note: at start it's White's turn so e2e3 is actually legal → woke.
    # Use a Black-to-move position to make e2e3 illegal-for-black.
    board = chess.Board("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1")
    attempt = classify(board, "e2e4")  # white pawn, black to move → phantom
    assert attempt["legal"] is False
    assert attempt["kind"] == KIND_PHANTOM
    assert attempt["from_occupied"] is False
    assert attempt["fen_after"] is None


def test_classify_malformed_uci_is_phantom():
    """A malformed UCI string is handled as a phantom, not a crash."""
    board = chess.Board()
    for bad in ["", "xyz", "z9z9", "e2", "notamove"]:
        attempt = classify(board, bad)
        assert attempt["kind"] == KIND_PHANTOM
        assert attempt["fen_after"] is None
        assert attempt["from_occupied"] is False


# --- play_model_turn ---------------------------------------------------------


class _FixedIllegalProposer:
    """Always proposes the same illegal (phantom) move → never wakes."""

    def sample_move(self, board: chess.Board, temperature: float) -> str:
        return "e4e5"  # e4 empty at the start position → phantom every time


class _SequenceProposer:
    """Proposes a fixed sequence of moves to exercise mixed attempts."""

    def __init__(self, moves):
        self._moves = list(moves)
        self._i = 0

    def sample_move(self, board: chess.Board, temperature: float) -> str:
        uci = self._moves[min(self._i, len(self._moves) - 1)]
        self._i += 1
        return uci


def test_play_model_turn_fail_to_wake():
    """When the proposer's move is always illegal, the turn fails to wake."""
    board = chess.Board()
    cap = 8
    rec = play_model_turn(board, _FixedIllegalProposer(), temperature=0.0, cap=cap, ply=1)
    assert rec["woke"] is False
    assert rec["accepted"] is None
    assert rec["samples_used"] == cap
    assert len(rec["attempts"]) == cap
    # Board must be unchanged (nothing pushed).
    assert board.fen() == chess.Board().fen()


def test_turn_record_keys_and_attempt_ordering():
    """turn_record has all required keys; attempts ordered with correct n."""
    board = chess.Board()
    # b8 black knight: b8b5 (wrong_board), e7e6/g8f6 are not Black's turn at start...
    # Use a Black-to-move position so a legal Black move exists to wake on.
    board = chess.Board("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1")
    # Sequence: phantom, wrong_board, then a legal black move (g8f6) to wake.
    proposer = _SequenceProposer(["e4e5", "b8b5", "g8f6"])
    rec = play_model_turn(board, proposer, temperature=0.5, cap=10, ply=1)

    required = {
        "type", "ply", "side", "fen_before", "temperature", "cap",
        "attempts", "accepted", "woke", "samples_used",
    }
    assert required.issubset(rec.keys())
    assert rec["type"] == "turn_record"
    assert rec["side"] == "model"
    assert rec["woke"] is True
    assert rec["accepted"] == "g8f6"
    assert rec["samples_used"] == 3
    # Ordering: n is 0-based and contiguous.
    assert [a["n"] for a in rec["attempts"]] == [0, 1, 2]
    # Kinds in expected order.
    assert rec["attempts"][0]["kind"] == KIND_PHANTOM
    assert rec["attempts"][1]["kind"] == KIND_WRONG_BOARD
    assert rec["attempts"][2]["kind"] == KIND_WOKE
    # Last attempt is the accepted move.
    assert rec["attempts"][-1]["uci"] == rec["accepted"]


# --- MockProposer temperature dynamics --------------------------------------


def test_mock_proposer_low_temp_is_deterministic():
    """At temperature≈0 the MockProposer returns the same move every resample."""
    from .proposer import MockProposer

    board = chess.Board()
    mp = MockProposer(seed=12345)
    picks = {mp.sample_move(board, temperature=1e-6) for _ in range(20)}
    assert len(picks) == 1  # locked onto a single top move


def test_mock_proposer_satisfies_protocol():
    """MockProposer is a structural Proposer."""
    from .proposer import MockProposer

    assert isinstance(MockProposer(seed=1), Proposer)
