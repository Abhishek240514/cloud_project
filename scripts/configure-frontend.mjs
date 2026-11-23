import { readFile, writeFile } from "node:fs/promises";
const outputs = JSON.parse(
  await readFile(process.argv[2] || "artifacts/stack-outputs.json", "utf8"),
);
const get = (key) => {
  const value = outputs.find((x) => x.OutputKey === key)?.OutputValue;
  if (!value) throw new Error(`Missing output: ${key}`);
  return value;
};
const ws = get("WebSocketUrl"),
  rest = get("RestApiUrl");
if (!ws.startsWith("wss://") || !rest.startsWith("https://"))
  throw new Error("Unexpected API endpoints");
await writeFile(
  "frontend/.env.local",
  `VITE_WEBSOCKET_URL=${ws}\nVITE_API_URL=${rest}\n`,
);
console.log("Wrote frontend/.env.local with public API endpoints.");
