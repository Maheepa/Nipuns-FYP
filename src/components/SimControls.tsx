import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import {
  SIM_SCENARIOS,
  getSimScenario,
  onSimChange,
  setSimScenario,
  simFireAlert,
  type SimScenario,
} from '../services/simulator';

/** Scenario picker + "Fire ALERT" button, visible only in simulation mode. */
export function SimControls() {
  const simulate = useStore((s) => s.settings.simulate);
  const [scenario, setScenario] = useState<SimScenario>(getSimScenario());
  useEffect(() => onSimChange(() => setScenario(getSimScenario())), []);

  if (!simulate) return null;
  return (
    <div className="sim-controls">
      <span className="sim-tag">SIMULATION</span>
      <select value={scenario} onChange={(e) => setSimScenario(e.target.value as SimScenario)}>
        {SIM_SCENARIOS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <button className="sim-alert" onClick={simFireAlert} title="Send a fake emergency-button ALERT packet">
        Fire ALERT
      </button>
    </div>
  );
}
