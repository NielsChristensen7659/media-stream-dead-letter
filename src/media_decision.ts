import { z } from "zod";

export const ingestRequest = z.object({
  jobId: z.string().uuid(),
  assetId: z.string().min(1),
  creatorId: z.string().min(1),
  sourceUrl: z.string().url(),
  format: z.enum(["mp4", "hls", "unknown"]),
}).strict();

export type MediaJob = z.infer<typeof ingestRequest>;

export function decideDelivery(job: MediaJob): { kind: "deliver"; receipt: string } | { kind: "retry" } {
  if (job.format === "unknown") return { kind: "retry" };
  return { kind: "deliver", receipt: `${job.creatorId}/${job.assetId}/${job.format}` };
}
