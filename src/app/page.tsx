"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Plus,
  Trash2,
  Sparkles,
  Bookmark,
  FileSignature,
  Wallet,
  CircleDot,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import {
  AGENT_LABELS,
  DEFAULT_PRIORITIES,
  PRIORITY_LABELS,
  makeOptionId,
  type AgentName,
  type ComparisonInput,
  type ComparisonResult,
  type OptionInput,
  type Priority,
  type PriorityWeights,
  type ScoredOption,
} from "@/lib/comparison";
import type { DecisionReceipt } from "@/lib/genlayer";
import { isGenLayerWalletPathConfigured, isWalletConfigured } from "@/lib/wallet";
import { ReceiptCard } from "@/components/receipt/ReceiptCard";
import { WalletReceiptControls } from "@/components/receipt/WalletReceiptControls";
import { useReceiptPolling, type PolledReceipt } from "@/lib/hooks/useReceiptPolling";
import { trackClientEvent } from "@/lib/analytics";

interface WatchlistEntry {
  id: string;
  comparisonId: string;
  optionId: string;
  name: string;
  score: number;
  addedAt: string;
  payloadHash: string;
}

interface ComparisonRecord {
  id: string;
  createdAt: string;
  input: ComparisonInput;
  result: ComparisonResult;
}

interface ReceiptRecord extends DecisionReceipt {
  comparisonId: string;
}

type UsageFeature = "comparisons" | "watchlist" | "receipts";

interface UsageMetric {
  used: number;
  limit: number | null;
  remaining: number | null;
  percent: number | null;
  blocked: boolean;
}

interface UsageSummary {
  plan: "free" | "plus" | "pro";
  resetAt: string;
  usage: Record<UsageFeature, UsageMetric>;
}

class ApiRequestError extends Error {
  status: number;
  code: string | null;
  feature: UsageFeature | null;

  constructor(
    status: number,
    message: string,
    code: string | null = null,
    feature: UsageFeature | null = null,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.feature = feature;
    this.name = "ApiRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const detail = isRecord(payload)
      ? payload.message ?? payload.error
      : null;
    const code = isRecord(payload) && typeof payload.error === "string"
      ? payload.error
      : null;
    const feature = isRecord(payload) && isUsageFeature(payload.feature)
      ? payload.feature
      : null;
    throw new ApiRequestError(
      response.status,
      typeof detail === "string"
        ? detail
        : `Request failed (${response.status})`,
      code,
      feature,
    );
  }
  return payload as T;
}

function isUsageFeature(value: unknown): value is UsageFeature {
  return value === "comparisons" || value === "watchlist" || value === "receipts";
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function isUpgradeMessage(message: string | null): boolean {
  return message?.includes("Upgrade to Plus") ?? false;
}

export function planLimitMessage(err: ApiRequestError, fallback: string): string {
  if (err.code !== "plan_limit_reached") return err.message || fallback;
  return `${err.message} Upgrade to Plus to keep going.`;
}

export function localLimitMessage(
  feature: UsageFeature,
  usage: UsageSummary | null,
): string {
  const metric = usage?.usage[feature];
  if (!metric || metric.limit === null) {
    return "This Free plan limit has been reached. Upgrade to Plus to keep going.";
  }
  const nouns: Record<UsageFeature, string> = {
    comparisons: "comparisons",
    watchlist: "watchlist items",
    receipts: "receipts",
  };
  return `Free plan includes ${metric.limit} ${nouns[feature]}. Upgrade to Plus to keep going.`;
}

export function isUsageBlocked(
  usage: UsageSummary | null,
  feature: UsageFeature,
): boolean {
  return usage?.usage[feature].blocked ?? false;
}

const STARTER_PROMPT = "Compare these options for a primary work laptop under $1500.";

const EXAMPLE_PROMPTS = [
  "Pick the best work laptop under $1500 for travel and video calls.",
  "Compare apartments for a 12-month lease near public transit.",
  "Choose a customer support tool for a five-person startup.",
  "Rank vacation rentals for a quiet family trip.",
  "Decide which online course gives the best career value.",
];

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
  const [prompt, setPrompt] = useState<string>(STARTER_PROMPT);
  const [options, setOptions] = useState<OptionInput[]>(STARTER_OPTIONS);
  const [priorities, setPriorities] =
    useState<PriorityWeights>(DEFAULT_PRIORITIES);
  const [mustHaves, setMustHaves] = useState<string>("");
  const [dealBreakers, setDealBreakers] = useState<string>("");
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [receipt, setReceipt] = useState<ReceiptRecord | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [isSavingWatchlist, setIsSavingWatchlist] = useState<boolean>(false);
  const [removingWatchId, setRemovingWatchId] = useState<string | null>(null);
  const [isBuildingReceipt, setIsBuildingReceipt] = useState<boolean>(false);
  const [feedbackByComparison, setFeedbackByComparison] = useState<Record<string, boolean>>({});
  const [isSendingFeedback, setIsSendingFeedback] = useState<boolean>(false);
  const [pollRestartKey, setPollRestartKey] = useState<number>(0);

  const validOptions = useMemo(
    () => options.filter((o) => o.name.trim().length > 0),
    [options],
  );
  const canCompare = validOptions.length >= 2;
  const usageBlocksCompare = usage?.usage.comparisons.blocked ?? false;
  const usageBlocksWatchlist = usage?.usage.watchlist.blocked ?? false;
  const usageBlocksReceipt = usage?.usage.receipts.blocked ?? false;

  const refreshUsage = useCallback(async () => {
    try {
      const payload = await fetchJson<UsageSummary>("/api/usage");
      setUsage(payload);
      setUsageError(null);
    } catch (err) {
      setUsage(null);
      setUsageError(errorMessage(err, "Unable to load plan usage."));
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadPersistedData() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const [comparisonPayload, watchlistPayload, usagePayload] = await Promise.all([
          fetchJson<{ comparisons: ComparisonRecord[] }>("/api/comparisons"),
          fetchJson<{ watchlist: WatchlistEntry[] }>("/api/watchlist"),
          fetchJson<UsageSummary>("/api/usage").catch((err) => {
            if (!ignore) {
              setUsage(null);
              setUsageError(errorMessage(err, "Unable to load plan usage."));
            }
            return null;
          }),
        ]);
        if (ignore) return;

        const latest = comparisonPayload.comparisons[0] ?? null;
        let latestReceipt: ReceiptRecord | null = null;
        if (latest) {
          try {
            const receiptPayload = await fetchJson<{ receipt: ReceiptRecord }>(
              `/api/comparisons/${latest.id}/receipt`,
            );
            latestReceipt = receiptPayload.receipt;
          } catch (err) {
            if (!(err instanceof ApiRequestError && err.status === 404)) {
              throw err;
            }
          }
        }
        if (ignore) return;

        setComparisonId(latest?.id ?? null);
        setResult(latest?.result ?? null);
        setReceipt(latestReceipt);
        setWatchlist(watchlistPayload.watchlist);
        if (usagePayload) {
          setUsage(usagePayload);
          setUsageError(null);
        }
      } catch (err) {
        if (!ignore) {
          setLoadError(errorMessage(err, "Unable to load saved decisions."));
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    void loadPersistedData();

    return () => {
      ignore = true;
    };
  }, []);

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

  async function handleCompare() {
    if (!canCompare) return;
    if (usageBlocksCompare) {
      setActionError(localLimitMessage("comparisons", usage));
      return;
    }
    const input: ComparisonInput = {
      prompt,
      options: validOptions,
      priorities,
      mustHaves,
      dealBreakers,
    };
    setIsComparing(true);
    setActionError(null);
    try {
      const payload = await fetchJson<{ comparison: ComparisonRecord }>(
        "/api/comparisons",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      setComparisonId(payload.comparison.id);
      setResult(payload.comparison.result);
      setReceipt(null);
      void refreshUsage();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "plan_limit_reached") {
        setActionError(planLimitMessage(err, "Unable to run comparison."));
        void refreshUsage();
      } else {
        setActionError(errorMessage(err, "Unable to run comparison."));
      }
    } finally {
      setIsComparing(false);
    }
  }

  function handleReset() {
    setPrompt(STARTER_PROMPT);
    setOptions(STARTER_OPTIONS.map((o) => ({ ...o })));
    setPriorities(DEFAULT_PRIORITIES);
    setMustHaves("");
    setDealBreakers("");
    setComparisonId(null);
    setResult(null);
    setReceipt(null);
    setActionError(null);
  }

  async function handleSaveTopPick() {
    if (!result || !comparisonId) return;
    const alreadySaved = watchlist.some(
      (w) =>
        w.comparisonId === comparisonId &&
        w.payloadHash === result.receiptPayloadHash,
    );
    if (usageBlocksWatchlist && !alreadySaved) {
      setActionError(localLimitMessage("watchlist", usage));
      return;
    }
    setIsSavingWatchlist(true);
    setActionError(null);
    try {
      const payload = await fetchJson<{ entry: WatchlistEntry }>(
        `/api/comparisons/${comparisonId}/watchlist`,
        { method: "POST" },
      );
      setWatchlist((prev) => {
        if (prev.some((w) => w.id === payload.entry.id)) {
          return prev;
        }
        return [
          payload.entry,
          ...prev.filter((w) => w.payloadHash !== payload.entry.payloadHash),
        ];
      });
      void refreshUsage();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "plan_limit_reached") {
        setActionError(planLimitMessage(err, "Unable to save top pick."));
        void refreshUsage();
      } else {
        setActionError(errorMessage(err, "Unable to save top pick."));
      }
    } finally {
      setIsSavingWatchlist(false);
    }
  }

  async function handleRemoveWatch(id: string) {
    setRemovingWatchId(id);
    setActionError(null);
    try {
      await fetchJson<{ removed: true }>(`/api/watchlist/${id}`, {
        method: "DELETE",
      });
      setWatchlist((prev) => prev.filter((w) => w.id !== id));
      void refreshUsage();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        setWatchlist((prev) => prev.filter((w) => w.id !== id));
        setActionError("That watchlist item was already removed.");
        void refreshUsage();
      } else {
        setActionError(errorMessage(err, "Unable to remove watchlist item."));
      }
    } finally {
      setRemovingWatchId(null);
    }
  }

  async function handleBuildReceipt() {
    if (!result || !comparisonId) return;
    if (usageBlocksReceipt && !displayReceipt) {
      setActionError(localLimitMessage("receipts", usage));
      return;
    }
    setIsBuildingReceipt(true);
    setActionError(null);
    try {
      const payload = await fetchJson<{ receipt: ReceiptRecord }>(
        `/api/comparisons/${comparisonId}/receipt`,
        { method: "POST" },
      );
      setReceipt(payload.receipt);
      setPollRestartKey((k) => k + 1);
      void refreshUsage();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "plan_limit_reached") {
        setActionError(planLimitMessage(err, "Unable to build receipt."));
        void refreshUsage();
      } else {
        setActionError(errorMessage(err, "Unable to build receipt."));
      }
    } finally {
      setIsBuildingReceipt(false);
    }
  }

  async function handleResultFeedback(helpful: boolean) {
    if (!comparisonId) return;
    setIsSendingFeedback(true);
    setActionError(null);
    try {
      await fetchJson<{ ok: true; requestId: string }>(
        `/api/comparisons/${comparisonId}/feedback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ helpful }),
        },
      );
      setFeedbackByComparison((prev) => ({ ...prev, [comparisonId]: helpful }));
    } catch (err) {
      setActionError(errorMessage(err, "Unable to send feedback."));
    } finally {
      setIsSendingFeedback(false);
    }
  }

  const pollComparisonId = useMemo(() => {
    if (!receipt) return null;
    const TERMINAL = new Set([
      "finalized",
      "finalized_with_error",
      "failed",
      "off_chain_only",
    ]);
    if (TERMINAL.has(receipt.status)) return null;
    if (!receipt.transactionHash) return null;
    return receipt.comparisonId;
  }, [receipt]);

  const pollFetcher = useCallback(
    (id: string) =>
      fetchJson<{ receipt: ReceiptRecord }>(`/api/comparisons/${id}/receipt`).then(
        (r) => r.receipt as ReceiptRecord & PolledReceipt,
      ),
    [],
  );

  const polling = useReceiptPolling<ReceiptRecord & PolledReceipt>(
    pollComparisonId,
    pollFetcher,
    pollRestartKey,
  );

  const displayReceipt: ReceiptRecord | null =
    (polling.receipt as ReceiptRecord | null) ?? receipt;
  const currentResultSaved = result && comparisonId
    ? watchlist.some(
      (w) =>
        w.comparisonId === comparisonId &&
        w.payloadHash === result.receiptPayloadHash,
    )
    : false;
  const saveBlockedByUsage = usageBlocksWatchlist && !currentResultSaved;
  const receiptBlockedByUsage = usageBlocksReceipt && !displayReceipt;

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
          <Link className="app-header-link" href="/help">
            Help
          </Link>
          <Link className="app-header-link" href="/pricing">
            Pricing
          </Link>
          <Link className="app-header-link" href="/account">
            Account
          </Link>
          <Link className="app-header-link" href="/privacy">
            Privacy
          </Link>
          <Link className="app-header-link" href="/terms">
            Terms
          </Link>
          <span className="pill">
            <span
              className={`pill-dot ${isWalletConfigured ? "dot-ok" : ""}`}
            />
            Wallet {isWalletConfigured ? "ready" : "optional"}
          </span>
          {usage ? (
            <span className="pill">
              <span className="pill-dot dot-ok" />
              {usage.plan === "free" ? "Free plan" : usage.plan}
              {usage.usage.comparisons.remaining !== null
                ? ` · ${usage.usage.comparisons.remaining} comparisons left`
                : " · Unlimited comparisons"}
            </span>
          ) : null}
          {isWalletConfigured ? (
            <ConnectButton />
          ) : (
            <button className="btn btn-ghost" type="button" disabled>
              <Wallet size={14} />
              Connect
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        <section className="panel-stack">
          <Composer
            prompt={prompt}
            examplePrompts={EXAMPLE_PROMPTS}
            onPromptChange={setPrompt}
            options={options}
            onUpdateOption={updateOption}
            onAddOption={addOption}
            onRemoveOption={removeOption}
            onCompare={handleCompare}
            onReset={handleReset}
            canCompare={canCompare}
            isComparing={isComparing}
            usageBlocked={usageBlocksCompare}
          />
          {isLoading ? (
            <div className="panel">
              <div className="panel-body">
                <div className="section-helper">Loading saved decisions...</div>
              </div>
            </div>
          ) : null}
          {loadError ? (
            <div className="panel">
              <div className="panel-body">
                <div className="section-helper" role="alert">{loadError}</div>
              </div>
            </div>
          ) : null}
          {actionError ? (
            <div className="panel">
              <div className="panel-body">
                <div className="section-helper" role="alert">
                  {actionError}
                  {isUpgradeMessage(actionError) ? (
                    <a
                      className="inline-upgrade-link"
                      href="/pricing"
                      onClick={() => trackClientEvent("upgrade_clicked", { source: "action_error" })}
                    >
                      View pricing
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          <Priorities priorities={priorities} onChange={setPriority} />
          <Constraints
            mustHaves={mustHaves}
            dealBreakers={dealBreakers}
            onMustHaves={setMustHaves}
            onDealBreakers={setDealBreakers}
          />
          <ResultView
            result={result}
            onSave={handleSaveTopPick}
            canSave={Boolean(comparisonId)}
            isSaving={isSavingWatchlist}
            saveBlocked={saveBlockedByUsage}
            feedback={comparisonId ? feedbackByComparison[comparisonId] ?? null : null}
            isSendingFeedback={isSendingFeedback}
            onFeedback={handleResultFeedback}
          />
        </section>

        <aside className="panel-stack">
          <UsagePanel usage={usage} usageError={usageError} />
          <WatchlistPanel
            watchlist={watchlist}
            onRemove={handleRemoveWatch}
            removingId={removingWatchId}
          />
          <ReceiptPanel
            result={result}
            receipt={displayReceipt}
            comparisonId={comparisonId}
            onBuild={handleBuildReceipt}
            canBuild={Boolean(comparisonId)}
            isBuilding={isBuildingReceipt}
            pollingError={polling.error}
            onRetry={handleBuildReceipt}
            onWalletReceipt={(record) => {
              setReceipt(record);
              setPollRestartKey((k) => k + 1);
              void refreshUsage();
            }}
            onWalletError={(message) => setActionError(message)}
            usageBlocked={receiptBlockedByUsage}
          />
        </aside>
      </main>
    </div>
  );
}

interface ComposerProps {
  prompt: string;
  examplePrompts: string[];
  onPromptChange: (v: string) => void;
  options: OptionInput[];
  onUpdateOption: (id: string, patch: Partial<OptionInput>) => void;
  onAddOption: () => void;
  onRemoveOption: (id: string) => void;
  onCompare: () => void;
  onReset: () => void;
  canCompare: boolean;
  isComparing: boolean;
  usageBlocked: boolean;
}

function Composer(props: ComposerProps) {
  const {
    prompt,
    examplePrompts,
    onPromptChange,
    options,
    onUpdateOption,
    onAddOption,
    onRemoveOption,
    onCompare,
    onReset,
    canCompare,
    isComparing,
    usageBlocked,
  } = props;

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Compare your options</span>
        <span className="panel-subtitle">
          Clear recommendation, tradeoffs, and uncertainty
        </span>
      </div>
      <div className="panel-body panel-stack">
        <div className="section-helper">
          Describe the choice, add your options, and ChoiceLens will rank them
          with practical tradeoffs. Wallets are optional for the free flow;
          receipts are optional snapshots for later.
        </div>
        <div className="example-prompt-list" aria-label="Example prompts">
          {examplePrompts.map((example) => (
            <button
              className="example-prompt"
              key={example}
              type="button"
              onClick={() => onPromptChange(example)}
            >
              {example}
            </button>
          ))}
        </div>
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
            disabled={!canCompare || isComparing || usageBlocked}
            title={usageBlocked ? "Free comparison limit reached" : undefined}
          >
            <Sparkles size={14} />
            {usageBlocked
              ? "Limit reached"
              : isComparing
              ? "Running..."
              : "Run comparison"}
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
  canSave: boolean;
  isSaving: boolean;
  saveBlocked: boolean;
  feedback: boolean | null;
  isSendingFeedback: boolean;
  onFeedback: (helpful: boolean) => void;
}

function ResultView({
  result,
  onSave,
  canSave,
  isSaving,
  saveBlocked,
  feedback,
  isSendingFeedback,
  onFeedback,
}: ResultViewProps) {
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
            <TopPick
              option={result.topPick}
              onSave={onSave}
              canSave={canSave}
              isSaving={isSaving}
              saveBlocked={saveBlocked}
            />
            <ScoreTable shortlist={result.shortlist} topId={result.topPick.id} />
            <Signals
              confidence={result.signals.confidence}
              uncertainty={result.signals.uncertainty}
              whatWouldChange={result.signals.whatWouldChange}
            />
            <ResultFeedback
              value={feedback}
              disabled={!canSave || isSendingFeedback}
              onFeedback={onFeedback}
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
  canSave,
  isSaving,
  saveBlocked,
}: {
  option: ScoredOption;
  onSave: () => void;
  canSave: boolean;
  isSaving: boolean;
  saveBlocked: boolean;
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
        <button
          className="btn"
          type="button"
          onClick={onSave}
          disabled={!canSave || isSaving || saveBlocked}
          title={saveBlocked ? "Free watchlist limit reached" : undefined}
        >
          <Bookmark size={14} />
          {saveBlocked
            ? "Watchlist limit"
            : isSaving
            ? "Saving..."
            : "Save to watchlist"}
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
                const score = s?.score ?? 0;
                return (
                  <td key={a} className="score-cell">
                    <span className="score-bar" aria-hidden>
                      <span
                        className="score-bar-fill"
                        style={{ "--bar-width": `${score}%` } as React.CSSProperties}
                      />
                    </span>
                    {score}
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

function ResultFeedback({
  value,
  disabled,
  onFeedback,
}: {
  value: boolean | null;
  disabled: boolean;
  onFeedback: (helpful: boolean) => void;
}) {
  return (
    <div className="result-feedback" aria-live="polite">
      <span className="section-helper">Was this recommendation useful?</span>
      <div className="row-actions">
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => onFeedback(true)}
          disabled={disabled}
          aria-pressed={value === true}
        >
          <ThumbsUp size={14} />
          Helpful
        </button>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => onFeedback(false)}
          disabled={disabled}
          aria-pressed={value === false}
        >
          <ThumbsDown size={14} />
          Not helpful
        </button>
      </div>
      {value !== null ? (
        <div className="section-helper">Thanks — feedback saved for this result.</div>
      ) : null}
    </div>
  );
}

interface WatchlistPanelProps {
  watchlist: WatchlistEntry[];
  onRemove: (id: string) => void;
  removingId: string | null;
}

function formatUsage(metric: UsageMetric): string {
  return metric.limit === null ? `${metric.used} / ∞` : `${metric.used} / ${metric.limit}`;
}

function UsagePanel({
  usage,
  usageError,
}: {
  usage: UsageSummary | null;
  usageError: string | null;
}) {
  if (!usage && !usageError) return null;
  return (
    <div className="panel usage-panel">
      <div className="panel-header">
        <span className="panel-title">Plan usage</span>
        <span className="panel-subtitle">
          {usage ? (usage.plan === "free" ? "Free" : usage.plan) : "Unavailable"}
        </span>
      </div>
      <div className="panel-body">
        {usage ? (
          <>
            <div className="usage-list">
              <UsageRow
                label="Comparisons"
                metric={usage.usage.comparisons}
                resetAt={usage.resetAt}
              />
              <UsageRow label="Watchlist" metric={usage.usage.watchlist} />
              <UsageRow
                label="Receipts"
                metric={usage.usage.receipts}
                resetAt={usage.resetAt}
              />
            </div>
            {(usage.usage.comparisons.blocked ||
              usage.usage.watchlist.blocked ||
              usage.usage.receipts.blocked) ? (
              <p className="section-helper usage-upgrade-note">
                Upgrade to Plus to keep going.
                <a
                  className="inline-upgrade-link"
                  href="/pricing"
                  onClick={() => trackClientEvent("upgrade_clicked", { source: "usage_panel" })}
                >
                  View pricing
                </a>
              </p>
            ) : null}
          </>
        ) : (
          <p className="section-helper">{usageError}</p>
        )}
      </div>
    </div>
  );
}

function UsageRow({
  label,
  metric,
  resetAt,
}: {
  label: string;
  metric: UsageMetric;
  resetAt?: string;
}) {
  return (
    <div className="usage-row" data-blocked={metric.blocked ? "true" : undefined}>
      <div>
        <div className="usage-row-head">
          <span>{label}</span>
          <span className="slider-value">{formatUsage(metric)}</span>
        </div>
        <div className="usage-bar" aria-hidden>
          <span
            className="usage-bar-fill"
            style={{ "--usage-width": `${metric.percent ?? 0}%` } as React.CSSProperties}
          />
        </div>
        {resetAt ? (
          <div className="usage-reset">
            Resets {new Date(resetAt).toLocaleDateString()}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WatchlistPanel({
  watchlist,
  onRemove,
  removingId,
}: WatchlistPanelProps) {
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Watchlist</span>
        <span className="panel-subtitle">{watchlist.length} saved</span>
      </div>
      <div className="panel-body">
        {watchlist.length === 0 ? (
          <div className="watchlist-empty">
            Save a top pick from a result to start tracking it here.
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
                    disabled={removingId === item.id}
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
  receipt: ReceiptRecord | null;
  comparisonId: string | null;
  onBuild: () => void;
  canBuild: boolean;
  isBuilding: boolean;
  pollingError: string | null;
  onRetry: () => void;
  onWalletReceipt: (receipt: ReceiptRecord) => void;
  onWalletError: (message: string) => void;
  usageBlocked: boolean;
}

function ReceiptPanel({
  result,
  receipt,
  comparisonId,
  onBuild,
  canBuild,
  isBuilding,
  pollingError,
  onRetry,
  onWalletReceipt,
  onWalletError,
  usageBlocked,
}: ReceiptPanelProps) {
  const [walletBusy, setWalletBusy] = useState<boolean>(false);
  const showWalletControls = isWalletConfigured && isGenLayerWalletPathConfigured;
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Decision receipt</span>
        <span className="panel-subtitle">Optional, premium-friendly snapshot</span>
      </div>
      <div className="panel-body panel-stack">
        <div className="section-helper">
          Receipts save a hashed snapshot of the scoring result so you can revisit
          what was compared later. They are optional, may count against plan
          limits, and are separate from the free comparison flow.
        </div>
        <div className="row-actions">
          <button
            className="btn"
            type="button"
            onClick={onBuild}
            disabled={!result || !canBuild || isBuilding || walletBusy || usageBlocked}
            title={usageBlocked ? "Free receipt limit reached" : undefined}
          >
            <FileSignature size={14} />
            {usageBlocked
              ? "Receipt limit"
              : isBuilding
              ? "Building..."
              : "Build receipt"}
          </button>
        </div>
        {usageBlocked ? (
          <div className="section-helper">
            Free receipt limit reached. Upgrade to Plus to keep going.
            <a
              className="inline-upgrade-link"
              href="/pricing"
              onClick={() => trackClientEvent("upgrade_clicked", { source: "receipt_limit" })}
            >
              View pricing
            </a>
          </div>
        ) : null}
        {showWalletControls ? (
          <WalletReceiptControls
            comparisonId={comparisonId}
            disabled={!result || !canBuild || isBuilding || usageBlocked}
            onSubmitting={setWalletBusy}
            onSubmitted={(record) => onWalletReceipt(record as ReceiptRecord)}
            onError={onWalletError}
          />
        ) : null}
        {receipt ? (
          <ReceiptCard
            receipt={receipt}
            pollingError={pollingError}
            onRetry={onRetry}
          />
        ) : null}
      </div>
    </div>
  );
}
