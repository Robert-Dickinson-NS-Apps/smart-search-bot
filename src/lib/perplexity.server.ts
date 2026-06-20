// Perplexity sonar-pro retrieval. Server-only.
import type { Source } from "./research-pipeline.server";

type PplxResponse = {
  choices: { message: { content: string } }[];
  citations?: string[];
  search_results?: { title?: string; url: string; snippet?: string; date?: string }[];
};

async function callPerplexity(query: string, apiKey: string): Promise<PplxResponse> {
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [
        {
          role: "system",
          content:
            "You are a research assistant. Answer concisely with citations. Prioritise authoritative SWMM5 / EPA / academic / engineering sources.",
        },
        { role: "user", content: query },
      ],
      return_citations: true,
      return_images: false,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Perplexity ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

export async function perplexityRetrieve(
  questions: string[],
  topic: string,
): Promise<Source[]> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not configured");

  const queries = [topic, ...questions].slice(0, 5);
  const seen = new Map<string, Source>();
  let nextId = 1;
  const now = new Date().toISOString();

  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        return { q, data: await callPerplexity(q, apiKey) };
      } catch (e) {
        return { q, error: (e as Error).message };
      }
    }),
  );

  for (const r of results) {
    if (!("data" in r) || !r.data) continue;
    const data = r.data;
    // Prefer search_results (rich metadata); fall back to citations[].
    if (data.search_results && data.search_results.length) {
      for (const sr of data.search_results) {
        if (!sr.url || seen.has(sr.url)) continue;
        seen.set(sr.url, {
          id: nextId++,
          url: sr.url,
          title: sr.title || sr.url,
          snippet: sr.snippet || `Cited by Perplexity for: "${r.q}"`,
          retrieved_at: now,
        });
      }
    } else if (data.citations) {
      for (const url of data.citations) {
        if (!url || seen.has(url)) continue;
        seen.set(url, {
          id: nextId++,
          url,
          title: url,
          snippet: `Cited by Perplexity for: "${r.q}"`,
          retrieved_at: now,
        });
      }
    }
  }

  return Array.from(seen.values()).slice(0, 12);
}
