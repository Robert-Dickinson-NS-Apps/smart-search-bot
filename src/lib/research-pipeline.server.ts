import { generateText, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { perplexityRetrieve } from "./perplexity.server";

export type Source = {
  id: number;
  url: string;
  title: string;
  snippet: string;
  retrieved_at: string;
  reachable?: boolean;
  http_status?: number;
};

export type SentenceAudit = {
  index: number;
  text: string;
  cited_refs: number[];
  status: "ok" | "unsupported" | "missing_ref" | "broken_link";
  reason?: string;
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
  missing_refs: number[];
  unsupported_claims: { sentence: string; reason: string }[];
  sentences: SentenceAudit[];
};

export type Strategy = "quick" | "standard" | "deep";

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

// ─── Stage 2: Retrieve via Perplexity sonar-pro ─────────────────────────────
export async function retrieveSources(
  questions: string[],
  query: string,
): Promise<Source[]> {
  return perplexityRetrieve(questions, query);
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

// ─── Stage 4: Validate citations & per-sentence audit ───────────────────────

// Extract sentences from prose blocks of the markdown (skip headings/lists/code).
function extractSentences(markdown: string): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  const lines = markdown.split("\n");
  let inCode = false;
  let cursor = 0;
  for (const line of lines) {
    const lineStart = cursor;
    cursor += line.length + 1;
    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#{1,6}\s/.test(trimmed)) continue;
    if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) continue;
    if (/^\|/.test(trimmed)) continue;

    // Sentence split on .!? followed by space/EOL
    const re = /[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const text = m[0].trim();
      if (text.length < 20) continue; // skip stubs
      out.push({ text, offset: lineStart + m.index });
    }
  }
  return out;
}

export async function validateReport(
  markdown: string,
  sources: Source[],
): Promise<ValidationReport> {
  const refs = Array.from(markdown.matchAll(/\[(\d+)\]/g)).map((m) => Number(m[1]));
  const sourceIds = new Set(sources.map((s) => s.id));
  const brokenIds = new Set(
    sources.filter((s) => s.reachable === false).map((s) => s.id),
  );
  const uniqueRefs = Array.from(new Set(refs));
  const missing_refs = uniqueRefs.filter((n) => !sourceIds.has(n));

  const broken_links = sources
    .filter((s) => s.reachable === false)
    .map((s) => ({ id: s.id, url: s.url, status: s.http_status ?? "network_error" }));

  // Per-sentence baseline classification
  const sentences = extractSentences(markdown);
  const baseline: SentenceAudit[] = sentences.map((s, i) => {
    const cited = Array.from(s.text.matchAll(/\[(\d+)\]/g)).map((m) => Number(m[1]));
    let status: SentenceAudit["status"] = "ok";
    let reason: string | undefined;
    if (cited.length === 0) {
      // hedged / unverified prefix is fine
      if (!/unverified[: ]/i.test(s.text)) {
        status = "unsupported";
        reason = "No inline [n] citation";
      }
    } else {
      const missing = cited.filter((n) => !sourceIds.has(n));
      const broken = cited.filter((n) => brokenIds.has(n));
      if (missing.length) {
        status = "missing_ref";
        reason = `Cites [${missing.join(", ")}] but no such source was retrieved`;
      } else if (broken.length) {
        status = "broken_link";
        reason = `Cites [${broken.join(", ")}] which is unreachable`;
      }
    }
    return { index: i, text: s.text, cited_refs: cited, status, reason };
  });

  // Ask the model to upgrade verdicts: claims with citations that don't actually
  // support them get bumped to "unsupported".
  let llmFlags: { index: number; reason: string }[] = [];
  try {
    const { output } = await generateText({
      model: getModel(),
      output: Output.object({
        schema: z.object({
          flags: z
            .array(z.object({ index: z.number(), reason: z.string() }))
            .max(15),
        }),
      }),
      prompt: `Audit each sentence below. Return up to 15 sentence indices where the cited [n] sources do NOT plausibly support the factual claim. Skip sentences with no citation (already flagged), and skip sentences prefixed with "Unverified:".

Sources:
${sources.map((s) => `[${s.id}] ${s.title}: ${s.snippet}`).join("\n")}

Sentences:
${baseline
  .filter((b) => b.cited_refs.length > 0)
  .map((b) => `#${b.index} (cites ${b.cited_refs.join(",")}): ${b.text}`)
  .join("\n")}`,
    });
    llmFlags = output.flags;
  } catch {
    // best-effort
  }

  for (const f of llmFlags) {
    const s = baseline[f.index];
    if (s && s.status === "ok") {
      s.status = "unsupported";
      s.reason = f.reason;
    }
  }

  const unsupported_claims = baseline
    .filter((b) => b.status === "unsupported")
    .map((b) => ({ sentence: b.text, reason: b.reason ?? "Unsupported" }));

  return {
    total_citations: refs.length,
    reachable_count: sources.filter((s) => s.reachable).length,
    broken_links,
    missing_refs,
    unsupported_claims,
    sentences: baseline,
  };
}
