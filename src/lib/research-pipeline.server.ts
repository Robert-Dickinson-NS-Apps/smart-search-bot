import { generateText, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

export type Source = {
  id: number;
  url: string;
  title: string;
  snippet: string;
  retrieved_at: string;
  reachable?: boolean;
  http_status?: number;
};

export type ProgressEvent =
  | { kind: "stage"; stage: string; message: string }
  | { kind: "plan"; questions: string[] }
  | { kind: "source"; source: Source }
  | { kind: "section"; title: string; markdown: string }
  | { kind: "validation"; report: ValidationReport }
  | { kind: "done"; markdown: string; sources: Source[]; validation: ValidationReport }
  | { kind: "error"; message: string };

export type ValidationReport = {
  total_citations: number;
  reachable_count: number;
  broken_links: { id: number; url: string; status: number | string }[];
  missing_refs: number[]; // [n] used in text but no matching source
  unsupported_claims: { sentence: string; reason: string }[];
};

export type Strategy = "quick" | "standard" | "deep";

const SWMM_SOURCES = [
  {
    url: "https://www.epa.gov/water-research/storm-water-management-model-swmm",
    title: "EPA Storm Water Management Model (SWMM) — Official Page",
    snippet:
      "EPA SWMM is a dynamic rainfall-runoff simulation model used for single-event or long-term simulation of runoff quantity and quality from primarily urban areas.",
  },
  {
    url: "https://www.openswmm.org/",
    title: "Open SWMM — Community Knowledge Base",
    snippet:
      "OpenSWMM aggregates SWMM5 user knowledge: forum threads, modeling tips, parameter guidance, and discussions of LID, hydrology, hydraulics and water quality.",
  },
  {
    url: "https://pyswmm.github.io/pyswmm/",
    title: "PySWMM Documentation",
    snippet:
      "PySWMM is the Python wrapper for the EPA SWMM5 toolkit, exposing nodes, links, subcatchments, simulation control and the OWA Toolkit API.",
  },
  {
    url: "https://github.com/USEPA/Stormwater-Management-Model",
    title: "USEPA/Stormwater-Management-Model — Source",
    snippet:
      "Canonical SWMM5 C source code, including hydraulics, hydrology, water-quality and dynamic-wave routing modules. Useful for grounding equations and error codes.",
  },
  {
    url: "https://www.chiwater.com/Files/SWMM5_Reference_Manual_Vol_I_Hydrology.pdf",
    title: "SWMM5 Reference Manual Vol. I — Hydrology",
    snippet:
      "Authoritative description of SWMM5 hydrology: subcatchment runoff, infiltration (Horton, Green-Ampt, Curve Number), snowmelt, and groundwater modules.",
  },
];

function getModel() {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  return createLovableAiGatewayProvider(key)("google/gemini-3-flash-preview");
}

// ─── Stage 1: Plan ──────────────────────────────────────────────────────────
export async function planResearch(query: string, strategy: Strategy): Promise<string[]> {
  const targetCount = strategy === "deep" ? 6 : strategy === "standard" ? 4 : 2;
  const { output } = await generateText({
    model: getModel(),
    output: Output.object({
      schema: z.object({
        sub_questions: z.array(z.string()).min(1).max(8),
      }),
    }),
    prompt: `You are a SWMM5 (EPA Storm Water Management Model) research planner. Decompose the user's topic into ${targetCount} focused sub-questions that, answered together, would form a comprehensive briefing. Be specific to SWMM5 (hydrology, hydraulics, water quality, LID, parameters, error codes, PySWMM).\n\nTopic: ${query}`,
  });
  return output.sub_questions.slice(0, targetCount);
}

// ─── Stage 2: Retrieve (MOCK — wire Perplexity later) ───────────────────────
export async function retrieveSourcesMock(
  questions: string[],
  query: string,
): Promise<Source[]> {
  // Mock retrieval: return canonical SWMM5 sources with a query-tagged snippet.
  // TODO: replace with Perplexity sonar-pro call (see /lib/perplexity.server.ts).
  const now = new Date().toISOString();
  const picks = strategyPick(SWMM_SOURCES, questions.length + 2);
  return picks.map((s, i) => ({
    id: i + 1,
    url: s.url,
    title: s.title,
    snippet: `[MOCK] ${s.snippet} — relevant to: "${query}"`,
    retrieved_at: now,
  }));
}

function strategyPick<T>(arr: T[], n: number): T[] {
  return arr.slice(0, Math.min(n, arr.length));
}

// ─── Reachability check ─────────────────────────────────────────────────────
export async function verifySource(src: Source): Promise<Source> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(src.url, {
      method: "GET",
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "BobSWMM-Research/1.0" },
    });
    clearTimeout(t);
    return { ...src, reachable: res.ok, http_status: res.status };
  } catch {
    return { ...src, reachable: false, http_status: 0 };
  }
}

// ─── Stage 3: Synthesize ────────────────────────────────────────────────────
export async function synthesizeReport(
  query: string,
  questions: string[],
  sources: Source[],
): Promise<string> {
  const sourceList = sources
    .map((s) => `[${s.id}] ${s.title} — ${s.url}\n   ${s.snippet}`)
    .join("\n");
  const { text } = await generateText({
    model: getModel(),
    prompt: `You are writing a technical briefing on EPA SWMM5. Write a structured markdown report answering the topic.

Topic: ${query}

Sub-questions to address as sections:
${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Sources (cite EVERY factual claim using [n] inline; never invent sources):
${sourceList}

Rules:
- Use H2 (##) for each section.
- Every non-trivial sentence must end with at least one [n] citation that maps to the sources above.
- If a claim cannot be supported by the sources, prefix it with "Unverified:".
- End with a "## Sources" section listing all [n] used.`,
  });
  return text;
}

// ─── Stage 4: Validate citations & claims ───────────────────────────────────
export async function validateReport(
  markdown: string,
  sources: Source[],
): Promise<ValidationReport> {
  // Find all [n] refs in the body
  const refs = Array.from(markdown.matchAll(/\[(\d+)\]/g)).map((m) => Number(m[1]));
  const uniqueRefs = Array.from(new Set(refs));
  const sourceIds = new Set(sources.map((s) => s.id));
  const missing_refs = uniqueRefs.filter((n) => !sourceIds.has(n));

  const broken_links = sources
    .filter((s) => s.reachable === false)
    .map((s) => ({ id: s.id, url: s.url, status: s.http_status ?? "network_error" }));

  // Use the model to spot unsupported claims (sentences w/ no citation)
  let unsupported_claims: ValidationReport["unsupported_claims"] = [];
  try {
    const { output } = await generateText({
      model: getModel(),
      output: Output.object({
        schema: z.object({
          unsupported: z
            .array(
              z.object({
                sentence: z.string(),
                reason: z.string(),
              }),
            )
            .max(10),
        }),
      }),
      prompt: `Audit this markdown research report. List up to 10 sentences that make factual claims but have NO inline [n] citation, OR cite a source that does not plausibly support the claim. Skip headings, list scaffolding, and clearly hedged statements ("Unverified:" prefix is allowed).

Sources available:
${sources.map((s) => `[${s.id}] ${s.title}: ${s.snippet}`).join("\n")}

Report:
${markdown}`,
    });
    unsupported_claims = output.unsupported;
  } catch {
    // best-effort
  }

  return {
    total_citations: refs.length,
    reachable_count: sources.filter((s) => s.reachable).length,
    broken_links,
    missing_refs,
    unsupported_claims,
  };
}
