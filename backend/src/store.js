import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { emptyBoard, applyOperation, AppError } from "./domain.js";
export function createStore(
  client = DynamoDBDocumentClient.from(new DynamoDBClient({})),
) {
  const boards = process.env.BOARDS_TABLE,
    connections = process.env.CONNECTIONS_TABLE;
  async function getBoard(id, create = false) {
    const found = await client.send(
      new GetCommand({
        TableName: boards,
        Key: { boardId: id },
        ConsistentRead: true,
      }),
    );
    if (found.Item) return found.Item;
    if (!create)
      throw new AppError(
        "Board not found. Open it in the whiteboard first.",
        404,
      );
    const item = emptyBoard(id);
    try {
      await client.send(
        new PutCommand({
          TableName: boards,
          Item: item,
          ConditionExpression: "attribute_not_exists(boardId)",
        }),
      );
      return item;
    } catch (err) {
      if (err.name !== "ConditionalCheckFailedException") throw err;
      return getBoard(id);
    }
  }
  return {
    getBoard,
    async mutate(id, message) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const before = await getBoard(id, true),
          after = applyOperation(before, message);
        if (before === after) return after;
        try {
          await client.send(
            new PutCommand({
              TableName: boards,
              Item: after,
              ConditionExpression: "revision = :revision",
              ExpressionAttributeValues: { ":revision": before.revision },
            }),
          );
          return after;
        } catch (err) {
          if (err.name !== "ConditionalCheckFailedException") throw err;
          await new Promise((resolve) =>
            setTimeout(resolve, 10 + Math.random() * 40 * (attempt + 1)),
          );
        }
      }
      throw new AppError("Board is busy. Please try again.", 409);
    },
    async connect(connectionId, id) {
      await client.send(
        new PutCommand({
          TableName: connections,
          Item: {
            connectionId,
            boardId: id,
            expiresAt: Math.floor(Date.now() / 1000) + 7500,
          },
        }),
      );
    },
    async disconnect(connectionId) {
      await client.send(
        new DeleteCommand({ TableName: connections, Key: { connectionId } }),
      );
    },
    async connection(connectionId) {
      return (
        await client.send(
          new GetCommand({
            TableName: connections,
            Key: { connectionId },
            ConsistentRead: true,
          }),
        )
      ).Item;
    },
    async members(id) {
      let cursor;
      const items = [];
      do {
        const result = await client.send(
          new QueryCommand({
            TableName: connections,
            IndexName: "byBoard",
            KeyConditionExpression: "boardId = :id",
            ExpressionAttributeValues: { ":id": id },
            ExclusiveStartKey: cursor,
          }),
        );
        items.push(...(result.Items || []));
        cursor = result.LastEvaluatedKey;
      } while (cursor);
      return items.filter((x) => x.expiresAt > Math.floor(Date.now() / 1000));
    },
    async claimSummary(id) {
      try {
        await client.send(
          new UpdateCommand({
            TableName: boards,
            Key: { boardId: id },
            UpdateExpression:
              "SET summaryAfter = :next ADD revision :increment",
            ConditionExpression:
              "attribute_exists(boardId) AND (attribute_not_exists(summaryAfter) OR summaryAfter < :now)",
            ExpressionAttributeValues: {
              ":now": Date.now(),
              ":next": Date.now() + 15000,
              ":increment": 1,
            },
          }),
        );
      } catch (err) {
        if (err.name === "ConditionalCheckFailedException")
          throw new AppError("Please wait 15 seconds between summaries.", 429);
        throw err;
      }
    },
  };
}
