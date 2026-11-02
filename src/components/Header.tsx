import { config } from '../config';
import { ago } from '../format';
import { live, packetRate } from '../store/live';
import { useFrame } from '../store/ticker';
import { useStore } from '../store/useStore';
import { askConfirm } from '../store/useUi';
import { Logo } from './Logo';

interface Props {
  onConnect: () => void;
  onDisconnect: () => void;
  onOpenLog: () => void;
}

type Dot = '' | 'ok' | 'warn' | 'bad';

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

function Chip({ label, text, dot, title }: { label: string; text: string; dot: Dot; title: string }) {
  return (
    <span className="chip" title={title}>
      <span className={`dot ${dot}`} />
      <span className="chip-label">{label}</span>
      {text}
    </span>
  );
}

/** Mute button shared by the header and the alert banner. The choice is saved in this browser. */
export function MuteButton({ className = 'hbtn icon' }: { className?: string }) {
  const muted = useStore((s) => s.settings.muted);
  const setMuted = useStore((s) => s.setMuted);
  return (
    <button
      className={className}
      onClick={() => setMuted(!muted)}
      title={muted ? 'Alarm muted — click to unmute' : 'Mute the alarm sound (the banner stays visible)'}
      aria-label={muted ? 'Unmute alarm' : 'Mute alarm'}
      aria-pressed={muted}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}

export function Header({ onConnect, onDisconnect, onOpenLog }: Props) {
  const now = useFrame(2);
  const link = useStore((s) => s.link);
  const simulate = useStore((s) => s.settings.simulate);
  const dryRun = useStore((s) => s.settings.dryRun);
  const droneLink = useStore((s) => s.droneLink);
  const eventCount = useStore((s) => s.events.length);
  const { setSimulate, setDryRun } = useStore.getState();
  const stats = live.stats;
  const watch = live.watch;

  // ---- LoRa receiver: from the receiver's own READY / HB lines
  const silentSince = link.lastHbAt ?? link.connectedAt;
  const receiverSilent = silentSince != null && now - silentSince > config.serial.heartbeatTimeoutMs;
  let lora: [string, Dot, string] = ['Disconnected', '', 'LoRa receiver not connected'];
  if (simulate) lora = ['Simulated', 'warn', 'Simulated receiver lines'];
  else if (link.status === 'unsupported') lora = ['Unsupported', 'bad', 'Web Serial needs Chrome or Edge on localhost'];
  else if (link.status === 'connecting') lora = ['Connecting', 'warn', 'Waiting for the serial port'];
  else if (link.status === 'error') lora = ['Error', 'bad', link.error ?? 'Serial error'];
  else if (link.status === 'connected') {
    if (link.receiverReady === false)
      lora = ['Receiver LoRa failed', 'bad', 'Receiver printed READY|LORA_FAIL: check the Ra-02 wiring (3.3 V, NSS 5, RST 14, DIO0 26, SPI 18/19/23)'];
    else if (receiverSilent) lora = ['Receiver silent', 'warn', `No HB line for over ${config.serial.heartbeatTimeoutMs / 1000} s`];
    else if (link.receiverReady === true || link.lastHbAt != null) lora = ['Receiver ready', 'ok', 'READY|LORA_OK / heartbeat received'];
    else lora = ['Waiting for receiver', 'warn', 'Port open, no READY or HB line yet'];
  }

  // ---- Watch: alive = RX packets arriving (separate from the receiver heartbeat)
  const watchFresh = stats.lastPacketAt != null && now - stats.lastPacketAt <= config.serial.packetStaleMs;
  let watchChip: [string, Dot, string] = ['—', '', 'No watch packet yet'];
  if (stats.lastPacketAt != null) {
    if (!watchFresh) watchChip = ['Stale', 'warn', `No packet for ${ago(stats.lastPacketAt, now)}`];
    else if (watch.positionStale || !watch.position) watchChip = ['No GPS', 'warn', 'Packets arriving, but LAT/LNG = NA'];
    else watchChip = ['Live', 'ok', 'Packets and GPS fix'];
  }

  // ---- Drone link: WebSocket to the bridge + MAVLink freshness
  const mavFresh = live.drone.lastMsgAt != null && now - live.drone.lastMsgAt < config.bridge.telemetryTimeoutMs;
  let drone: [string, Dot, string];
  if (simulate) drone = ['Simulated', 'warn', 'Simulated drone'];
  else if (!droneLink.wsConnected) drone = ['Bridge offline', 'bad', `Start it with npm run dev — retrying every ${config.bridge.reconnectMs / 1000} s`];
  else if (mavFresh) drone = ['Connected', 'ok', 'MAVLink arriving from Mission Planner'];
  else drone = ['No data', 'warn', `Bridge up, no MAVLink for ${config.bridge.telemetryTimeoutMs / 1000} s — check the Mission Planner mirror`];

  const connected = link.status === 'connected' || link.status === 'connecting';
  const unsupported = link.status === 'unsupported';
  const rssi = stats.lastRssi != null ? `${stats.lastRssi} dBm` : '— dBm';
  const snr = stats.lastSnr != null ? `${stats.lastSnr.toFixed(1)} dB` : '— dB';

  const toggleDryRun = async () => {
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
            Confirmed commands will be sent to the <b>real drone</b> through the bridge and Mission Planner. Each command
            still needs its own confirmation.
          </p>
        ),
        checklist: ['I have bench-tested these commands with the propellers removed', 'The flight area is clear and a safety pilot is ready'],
      }));
    if (ok) {
      setDryRun(false);
      log({ kind: 'info', message: simulate ? 'LIVE commands to the simulated drone' : 'LIVE drone commands enabled' });
    }
  };

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
        <Chip label="LoRa" text={lora[0]} dot={lora[1]} title={lora[2]} />
        <Chip label="Watch" text={watchChip[0]} dot={watchChip[1]} title={watchChip[2]} />
        <Chip label="Drone" text={drone[0]} dot={drone[1]} title={drone[2]} />
        <button
          className={`chip chip-btn ${dryRun ? 'dry' : 'live'}`}
          onClick={toggleDryRun}
          title={dryRun ? 'Dry-run ON: drone commands are logged, not sent. Click to go LIVE.' : 'LIVE: confirmed commands are sent. Click for dry-run.'}
        >
          Dry-run {dryRun ? 'ON' : 'OFF'}
        </button>

        <span className="sep" />

        <button
          className={`hbtn ${simulate ? 'on' : ''}`}
          onClick={() => setSimulate(!simulate)}
          disabled={!simulate && connected}
          title={connected ? 'Disconnect the receiver to simulate' : 'Generate fake watch and drone data'}
        >
          {simulate ? '◉ Simulating' : '○ Simulate'}
        </button>
        <MuteButton />
        <button className="hbtn" onClick={onOpenLog} title="Event log and CSV export">
          Log {eventCount}
        </button>

        <span className="sep" />

        <div className="connect-group">
          <div className="connect-info">
            <div className="meta">
              {packetRate(now).toFixed(1)} pkt/s · {rssi} / {snr}
            </div>
            <div className="meta">last packet {ago(stats.lastPacketAt, now)}</div>
          </div>
          {connected ? (
            <button className="btn-connect disconnect" onClick={onDisconnect}>
              Disconnect
            </button>
          ) : (
            // Disabled buttons don't show tooltips in every browser, so the wrapper carries it.
            <span
              className="tip-wrap"
              title={
                unsupported
                  ? 'Web Serial is not available in this browser. Open the app in Chrome or Edge at http://localhost:5173.'
                  : simulate
                    ? 'Turn off Simulate to connect the receiver'
                    : 'Choose the LoRa receiver serial port'
              }
            >
              <button className="btn-connect" onClick={onConnect} disabled={unsupported || simulate}>
                Connect
              </button>
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
