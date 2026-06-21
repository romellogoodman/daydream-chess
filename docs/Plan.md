# daydream-chess

A playable chess opponent that thinks out loud. You play White. On Black's turn a small GPT — trained only on game transcripts, never shown a board — proposes moves by sampling. A validator accepts the first legal one and rejects the rest. The rejected moves are not hidden the way every chess program hides them. They are rendered: each illegal proposal becomes a dim, hazy "dream" board, a wrong picture of where the pieces are. The accepted move snaps to full sharpness — the model "wakes." If it cannot find a legal move within the resample cap, the turn fails to wake and the game ends in sleep.

The model has no concept of a rule. It emits what *resembles* a continuation under pattern-pressure, and the validator is the wall it walks into until it stumbles through a door. The dreams are the content. The legal game is the repetition; the wrong boards leaking out of it are the individuality.

This document is the build runbook. It specifies two artifacts: the repo (`daydream-chess`) and the model inside it (`daydream-chess-nanogpt`). It is written to be handed to a coding agent.

---

## 1. What this is and is not

It **is** a local, live, playable web app. You run a script, a browser opens, you play. The sampling happens as you play — nothing is precomputed.

It is **not** Small Hours. Small Hours precomputes every poem offline and ships a static JSON; the model never serves a live request. daydream-chess is the inverse: the model *must* run live, because watching it sample in real time is the entire piece. That single fact forces a different architecture (a local server, not a static site).

It is **not** trying to be Stockfish. The opponent plays at amateur strength and blunders like a person. That is correct and wanted — a perfect engine has boring dreams.

---

## 2. Architecture: three decoupled parts, one seam

The same discipline as Small Hours: components are coupled only through an explicit data contract, never through shared internals.

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  daydream-chess-     │     │  engine              │     │  ui             │
│  nanogpt             │     │  (proposer +         │     │  (dream/wake    │
│                      │ ──▶ │   validator +        │ ──▶ │   render)       │
│  trained once,       │     │   turn-record        │     │                 │
│  offline. emits      │     │   emitter)           │     │  consumes turn  │
│  a checkpoint.       │     │                      │     │  records only.  │
└─────────────────────┘     └──────────────────────┘     └─────────────────┘
        weights                  python-chess +              browser, two
                                 the move loop               board renderers
```

The model never touches the UI. The UI never touches the model. They meet at one place: **the turn record** (§3). Get that contract right and the three parts can be built, swapped, and tested independently.

---

## 3. The seam: the turn record

Every turn the model plays produces exactly one turn record. This is the only object that crosses from engine to UI. Define it first; everything else conforms to it.

```jsonc
{
  "ply": 7,                       // half-move index in the real game
  "side": "model",                // always "model" for records the UI animates
  "fen_before": "r1bqkbnr/...",   // true position the model is reasoning from
  "temperature": 0.8,             // sampling temp used this turn
  "cap": 24,                      // resample budget for this turn
  "attempts": [
    {
      "n": 0,                     // sample index, 0-based
      "uci": "f8c5",              // the proposed move, raw from the model
      "legal": false,
      "kind": "wrong_board",      // see render tiers, §6.3
      "fen_after": "r1bq...",     // force-applied dream board, or null
      "from_occupied": true       // was the from-square actually occupied?
    },
    {
      "n": 1,
      "uci": "e7e5",
      "legal": false,
      "kind": "phantom",          // moved a piece that isn't there
      "fen_after": null,
      "from_occupied": false
    },
    {
      "n": 2,
      "uci": "g8f6",
      "legal": true,
      "kind": "woke",
      "fen_after": "r1bqkb1r/...",
      "from_occupied": true
    }
  ],
  "accepted": "g8f6",             // uci of the legal move, or null if failed to wake
  "woke": true,                   // false => turn died, game ends in sleep
  "samples_used": 3
}
```

Notes that the agent must respect:

- `attempts` is ordered. The UI animates them in order: dream, dream, …, wake. The final attempt is the accepted move iff `woke` is true.
- `fen_after` is **null** when the dream cannot be drawn as a board (a phantom piece — see §6.3). The UI falls back to a ghost annotation in that case.
- `accepted: null` + `woke: false` is the fail-to-wake ending. The UI must handle it as a terminal state, not an error.

The human's own moves do not need full turn records — they are always legal and real. A minimal `{ply, side: "human", uci, fen_after}` is enough for the log.

---

## 4. Locked decisions

These are settled. Rationale included so the agent does not re-litigate them.

**Tokenization: move-level, fixed UCI vocabulary.** The vocab is the full set of from-square × to-square × promotion combinations (~1968 tokens) plus a game-start token. Every token the model can emit is a *syntactically* valid move. Therefore every rejection is a *position* error — moving a pinned piece, capturing your own piece, moving into check, moving the wrong color, moving a piece that isn't there. Each rejected board is a coherent wrong-belief about the position, which is exactly the "tracking a board and getting it wrong" phenomenon the piece is about. This also keeps sequences short (a full game is ~80–150 tokens) and the validator trivial.

  - Char-level tokenization is the alternative — it would let the model emit malformed strings (typos, broken grammar), a wilder dream halo. It is deferred as a possible second model ("delirium mode"), not the v1. Reason: char-level mixes two kinds of failure (grammar errors and board errors) and muddies the thesis, trains slower, and needs a 4× longer block size.

**The model plays Black, the human plays White, for v1.** One less thing to configure. Color choice can come later.

**Architecture is a local server, not a static site.** Sampling is live, so the model must run at play time. A Python backend co-locates the proposer (PyTorch) and the validator (`python-chess`) in one process, which is the whole engine. The browser is a thin client talking to `localhost`. A static browser-inference build (ONNX + chess.js) is a *future* shippable-site path, parallel to how Small Hours deploys — noted in §9, not built now.

**Fail-to-wake is real.** When the resample cap is exceeded the turn dies and the game ends in sleep — not checkmate, not resignation, something closer to aphasia. The model failed to guess its way to a legal sentence. This is the honest ending and it is the default behavior, not an edge case to paper over.

**Temperature and cap are exposed knobs.** Defaults: temperature 0.8, cap 24. Both surface in the UI (§6.4).

---

## 5. Component 1 — daydream-chess-nanogpt (the model)

Trained once, offline, on the M5 (MPS backend, `compile=False`). Emits a single checkpoint the engine loads.

### 5.1 Corpus

Source: Lichess monthly PGN dumps (`database.lichess.org`). These are enormous; you need a subset.

Pipeline (scripted, deterministic — no LLM in this path):

1. Stream-parse the PGN with `python-chess`.
2. Keep standard games only (no variants), with a clean result, between ~10 and ~120 ply.
3. **Elo filter — open fork, see below.** Default band: both players rated 1200–1800.
4. Convert each game to a UCI move sequence: `<g> e2e4 e7e5 g1f3 ...`.
5. Shard to a target of ~200k–1M games. Start at 200k for the Tier-1 model; scale up only if play quality demands it.
6. Tokenize against the fixed UCI vocab. Write `train.bin` / `val.bin` in nanoGPT's flat-uint16 format.

**Open fork — training-data strength.** This sets the opponent's whole character:
- *Mid-band (1200–1800), recommended default.* Competent enough to be coherent, human enough to dream wildly and blunder with personality. The most expressive dreams.
- *High only (2000+).* Cleaner play, fewer and more pointed dreams, a stiffer opponent.
- *Full range, unfiltered.* Maximum human chaos, but a lot of very weak play drags quality down.

Lock the default to mid-band; it is a one-line change to revisit.

### 5.2 Model config

Two tiers. Build Tier 1 first; it is the fast path to a playable loop. Move to Tier 2 only if the opponent plays too randomly for the dreams to be legible.

| | n_layer | n_head | n_embd | block_size | ~params | M5 train time (rough) |
|---|---|---|---|---|---|---|
| **Tier 1 "it works"** | 6 | 6 | 384 | 512 | ~12M | hours |
| **Tier 2 "plays real chess"** | 8 | 8 | 512 | 512 | ~25M | ~a day |

`block_size 512` comfortably holds a full game in UCI move-tokens with room for the running context. `vocab_size` = UCI vocab + specials (~1970). Standard nanoGPT training loop; AdamW; cosine schedule; checkpoint on best val loss.

### 5.3 Checkpoint artifact

The model's only output is `daydream-chess-nanogpt.pt` (weights + the config + the vocab mapping). The engine needs nothing else. Keep the vocab mapping *in* the checkpoint so the engine can decode token → UCI without a side file.

---

## 6. Component 2 — the engine

A Python process holding the model and `python-chess`. It runs the move loop, validates, and emits turn records over a local HTTP/websocket endpoint to the UI.

### 6.1 The move loop

```python
def model_turn(board, history_tokens, temperature, cap):
    attempts = []
    for n in range(cap):
        tok = model.sample_one_move(history_tokens, temperature)  # one move token
        uci = vocab.decode(tok)
        move = parse_uci(uci)
        record = classify(board, uci, move)        # see 6.3
        attempts.append(record)
        if record["legal"]:
            board.push(move)
            return turn_record(attempts, accepted=uci, woke=True)
    return turn_record(attempts, accepted=None, woke=False)  # failed to wake
```

The human's real move is pushed onto `board` and appended to `history_tokens` before the model's turn, so the model always reasons from the true position. Its dreams are dreams *from reality*, which is what makes the wrong-belief legible.

### 6.2 Resampling and the temperature/cap interaction

Each resample draws independently from the *same* context. Variety comes entirely from temperature. This means:

- At `temperature 0` the model proposes the same move every time. If its top move is illegal, it can never escape — the cap is guaranteed to be hit and every turn fails to wake. **Temperature must be > 0 for resampling to function.** Enforce a floor (e.g. 0.3) on the slider, or document this clearly.
- Higher temperature widens the dream halo: failures cluster less tightly around plausible moves and range into stranger territory.

### 6.3 Render tiers — classifying a rejected move

Not every illegal move can be drawn as a board. Classify each attempt so the UI knows how to render it:

- **`woke`** — legal. The move that actually happens.
- **`wrong_board`** — illegal, but the from-square is occupied by the model's own movable piece, so the move can be *force-applied* (move the piece to the destination ignoring legality). Produces a coherent but wrong `fen_after`. **These are the beautiful ones** — a legible false belief about the position (a king strolling into check, a pinned bishop sliding free, a piece capturing its own side).
- **`phantom`** — illegal *and* un-force-applyable: the from-square is empty, or the move references a piece that isn't there. The model imagined a piece into existence. `fen_after` is null; the UI renders this as a ghost annotation (a faint arrow from an empty square) rather than a board.

This taxonomy is the engine's job, not the UI's — the UI just reads `kind`.

### 6.4 Exposed controls

The endpoint accepts `temperature` and `cap` per game (or per turn). Defaults 0.8 / 24. These flow straight into the loop and are echoed back in every turn record so the UI can label what it is showing.

---

## 7. Component 3 — the UI

A browser frontend that plays the game and renders the dream/wake aesthetic. It consumes turn records and nothing else.

### 7.1 The core render: dream then wake

When a model turn arrives, animate its `attempts` in order:

- Each **`wrong_board`** attempt flashes its `fen_after` as a board rendered *dim and hazy* — low contrast, slightly desaturated, maybe a faint blur. A wrong dream, briefly held, then released.
- Each **`phantom`** attempt draws a ghost arrow on the current real board from the (empty) from-square to the to-square — a piece that was never there, reaching.
- The **`woke`** attempt snaps the real board to full sharpness and color. Reality arrives. The move lands.

The title is doing design work: dreams must *look* like dreams and the wake must *look* like waking. If the failures and the success render identically, the name is carrying a feeling the piece does not deliver. The dim-to-sharp contrast is the single most important visual decision in the build.

### 7.2 The game log

A running record of the real game with every dream folded in beside it: the one true line surrounded by the scatter of rejected ones. Per turn, show the accepted move and, collapsibly, the `n` attempts that preceded it — the moves it almost made, the boards it briefly believed. This log *is* the artifact you'd export or exhibit.

### 7.3 Fail-to-wake state

When `woke` is false, the UI enters a terminal "sleep" state: the model dreamed the full cap and never surfaced. Present it as an ending in its own right — quieter and stranger than checkmate — not as an error toast.

### 7.4 Controls

A temperature slider (floor 0.3, default 0.8) labeled as the model's delirium width, and a cap control (default 24). Changing temperature visibly widens or tightens the dream halo on subsequent turns — let the player feel the dial.

---

## 8. Build order

1. **Vocab + tokenizer.** Define the UCI vocab, the encode/decode, the PGN→tokens converter. Unit-test round-trips on a handful of real games.
2. **Corpus.** Run the pipeline on a 200k-game subset. Produce `train.bin` / `val.bin`.
3. **Train Tier 1.** Get a checkpoint that emits *mostly* legal, *recognizable* chess. Sanity-check by sampling games and eyeballing legal-move rate.
4. **Engine loop, headless.** Proposer + validator + turn-record emitter. No UI yet — print turn records to console. Confirm the record contract (§3) is exactly right. This is the seam; freeze it here.
5. **UI v0 — playable, one board.** Just play the game. Render only the accepted moves. Prove the round-trip human↔engine↔model works end to end.
6. **UI v1 — the dreams.** Add the dim dream-board flashes, phantom ghost arrows, and the wake snap. This is where it becomes the piece.
7. **The log + fail-to-wake.** The dream-scatter log and the sleep ending.
8. **Controls.** Temperature and cap sliders.
9. **Tier 2 if needed.** Retrain larger only if Tier 1's play is too random for legible dreams.

Milestones 1–4 are pure engineering against ground truth. Milestone 6 is where the engineering ends and the rendering decisions — how to draw a board that is *wrong* — become the hard part.

---

## 9. Deferred / open

- **Static shippable build.** Export the checkpoint to ONNX, run inference in-browser via Transformer.js, reimplement validation with chess.js. Turns daydream-chess into a hostable site with no server, parallel to Small Hours' static deploy. Real work; out of scope for v1.
- **Delirium mode.** A second, char-level model whose dreams include grammatical nonsense, not just board errors. A wilder halo. Train only if the move-level dreams feel too tame.
- **Elo conditioning.** Train with rating tags so one set of weights plays at a chosen strength on command. Cheap to add to the corpus, expands the toy considerably.
- **Color choice.** Let the human play Black. Trivial once the loop is symmetric.

---

## 10. Naming

- Repo: `daydream-chess`
- Model artifact: `daydream-chess-nanogpt` → `daydream-chess-nanogpt.pt`
- Audience-facing title (when shown or shipped): **Daydream**

The `-nanogpt` suffix marks the trained char/move model as a component, consistent across the series (`small-hours-nanogpt`, `shakespeare-nanogpt`). The repo names the project; the model names the artifact; the gap between them is as wide as the project is more than its model.