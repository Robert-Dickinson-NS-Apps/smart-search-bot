import { createFileRoute } from "@tanstack/react-router";
import React, { useState, useRef, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Sparkles,
  ListTree,
  FileText,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BobSWMM Auto-Research" },
      {
        name: "description",
        content:
          "Multi-stage SWMM5 research pipeline with planning, Perplexity retrieval, synthesis, and per-sentence citation validation.",
      },
    ],
  }),
  component: Index,
});

type Strategy = "quick" | "standard" | "deep";
type Source = {
  id: number;
  url: string;
  title: string;
  snippet: string;
  reachable?: boolean;
  http_status?: number;
};
type SentenceAudit = {
  index: number;
  text: string;
  cited_refs: number[];
  status: "ok" | "unsupported" | "missing_ref" | "broken_link";
  reason?: string;
};
type ValidationReport = {
  total_citations: number;
  reachable_count: number;
  broken_links: { id: number; url: string; status: number | string }[];
  missing_refs: number[];
  unsupported_claims: { sentence: string; reason: string }[];
  sentences: SentenceAudit[];
};

const STRATEGIES: { id: Strategy; title: string; desc: string; cost: string }[] = [
  { id: "quick", title: "Quick", desc: "2 sub-questions, fast.", cost: "~10s" },
  { id: "standard", title: "Standard", desc: "4 sub-questions, balanced.", cost: "~25s" },
  { id: "deep", title: "Deep", desc: "6 sub-questions, thorough.", cost: "~60s" },
];

function Index() {
  const [query, setQuery] = useState("");
  const [strategy, setStrategy] = useState<Strategy>("standard");
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [stageMsg, setStageMsg] = useState<string>("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [markdown, setMarkdown] = useState("");
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeRef, setActiveRef] = useState<number | null>(null);
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState(true);
  const [hoverDelayMs, setHoverDelayMs] = useState(150);
  const abortRef = useRef<AbortController | null>(null);

  async function run() {
    if (!query.trim() || running) return;
    setRunning(true);
    setStage(null);
    setStageMsg("");
    setQuestions([]);
    setSources([]);
    setMarkdown("");
    setValidation(null);
    setError(null);
    setActiveRef(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, strategy }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const txt = await res.text();
        throw new Error(`Request failed (${res.status}): ${txt}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const block of events) {
          const line = block.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const evt = JSON.parse(line.slice(6));
          handleEvent(evt);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setRunning(false);
      setStage(null);
    }
  }

  function handleEvent(e: any) {
    switch (e.kind) {
      case "stage":
        setStage(e.stage);
        setStageMsg(e.message);
        break;
      case "plan":
        setQuestions(e.questions);
        break;
      case "source":
        setSources((prev) =>
          prev.some((p) => p.id === e.source.id) ? prev : [...prev, e.source].sort((a, b) => a.id - b.id),
        );
        break;
      case "section":
        setMarkdown(e.markdown);
        break;
      case "validation":
        setValidation(e.report);
        break;
      case "error":
        setError(e.message);
        break;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  const brokenIds = useMemo(
    () => new Set(sources.filter((s) => s.reachable === false).map((s) => s.id)),
    [sources],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <header className="mb-8">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Sparkles className="h-4 w-4" />
            <span>BobSWMM Auto-Research · Perplexity sonar-pro</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Multi-stage SWMM5 research with per-sentence citation audit
          </h1>
          <p className="mt-2 text-muted-foreground">
            Plan → retrieve (Perplexity) → synthesize → validate. Every sentence is
            audited and color-coded inline; click a citation to highlight it in the
            sources sidebar.
          </p>
        </header>

        <Card className="p-6 mb-6">
          <div className="space-y-4">
            <div>
              <Label htmlFor="q" className="text-sm font-medium">Research topic</Label>
              <div className="mt-2 flex gap-2">
                <Input
                  id="q"
                  placeholder="e.g. How does SWMM5 model Green-Ampt infiltration?"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={running}
                  onKeyDown={(e) => e.key === "Enter" && run()}
                />
                {running ? (
                  <Button onClick={cancel} variant="destructive">Stop</Button>
                ) : (
                  <Button onClick={run} disabled={!query.trim()}>
                    <Search className="mr-2 h-4 w-4" /> Research
                  </Button>
                )}
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium">Pipeline strategy</Label>
              <RadioGroup
                value={strategy}
                onValueChange={(v) => setStrategy(v as Strategy)}
                className="mt-2 grid gap-3 md:grid-cols-3"
                disabled={running}
              >
                {STRATEGIES.map((s) => (
                  <label
                    key={s.id}
                    htmlFor={s.id}
                    className={`relative cursor-pointer rounded-lg border p-3 transition ${
                      strategy === s.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value={s.id} id={s.id} />
                        <span className="font-medium">{s.title}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs">{s.cost}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{s.desc}</p>
                  </label>
                ))}
              </RadioGroup>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="preview-toggle" className="text-sm font-medium">Citation hover previews</Label>
                <Switch
                  id="preview-toggle"
                  checked={hoverPreviewEnabled}
                  onCheckedChange={setHoverPreviewEnabled}
                />
              </div>
              {hoverPreviewEnabled && (
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Hover delay</Label>
                    <span className="text-xs font-mono">{hoverDelayMs}ms</span>
                  </div>
                  <Slider
                    value={[hoverDelayMs]}
                    onValueChange={(v) => setHoverDelayMs(v[0])}
                    min={0}
                    max={1000}
                    step={50}
                    className="mt-2"
                  />
                </div>
              )}
            </div>
          </div>
        </Card>

        {error && (
          <Card className="p-4 mb-6 border-destructive bg-destructive/10">
            <div className="flex items-start gap-2 text-destructive">
              <XCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Error</div>
                <div className="text-sm">{error}</div>
              </div>
            </div>
          </Card>
        )}

        {(running || stage) && (
          <Card className="p-4 mb-6">
            <div className="flex items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm font-medium capitalize">{stage}</span>
              <span className="text-sm text-muted-foreground">{stageMsg}</span>
            </div>
            <div className="mt-3 flex gap-2 text-xs">
              {["plan", "retrieve", "synthesize", "validate"].map((s) => (
                <Badge
                  key={s}
                  variant={
                    stage === s
                      ? "default"
                      : stagePassed(stage, s, !!markdown, !!validation)
                        ? "secondary"
                        : "outline"
                  }
                >
                  {s}
                </Badge>
              ))}
            </div>
          </Card>
        )}

        {questions.length > 0 && (
          <Card className="p-5 mb-6">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
              <ListTree className="h-4 w-4" /> Research plan
            </div>
            <ol className="space-y-1.5 text-sm list-decimal pl-5">
              {questions.map((q, i) => <li key={i}>{q}</li>)}
            </ol>
          </Card>
        )}

        {/* Two-column report + sidebar */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            {markdown && (
              <Card className="p-6 mb-6">
                <div className="flex items-center gap-2 mb-4 text-sm font-semibold">
                  <FileText className="h-4 w-4" /> Report
                  {validation && <AuditLegend />}
                </div>
                {validation ? (
                  <AuditedMarkdown
                    markdown={markdown}
                    sentences={validation.sentences}
                    activeRef={activeRef}
                    setActiveRef={setActiveRef}
                    brokenIds={brokenIds}
                    hoverPreviewEnabled={hoverPreviewEnabled}
                    hoverDelayMs={hoverDelayMs}
                  />
                ) : (
                  <div className="markdown-body text-sm leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
                  </div>
                )}
              </Card>
            )}

            {validation && (
              <Card className="p-5 mb-6">
                <div className="flex items-center gap-2 mb-4 text-sm font-semibold">
                  <ShieldCheck className="h-4 w-4" /> Validation summary
                </div>
                <div className="grid gap-3 md:grid-cols-4 mb-4">
                  <Stat label="Citations" value={validation.total_citations} tone="default" />
                  <Stat
                    label="Reachable"
                    value={`${validation.reachable_count}/${sources.length}`}
                    tone={validation.reachable_count === sources.length ? "good" : "warn"}
                  />
                  <Stat
                    label="Sentences audited"
                    value={validation.sentences.length}
                    tone="default"
                  />
                  <Stat
                    label="Issues"
                    value={validation.sentences.filter((s) => s.status !== "ok").length}
                    tone={
                      validation.sentences.filter((s) => s.status !== "ok").length === 0
                        ? "good"
                        : "warn"
                    }
                  />
                </div>
                {validation.sentences.filter((s) => s.status !== "ok").length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" /> Every sentence is supported by a reachable source.
                  </div>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {validation.sentences
                      .filter((s) => s.status !== "ok")
                      .map((s) => (
                        <li key={s.index} className="rounded border border-amber-500/30 bg-amber-500/5 p-2">
                          <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3" />
                            {s.status.replace("_", " ")}
                            {s.reason && <span className="font-normal text-muted-foreground">— {s.reason}</span>}
                          </div>
                          <div className="mt-1 text-foreground/80">"{s.text}"</div>
                        </li>
                      ))}
                  </ul>
                )}
              </Card>
            )}
          </div>

          {/* Citations sidebar */}
          {sources.length > 0 && (
            <aside className="lg:sticky lg:top-6 lg:self-start">
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
                  <ExternalLink className="h-4 w-4" /> Sources ({sources.length})
                </div>
                <ul className="space-y-2">
                  {sources.map((s) => {
                    const isActive = activeRef === s.id;
                    const usageCount = (markdown.match(new RegExp(`\\[${s.id}\\]`, "g")) || []).length;
                    return (
                      <li key={s.id}>
                        <button
                          onClick={() => setActiveRef(isActive ? null : s.id)}
                          className={`w-full text-left rounded-md border p-2.5 text-xs transition ${
                            isActive
                              ? "border-primary bg-primary/10"
                              : "border-border hover:bg-muted/50"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <Badge variant="outline" className="font-mono shrink-0 text-[10px]">
                              [{s.id}]
                            </Badge>
                            <div className="min-w-0 flex-1">
                              <div className="font-medium break-words line-clamp-2">{s.title}</div>
                              <div className="flex items-center flex-wrap gap-1 mt-1">
                                {s.reachable === true && (
                                  <Badge className="text-[10px] gap-0.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 hover:bg-emerald-100">
                                    <CheckCircle2 className="h-2.5 w-2.5" />
                                    {s.http_status}
                                  </Badge>
                                )}
                                {s.reachable === false && (
                                  <Badge variant="destructive" className="text-[10px] gap-0.5">
                                    <XCircle className="h-2.5 w-2.5" />
                                    {s.http_status || "fail"}
                                  </Badge>
                                )}
                                {s.reachable === undefined && (
                                  <Badge variant="outline" className="text-[10px]">checking…</Badge>
                                )}
                                <Badge variant="secondary" className="text-[10px]">
                                  {usageCount} use{usageCount === 1 ? "" : "s"}
                                </Badge>
                              </div>
                              <div className="text-muted-foreground truncate mt-1">{s.url}</div>
                              <a
                                href={s.url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-block mt-1 text-primary hover:underline"
                              >
                                Open ↗
                              </a>
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {activeRef !== null && (
                  <button
                    onClick={() => setActiveRef(null)}
                    className="mt-3 w-full text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear highlight
                  </button>
                )}
              </Card>
            </aside>
          )}
        </div>

        <Separator className="my-8" />
        <p className="text-xs text-muted-foreground">
          Retrieval grounded by Perplexity <code>sonar-pro</code>. Sentences with no
          citation are flagged <span className="text-destructive">unsupported</span>;
          citations to missing sources are <span className="text-amber-600">amber</span>;
          citations to unreachable URLs are <span className="text-orange-600">orange</span>.
        </p>
      </div>
    </div>
  );
}

// ─── Audit-aware markdown renderer ──────────────────────────────────────────
function AuditedMarkdown({
  markdown,
  sentences,
  activeRef,
  setActiveRef,
  brokenIds,
  hoverPreviewEnabled,
  hoverDelayMs,
}: {
  markdown: string;
  sentences: SentenceAudit[];
  activeRef: number | null;
  setActiveRef: (n: number | null) => void;
  brokenIds: Set<number>;
  hoverPreviewEnabled: boolean;
  hoverDelayMs: number;
}) {
  // Map: sentence text → audit (best-effort exact-match; sentences are unique enough)
  const lookup = useMemo(() => {
    const m = new Map<string, SentenceAudit>();
    for (const s of sentences) m.set(s.text, s);
    return m;
  }, [sentences]);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePreviewRef = useRef<number | null>(null);
  const schedulePreview = (idx: number) => {
    if (!hoverPreviewEnabled) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      previewSentenceCitations(idx);
      activePreviewRef.current = idx;
    }, hoverDelayMs);
  };
  const clearPreview = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (activePreviewRef.current !== null) {
      clearSentencePreview(activePreviewRef.current);
      activePreviewRef.current = null;
    }
  };

  return (
    <div className="markdown-body text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p>{renderInline(children, lookup, activeRef, setActiveRef, brokenIds, schedulePreview, clearPreview)}</p>
          ),
          li: ({ children }) => (
            <li>{renderInline(children, lookup, activeRef, setActiveRef, brokenIds, schedulePreview, clearPreview)}</li>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function renderInline(
  children: React.ReactNode,
  lookup: Map<string, SentenceAudit>,
  activeRef: number | null,
  setActiveRef: (n: number | null) => void,
  brokenIds: Set<number>,
  schedulePreview: (idx: number) => void,
  clearPreview: () => void,
): React.ReactNode {
  const out: React.ReactNode[] = [];
  let key = 0;
  const handle = (node: React.ReactNode) => {
    if (typeof node === "string") {
      out.push(...splitText(node, lookup, activeRef, setActiveRef, brokenIds, schedulePreview, clearPreview, () => key++));
    } else if (Array.isArray(node)) {
      node.forEach(handle);
    } else {
      out.push(<span key={key++}>{node}</span>);
    }
  };
  handle(children);
  return out;
}

function jumpToSentenceCitations(
  sentenceIdx: number,
  firstRef: number | null,
  setActiveRef: (n: number | null) => void,
) {
  if (firstRef !== null) setActiveRef(firstRef);
  requestAnimationFrame(() => {
    const pills = document.querySelectorAll<HTMLElement>(
      `[data-sentence-idx="${sentenceIdx}"].cite-ref`,
    );
    if (!pills.length) return;
    pills[0].scrollIntoView({ behavior: "smooth", block: "center" });
    pills.forEach((p) => {
      p.classList.remove("cite-flash");
      void p.offsetWidth;
      p.classList.add("cite-flash");
    });
  });
}

function previewSentenceCitations(sentenceIdx: number) {
  const pills = document.querySelectorAll<HTMLElement>(
    `[data-sentence-idx="${sentenceIdx}"].cite-ref`,
  );
  pills.forEach((p) => p.classList.add("cite-preview"));
}

function clearSentencePreview(sentenceIdx: number) {
  const pills = document.querySelectorAll<HTMLElement>(
    `[data-sentence-idx="${sentenceIdx}"].cite-ref`,
  );
  pills.forEach((p) => p.classList.remove("cite-preview"));
}

function splitText(
  text: string,
  lookup: Map<string, SentenceAudit>,
  activeRef: number | null,
  setActiveRef: (n: number | null) => void,
  brokenIds: Set<number>,
  schedulePreview: (idx: number) => void,
  clearPreview: () => void,
  nextKey: () => number,
): React.ReactNode[] {
  const sentenceRe = /[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g;
  const out: React.ReactNode[] = [];
  let m: RegExpExecArray | null;
  let lastIdx = 0;
  while ((m = sentenceRe.exec(text)) !== null) {
    if (m.index > lastIdx) out.push(text.slice(lastIdx, m.index));
    const raw = m[0];
    const trimmed = raw.trim();
    const audit = lookup.get(trimmed);
    const cls =
      audit?.status === "unsupported"
        ? "audit-sentence audit-unsupported"
        : audit?.status === "missing_ref"
          ? "audit-sentence audit-missing-ref"
          : audit?.status === "broken_link"
            ? "audit-sentence audit-broken-link"
            : "audit-sentence audit-ok";
    const flagged = !!audit && audit.status !== "ok";
    const refs = audit?.cited_refs ?? [];
    const firstRef = refs[0] ?? null;
    const tip = audit
      ? (audit.reason ?? "Supported") +
        (flagged
          ? refs.length
            ? ` — click to jump to [${refs.join("] [")}]`
            : " — no inline citations"
          : "")
      : undefined;
    const hasRefs = refs.length > 0 && audit != null;
    out.push(
      <span
        key={nextKey()}
        className={cls + (flagged ? " audit-clickable" : "")}
        title={tip}
        role={flagged ? "button" : undefined}
        tabIndex={flagged ? 0 : undefined}
        onMouseEnter={
          hasRefs
            ? () => schedulePreview(audit.index)
            : undefined
        }
        onMouseLeave={
          hasRefs
            ? () => clearPreview()
            : undefined
        }
        onFocus={
          flagged && audit
            ? () => schedulePreview(audit.index)
            : undefined
        }
        onBlur={
          flagged && audit
            ? () => clearPreview()
            : undefined
        }
        onClick={
          flagged && audit
            ? (e) => {
                e.stopPropagation();
                jumpToSentenceCitations(audit.index, firstRef, setActiveRef);
              }
            : undefined
        }
        onKeyDown={
          flagged && audit
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  jumpToSentenceCitations(audit.index, firstRef, setActiveRef);
                }
              }
            : undefined
        }
      >
        {renderCitations(raw, audit?.index ?? null, activeRef, setActiveRef, brokenIds, nextKey)}
      </span>,
    );
    lastIdx = m.index + raw.length;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return out;
}

function renderCitations(
  text: string,
  sentenceIdx: number | null,
  activeRef: number | null,
  setActiveRef: (n: number | null) => void,
  brokenIds: Set<number>,
  nextKey: () => number,
): React.ReactNode[] {
  const re = /\[(\d+)\]/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const n = Number(m[1]);
    const broken = brokenIds.has(n);
    out.push(
      <span
        key={nextKey()}
        data-sentence-idx={sentenceIdx ?? undefined}
        data-cite-n={n}
        className={`cite-ref ${activeRef === n ? "cite-active" : ""} ${broken ? "cite-broken" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          setActiveRef(activeRef === n ? null : n);
        }}
      >
        [{n}]
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function AuditLegend() {
  return (
    <span className="ml-auto flex items-center gap-2 text-[11px] font-normal text-muted-foreground">
      <LegendDot className="audit-unsupported" label="unsupported" />
      <LegendDot className="audit-missing-ref" label="missing ref" />
      <LegendDot className="audit-broken-link" label="broken link" />
    </span>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`audit-sentence ${className} inline-block w-3 h-3 rounded-sm`} />
      {label}
    </span>
  );
}

function stagePassed(
  current: string | null,
  s: string,
  hasMarkdown: boolean,
  hasValidation: boolean,
) {
  const order = ["plan", "retrieve", "synthesize", "validate"];
  if (hasValidation) return true;
  if (s === "validate") return false;
  if (s === "synthesize" && hasMarkdown) return true;
  if (current && order.indexOf(s) < order.indexOf(current)) return true;
  return false;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "default" | "good" | "warn";
}) {
  const colors =
    tone === "good"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : tone === "warn"
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-border";
  return (
    <div className={`rounded-lg border p-3 ${colors}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}
