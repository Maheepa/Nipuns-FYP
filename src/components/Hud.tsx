import { config } from '../config';
import { fmt } from '../format';
import { useNow } from '../hooks/useNow';
import { useStore } from '../store/useStore';

const FIX_TEXT: Record<number, string> = {
  0: 'No GPS',
  1: 'No Fix',
  2: '2D Fix',
  3: '3D Fix',
  4: '3D DGPS',
  5: 'RTK Float',
  6: 'RTK Fixed',
};

/** Mission-Planner-style status overlay in the corner of the map. */
export function Hud() {
  const now = useNow(1000);
  const d = useStore((s) => s.drone);
  const link = useStore((s) => s.droneLink);
  const live = d.lastMsgAt != null && now - d.lastMsgAt < config.bridge.telemetryTimeoutMs;
  const lastText = d.statusTexts[d.statusTexts.length - 1];

  if (!live) {
    return (
      <div className="hud">
        <div className="hud-arm nodata">NO DRONE DATA</div>
        <div className="hud-row muted">{link.wsConnected ? 'Bridge up · waiting for MAVLink' : 'Bridge not connected'}</div>
      </div>
    );
  }

  return (
    <div className="hud">
      <div className={`hud-arm ${d.armed ? 'armed' : 'disarmed'}`}>{d.armed ? 'ARMED' : 'DISARMED'}</div>
      <div className="hud-row">
        <span className="k">Mode</span>
        <span className="v">{d.mode}</span>
      </div>
      <div className="hud-row">
        <span className="k">GPS</span>
        <span className={`v ${d.gpsFix >= 3 ? 'ok' : 'bad'}`}>
          {FIX_TEXT[d.gpsFix] ?? `fix ${d.gpsFix}`} · {d.sats ?? '—'} sats
        </span>
      </div>
      <div className="hud-row">
        <span className="k">Alt</span>
        <span className="v">{fmt(d.relAltM, 1)} m</span>
        <span className="k">GS</span>
        <span className="v">{fmt(d.groundSpeed, 1)} m/s</span>
      </div>
      <div className="hud-row">
        <span className="k">Batt</span>
        <span className={`v ${d.batteryPct != null && d.batteryPct < 30 ? 'bad' : ''}`}>
          {fmt(d.batteryV, 1)} V{d.batteryPct != null && d.batteryPct >= 0 ? ` · ${d.batteryPct}%` : ''}
        </span>
      </div>
      {lastText && (
        <div className={`hud-text ${lastText.severity <= 4 ? 'bad' : ''}`} title={new Date(lastText.t).toLocaleTimeString()}>
          {lastText.text}
          {lastText.count > 1 ? ` (×${lastText.count})` : ''}
        </div>
      )}
    </div>
  );
}
