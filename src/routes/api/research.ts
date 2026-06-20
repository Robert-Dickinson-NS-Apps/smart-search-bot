import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  planResearch,
  retrieveSourcesMock,
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
              // Stage 1
              send({ kind: "stage", stage: "plan", message: "Planning sub-questions…" });
              const questions = await planResearch(query, strategy);
              send({ kind: "plan", questions });

              // Stage 2
              send({
                kind: "stage",
                stage: "retrieve",
                message: `Retrieving sources (mock — wire Perplexity to enable live search)…`,
              });
              const raw = await retrieveSourcesMock(questions, query);

              // Verify each source reachable
              const verified: Source[] = [];
              for (const s of raw) {
                const v = await verifySource(s);
                verified.push(v);
                send({ kind: "source", source: v });
              }

              // Stage 3
              send({ kind: "stage", stage: "synthesize", message: "Synthesizing report…" });
              const markdown = await synthesizeReport(query, questions, verified);
              send({ kind: "section", title: "Report", markdown });

              // Stage 4
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
