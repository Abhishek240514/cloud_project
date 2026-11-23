import test from "node:test";
import assert from "node:assert/strict";
import { summaryHandler } from "../src/summary.js";
import { PNG } from "pngjs";
import { boardPng } from "../src/raster.js";
process.env.GEMINI_MODEL = "test-model";
process.env.ALLOWED_ORIGINS = "https://board.example";
const elements = [
  {
    id: "stroke-123456",
    tool: "pen",
    color: "#000000",
    width: 4,
    points: [
      [100, 100],
      [200, 200],
    ],
  },
  {
    id: "text-123456",
    tool: "text",
    text: "Ship Friday",
    x: 100,
    y: 80,
    width: 24,
    color: "#000000",
  },
];
const event = {
  headers: { origin: "https://board.example" },
  body: JSON.stringify({ boardId: "room-123" }),
};
function fixture(overrides = {}) {
  let secretsRead = 0;
  const calls = [];
  return {
    calls,
    get reads() {
      return secretsRead;
    },
    handler: summaryHandler({
      store: {
        getBoard: async () => ({ elements, revision: 2 }),
        claimSummary: async () => {},
      },
      secrets: {
        send: async () => {
          secretsRead++;
          return {
            SecretString: JSON.stringify({ apiKey: "unit-test-only-key" }),
          };
        },
      },
      fetcher: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          json: async () => ({
            candidates: [
              { content: { parts: [{ text: "Ship the project Friday." }] } },
            ],
          }),
        };
      },
      ...overrides,
    }),
  };
}
test("summary reads secret server-side and sends persisted notes and PNG to Gemini", async () => {
  const f = fixture();
  const result = await f.handler(event);
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).summary, "Ship the project Friday.");
  assert.equal(
    result.headers["Access-Control-Allow-Origin"],
    "https://board.example",
  );
  const data = JSON.parse(f.calls[0].options.body);
  assert.match(data.contents[0].parts[0].text, /Ship Friday/);
  assert.equal(data.contents[0].parts[1].inlineData.mimeType, "image/png");
  assert.ok(!result.body.includes("unit-test-only-key"));
  await f.handler(event);
  assert.equal(f.reads, 1);
});
test("summary rejects unexpected origins and invalid payloads", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.handler({
        ...event,
        headers: { origin: "https://untrusted.example" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await f.handler({ ...event, body: "bad json" })).statusCode,
    400,
  );
  assert.equal(f.calls.length, 0);
});
test("empty boards skip Gemini calls", async () => {
  const f = fixture({ store: { getBoard: async () => ({ elements: [] }) } });
  assert.equal((await f.handler(event)).statusCode, 400);
  assert.equal(f.calls.length, 0);
});
test("Gemini errors and missing output produce useful failures", async () => {
  const f = fixture({ fetcher: async () => ({ ok: false, status: 429 }) });
  assert.equal((await f.handler(event)).statusCode, 502);
  const g = fixture({
    fetcher: async () => ({ ok: true, json: async () => ({ candidates: [] }) }),
  });
  assert.equal((await g.handler(event)).statusCode, 502);
});
test("raster produces an actual PNG and eraser restores white pixels", () => {
  const png = PNG.sync.read(Buffer.from(boardPng(elements), "base64"));
  assert.equal(png.width, 720);
  assert.equal(png.data[(50 * 720 + 50) * 4], 0);
  const erased = PNG.sync.read(
    Buffer.from(
      boardPng([...elements, { ...elements[0], tool: "eraser", width: 20 }]),
      "base64",
    ),
  );
  assert.equal(erased.data[(50 * 720 + 50) * 4], 255);
});
