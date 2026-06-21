// Unified socket layer for daydream-chess.
//
// Two implementations share one interface:
//   connect()                       -> begin connecting
//   send(obj)                       -> send a client message
//   onMessage(fn)                   -> register a server-message handler
//   onStatus(fn)                    -> register a connection-status handler
//   close()                         -> tear down
//
// connectSocket() tries the real WebSocket first; if it cannot connect within
// a short window it falls back to the MockSocket replaying fixtures. The caller
// is told which mode it ended up in via onStatus.

import { FIXTURES } from "./fixtures.js";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws";

// How long to wait for the real WS to open before falling back to demo mode.
const CONNECT_TIMEOUT_MS = 1500;

// --- MockSocket -----------------------------------------------------------
// Replays canned fixtures with realistic timing in response to client
// messages, so the UI is fully demoable with no server.

const MOCK_TURN_DELAY_MS = 120; // pause before the model's turn_record arrives
const MOCK_STATE_DELAY_MS = 60; // pause between successive replayed messages

class MockSocket {
  constructor() {
    this._messageHandlers = [];
    this._statusHandlers = [];
    this._timers = [];
  }

  connect() {
    // Demo mode is "connected" immediately, but we announce it as demo.
    setTimeout(() => this._emitStatus("demo"), 0);
  }

  send(obj) {
    switch (obj.type) {
      case "new_game":
        this._replay([FIXTURES.initialState], 0);
        break;
      case "human_move": {
        const seq = FIXTURES.turns[obj.uci];
        if (!seq) {
          // Unknown move in demo mode -> reject so the human picks again.
          this._schedule(
            () => this._emit({ type: "move_rejected", uci: obj.uci }),
            MOCK_STATE_DELAY_MS
          );
          return;
        }
        this._replay(seq, 0);
        break;
      }
      case "set_controls":
        // No-op echo in demo mode.
        break;
      default:
        break;
    }
  }

  // Replay a list of messages with timing. The first state-after-human is
  // quick; the turn_record waits a beat to feel like the model "thinking".
  _replay(messages, startIndex) {
    let delay = 0;
    messages.forEach((msg, i) => {
      if (i < startIndex) return;
      delay +=
        msg.type === "turn_record" ? MOCK_TURN_DELAY_MS : MOCK_STATE_DELAY_MS;
      this._schedule(() => this._emit(msg), delay);
    });
  }

  _schedule(fn, delay) {
    const id = setTimeout(fn, delay);
    this._timers.push(id);
  }

  _emit(msg) {
    this._messageHandlers.forEach((fn) => fn(msg));
  }

  _emitStatus(status) {
    this._statusHandlers.forEach((fn) => fn(status));
  }

  onMessage(fn) {
    this._messageHandlers.push(fn);
  }

  onStatus(fn) {
    this._statusHandlers.push(fn);
  }

  close() {
    this._timers.forEach(clearTimeout);
    this._timers = [];
  }
}

// --- RealSocket -----------------------------------------------------------

class RealSocket {
  constructor(url) {
    this._url = url;
    this._ws = null;
    this._messageHandlers = [];
    this._statusHandlers = [];
    this._queue = [];
  }

  connect() {
    this._ws = new WebSocket(this._url);
    this._ws.addEventListener("open", () => {
      this._emitStatus("connected");
      this._queue.forEach((obj) => this._ws.send(JSON.stringify(obj)));
      this._queue = [];
    });
    this._ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this._messageHandlers.forEach((fn) => fn(msg));
    });
    this._ws.addEventListener("close", () => this._emitStatus("disconnected"));
    this._ws.addEventListener("error", () => this._emitStatus("error"));
  }

  send(obj) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    } else {
      this._queue.push(obj);
    }
  }

  onMessage(fn) {
    this._messageHandlers.push(fn);
  }

  onStatus(fn) {
    this._statusHandlers.push(fn);
  }

  _emitStatus(status) {
    this._statusHandlers.forEach((fn) => fn(status));
  }

  close() {
    if (this._ws) this._ws.close();
  }
}

// --- connectSocket --------------------------------------------------------
// Returns a socket object (real or mock). It begins as a "racing" real socket
// and, if that fails to open in time, transparently swaps to the mock. To the
// caller it is a single object whose handlers persist across the swap.

export function connectSocket() {
  const messageHandlers = [];
  const statusHandlers = [];
  let active = null;
  let settled = false;

  const facade = {
    send: (obj) => active && active.send(obj),
    onMessage: (fn) => messageHandlers.push(fn),
    onStatus: (fn) => statusHandlers.push(fn),
    close: () => active && active.close(),
    connect: () => {},
  };

  const wire = (socket) => {
    socket.onMessage((m) => messageHandlers.forEach((fn) => fn(m)));
    socket.onStatus((s) => statusHandlers.forEach((fn) => fn(s)));
  };

  const fallbackToMock = () => {
    if (settled) return;
    settled = true;
    if (active) active.close();
    const mock = new MockSocket();
    active = mock;
    wire(mock);
    mock.connect();
  };

  // Try the real socket.
  let real;
  try {
    real = new RealSocket(WS_URL);
  } catch {
    fallbackToMock();
    return facade;
  }

  active = real;
  real.onMessage((m) => messageHandlers.forEach((fn) => fn(m)));
  real.onStatus((s) => {
    if (s === "connected") {
      settled = true;
    }
    if ((s === "error" || s === "disconnected") && !settled) {
      fallbackToMock();
      return;
    }
    statusHandlers.forEach((fn) => fn(s));
  });

  const timeout = setTimeout(() => {
    if (!settled) fallbackToMock();
  }, CONNECT_TIMEOUT_MS);

  // Clear the timeout once we settle either way.
  statusHandlers.push((s) => {
    if (s === "connected" || s === "demo") clearTimeout(timeout);
  });

  real.connect();
  return facade;
}
