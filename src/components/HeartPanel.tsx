import { config } from '../config';
import { ago, fmt } from '../format';
import { useMemo } from 'react';
import { fingerStatusText } from '../services/packetParser';
import { live, recentSamples, validBpm } from '../store/live';
import { useFrame } from '../store/ticker';
import { TimeChart, type Series } from './TimeChart';

const BPM_SERIES: Series[] = [{ key: 'bpm', label: 'BPM', color: '#2a78d6' }];

function bpmClass(bpm: number | null): 'safe' | 'warn' | 'danger' | 'none' {
  if (bpm == null) return 'none';
  const { bpmLow, bpmHigh } = config.detection;
  if (bpm < bpmLow || bpm > bpmHigh) return 'danger';
  if (bpm < bpmLow + 5 || bpm > bpmHigh - 10) return 'warn';
  return 'safe';
}

function Stat({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className={`stat ${cls}`}>
      <span className="stat-k">{label}</span>
      <span className="stat-v">{value}</span>
    </div>
  );
}

export function HeartPanel() {
  const now = useFrame(8);
  const p = live.watch.latest;
  const version = live.samples.version;
  const samples = useMemo(() => recentSamples(), [version]);
  const stats = live.stats;

  const bpm = p ? validBpm(p) : null;
  const cls = bpmClass(bpm);
  const stale = stats.lastPacketAt == null || now - stats.lastPacketAt > config.serial.packetStaleMs;
  const beat = bpm ? `${(60 / bpm).toFixed(2)}s` : '0s';
  const fingerOk = p?.stat === 3;

  return (
    <section className="card">
      <div className="card-head">
        MAX32664 · Heart rate &amp; telemetry
        <div className="right">
          {stats.lastPacketType && (
            <span className={`pkt-type ${stats.lastPacketType === 'ALERT' ? 'alert' : ''}`}>{stats.lastPacketType}</span>
          )}
          <span className={stale ? 'stale-text' : ''}>updated {ago(stats.lastPacketAt, now)}</span>
        </div>
      </div>
      <div className="card-body heart-body">
        <div className={`bpm-block ${cls} ${stale ? 'stale' : ''}`}>
          <svg
            className={`heart ${bpm && !stale ? 'beating' : ''}`}
            style={{ animationDuration: beat }}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4h2c.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z" />
          </svg>
          <div className="bpm-num">{bpm != null ? Math.round(bpm) : '--'}</div>
          <div className="bpm-unit">BPM {bpm == null && p ? '· no valid reading' : ''}</div>
        </div>

        <div className="chart-box bpm-chart">
          <TimeChart samples={samples} series={BPM_SERIES} unit="BPM" domain={[30, 180]} ticks={[50, 100, 150]} digits={0} />
        </div>

        <div className="stats-grid">
          <Stat label="SpO₂" value={p?.spo2 ? `${p.spo2} %` : '—'} />
          <Stat label="Confidence" value={p?.conf != null ? `${p.conf} %` : '—'} cls={p?.conf != null && p.conf < config.detection.minConfidence ? 'warn' : ''} />
          <Stat label="Finger" value={fingerStatusText(p?.stat ?? null)} cls={p ? (fingerOk ? 'ok' : 'warn') : ''} />
          <Stat label="Signal" value={`${stats.lastRssi ?? '—'} dBm / ${fmt(stats.lastSnr, 1)} dB`} />
          <Stat label="DATA / ALERT pkts" value={`${stats.data} / ${stats.alert}`} cls={stats.alert > 0 ? 'warn' : ''} />
          <Stat label="Bad packets" value={String(stats.bad)} cls={stats.bad > 0 ? 'warn' : ''} />
        </div>
      </div>
    </section>
  );
}
