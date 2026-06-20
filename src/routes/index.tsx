import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
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

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BobSWMM Auto-Research" },
      {
        name: "description",
        content:
          "Multi-stage SWMM5 research pipeline with planning, retrieval, synthesis, and citation validation.",
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
type ValidationReport = {
  total_citations: number;
  reachable_count: number;
  broken_links: { id: number; url: string; status: number | string }[];
  missing_refs: number[];
  unsupported_claims: { sentence: string; reason: string }[];
};

const STRATEGIES: { id: Strategy; title: string; desc: string; cost: string }[] = [
  {
    id: "quick",
    title: "Quick",
    desc: "Single-shot synthesis, 2 sub-questions. Fastest answer.",
    cost: "~3s",
  },
  {
    id: "standard",
    title: "Standard",
    desc: "Plan → retrieve → synthesize, 4 sub-questions. Balanced.",
    cost: "~10s",
  },
  {
    id: "deep",
    title: "Deep",
    desc: "Plan → retrieve → synthesize → validate, 6 sub-questions. Most thorough.",
    cost: "~30s",
  },
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
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message);
      }
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
        setSources((prev) => [...prev, e.source]);
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Sparkles className="h-4 w-4" />
            <span>BobSWMM Auto-Research</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Multi-stage SWMM5 research with citation validation
          </h1>
          <p className="mt-2 text-muted-foreground">
            Plan → retrieve → synthesize → validate. Every claim is grounded in a
            verified source, every link is checked, and unsupported statements are
            flagged.
          </p>
        </header>

        <Card className="p-6 mb-6">
          <div className="space-y-4">
            <div>
              <Label htmlFor="q" className="text-sm font-medium">
                Research topic
              </Label>
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
                  <Button onClick={cancel} variant="destructive">
                    Stop
                  </Button>
                ) : (
                  <Button onClick={run} disabled={!query.trim()}>
                    <Search className="mr-2 h-4 w-4" />
                    Research
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
                      strategy === s.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value={s.id} id={s.id} />
                        <span className="font-medium">{s.title}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {s.cost}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{s.desc}</p>
                  </label>
                ))}
              </RadioGroup>
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
              {questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          </Card>
        )}

        {sources.length > 0 && (
          <Card className="p-5 mb-6">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
              <ExternalLink className="h-4 w-4" /> Sources ({sources.length})
            </div>
            <ul className="space-y-3">
              {sources.map((s) => (
                <li key={s.id} className="text-sm">
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="font-mono shrink-0">
                      [{s.id}]
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary hover:underline break-words"
                      >
                        {s.title}
                      </a>
                      <div className="flex items-center gap-2 mt-0.5">
                        {s.reachable === true && (
                          <Badge
                            variant="secondary"
                            className="text-xs gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            {s.http_status}
                          </Badge>
                        )}
                        {s.reachable === false && (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <XCircle className="h-3 w-3" />
                            {s.http_status || "unreachable"}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground truncate">
                          {s.url}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {s.snippet}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {markdown && (
          <Card className="p-6 mb-6">
            <div className="flex items-center gap-2 mb-4 text-sm font-semibold">
              <FileText className="h-4 w-4" /> Report
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
            </div>
          </Card>
        )}

        {validation && (
          <Card className="p-5 mb-6">
            <div className="flex items-center gap-2 mb-4 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4" /> Citation validation
            </div>
            <div className="grid gap-3 md:grid-cols-3 mb-4">
              <Stat
                label="Citations used"
                value={validation.total_citations}
                tone="default"
              />
              <Stat
                label="Reachable sources"
                value={`${validation.reachable_count} / ${sources.length}`}
                tone={
                  validation.reachable_count === sources.length ? "good" : "warn"
                }
              />
              <Stat
                label="Issues flagged"
                value={
                  validation.broken_links.length +
                  validation.missing_refs.length +
                  validation.unsupported_claims.length
                }
                tone={
                  validation.broken_links.length +
                    validation.missing_refs.length +
                    validation.unsupported_claims.length ===
                  0
                    ? "good"
                    : "warn"
                }
              />
            </div>

            {validation.broken_links.length > 0 && (
              <Issue
                title="Broken or unreachable links"
                items={validation.broken_links.map(
                  (b) => `[${b.id}] ${b.url} — status ${b.status}`,
                )}
              />
            )}
            {validation.missing_refs.length > 0 && (
              <Issue
                title="Citations referencing missing sources"
                items={validation.missing_refs.map(
                  (n) => `[${n}] is cited in the text but no source [${n}] was retrieved`,
                )}
              />
            )}
            {validation.unsupported_claims.length > 0 && (
              <Issue
                title="Unsupported or weakly-cited claims"
                items={validation.unsupported_claims.map(
                  (c) => `"${c.sentence}" — ${c.reason}`,
                )}
              />
            )}
            {validation.broken_links.length === 0 &&
              validation.missing_refs.length === 0 &&
              validation.unsupported_claims.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  All citations validated. No unsupported claims detected.
                </div>
              )}
          </Card>
        )}

        <Separator className="my-8" />
        <p className="text-xs text-muted-foreground">
          Note: source retrieval is currently <strong>mocked</strong> against a
          curated list of canonical SWMM5 references. Connect Perplexity (or
          Firecrawl) to enable live web search.
        </p>
      </div>
    </div>
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

function Issue({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400 mb-2">
        <AlertTriangle className="h-4 w-4" />
        {title}
      </div>
      <ul className="space-y-1 text-sm list-disc pl-5">
        {items.map((it, i) => (
          <li key={i} className="text-foreground/80">
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
