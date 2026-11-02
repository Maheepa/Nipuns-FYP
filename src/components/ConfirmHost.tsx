import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { useUi } from '../store/useUi';

/** Renders the pending confirmation dialog (see askConfirm) and the toast stack. */
export function ConfirmHost() {
  const req = useUi((s) => s.confirm);
  const toasts = useUi((s) => s.toasts);
  const dryRun = useStore((s) => s.settings.dryRun);
  const simulate = useStore((s) => s.settings.simulate);
  const [ticked, setTicked] = useState<boolean[]>([]);

  useEffect(() => {
    setTicked(req?.checklist?.map(() => false) ?? []);
    if (!req) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && req.resolve(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  const allTicked = ticked.every(Boolean);

  return (
    <>
      {req && (
        <div className="modal-backdrop" onClick={() => req.resolve(false)}>
          <div className={`modal ${req.tone}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <b>{req.title}</b>
              <span className={`mode-badge ${simulate ? 'sim' : dryRun ? 'dry' : 'live'}`}>
                {simulate ? (dryRun ? 'SIM · DRY-RUN' : 'SIMULATED DRONE') : dryRun ? 'DRY-RUN · nothing will be sent' : 'LIVE · will be sent to the drone'}
              </span>
            </div>
            <div className="modal-body">
              {req.body}
              {req.checklist && (
                <ul className="checklist">
                  {req.checklist.map((item, i) => (
                    <li key={item}>
                      <label>
                        <input
                          type="checkbox"
                          checked={ticked[i] ?? false}
                          onChange={(e) => setTicked((t) => t.map((v, j) => (j === i ? e.target.checked : v)))}
                        />
                        {item}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn secondary" onClick={() => req.resolve(false)} autoFocus>
                Cancel
              </button>
              <button
                className={`btn ${req.tone === 'danger' ? 'danger' : 'orange'}`}
                onClick={() => req.resolve(true)}
                disabled={!allTicked}
                title={allTicked ? '' : 'Tick every item of the checklist first'}
              >
                {req.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
