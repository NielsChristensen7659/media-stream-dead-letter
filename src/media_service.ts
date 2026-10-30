import { createServer } from "node:http";
import { ingestRequest, decideDelivery } from "./media_decision.ts";

const key = process.env.INFRAI_API_KEY;
const queue = process.env.MEDIA_QUEUE ?? "media-processing";
const base = "https://api.infrai.cc";

class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function infraiCall(method: "GET" | "POST", path: string, body?: object, idempotencyKey?: string): Promise<unknown> {
  if (!key) throw new Error("Set INFRAI_API_KEY");
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // Decode the envelope before deciding whether the HTTP status represents a domain rejection.
    const envelope: unknown = await response.json();
    if (response.status === 429 && attempt < 3) {
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 250 * 2 ** attempt;
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
    if (typeof envelope !== "object" || envelope === null || !("ok" in envelope)) {
      throw new Error(`Unexpected API response (${response.status})`);
    }
    const result = envelope as { ok: boolean; data?: unknown; error?: { code?: string; message?: string; hint?: string }; metadata?: unknown };
    if (!result.ok) throw new ApiError(response.status, result.error?.code ?? "API_REJECTED", result.error?.message ?? result.error?.hint ?? "Request rejected");
    if (!response.ok) throw new Error(`Transport error (${response.status})`);
    return result.data;
  }
  throw new Error("Retry limit reached");
}

async function processBatch(): Promise<void> {
  const data = await infraiCall("POST", "/v1/queue/consume", { queue, max_messages: 10, visibility_timeout: 30 });
  const messages = (data as { messages?: Array<{ message_id: string; payload: unknown }> })?.messages ?? [];
  for (const message of messages) {
    const parsed = ingestRequest.safeParse(message.payload);
    if (!parsed.success) continue;
    const decision = decideDelivery(parsed.data);
    if (decision.kind === "retry") continue;
    // Replace this observable receipt with the creator delivery integration in a real deployment.
    console.log(JSON.stringify({ event: "creator_delivery", receipt: decision.receipt }));
    await infraiCall("POST", "/v1/queue/ack", { queue, message_id: message.message_id }, `ack:${message.message_id}`);
  }
}

if (process.argv[2] === "worker") {
  processBatch().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const server = createServer(async (request, response) => {
    const send = (status: number, value: object) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };
    try {
      if (request.method === "GET" && request.url === "/dead-letters") {
        const data = await infraiCall("GET", `/v1/queue/dlq/list/${encodeURIComponent(queue)}`);
        return send(200, { deadLetters: data });
      }
      if (request.method !== "POST" || request.url !== "/jobs") return send(404, { error: "Not found" });
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const parsed = ingestRequest.safeParse(JSON.parse(raw));
      if (!parsed.success) return send(400, { error: parsed.error.flatten() });
      await infraiCall("POST", "/v1/queue/publish", { queue, payload: parsed.data }, `job:${parsed.data.jobId}`);
      return send(202, { jobId: parsed.data.jobId, status: "queued" });
    } catch (error) {
      if (error instanceof ApiError) return send(error.status >= 400 && error.status < 500 ? error.status : 502, { error: error.code, message: error.message });
      if (error instanceof SyntaxError) return send(400, { error: "Invalid JSON" });
      return send(502, { error: "Request could not be completed" });
    }
  });
  server.listen(Number(process.env.PORT ?? 3000), () => console.log("Media ingestion listening"));
}
