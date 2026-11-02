import { config } from '../config';
import { useNow } from '../hooks/useNow';
import { useStore } from '../store/useStore';
import { ago } from '../format';
import { askConfirm } from '../store/useUi';
import { Logo } from './Logo';

interface Props {
  onConnect: () => void;
  onDisconnect: () => void;
  onOpenLog: () => void;
}

function Waves() {
  // Two identical wave periods side by side so the drift loops seamlessly.
  const d = 'M0 10 Q 25 0 50 10 T 100 10 T 150 10 T 200 10 V 20 H 0 Z';
  return (
    <div className="header-waves">
      <svg viewBox="0 0 200 20" preserveAspectRatio="none">
        <path d={d} fill="#bfe9e2" />
      </svg>
    </div>
  );
}

export function Header({ onConnect, onDisconnect, onOpenLog }: Props) {
  const now = useNow(500);
  const link = useStore((s) => s.link);
  const stats = useStore((s) => s.stats);
  const simulate = useStore((s) => s.settings.simulate);
  const dryRun = useStore((s) => s.settings.dryRun);
  const muted = useStore((s) => s.settings.muted);
  const watchPos = useStore((s) => s.watch.position);
  const positionStale = useStore((s) => s.watch.positionStale);
  const droneLink = useStore((s) => s.droneLink);
  const droneLastMsg = useStore((s) => s.drone.lastMsgAt);
  const eventCount = useStore((s) => s.events.length);
  const { setSimulate, setDryRun, setMuted } = useStore.getState();

  // ---- drone link chip
  const droneFresh = droneLastMsg != null && now - droneLastMsg < config.bridge.telemetryTimeoutMs;
  const droneDot = droneFresh ? 'ok' : droneLink.wsConnected ? 'warn' : '';
  const droneText = simulate
    ? 'Drone: sim'
    : droneFresh
      ? 'Drone: connected'
      : droneLink.wsConnected
        ? 'Drone: no data'
        : 'Drone: bridge off';

  const packetFresh = stats.lastPacketAt != null && now - stats.lastPacketAt < config.serial.packetStaleMs;
  const rate = stats.recentRx.filter((t) => now - t < 10_000).length / 10;

  // ---- LoRa chip
  let loraDot = '';
  let loraText = 'LoRa: off';
  if (simulate) {
    loraDot = 'warn';
    loraText = 'LoRa: sim';
  } else if (link.status === 'connected') {
    loraDot = packetFresh ? 'ok' : link.receiverReady === false ? 'bad' : 'warn';
    loraText = packetFresh ? 'LoRa: receiving' : 'LoRa: no packets';
  } else if (link.status === 'error') {
    loraDot = 'bad';
    loraText = 'LoRa: error';
  }

  // ---- watch GPS chip
  let gpsDot = '';
  let gpsText = 'GPS: —';
  if (stats.lastPacketAt != null) {
    if (!positionStale && watchPos) {
      gpsDot = 'ok';
      gpsText = 'GPS: fix';
    } else {
      gpsDot = 'warn';
      gpsText = watchPos ? 'GPS: stale' : 'GPS: no fix';
    }
  }

  // ---- connection text next to the button
  const hbFresh = link.lastHbAt != null && now - link.lastHbAt < config.serial.heartbeatTimeoutMs;
  let stateText = 'Disconnected';
  if (simulate) stateText = 'Simulated receiver';
  else if (link.status === 'connecting') stateText = 'Connecting…';
  else if (link.status === 'connected') {
    if (link.receiverReady === false) stateText = 'Connected · LoRa FAIL';
    else if (!hbFresh && link.lastHbAt != null) stateText = 'Connected · receiver silent';
    else if (link.receiverReady === true) stateText = 'Connected · receiver ready';
    else stateText = hbFresh ? 'Connected · receiver alive' : 'Connected · waiting for receiver';
  }
  else if (link.status === 'error') stateText = `Error${link.error ? `: ${link.error}` : ''}`;
  else if (link.status === 'unsupported') stateText = 'Web Serial unsupported';

  const connected = link.status === 'connected' || link.status === 'connecting';
  const rssi = stats.lastRssi != null ? `${stats.lastRssi} dBm` : '— dBm';
  const snr = stats.lastSnr != null ? `${stats.lastSnr.toFixed(1)} dB` : '— dB';

  return (
    <header className="header">
      <Waves />
      <div className="brand">
        <Logo />
        <div className="brand-title">
          <strong>Beach Safety</strong>
          <span>Drowning Detection &amp; Drone Rescue</span>
        </div>
      </div>

      <div className="header-right">
        <span className="chip" title="LoRa receiver link">
          <span className={`dot ${loraDot}`} />
          {loraText}
        </span>
        <span className="chip" title="MAVLink via the Node bridge (Mission Planner mirror)">
          <span className={`dot ${droneDot}`} />
          {droneText}
        </span>
        <span className="chip" title="Watch GPS fix">
          <span className={`dot ${gpsDot}`} />
          {gpsText}
        </span>

        <span className="sep" />

        <button
          className={`hbtn ${simulate ? 'on' : ''}`}
          onClick={() => setSimulate(!simulate)}
          disabled={!simulate && connected}
          title={connected ? 'Disconnect the receiver to simulate' : 'Generate fake watch and drone data'}
        >
          {simulate ? '◉ Simulating' : '○ Simulate'}
        </button>
        <button
          className={`hbtn ${dryRun ? 'dry' : 'live'}`}
          onClick={async () => {
            const log = useStore.getState().logEvent;
            if (!dryRun) {
              setDryRun(true);
              log({ kind: 'info', message: 'Dry-run ON — drone commands are logged only' });
              return;
            }
            const ok =
              simulate ||
              (await askConfirm({
                title: 'Switch to LIVE drone commands?',
                confirmLabel: 'Go LIVE',
                tone: 'danger',
                body: (
                  <p>
                    Confirmed commands will be sent to the <b>real drone</b> through the bridge and Mission Planner. Each
                    command still needs its own confirmation.
                  </p>
                ),
                checklist: ['I have bench-tested these commands with the propellers removed', 'The flight area is clear and a safety pilot is ready'],
              }));
            if (ok) {
              setDryRun(false);
              log({ kind: 'info', message: simulate ? 'LIVE commands to the simulated drone' : 'LIVE drone commands enabled' });
            }
          }}
          title="Dry-run: drone commands are logged, not sent"
        >
          {dryRun ? 'DRY-RUN ON' : 'LIVE COMMANDS'}
        </button>
        <button className="hbtn" onClick={() => setMuted(!muted)} title="Mute alarm sound">
          {muted ? '🔇 Muted' : '🔊 Sound'}
        </button>
        <button className="hbtn" onClick={onOpenLog} title="Event log and CSV export">
          Log {eventCount}
        </button>

        <span className="sep" />

        <div className="connect-group">
          <div className="connect-info">
            <div className="state">{stateText}</div>
            <div className="meta">
              {rate.toFixed(1)} pkt/s · {rssi} / {snr} · {ago(stats.lastPacketAt, now)}
            </div>
          </div>
          {connected ? (
            <button className="btn-connect disconnect" onClick={onDisconnect}>
              Disconnect
            </button>
          ) : (
            <button
              className="btn-connect"
              onClick={onConnect}
              disabled={link.status === 'unsupported' || simulate}
              title={simulate ? 'Turn off Simulate to connect the receiver' : 'Choose the LoRa receiver serial port'}
            >
              Connect
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
