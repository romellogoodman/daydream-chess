"""Headless self-game demo proving the loop and the contract end-to-end.

Run with:  .venv/bin/python -m server.demo

White is driven by random LEGAL moves; Black is the MockProposer. Each model
turn's turn_record is pretty-printed so you can see the dreams (wrong_board /
phantom) before the wake — or a fail-to-wake (sleep).
"""

from __future__ import annotations

import random

from .game import STATUS_PLAYING, Game

KIND_GLYPH = {
    "woke": "WAKE ",
    "wrong_board": "dream",
    "phantom": "ghost",
}


def _print_turn_record(rec: dict) -> None:
    print(f"\n--- ply {rec['ply']}  (model / Black)  "
          f"temp={rec['temperature']}  cap={rec['cap']} ---")
    for a in rec["attempts"]:
        glyph = KIND_GLYPH.get(a["kind"], a["kind"])
        occ = "own-piece" if a["from_occupied"] else "empty/white"
        print(f"  n={a['n']:2d}  {glyph}  {a['uci']:6s}  "
              f"legal={str(a['legal']):5s}  from={occ}")
    if rec["woke"]:
        print(f"  => WOKE, accepted {rec['accepted']} "
              f"after {rec['samples_used']} sample(s) "
              f"({rec['samples_used'] - 1} dream(s))")
    else:
        print(f"  => FAILED TO WAKE after {rec['samples_used']} sample(s) — sleep")


def main(temperature: float = 0.8, cap: int = 24, max_full_moves: int = 60, seed: int | None = None) -> None:
    rng = random.Random(seed)
    game = Game(temperature=temperature, cap=cap)
    game.new_game()

    print(f"daydream-chess demo — temperature={temperature}, cap={cap}")
    print(f"start FEN: {game.board.fen()}")

    woke_count = 0
    dream_total = 0
    kinds_seen: set[str] = set()

    for _ in range(max_full_moves):
        if game.status() != STATUS_PLAYING:
            break

        # White: random legal move.
        legal = list(game.board.legal_moves)
        if not legal:
            break
        white_move = rng.choice(legal)
        ok, _ = game.apply_human_move(white_move.uci())
        assert ok, "random legal move was rejected?!"
        print(f"\nWhite plays {white_move.uci()}")

        if game.status() != STATUS_PLAYING:
            break

        # Black: model turn.
        rec = game.model_turn()
        _print_turn_record(rec)

        for a in rec["attempts"]:
            kinds_seen.add(a["kind"])
        if rec["woke"]:
            woke_count += 1
            dream_total += rec["samples_used"] - 1
        else:
            break  # sleep — game over

    print("\n========== SUMMARY ==========")
    print(f"final status : {game.status()}")
    print(f"winner       : {game.winner()}")
    print(f"model wakes  : {woke_count}")
    if woke_count:
        print(f"avg dreams/wake at temp {temperature}: {dream_total / woke_count:.2f}")
    print(f"kinds seen   : {sorted(kinds_seen)}")
    print(f"final FEN    : {game.board.fen()}")


if __name__ == "__main__":
    main()
