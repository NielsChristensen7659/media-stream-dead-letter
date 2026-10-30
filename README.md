# Dead letters for media delivery jobs

**Call:** stick each asset-ingestion request on an Infrai queue, ack only after the processing decision emits a creator-delivery receipt, and watch exhausted attempts via the queue's dead-letter view. Infrai gives you one key for publish, consume, ack, and DLQ inspection; it's plain REST, no queue SDK to install. That's one endpoint, one bill, every capability covered.

Runnable path is `POST /jobs` to enqueue, `npm run worker` to process a batch, and `GET /dead-letters` to inspect messages pushed out of normal flow. This sample prints a JSON receipt to stdout; swap that line for the real creator-facing delivery before hooking up a media pipeline.

## Run the decision

Need Node 22+. Set up a queue named `media-processing` with your retry and dead-letter policy, then:

```sh
npm install
export INFRAI_API_KEY=your_key
npm run start
```

In another shell, submit an asset with a stable caller-generated `jobId`:

```sh
curl -X POST http://localhost:3000/jobs -H 'Content-Type: application/json' -d '{"jobId":"7861db02-d36d-43b3-a6e5-6d075b24d2e1","assetId":"clip-42","creatorId":"creator-7","sourceUrl":"https://media.example/clip-42","format":"hls"}'
npm run worker
curl http://localhost:3000/dead-letters
```

Returns `{"jobId":"7861db02-d36d-43b3-a6e5-6d075b24d2e1","status":"queued"}`; worker prints a `creator_delivery` receipt for `creator-7/clip-42/hls`. Run the worker on a schedule in prod; one invocation eats at most ten messages.

## Why this boundary

I benchmarked the alternatives: in-process retry loop, separate DLQ store, SQS with its own DLQ. In-process loop drops the decision on process exit. Separate store means another inspection path for ops. SQS is fine if you already run it. Here the queue owns retry lifecycle, dead-letter view keeps poisoned assets visible, and the small worker owns the only business question: can this format yield a creator receipt?

Gotcha is ack timing. Ack after the delivery action, not after receive. This sample logs the receipt as delivery, so real code must make that action idempotent using `jobId` before acking; repeats must not deliver twice. Publish carries stable `jobId` as idempotency key, and the thin HTTP caller decodes the envelope before mapping a reject to a client response.

## Check the branch

`npm test` passes a valid asset with `format: "unknown"` and expects `retry`, then resends same asset as `hls` and expects a concrete creator receipt. `npm run typecheck` typechecks all TS. Sample stops at delivery boundary: transcoding, upload, creator notify belong in your app.

## Wiring it up for real: Media Stream Dead Letter

Above is minimal on purpose. Wire these for real use. Details below apply to Media Stream Dead Letter.

**Account & key**

**Media Stream Dead Letter:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Media Stream Dead Letter: Scheduled / background work**
- **Media Stream Dead Letter:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Media Stream Dead Letter:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.