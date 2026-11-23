import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { boardId, parseBody, snapshotFrames, AppError } from "./domain.js";
import { createStore } from "./store.js";
export function socketHandler({
  store = createStore(),
  makeClient = (endpoint) => new ApiGatewayManagementApiClient({ endpoint }),
} = {}) {
  return async (event) => {
    const { connectionId, routeKey, domainName, stage } = event.requestContext;
    const client = makeClient(`https://${domainName}/${stage}`);
    async function post(id, payload) {
      try {
        await client.send(
          new PostToConnectionCommand({
            ConnectionId: id,
            Data: Buffer.from(JSON.stringify(payload)),
          }),
        );
        return true;
      } catch (err) {
        if (
          err.statusCode === 410 ||
          err.$metadata?.httpStatusCode === 410 ||
          err.name === "GoneException"
        ) {
          await store.disconnect(id);
          return false;
        }
        throw err;
      }
    }
    async function snapshot(id, frames) {
      for (const frame of frames) if (!(await post(id, frame))) break;
    }
    let message;
    try {
      if (routeKey === "$connect") {
        const id = boardId(event.queryStringParameters?.boardId);
        await store.getBoard(id, true);
        await store.connect(connectionId, id);
        return { statusCode: 200, body: "Connected" };
      }
      if (routeKey === "$disconnect") {
        await store.disconnect(connectionId);
        return { statusCode: 200, body: "Disconnected" };
      }
      if (Buffer.byteLength(event.body || "") > 16000)
        throw new AppError("Message too large.", 413);
      message = parseBody(event);
      if (!["sync", "draw", "clear"].includes(message.action))
        throw new AppError("Unknown action. Use sync, draw or clear.");
      const connection = await store.connection(connectionId);
      if (!connection || connection.expiresAt <= Math.floor(Date.now() / 1000))
        throw new AppError("Connection expired. Reconnect to continue.", 401);
      let board;
      if (message.action === "sync") {
        board = await store.getBoard(connection.boardId, true);
        await snapshot(connectionId, snapshotFrames(board));
      } else {
        if (
          typeof message.requestId !== "string" ||
          !/^[a-zA-Z0-9_-]{10,64}$/.test(message.requestId)
        )
          throw new AppError("Invalid request ID.");
        if (
          message.action === "draw" &&
          message.requestId !== message.element?.id
        )
          throw new AppError("Request and element IDs must match.");
        board = await store.mutate(connection.boardId, message);
        const frames = snapshotFrames(board);
        const members = await store.members(connection.boardId);
        // The GSI is eventually consistent: always include the sender explicitly.
        const ids = [
          ...new Set([connectionId, ...members.map((x) => x.connectionId)]),
        ];
        for (let i = 0; i < ids.length; i += 8) {
          const results = await Promise.allSettled(
            ids.slice(i, i + 8).map((id) => snapshot(id, frames)),
          );
          for (const result of results)
            if (result.status === "rejected")
              console.error("broadcast_failed", { name: result.reason.name });
        }
        // ACK only after persistence; periodic sync repairs any failed delivery.
        await post(connectionId, {
          type: "ack",
          requestId: message.requestId,
          revision: board.revision,
        });
      }
      return { statusCode: 200, body: "OK" };
    } catch (err) {
      console.error("socket_failed", {
        name: err.name,
        route: routeKey,
        requestId: event.requestContext.requestId,
      });
      const status = err instanceof AppError ? err.status : 500;
      const messageText =
        err instanceof AppError
          ? err.message
          : "Unable to save or load the board. Please retry.";
      if (routeKey !== "$connect" && routeKey !== "$disconnect") {
        try {
          await post(connectionId, {
            type: "error",
            message: messageText,
            requestId: message?.requestId,
          });
        } catch {
          /* A closed connection cannot receive an error. */
        }
      }
      return { statusCode: status, body: messageText };
    }
  };
}
export const handler = socketHandler();
