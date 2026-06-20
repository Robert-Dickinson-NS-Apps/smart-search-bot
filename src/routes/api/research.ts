import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  planResearch,
  retrieveSources,
  synthesizeReport,
  validateReport,
  verifySource,
  type ProgressEvent,
  type Source,
} from "@/lib/research-pipeline.server";

const RequestSchema = z.object({
  query: z.string().min(3).max(500),
  strategy: z.enum(["quick", "standard", "deep"]).default("standard"),
});

export const Route = createFileRoute("/api/research")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => null);
        const parsed = RequestSchema.safeParse(body);
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        const { query, strategy } = parsed.data;

        const stream = new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder();
            const send = (e: ProgressEvent) =>
              controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));

            try {
              send({ kind: "stage", stage: "plan", message: "Planning sub-questions…" });
              const questions = await planResearch(query, strategy);
              send({ kind: "plan", questions });

              send({
                kind: "stage",
                stage: "retrieve",
                message: "Retrieving sources via Perplexity sonar-pro…",
              });
              const raw = await retrieveSources(questions, query);

              const verified: Source[] = [];
              await Promise.all(
                raw.map(async (s) => {
                  const v = await verifySource(s);
                  verified.push(v);
                  send({ kind: "source", source: v });
                }),
              );
              verified.sort((a, b) => a.id - b.id);

              send({ kind: "stage", stage: "synthesize", message: "Synthesizing report…" });
              const markdown = await synthesizeReport(query, questions, verified);
              send({ kind: "section", title: "Report", markdown });

              send({ kind: "stage", stage: "validate", message: "Validating citations…" });
              const validation = await validateReport(markdown, verified);
              send({ kind: "validation", report: validation });

              send({ kind: "done", markdown, sources: verified, validation });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              send({ kind: "error", message: msg });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            "x-accel-buffering": "no",
          },
        });
      },
    },
  },
});
