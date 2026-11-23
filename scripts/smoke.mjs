import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { snapshotAssembler } from "../frontend/src/protocol.js";
const endpoint = process.env.WEBSOCKET_URL;
if (!endpoint?.startsWith("wss://"))
  throw new Error("Set WEBSOCKET_URL to the deployed wss:// API URL.");
const boardId = `smoke-${randomUUID()}`;
const clients = [];
async function connect() {
  const url = new URL(endpoint);
  url.searchParams.set("boardId", boardId);
  const socket = new WebSocket(url),
    assemble = snapshotAssembler();
  const client = {
    socket,
    board: null,
    errors: [],
    send: (message) => socket.send(JSON.stringify(message)),
  };
  clients.push(client);
  socket.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    if (m.type === "error") client.errors.push(m.message);
    const board = assemble(m);
    if (board && (!client.board || board.revision >= client.board.revision))
      client.board = board;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Connect timeout")), 15000);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("WebSocket connection failed"));
      },
      { once: true },
    );
  });
  client.send({ action: "sync" });
  await until(() => client.board, "initial snapshot");
  return client;
}
async function until(predicate, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `Timed out: ${label}. Server errors: ${clients.flatMap((c) => c.errors).join("; ")}`,
  );
}
try {
  const a = await connect(),
    b = await connect();
  const id = randomUUID();
  a.send({
    action: "draw",
    requestId: id,
    epoch: a.board.epoch,
    element: {
      id,
      tool: "text",
      color: "#183349",
      width: 24,
      x: 120,
      y: 140,
      text: "Milestone: finish prototype, then review with the team.",
    },
  });
  await until(
    () => b.board.elements.some((e) => e.id === id),
    "two-user broadcast",
  );
  const strokeId = randomUUID();
  b.send({
    action: "draw",
    requestId: strokeId,
    epoch: b.board.epoch,
    element: {
      id: strokeId,
      tool: "pen",
      color: "#0d9488",
      width: 4,
      points: [
        [100, 180],
        [400, 180],
      ],
    },
  });
  await until(
    () => a.board.elements.length === 2 && b.board.elements.length === 2,
    "bidirectional drawing",
  );
  if (process.env.RUN_SUMMARY === "1") {
    if (!process.env.REST_API_URL)
      throw new Error("Set REST_API_URL for the optional AI check.");
    const response = await fetch(
      `${process.env.REST_API_URL.replace(/\/$/, "")}/summarize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId }),
        signal: AbortSignal.timeout(30000),
      },
    );
    assert.equal(response.status, 200, await response.clone().text());
    assert.ok((await response.json()).summary);
    console.log("PASS: live Gemini summary");
  }
  a.socket.close();
  const rejoined = await connect();
  assert.equal(rejoined.board.elements.length, 2);
  b.send({ action: "clear", requestId: randomUUID(), epoch: b.board.epoch });
  await until(
    () => b.board.elements.length === 0 && rejoined.board.elements.length === 0,
    "clear broadcast",
  );
  console.log(
    `PASS: live two-client broadcast, persistence, reconnect and clear. Room: ${boardId}`,
  );
} finally {
  for (const c of clients) c.socket.close();
}
