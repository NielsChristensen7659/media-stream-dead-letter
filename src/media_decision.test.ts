import assert from "node:assert/strict";
import test from "node:test";
import { decideDelivery, ingestRequest } from "./media_decision.ts";

test("unsupported input remains unacknowledged; supported input receives a delivery receipt", () => {
  const base = ingestRequest.parse({
    jobId: "7861db02-d36d-43b3-a6e5-6d075b24d2e1",
    assetId: "clip-42", creatorId: "creator-7",
    sourceUrl: "https://media.example/clip-42", format: "unknown",
  });
  assert.deepEqual(decideDelivery(base), { kind: "retry" });
  assert.deepEqual(decideDelivery({ ...base, format: "hls" }), {
    kind: "deliver", receipt: "creator-7/clip-42/hls",
  });
});
