"use client";

import { PRIORITY_LABELS, type Priority, type PriorityWeights } from "@/lib/comparison";

interface PrioritiesProps {
  priorities: PriorityWeights;
  onChange: (p: Priority, value: number) => void;
}

export function Priorities({ priorities, onChange }: PrioritiesProps) {
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


