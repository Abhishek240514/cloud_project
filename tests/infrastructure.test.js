import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
const doc = parseDocument(readFileSync("template.yaml", "utf8"), {
  customTags: ["!Ref", "!Sub", "!GetAtt"].map((tag) => ({
    tag,
    resolve: (value) => ({ [tag]: value }),
  })),
});
const template = doc.toJS(),
  r = template.Resources;
test("infrastructure is valid YAML with matching WebSocket routes and Lambda artifacts", () => {
  assert.equal(doc.errors.length, 0);
  assert.deepEqual(
    Object.values(r)
      .filter((x) => x.Type === "AWS::ApiGatewayV2::Route")
      .map((x) => x.Properties.RouteKey)
      .sort(),
    ["$connect", "$default", "$disconnect", "clear", "draw", "sync"],
  );
  for (const f of Object.values(r).filter(
    (x) => x.Type === "AWS::Serverless::Function",
  ))
    assert.equal(f.Properties.CodeUri, ".aws-sam/build/handlers/");
});
test("REST route and storage keys match implementation", () => {
  assert.equal(
    r.SummaryFunction.Properties.Events.Summarize.Properties.Path,
    "/summarize",
  );
  assert.equal(r.BoardsTable.Properties.KeySchema[0].AttributeName, "boardId");
  assert.equal(
    r.ConnectionsTable.Properties.KeySchema[0].AttributeName,
    "connectionId",
  );
  assert.equal(
    r.ConnectionsTable.Properties.GlobalSecondaryIndexes[0].IndexName,
    "byBoard",
  );
});
test("hosting stays private and secret access is scoped", () => {
  assert.equal(
    r.FrontendBucket.Properties.PublicAccessBlockConfiguration
      .BlockPublicPolicy,
    true,
  );
  const statements = r.SummaryFunction.Properties.Policies[0].Statement;
  assert.deepEqual(
    statements.find((x) => x.Action === "secretsmanager:GetSecretValue")
      .Resource,
    { "!Ref": "GeminiSecretArn" },
  );
});
