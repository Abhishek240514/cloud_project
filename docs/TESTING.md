# End-to-end validation and demonstration

Run `npm run check` first. Unit tests use dependency-injected test doubles only. They cover validation, concurrent-write retry, size limits, clear epochs, idempotency, fragmented snapshots, stale connections, error propagation, secret handling, AI failures, PNG rendering, and infrastructure contracts.

## AWS preflight

1. Deploy using the README and wait for the stack and CloudFront distribution to finish.
2. Open the printed HTTPS website URL. Confirm **connected**, an empty canvas, and revision 0 for a new room.
3. Verify DynamoDB BoardState contains the room and Connections contains the browser's connection ID. Do not expose the Gemini secret while demonstrating.
4. Run `node scripts/smoke.mjs` with the deployed WebSocket URL. For AI verification, set `RUN_SUMMARY=1` and `REST_API_URL` as described in the README.

## One-user drawing

1. Draw a line with the pen; switch color and width. Confirm the saving indicator settles to a saved revision.
2. Select Text, enter “Launch plan: prototype Monday, review Friday”, then click the canvas. Confirm the note appears at that location.
3. Use eraser on part of a line. Confirm it erases without moving the rest of the drawing.
4. Refresh the page. Confirm the same room and all saved content are restored.
5. Try malformed room IDs and verify a validation message with no connection attempt to that room.

## Two-user collaboration and room isolation

1. Copy the invitation link into a second browser/incognito window or another device.
2. Draw different-colored lines simultaneously in both clients. Confirm both eventually show identical content and revision.
3. Add text in either client and observe it in the other.
4. Create a new board in a third client. Confirm its drawings do not appear in the first board.
5. Close the third client. Verify its connection row is removed or later cleaned up via 410/TTL.

## Reconnect and persistence

1. Wait for Saved, then disconnect one client from the network.
2. Draw from the still-connected client. Restore the network in the other; confirm reconnect and restoration without refresh.
3. Refresh both clients. Confirm the persisted board is identical.
4. Interrupt the network just after a stroke. Keep the page open and reconnect; confirm pending segments are either acknowledged exactly once or visibly rejected if the board was cleared while disconnected.
5. Leave a client open across API Gateway's connection lifetime. Confirm automatic reconnect and restored state.

## Clear/reset race

1. With two clients on the same board, click Clear and cancel the confirmation; content must remain.
2. Confirm Clear. Both clients must become empty and the saved revision must increase.
3. Refresh: the board remains empty.
4. Repeat with one client temporarily disconnected. Its old-epoch operations must not resurrect pre-clear content after reconnect.

## AI summarization

1. Add a diagram and several typed notes. Wait for Saved.
2. Click Summarize board. Verify a meaningful summary appears and the key is absent from browser source and Network request data.
3. Confirm the HTTP request is `POST /prod/summarize` with only a room ID. The image is rendered inside Lambda from DynamoDB content.
4. Immediately request another summary; a useful cooldown message should appear.
5. In a disposable test deployment, configure an invalid model ID and verify a useful error; restore the valid ID afterward.
6. Summarize an empty board using curl and verify HTTP 400. A nonexistent valid room ID returns 404. An invalid room ID returns 400.

## Deployment and responsive UI

1. Open the S3 object URL directly; public access should be denied. Open through CloudFront; the app should load over HTTPS.
2. Verify the page on desktop and mobile, with a touch/pen device when available.
3. Redeploy a small visible change. Confirm assets upload, index updates and the invalidation completes.
4. Check CloudWatch for unexplained errors and AWS billing usage. Local tests do not cover deployed IAM, actual network latency, regional quotas or Gemini account entitlement.

## Three-minute presentation

- Explain the React → CloudFront/S3 hosting and WebSocket → Lambda → DynamoDB update path.
- Open two clients, draw simultaneously, add notes, then refresh one to show persistence.
- Summarize the board and explain the REST → Lambda → Secrets Manager → Gemini flow.
- Clear the board in one client and show both update.
- Show the template and unit test output; state that room links provide collaboration access without user accounts.
