import React, { useEffect, useRef, useState } from "react";
import { useBoard } from "./useBoard.js";
import { paint, WIDTH, HEIGHT } from "./canvas.js";
const validRoom = (value) => /^[a-zA-Z0-9_-]{6,64}$/.test(value);
const initialRoom = new URLSearchParams(location.search).get("board");
const colors = [
  "#183349",
  "#2563eb",
  "#0d9488",
  "#e85d4a",
  "#9b51b5",
  "#e9a825",
];
export default function App() {
  const [room, setRoom] = useState(
    validRoom(initialRoom || "") ? initialRoom : crypto.randomUUID(),
  );
  const [roomInput, setRoomInput] = useState(room),
    [tool, setTool] = useState("pen"),
    [color, setColor] = useState(colors[0]);
  const [width, setWidth] = useState(4),
    [text, setText] = useState(""),
    [summary, setSummary] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const { board, status, error, setError, pending, send } = useBoard(room);
  const canvas = useRef(null),
    stroke = useRef(null),
    summaryRequest = useRef(null);
  const connected = status === "connected";
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("board", room);
    history.replaceState(null, "", url);
    setRoomInput(room);
    setSummary("");
    setNotice("");
    stroke.current = null;
    summaryRequest.current?.abort();
    setBusy(false);
  }, [room]);
  useEffect(() => {
    if (board && stroke.current && stroke.current.epoch !== board.epoch)
      stroke.current = null;
    paint(canvas.current, [
      ...(board?.elements || []),
      ...pending,
      ...(stroke.current ? [stroke.current] : []),
    ]);
  }, [board, pending]);
  useEffect(() => () => summaryRequest.current?.abort(), []);
  function point(event) {
    const rect = canvas.current.getBoundingClientRect();
    return [
      Math.max(
        0,
        Math.min(
          WIDTH,
          Math.round(((event.clientX - rect.left) * WIDTH) / rect.width),
        ),
      ),
      Math.max(
        0,
        Math.min(
          HEIGHT,
          Math.round(((event.clientY - rect.top) * HEIGHT) / rect.height),
        ),
      ),
    ];
  }
  function down(event) {
    if (!connected || event.button !== 0) return;
    const [x, y] = point(event);
    if (tool === "text") {
      if (text.trim())
        send({
          action: "draw",
          element: {
            id: crypto.randomUUID(),
            tool,
            text: text.trim(),
            x,
            y,
            color,
            width: 24,
          },
        });
      else setNotice("Type a note in the text field, then click the canvas.");
      return;
    }
    canvas.current.setPointerCapture(event.pointerId);
    stroke.current = {
      id: crypto.randomUUID(),
      tool,
      color,
      width: tool === "eraser" ? width * 5 : width,
      points: [[x, y]],
      epoch: board.epoch,
      at: Date.now(),
    };
  }
  function flush(finish = false) {
    const s = stroke.current;
    if (!s) return;
    const { epoch, at, ...element } = s;
    if (!send({ action: "draw", element })) {
      stroke.current = null;
      return;
    }
    stroke.current = finish
      ? null
      : {
          ...s,
          id: crypto.randomUUID(),
          points: [s.points.at(-1)],
          at: Date.now(),
        };
  }
  function move(event) {
    const s = stroke.current;
    if (!s) return;
    s.points.push(point(event));
    paint(canvas.current, [...(board?.elements || []), ...pending, s]);
    if (s.points.length >= 60 || Date.now() - s.at > 180) flush();
  }
  async function summarize() {
    const controller = new AbortController();
    summaryRequest.current = controller;
    setBusy(true);
    setError("");
    try {
      const base = import.meta.env.VITE_API_URL;
      if (!base || base.includes("YOUR_"))
        throw new Error("Configure VITE_API_URL to enable AI summaries.");
      const result = await fetch(`${base.replace(/\/$/, "")}/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId: room }),
        signal: controller.signal,
      });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || "Summary request failed.");
      setSummary(data.summary);
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      if (summaryRequest.current === controller) setBusy(false);
    }
  }
  function join(event) {
    event.preventDefault();
    if (!validRoom(roomInput)) {
      setNotice("Use 6–64 letters, numbers, underscores or hyphens.");
      return;
    }
    setRoom(roomInput);
    setNotice("");
  }
  return (
    <div className="app">
      <header>
        <a className="brand" href={location.pathname}>
          <span className="brand-icon">
            c<span>·</span>
          </span>
          commonboard
        </a>
        <span className="tagline">A space to think together.</span>
        <div className={`status ${connected ? "online" : ""}`} role="status">
          <i />
          {status === "unconfigured" ? "Setup required" : status}
        </div>
      </header>
      <main>
        <section className="intro">
          <div>
            <div className="eyebrow">YOUR SHARED WORKSPACE</div>
            <h1>
              Big ideas start here<span>.</span>
            </h1>
            <p>Sketch it. Write it. Make sense of it together.</p>
          </div>
          <button
            className="primary"
            onClick={() => setRoom(crypto.randomUUID())}
          >
            ＋ New board
          </button>
        </section>
        <section className="room-bar">
          <form onSubmit={join}>
            <label htmlFor="room">Board</label>
            <input
              id="room"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              maxLength={64}
            />
            <button type="submit">Join</button>
          </form>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(location.href);
                setNotice(
                  "Board link copied. Share it with your collaborators.",
                );
              } catch {
                setNotice(
                  "Copy the URL from your address bar to share this board.",
                );
              }
            }}
          >
            Copy invite link ↗
          </button>
        </section>
        {(error || notice) && (
          <div className="notice" role="alert">
            {error || notice}
            <button
              aria-label="Dismiss message"
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              ×
            </button>
          </div>
        )}
        {status === "unconfigured" && (
          <div className="setup">
            Connect your AWS backend to start collaborating. Set{" "}
            <code>VITE_WEBSOCKET_URL</code> and <code>VITE_API_URL</code> in{" "}
            <code>frontend/.env.local</code>, then restart Vite. See the README
            for deployment.
          </div>
        )}
        <div className="workspace">
          <section className="drawing-panel" aria-label="Whiteboard workspace">
            <div className="toolbar">
              <div className="tools">
                {[
                  ["pen", "✎ Pen"],
                  ["eraser", "▱ Eraser"],
                  ["text", "T Text"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={tool === id ? "selected" : ""}
                    aria-pressed={tool === id}
                    onClick={() => setTool(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="colors">
                {colors.map((c) => (
                  <button
                    key={c}
                    aria-label={`Ink ${c}`}
                    aria-pressed={color === c}
                    className={color === c ? "swatch active" : "swatch"}
                    style={{ "--ink": c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
              <label className="size">
                Size{" "}
                <input
                  aria-label="Stroke width"
                  type="range"
                  min="2"
                  max="12"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                />
              </label>
              <button
                className="clear"
                disabled={!connected}
                onClick={() => {
                  if (
                    confirm(
                      "Clear this board for everyone? This cannot be undone.",
                    )
                  )
                    send({ action: "clear" });
                }}
              >
                Clear
              </button>
            </div>
            {tool === "text" && (
              <div className="text-entry">
                <label htmlFor="note">Your note</label>
                <input
                  id="note"
                  placeholder="Write a thought, then click the canvas…"
                  value={text}
                  maxLength={200}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
            )}
            <div className={`canvas-wrap ${!connected ? "disabled" : ""}`}>
              <canvas
                ref={canvas}
                width={WIDTH}
                height={HEIGHT}
                aria-label="Collaborative drawing canvas"
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={() => flush(true)}
                onPointerCancel={() => flush(true)}
              />
              {!board?.elements.length && !pending.length && (
                <div className="canvas-hint">
                  <span>✧</span>
                  <h2>A little room for your next big idea.</h2>
                  <p>
                    {connected
                      ? "Pick a pen and make your first mark."
                      : "Your shared canvas will appear when connected."}
                  </p>
                </div>
              )}
            </div>
            <div className="canvas-footer">
              <span>
                {connected
                  ? "Live collaboration enabled"
                  : "Waiting for connection"}
              </span>
              <span>
                {pending.length
                  ? `${pending.length} saving…`
                  : board
                    ? `Saved · revision ${board.revision}`
                    : "No board loaded"}
              </span>
            </div>
          </section>
          <aside>
            <div className="ai-icon">✧</div>
            <div className="eyebrow">FROM IDEAS TO CLARITY</div>
            <h2>See the bigger picture.</h2>
            <p>
              Turn your shared notes and sketches into a concise summary with
              Gemini.
            </p>
            <button
              className="primary summary-button"
              disabled={
                !connected ||
                busy ||
                pending.length > 0 ||
                !board?.elements.length
              }
              onClick={summarize}
            >
              {busy ? "Reading your board…" : "✧ Summarize board"}
            </button>
            <div className="summary" aria-live="polite">
              {summary || (
                <span>
                  Your summary will appear here.
                  <br />A fresh perspective, one click away.
                </span>
              )}
            </div>
            <div className="tip">
              <strong>Better together</strong>
              <p>
                Invite a friend using your board link. Every mark is saved and
                shared in real time.
              </p>
            </div>
            <div className="privacy">
              Summarizing sends the saved board content to Google Gemini. Anyone
              with this board ID can edit it.
            </div>
          </aside>
        </div>
        <footer>
          <span>COMMONBOARD / COLLABORATIVE WHITEBOARD</span>
          <span>Built on AWS · Powered by ideas</span>
        </footer>
      </main>
    </div>
  );
}
