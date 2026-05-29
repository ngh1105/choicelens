"use client";

import React from "react";
import { Bookmark, CircleDot, ExternalLink, ThumbsDown, ThumbsUp } from "lucide-react";
import { AGENT_LABELS, type AgentName, type ComparisonResult, type ScoredOption } from "@/lib/comparison";
const AGENT_ORDER: AgentName[] = ["value", "fit", "risk", "evidence", "longevity"];

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

export function ResultView({
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

export function TopPick({
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

export function ScoreTable({
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

export function Signals({
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

export function ResultFeedback({
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


