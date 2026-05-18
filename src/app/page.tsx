"use client";

import { useMemo, useState } from "react";
import {
  ExternalLink,
  Plus,
  Trash2,
  Sparkles,
  Bookmark,
  FileSignature,
  Wallet,
  CircleDot,
} from "lucide-react";
import {
  AGENT_LABELS,
  DEFAULT_PRIORITIES,
  PRIORITY_LABELS,
  makeOptionId,
  runComparison,
  type AgentName,
  type ComparisonResult,
  type OptionInput,
  type Priority,
  type PriorityWeights,
  type ScoredOption,
} from "@/lib/comparison";
import {
  getGenLayerService,
  type DecisionReceipt,
} from "@/lib/genlayer";
import { isWalletConfigured } from "@/lib/wallet";

interface WatchlistEntry {
  id: string;
  name: string;
  score: number;
  addedAt: string;
  payloadHash: string;
}

const STARTER_OPTIONS: OptionInput[] = [
  { id: "starter-1", name: "Option A", url: "", notes: "" },
  { id: "starter-2", name: "Option B", url: "", notes: "" },
  { id: "starter-3", name: "Option C", url: "", notes: "" },
];

const AGENT_ORDER: AgentName[] = [
  "value",
  "fit",
  "risk",
  "evidence",
  "longevity",
];

export default function HomePage() {
  const [prompt, setPrompt] = useState<string>(
    "Compare these options for a primary work laptop under $1500.",
  );
  const [options, setOptions] = useState<OptionInput[]>(STARTER_OPTIONS);
  const [priorities, setPriorities] =
    useState<PriorityWeights>(DEFAULT_PRIORITIES);
  const [mustHaves, setMustHaves] = useState<string>("");
  const [dealBreakers, setDealBreakers] = useState<string>("");
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [receipt, setReceipt] = useState<DecisionReceipt | null>(null);

  const validOptions = useMemo(
    () => options.filter((o) => o.name.trim().length > 0),
    [options],
  );
  const canCompare = validOptions.length >= 2;

  function updateOption(id: string, patch: Partial<OptionInput>) {
    setOptions((prev) =>
      prev.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    );
  }

  function addOption() {
    if (options.length >= 10) return;
    setOptions((prev) => [
      ...prev,
      { id: makeOptionId(), name: "", url: "", notes: "" },
    ]);
  }

  function removeOption(id: string) {
    setOptions((prev) =>
      prev.length <= 2 ? prev : prev.filter((o) => o.id !== id),
    );
  }

  function setPriority(p: Priority, value: number) {
    setPriorities((prev) => ({ ...prev, [p]: value }));
  }

  function handleCompare() {
    if (!canCompare) return;
    const next = runComparison({
      prompt,
      options: validOptions,
      priorities,
      mustHaves,
      dealBreakers,
    });
    setResult(next);
    setReceipt(null);
  }

  function handleReset() {
    setOptions(STARTER_OPTIONS.map((o) => ({ ...o })));
    setPriorities(DEFAULT_PRIORITIES);
    setMustHaves("");
    setDealBreakers("");
    setResult(null);
    setReceipt(null);
  }

  function handleSaveTopPick() {
    if (!result) return;
    const top = result.topPick;
    setWatchlist((prev) => {
      if (prev.some((w) => w.payloadHash === result.receiptPayloadHash)) {
        return prev;
      }
      const entry: WatchlistEntry = {
        id: `w-${result.receiptPayloadHash}`,
        name: top.name,
        score: top.finalScore,
        addedAt: new Date().toISOString(),
        payloadHash: result.receiptPayloadHash,
      };
      return [entry, ...prev];
    });
  }

  function handleRemoveWatch(id: string) {
    setWatchlist((prev) => prev.filter((w) => w.id !== id));
  }

  function handleBuildReceipt() {
    if (!result) return;
    const built = getGenLayerService().buildReceipt(result);
    setReceipt(built);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <span className="app-brand-mark" aria-hidden />
          <span>ChoiceLens</span>
          <span className="pill" style={{ marginLeft: 8 }}>
            <span className="pill-dot dot-warn" /> V1 preview
          </span>
        </div>
        <div className="app-header-actions">
          <span className="pill">
            <span
              className={`pill-dot ${isWalletConfigured ? "dot-ok" : ""}`}
            />
            Wallet {isWalletConfigured ? "ready" : "optional"}
          </span>
          <button className="btn btn-ghost" type="button" disabled>
            <Wallet size={14} />
            Connect
          </button>
        </div>
      </header>

      <main className="app-main">
        <section className="panel-stack">
          <Composer
            prompt={prompt}
            onPromptChange={setPrompt}
            options={options}
            onUpdateOption={updateOption}
            onAddOption={addOption}
            onRemoveOption={removeOption}
            onCompare={handleCompare}
            onReset={handleReset}
            canCompare={canCompare}
          />
          <Priorities priorities={priorities} onChange={setPriority} />
          <Constraints
            mustHaves={mustHaves}
            dealBreakers={dealBreakers}
            onMustHaves={setMustHaves}
            onDealBreakers={setDealBreakers}
          />
          <ResultView result={result} onSave={handleSaveTopPick} />
        </section>

        <aside className="panel-stack">
          <WatchlistPanel
            watchlist={watchlist}
            onRemove={handleRemoveWatch}
          />
          <ReceiptPanel
            result={result}
            receipt={receipt}
            onBuild={handleBuildReceipt}
          />
        </aside>
      </main>
    </div>
  );
}

interface ComposerProps {
  prompt: string;
  onPromptChange: (v: string) => void;
  options: OptionInput[];
  onUpdateOption: (id: string, patch: Partial<OptionInput>) => void;
  onAddOption: () => void;
  onRemoveOption: (id: string) => void;
  onCompare: () => void;
  onReset: () => void;
  canCompare: boolean;
}

function Composer(props: ComposerProps) {
  const {
    prompt,
    onPromptChange,
    options,
    onUpdateOption,
    onAddOption,
    onRemoveOption,
    onCompare,
    onReset,
    canCompare,
  } = props;

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Comparison</span>
        <span className="panel-subtitle">
          {options.length}/10 options
        </span>
      </div>
      <div className="panel-body panel-stack">
        <div className="field">
          <label className="field-label" htmlFor="prompt">
            What are you choosing
          </label>
          <textarea
            id="prompt"
            className="textarea"
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            placeholder="e.g. Pick a quiet hotel in Da Nang for a family trip."
          />
        </div>

        <div className="field">
          <span className="field-label">Options</span>
          <div>
            {options.map((option, idx) => (
              <div key={option.id} className="option-row">
                <span className="option-index">{String(idx + 1).padStart(2, "0")}</span>
                <input
                  className="text-input"
                  placeholder="Name"
                  value={option.name}
                  onChange={(e) =>
                    onUpdateOption(option.id, { name: e.target.value })
                  }
                />
                <div className="input-with-link">
                  <input
                    className="text-input"
                    placeholder="https://"
                    value={option.url ?? ""}
                    onChange={(e) =>
                      onUpdateOption(option.id, { url: e.target.value })
                    }
                  />
                  {option.url ? (
                    <a
                      className="url-link"
                      href={option.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label="Open link"
                    >
                      <ExternalLink size={14} />
                    </a>
                  ) : null}
                </div>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => onRemoveOption(option.id)}
                  aria-label="Remove option"
                  disabled={options.length <= 2}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <p className="section-helper">
            Add 2 to 10 options. URLs are optional and only used for context.
          </p>
        </div>

        <div className="row-actions">
          <button
            className="btn"
            type="button"
            onClick={onAddOption}
            disabled={options.length >= 10}
          >
            <Plus size={14} />
            Add option
          </button>
          <button className="btn btn-ghost" type="button" onClick={onReset}>
            Reset
          </button>
          <span style={{ flex: 1 }} />
          <button
            className="btn btn-primary"
            type="button"
            onClick={onCompare}
            disabled={!canCompare}
          >
            <Sparkles size={14} />
            Run comparison
          </button>
        </div>
      </div>
    </div>
  );
}

interface PrioritiesProps {
  priorities: PriorityWeights;
  onChange: (p: Priority, value: number) => void;
}

function Priorities({ priorities, onChange }: PrioritiesProps) {
  const keys = Object.keys(PRIORITY_LABELS) as Priority[];
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Priorities</span>
        <span className="panel-subtitle">
          Higher value = more weight in the decision
        </span>
      </div>
      <div className="panel-body">
        <div className="priority-grid">
          {keys.map((p) => (
            <div className="slider-row" key={p}>
              <div className="slider-row-head">
                <label htmlFor={`pri-${p}`}>{PRIORITY_LABELS[p]}</label>
                <span className="slider-value">{priorities[p]}</span>
              </div>
              <input
                id={`pri-${p}`}
                type="range"
                min={0}
                max={100}
                step={5}
                value={priorities[p]}
                onChange={(e) => onChange(p, Number(e.target.value))}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface ConstraintsProps {
  mustHaves: string;
  dealBreakers: string;
  onMustHaves: (v: string) => void;
  onDealBreakers: (v: string) => void;
}

function Constraints({
  mustHaves,
  dealBreakers,
  onMustHaves,
  onDealBreakers,
}: ConstraintsProps) {
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Must-haves and deal-breakers</span>
        <span className="panel-subtitle">Optional but improves confidence</span>
      </div>
      <div className="panel-body">
        <div className="dual-field">
          <div className="field">
            <label className="field-label" htmlFor="must">
              Must-haves
            </label>
            <textarea
              id="must"
              className="textarea"
              value={mustHaves}
              onChange={(e) => onMustHaves(e.target.value)}
              placeholder="e.g. 16 GB RAM, US warranty"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="break">
              Deal-breakers
            </label>
            <textarea
              id="break"
              className="textarea"
              value={dealBreakers}
              onChange={(e) => onDealBreakers(e.target.value)}
              placeholder="e.g. fan noise above 40 dB, no Linux drivers"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface ResultViewProps {
  result: ComparisonResult | null;
  onSave: () => void;
}

function ResultView({ result, onSave }: ResultViewProps) {
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Recommendation</span>
        <span className="panel-subtitle">
          {result ? `Top 3 of ${result.ranked.length}` : "Awaiting input"}
        </span>
      </div>
      <div className="panel-body panel-stack">
        {!result ? (
          <div className="result-empty">
            Add at least two options and run a comparison to see the top pick,
            scoring table, and confidence signals.
          </div>
        ) : (
          <>
            <TopPick option={result.topPick} onSave={onSave} />
            <ScoreTable shortlist={result.shortlist} topId={result.topPick.id} />
            <Signals
              confidence={result.signals.confidence}
              uncertainty={result.signals.uncertainty}
              whatWouldChange={result.signals.whatWouldChange}
            />
          </>
        )}
      </div>
    </div>
  );
}

function TopPick({
  option,
  onSave,
}: {
  option: ScoredOption;
  onSave: () => void;
}) {
  return (
    <div className="top-pick">
      <div className="top-pick-head">
        <div>
          <span className="tag tag-rank-1">RANK 01</span>
          <div className="top-pick-name" style={{ marginTop: 4 }}>
            {option.name}
          </div>
        </div>
        <div className="top-pick-score">{option.finalScore.toFixed(1)}</div>
      </div>
      <div className="section-helper">
        Strongest combined read across the {AGENT_ORDER.length} analysts.
      </div>
      <div className="row-actions">
        <button className="btn" type="button" onClick={onSave}>
          <Bookmark size={14} />
          Save to watchlist
        </button>
        {option.url ? (
          <a
            className="btn btn-ghost"
            href={option.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            <ExternalLink size={14} />
            Open link
          </a>
        ) : null}
      </div>
    </div>
  );
}

function ScoreTable({
  shortlist,
  topId,
}: {
  shortlist: ScoredOption[];
  topId: string;
}) {
  return (
    <div>
      <table className="score-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Option</th>
            {AGENT_ORDER.map((a) => (
              <th key={a}>{AGENT_LABELS[a].split(" ")[0]}</th>
            ))}
            <th className="score-cell">Final</th>
          </tr>
        </thead>
        <tbody>
          {shortlist.map((row) => (
            <tr
              key={row.id}
              className={row.id === topId ? "is-top" : undefined}
            >
              <td>
                <span className="tag">
                  {String(row.rank).padStart(2, "0")}
                </span>
              </td>
              <td>{row.name}</td>
              {AGENT_ORDER.map((a) => {
                const s = row.agentScores.find((x) => x.agent === a);
                return (
                  <td key={a} className="score-cell">
                    <span className="score-bar" aria-hidden>
                      <span
                        className="score-bar-fill"
                        style={{ width: `${s?.score ?? 0}%` }}
                      />
                    </span>
                    {s?.score ?? 0}
                  </td>
                );
              })}
              <td className="score-cell">{row.finalScore.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Signals({
  confidence,
  uncertainty,
  whatWouldChange,
}: {
  confidence: number;
  uncertainty: string[];
  whatWouldChange: string[];
}) {
  return (
    <div className="panel-stack" style={{ gap: 12 }}>
      <div className="confidence">
        <CircleDot size={14} />
        <span>Confidence</span>
        <div className="confidence-bar">
          <div
            className="confidence-bar-fill"
            style={{ width: `${confidence}%` }}
          />
        </div>
        <span className="slider-value">{confidence}%</span>
      </div>
      {uncertainty.length > 0 ? (
        <div>
          <div className="field-label">Uncertainty</div>
          <ul className="signals-list">
            {uncertainty.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <div className="field-label">What would change the answer</div>
        <ul className="signals-list">
          {whatWouldChange.map((u, i) => (
            <li key={i}>{u}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface WatchlistPanelProps {
  watchlist: WatchlistEntry[];
  onRemove: (id: string) => void;
}

function WatchlistPanel({ watchlist, onRemove }: WatchlistPanelProps) {
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Watchlist</span>
        <span className="panel-subtitle">{watchlist.length} saved</span>
      </div>
      <div className="panel-body">
        {watchlist.length === 0 ? (
          <div className="watchlist-empty">
            Save a top pick from a result to start tracking it here. V1 stores
            this in memory; persistence ships next.
          </div>
        ) : (
          <div>
            {watchlist.map((item) => (
              <div className="watchlist-item" key={item.id}>
                <div className="watchlist-item-head">
                  <span className="watchlist-item-name">{item.name}</span>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => onRemove(item.id)}
                    aria-label="Remove from watchlist"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="watchlist-item-meta">
                  <span>Score {item.score.toFixed(1)}</span>
                  <span>{new Date(item.addedAt).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ReceiptPanelProps {
  result: ComparisonResult | null;
  receipt: DecisionReceipt | null;
  onBuild: () => void;
}

function ReceiptPanel({ result, receipt, onBuild }: ReceiptPanelProps) {
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Decision receipt</span>
        <span className="panel-subtitle">GenLayer placeholder</span>
      </div>
      <div className="panel-body panel-stack">
        <div className="section-helper">
          Receipts anchor a hashed scoring snapshot for portability. V1 produces
          an off-chain receipt; on-chain anchoring is wired through the
          GenLayer service boundary.
        </div>
        <div className="row-actions">
          <button
            className="btn"
            type="button"
            onClick={onBuild}
            disabled={!result}
          >
            <FileSignature size={14} />
            Build receipt
          </button>
        </div>
        {receipt ? (
          <div className="receipt-card">
            <div className="receipt-row">
              <span className="receipt-key">Receipt</span>
              <span className="receipt-val">{receipt.id}</span>
            </div>
            <div className="receipt-row">
              <span className="receipt-key">Payload</span>
              <span className="receipt-val">{receipt.payloadHash}</span>
            </div>
            <div className="receipt-row">
              <span className="receipt-key">Status</span>
              <span className="receipt-val">{receipt.status}</span>
            </div>
            <div className="receipt-row">
              <span className="receipt-key">Network</span>
              <span className="receipt-val">{receipt.network}</span>
            </div>
            <div className="receipt-row">
              <span className="receipt-key">Tx hash</span>
              <span className="receipt-val">
                {receipt.transactionHash ?? "-"}
              </span>
            </div>
            <div className="receipt-row">
              <span className="receipt-key">Created</span>
              <span className="receipt-val">
                {new Date(receipt.createdAt).toLocaleString()}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
