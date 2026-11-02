import { useEffect, useRef } from 'react';
import { clock } from '../format';
import { downloadCsv } from '../services/eventLog';
import { useStore } from '../store/useStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Event log drawer with CSV export. */
export function EventLog({ open, onClose }: Props) {
  const events = useStore((s) => s.events);
  const clearEvents = useStore((s) => s.clearEvents);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottom.current?.scrollIntoView({ block: 'end' });
  }, [open, events.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Event log">
        <div className="drawer-head">
          <b>Event log</b>
          <span className="muted">{events.length} events</span>
          <span className="spacer" />
          <button className="btn" onClick={() => downloadCsv(events)} disabled={events.length === 0}>
            Export CSV
          </button>
          <button
            className="btn ghost"
            onClick={() => window.confirm('Delete all events from the log?') && clearEvents()}
            disabled={events.length === 0}
          >
            Clear
          </button>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="drawer-body">
          {events.length === 0 ? (
            <div className="empty">No events yet.</div>
          ) : (
            <table className="log-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Event</th>
                  <th>Location</th>
                  <th>BPM</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i} className={`k-${e.kind}`}>
                    <td className="mono">{clock(e.t)}</td>
                    <td>
                      <span className={`kind k-${e.kind}`}>{e.kind}</span>
                    </td>
                    <td>{e.message}</td>
                    <td className="mono">{e.lat != null && e.lng != null ? `${e.lat.toFixed(6)}, ${e.lng.toFixed(6)}` : ''}</td>
                    <td>{e.bpm != null ? Math.round(e.bpm) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div ref={bottom} />
        </div>
      </aside>
    </div>
  );
}
