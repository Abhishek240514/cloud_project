import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyBoard,
  applyOperation,
  boardId,
  validateElement,
  snapshotFrames,
  parseBody,
} from "../src/domain.js";
import { snapshotAssembler } from "../../frontend/src/protocol.js";
const element = {
  id: "stroke-123456",
  tool: "pen",
  color: "#123456",
  width: 4,
  points: [
    [0, 0],
    [1440, 900],
  ],
};
test("board IDs and malformed JSON are rejected", () => {
  for (const id of ["a", "../file", "a b c d", null, "a".repeat(65)])
    assert.throws(() => boardId(id));
  assert.equal(boardId("valid-board"), "valid-board");
  assert.throws(() => parseBody({ body: "{" }));
});
test("strokes validate boundaries, types and payload size", () => {
  assert.deepEqual(validateElement(element), element);
  for (const patch of [
    { width: NaN },
    { width: 61 },
    { color: "red" },
    { points: [[0, -1]] },
    { points: [] },
    { points: Array(81).fill([0, 0]) },
    { tool: "script" },
  ])
    assert.throws(() => validateElement({ ...element, ...patch }));
});
test("concurrent updates preserve existing elements; retries deduplicate", () => {
  let b = emptyBoard("room-123");
  const op = { action: "draw", epoch: b.epoch, element };
  b = applyOperation(b, op);
  assert.equal(b.revision, 1);
  assert.equal(applyOperation(b, op), b);
  b = applyOperation(b, {
    ...op,
    element: { ...element, id: "stroke-234567" },
  });
  assert.equal(b.elements.length, 2);
});
test("clear changes epoch and prevents delayed strokes resurrecting content", () => {
  const old = emptyBoard("room-123");
  const op = { action: "clear", epoch: old.epoch, requestId: "clear-123456" };
  const cleared = applyOperation(old, op);
  assert.notEqual(old.epoch, cleared.epoch);
  assert.throws(
    () =>
      applyOperation(cleared, { action: "draw", epoch: old.epoch, element }),
    /cleared/,
  );
  assert.equal(applyOperation(cleared, op), cleared);
});
test("board size limit returns useful error", () => {
  const b = emptyBoard("room-123");
  b.elements = Array.from({ length: 1500 }, (_, i) => ({
    ...element,
    id: `stroke-${i}`,
  }));
  assert.throws(
    () => applyOperation(b, { action: "draw", epoch: b.epoch, element }),
    /full/,
  );
});
test("Unicode snapshots fit frame limits and reassemble out of order", () => {
  const b = emptyBoard("room-123");
  b.elements = Array(100).fill({ text: '😀\n"\\'.repeat(100) });
  const frames = snapshotFrames(b);
  const assemble = snapshotAssembler();
  let result;
  for (const f of frames.reverse()) {
    assert.ok(Buffer.byteLength(JSON.stringify(f)) < 32768);
    result = assemble(f) || result;
  }
  assert.deepEqual(result, b);
});
test("interleaved snapshots remain independent", () => {
  const a = emptyBoard("room-123"),
    b = { ...a, revision: 1, elements: Array(80).fill(element) };
  const parse = snapshotAssembler(),
    one = snapshotFrames(a),
    two = snapshotFrames(b);
  assert.deepEqual(parse(one[0]), a);
  let result;
  for (const f of two) result = parse(f) || result;
  assert.deepEqual(result, b);
});
