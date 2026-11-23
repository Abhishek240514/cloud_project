import test from "node:test";
import assert from "node:assert/strict";
import { socketHandler } from "../src/socket.js";
import { emptyBoard, applyOperation } from "../src/domain.js";
function fixture() {
  let board = emptyBoard("room-123");
  const posted = [],
    removed = [];
  const store = {
    getBoard: async () => board,
    connect: async () => {},
    disconnect: async (id) => removed.push(id),
    connection: async () => ({
      boardId: board.boardId,
      expiresAt: Date.now() / 1000 + 1000,
    }),
    members: async () => [{ connectionId: "peer" }, { connectionId: "gone" }],
    mutate: async (id, op) => (board = applyOperation(board, op)),
  };
  const handler = socketHandler({
    store,
    makeClient: (endpoint) => {
      assert.equal(endpoint, "https://api.example/prod");
      return {
        send: async (c) => {
          if (c.input.ConnectionId === "gone") throw { name: "GoneException" };
          posted.push({
            id: c.input.ConnectionId,
            message: JSON.parse(c.input.Data.toString()),
          });
        },
      };
    },
  });
  const event = (routeKey, body) => ({
    requestContext: {
      routeKey,
      connectionId: "self",
      domainName: "api.example",
      stage: "prod",
    },
    queryStringParameters: { boardId: "room-123" },
    body: JSON.stringify(body),
  });
  return { handler, store, event, posted, removed, getBoard: () => board };
}
test("$connect does not post before the handshake completes; disconnect removes connection", async () => {
  const f = fixture();
  assert.equal((await f.handler(f.event("$connect"))).statusCode, 200);
  assert.equal(f.posted.length, 0);
  await f.handler(f.event("$disconnect"));
  assert.deepEqual(f.removed, ["self"]);
});
test("draw persists, broadcasts, ACKs, removes stale peers and includes sender absent from GSI", async () => {
  const f = fixture(),
    id = "stroke-123456";
  const result = await f.handler(
    f.event("draw", {
      action: "draw",
      requestId: id,
      epoch: f.getBoard().epoch,
      element: {
        id,
        tool: "pen",
        color: "#123456",
        width: 2,
        points: [[0, 0]],
      },
    }),
  );
  assert.equal(result.statusCode, 200);
  assert.equal(f.getBoard().elements.length, 1);
  assert.ok(
    f.posted.some((x) => x.id === "peer" && x.message.type === "snapshot"),
  );
  assert.ok(f.posted.some((x) => x.id === "self" && x.message.type === "ack"));
  assert.deepEqual(f.removed, ["gone"]);
});
test("sync restores persisted state", async () => {
  const f = fixture();
  await f.handler(f.event("sync", { action: "sync" }));
  assert.equal(f.posted[0].message.type, "snapshot");
});
test("invalid actions and missing connections send useful errors", async () => {
  const f = fixture();
  assert.equal(
    (await f.handler(f.event("$default", { action: "nope" }))).statusCode,
    400,
  );
  assert.equal(f.posted.at(-1).message.type, "error");
  f.store.connection = async () => null;
  assert.equal(
    (await f.handler(f.event("sync", { action: "sync" }))).statusCode,
    401,
  );
});
test("database failure never sends a success ACK", async () => {
  const f = fixture();
  f.store.mutate = async () => {
    throw new Error("Database unavailable");
  };
  assert.equal(
    (
      await f.handler(
        f.event("draw", {
          action: "draw",
          requestId: "stroke-123456",
          element: { id: "stroke-123456" },
        }),
      )
    ).statusCode,
    500,
  );
  assert.ok(!f.posted.some((x) => x.message.type === "ack"));
});
