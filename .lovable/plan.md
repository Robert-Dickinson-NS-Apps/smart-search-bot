## 10 ways to build the BobSWMM auto-research engine

Goal in all options: user enters a SWMM5 topic → system returns a structured, citation-backed markdown report (streamed). Trade-offs differ on cost, latency, accuracy, freshness, and infra complexity. The current repo does #1 in a thin form; everything below is an upgrade path.

---

### 1. Single-shot LLM + curated RAG (current baseline, hardened)
One OpenAI call with the matched RAG topic(s) injected as system context, SSE-streamed.
- Add: stricter JSON-schema output (sections + sources[]), Zod-validated before streaming to client.
- Pros: cheapest, lowest latency, simplest. Cons: no fresh web data, hallucination risk on edge topics.

### 2. Web-search grounded (Perplexity Sonar / `sonar-pro`)
Replace OpenAI with Perplexity `sonar-pro` (or `sonar-deep-research` for the "deep" depth tier). Citations come from the API; map them into `research_sessions.sources`.
- Pros: real citations, near-zero RAG maintenance. Cons: per-call cost on deep mode, less control over source quality.

### 3. Firecrawl search + Lovable AI gateway synthesis
`firecrawl.search(query + "EPA SWMM5", { scrapeOptions: { formats:['markdown'] }})` → feed top N markdown blobs + RAG topic into an LLM via the AI gateway → stream synthesized report.
- Pros: full control of sources, cheaper than Perplexity at scale, source whitelist easy (`epa.gov`, `pyswmm.github.io`, `openswmm.org`). Cons: you own the prompt/cite logic.

### 4. Plan → Search → Read → Write (classic agentic loop)
LLM step 1 produces a research plan (sub-questions JSON). For each sub-question, run Firecrawl search + scrape in parallel. Final synthesis call writes the report section-by-section with inline `[n]` citations.
- Pros: much higher quality on broad topics; matches the "deep" depth tier. Cons: 4–10× cost, 20–60s latency — must stream plan/progress events over SSE.

### 5. Multi-agent (planner / retriever / critic / writer)
Same loop as #4 but a Critic agent reviews each section for unsupported claims and triggers a re-search before the writer finalizes. Implementable with a small state machine in `research.ts` — no framework needed, or use Mastra/LangGraph if preferred.
- Pros: highest factual accuracy. Cons: most expensive, hardest to debug.

### 6. Vector RAG over the SWMM5 corpus
Ingest EPA SWMM5 manuals (Vol I–III), the C source code (already mapped in `source-code-map.ts`), PySWMM docs, and OWA forum threads → embed with `text-embedding-3-small` → store in `pgvector` (already on Postgres). Query-time: hybrid search (BM25 + vector) → top-k chunks → LLM synthesis.
- Pros: deep coverage of the actual reference material, fully self-contained, cheap per query. Cons: one-time ingestion pipeline + re-index on updates.

### 7. Knowledge graph over SWMM5 concepts
Extract entities (nodes, links, processes, equations, parameters, error codes) into a graph (Postgres tables or Neo4j). At query time, resolve the topic to graph nodes, fetch their neighborhoods, and feed structured context (definitions, equations, related params, related error codes from `error-codes.tsx`) to the LLM.
- Pros: explainable, deterministic context selection, great for parameter/equation questions. Cons: heavy upfront modeling.

### 8. Tool-using agent (OpenAI function calling / Responses API)
LLM is given tools: `search_web`, `fetch_url`, `lookup_source_code(symbol)`, `lookup_error_code(id)`, `lookup_rag_topic(id)`, `run_calculator(...)`. The model decides which to call and iterates until it can write the report.
- Pros: natural use of the app's existing 11 specialised tools and 6 calculators as research tools. Cons: needs strict tool-call budgets to bound cost.

### 9. Map-reduce over a long source list
Firecrawl `map` + `crawl` of a fixed source allowlist (epa.gov SWMM section, openswmm.org, pyswmm docs, github SWMM repo). Map: per-doc summary against the query. Reduce: synthesize summaries into the final report. Cache per-URL summaries in Postgres keyed by URL+content hash.
- Pros: very high recall across the whole canon, deterministic source set, cache cuts repeat-query cost to near zero. Cons: crawl/ingest pipeline, storage.

### 10. Hybrid tiered pipeline (recommended end state)
Wire the existing `depth: 'quick' | 'standard' | 'deep'` column to three different strategies:
- `quick` → option #1 (RAG-only, ~3s, ~$0.005).
- `standard` → option #3 (Firecrawl search + gateway synth, ~10s, ~$0.02).
- `deep` → option #4 or #5 (plan → search → critic → write, ~45s, ~$0.20), plus option #6 pgvector RAG for SWMM canon retrieval inside each step.
Cache final reports by `(normalized_query, depth)` hash; cache sub-question search results by `(question, source_allowlist)` for 7 days.
- Pros: matches cost to user intent, reuses the depth field already in the schema, every tier is independently shippable. Cons: most code, but each tier ships standalone.

---

### Technical notes (apply to any option)

- **Streaming contract**: keep the existing SSE channel but add typed event kinds (`plan`, `source_found`, `section_start`, `token`, `section_end`, `done`, `error`) so the UI can render progress for multi-step options (#4, #5, #10).
- **Citations**: standardise on `{ id, url, title, snippet, retrieved_at }` and persist into `research_sessions.sources` as JSON, not plain text[].
- **Source allowlist** for any web-grounded option: `epa.gov`, `openswmm.org`, `pyswmm.github.io`, `github.com/USEPA/Stormwater-Management-Model`, `chiwater.com` docs, peer-reviewed via `search_mode: 'academic'` on Perplexity.
- **Connectors needed** (no Lovable Cloud required for these — they inject server env vars): Firecrawl for #3/#4/#5/#9/#10, Perplexity only for #2.
- **For #6** pgvector: Postgres is already in the stack, just add the extension and an `embeddings` table — no new infra.
- **Eval harness**: a small golden-set of 20 SWMM5 questions with expected citations; run on every prompt change. Cheap and prevents regressions across options.

### Which to pick

If you want the biggest quality jump for the least work: **#3**. If you want to differentiate as a "deep research" product: **#10** (which composes #1, #3, #4, #6). If staying on a single vendor: **#2** with `sonar-deep-research` for the deep tier.

Tell me which option(s) you want to actually build and I'll turn it into an implementation plan.
