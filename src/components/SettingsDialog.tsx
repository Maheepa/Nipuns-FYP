import { useEffect, useState } from 'react';
import { config, type RescueSettings } from '../config';
import { useStore } from '../store/useStore';
import { askConfirm, useUi } from '../store/useUi';

const FIELDS: { key: keyof RescueSettings; label: string; unit: string; min: number; max: number; step: number; int?: boolean }[] = [
  { key: 'altitudeM', label: 'Rescue altitude (above home)', unit: 'm', min: 2, max: 40, step: 0.5 },
  { key: 'maxDistanceFromHomeM', label: 'Max distance from base station', unit: 'm', min: 10, max: 1000, step: 10 },
  { key: 'onTargetRadiusM', label: '"On target" radius', unit: 'm', min: 1, max: 30, step: 0.5 },
  { key: 'releaseServoChannel', label: 'Release servo channel', unit: '', min: 1, max: 16, step: 1, int: true },
  { key: 'releasePwm', label: 'Release PWM', unit: 'µs', min: 800, max: 2200, step: 10, int: true },
  { key: 'holdPwm', label: 'Hold (closed) PWM', unit: 'µs', min: 800, max: 2200, step: 10, int: true },
];

/** Editable rescue settings, saved in this browser. Defaults come from src/config.ts. */
export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  const setOpen = useUi((s) => s.setSettingsOpen);
  const current = useStore((s) => s.settings.rescue);
  const save = useStore((s) => s.setRescueSettings);
  const base = useStore((s) => s.settings.baseStation);
  const setBaseStation = useStore((s) => s.setBaseStation);
  const isDefaultBase = base.lat === config.baseStation.lat && base.lng === config.baseStation.lng;
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, String(current[f.key])])));
  }, [open, current]);

  if (!open) return null;

  const errors = Object.fromEntries(
    FIELDS.map((f) => {
      const v = Number(draft[f.key]);
      const bad = draft[f.key] === '' || !Number.isFinite(v) || v < f.min || v > f.max || (f.int && !Number.isInteger(v));
      return [f.key, bad ? `${f.min}–${f.max}${f.int ? ', whole number' : ''}` : null];
    }),
  );
  const valid = Object.values(errors).every((e) => e == null);

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Rescue settings</b>
          <span className="mode-badge sim">ASSUMED defaults — verify on the bench</span>
        </div>
        <div className="modal-body settings-grid">
          {FIELDS.map((f) => (
            <label key={f.key} className={errors[f.key] ? 'invalid' : ''}>
              <span>{f.label}</span>
              <span className="field">
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
                <em>{f.unit}</em>
              </span>
              {errors[f.key] && <small>{errors[f.key]}</small>}
            </label>
          ))}
        </div>
        <div className="modal-body base-row">
          <div>
            <b>Base station</b>
            <div className="mono">
              {base.lat.toFixed(7)}, {base.lng.toFixed(7)} {isDefaultBase ? '(default from config.ts)' : '(set on the map)'}
            </div>
          </div>
          <button
            className="btn secondary"
            disabled={isDefaultBase}
            onClick={async () => {
              const d = config.baseStation;
              const ok = await askConfirm({
                title: 'Reset the base station to the default?',
                confirmLabel: 'Reset base station',
                body: (
                  <p>
                    Moves the base station back to <b className="mono">{d.lat.toFixed(7)}, {d.lng.toFixed(7)}</b> from
                    src/config.ts and re-centres the map.
                  </p>
                ),
              });
              if (ok) {
                setBaseStation(null);
                useStore.getState().logEvent({ kind: 'info', message: 'Base station reset to the config.ts default', lat: d.lat, lng: d.lng });
              }
            }}
          >
            Reset base station to default
          </button>
        </div>
        <div className="modal-foot">
          <button className="btn secondary" onClick={() => setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, String(config.rescue[f.key])])))}>
            Reset to config.ts defaults
          </button>
          <span className="spacer" />
          <button className="btn secondary" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button
            className="btn"
            disabled={!valid}
            onClick={() => {
              save(Object.fromEntries(FIELDS.map((f) => [f.key, Number(draft[f.key])])) as Partial<RescueSettings>);
              useStore.getState().logEvent({ kind: 'info', message: `Rescue settings changed: ${FIELDS.map((f) => `${f.key}=${draft[f.key]}`).join(', ')}` });
              setOpen(false);
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
