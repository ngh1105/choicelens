"use client";

import { Trash2 } from "lucide-react";
import type { WatchlistEntry } from "./types";

interface WatchlistPanelProps {
  watchlist: WatchlistEntry[];
  onRemove: (id: string) => void;
  removingId: string | null;
}
export function WatchlistPanel({
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




