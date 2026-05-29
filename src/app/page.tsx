"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { isWalletConfigured } from "@/lib/wallet";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { DEFAULT_PRIORITIES, makeOptionId, type ComparisonInput, type ComparisonResult, type OptionInput, type Priority, type PriorityWeights } from "@/lib/comparison";
import { useReceiptPolling, type PolledReceipt } from "@/lib/hooks/useReceiptPolling";
import { trackClientEvent } from "@/lib/analytics";
import { Composer } from "@/components/home/Composer";
import { Priorities } from "@/components/home/Priorities";
import { Constraints } from "@/components/home/Constraints";
import { ResultView } from "@/components/home/ResultView";
import { ReceiptPanel } from "@/components/home/ReceiptPanel";
import { UsagePanel } from "@/components/home/UsagePanel";
import { WatchlistPanel } from "@/components/home/WatchlistPanel";
import type { ComparisonRecord, ReceiptRecord, UsageSummary, WatchlistEntry } from "@/components/home/types";
export { ApiRequestError, errorMessage, fetchJson, isUpgradeMessage, isUsageFeature, isUsageBlocked, localLimitMessage, planLimitMessage } from "@/components/home/utils";
import { ApiRequestError, errorMessage, fetchJson, isUpgradeMessage, isUsageBlocked, localLimitMessage, planLimitMessage } from "@/components/home/utils";

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




