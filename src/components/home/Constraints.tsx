"use client";



interface ConstraintsProps {
  mustHaves: string;
  dealBreakers: string;
  onMustHaves: (v: string) => void;
  onDealBreakers: (v: string) => void;
}

export function Constraints({
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


