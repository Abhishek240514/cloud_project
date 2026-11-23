import { randomUUID } from "node:crypto";
export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function boardId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{6,64}$/.test(value))
    throw new AppError(
      "Board ID must contain 6–64 letters, numbers, underscores or hyphens.",
    );
  return value;
}
export function parseBody(event) {
  try {
    return JSON.parse(
      event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString()
        : event.body || "{}",
    );
  } catch {
    throw new AppError("Invalid JSON request.");
  }
}
const number = (v, min, max) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
export function validateElement(e) {
  if (!e || typeof e.id !== "string" || !/^[a-zA-Z0-9_-]{10,64}$/.test(e.id))
    throw new AppError("Invalid element ID.");
  if (
    !["pen", "eraser", "text"].includes(e.tool) ||
    !/^#[a-fA-F0-9]{6}$/.test(e.color) ||
    !number(e.width, 1, 60)
  )
    throw new AppError("Invalid drawing tool, color or size.");
  const result = { id: e.id, tool: e.tool, color: e.color, width: e.width };
  if (e.tool === "text") {
    if (
      typeof e.text !== "string" ||
      !e.text.trim() ||
      e.text.length > 200 ||
      !number(e.x, 0, 1440) ||
      !number(e.y, 0, 900)
    )
      throw new AppError("Invalid text note.");
    return { ...result, text: e.text.trim(), x: e.x, y: e.y };
  }
  if (
    !Array.isArray(e.points) ||
    e.points.length < 1 ||
    e.points.length > 80 ||
    !e.points.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        number(p[0], 0, 1440) &&
        number(p[1], 0, 900),
    )
  )
    throw new AppError("Invalid stroke points.");
  return { ...result, points: e.points };
}
export function emptyBoard(id) {
  return {
    boardId: id,
    revision: 0,
    epoch: randomUUID(),
    elements: [],
    updatedAt: new Date().toISOString(),
  };
}
export function applyOperation(board, message) {
  if (message.epoch !== board.epoch) {
    // A retried clear may already have succeeded before the connection dropped.
    if (message.action === "clear" && message.requestId === board.lastClearId)
      return board;
    throw new AppError(
      "The board was cleared. Reloaded the latest board; please try again.",
      409,
    );
  }
  let elements;
  if (message.action === "clear") elements = [];
  else {
    const element = validateElement(message.element);
    if (board.elements.some((x) => x.id === element.id)) return board;
    elements = [...board.elements, element];
  }
  const next = {
    ...board,
    elements,
    revision: board.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  if (message.action === "clear") {
    next.epoch = randomUUID();
    next.lastClearId = message.requestId;
  }
  if (
    elements.length > 1500 ||
    Buffer.byteLength(JSON.stringify(next)) > 220000
  )
    throw new AppError(
      "This board is full. Create a new board or clear it to continue.",
      413,
    );
  return next;
}
export function snapshotFrames(board) {
  const raw = JSON.stringify(board),
    chunks = [];
  // 4,000 UTF-16 code units stay under 32 KB even when JSON escaping expands them.
  for (let i = 0; i < raw.length; i += 4000)
    chunks.push(raw.slice(i, i + 4000));
  const snapshotId = randomUUID();
  return chunks.map((data, index) => ({
    type: "snapshot",
    snapshotId,
    index,
    count: chunks.length,
    data,
  }));
}
