"use client";

import { ExternalLink, Plus, Sparkles, Trash2 } from "lucide-react";
import type { OptionInput } from "@/lib/comparison";

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

export function Composer(props: ComposerProps) {
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


