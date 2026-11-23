import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";
import { emptyBoard } from "../src/domain.js";
const conflict = () =>
  Object.assign(new Error("conflict"), {
    name: "ConditionalCheckFailedException",
  });
test("conditional write retries re-read concurrent changes without overwriting them", async () => {
  let board = emptyBoard("room-123"),
    writes = 0;
  const element = {
    id: "stroke-12345",
    tool: "pen",
    color: "#000000",
    width: 3,
    points: [[1, 1]],
  };
  const store = createStore({
    send: async (c) => {
      if (c.constructor.name === "GetCommand")
        return { Item: structuredClone(board) };
      if (c.constructor.name === "PutCommand") {
        writes++;
        assert.equal(c.input.ConditionExpression, "revision = :revision");
        if (writes === 1) {
          board = {
            ...board,
            revision: 1,
            elements: [{ ...element, id: "other-123456" }],
          };
          throw conflict();
        }
        board = c.input.Item;
        return {};
      }
    },
  });
  const result = await store.mutate(board.boardId, {
    action: "draw",
    epoch: board.epoch,
    element,
  });
  assert.equal(writes, 2);
  assert.equal(result.revision, 2);
  assert.equal(result.elements.length, 2);
});
test("member lookup paginates and filters expired connections", async () => {
  let pages = 0;
  const now = Math.floor(Date.now() / 1000);
  const store = createStore({
    send: async (c) => {
      assert.equal(c.input.IndexName, "byBoard");
      return pages++ === 0
        ? {
            Items: [{ connectionId: "a", expiresAt: now + 100 }],
            LastEvaluatedKey: { connectionId: "a" },
          }
        : { Items: [{ connectionId: "b", expiresAt: now - 1 }] };
    },
  });
  assert.deepEqual(
    (await store.members("room-123")).map((x) => x.connectionId),
    ["a"],
  );
  assert.equal(pages, 2);
});
test("DynamoDB outages propagate instead of returning fabricated data", async () => {
  const store = createStore({
    send: async () => {
      throw new Error("AWS outage");
    },
  });
  await assert.rejects(() => store.getBoard("room-123"), /AWS outage/);
});
test("summary cooldown uses a conditional update and revision to prevent write races", async () => {
  const store = createStore({
    send: async (c) => {
      assert.match(c.input.UpdateExpression, /ADD revision/);
      throw conflict();
    },
  });
  await assert.rejects(
    () => store.claimSummary("room-123"),
    (e) => e.status === 429,
  );
});
