import { fmt } from '../format';
import { useMemo } from 'react';
import { live, recentSamples } from '../store/live';
import { useFrame } from '../store/ticker';
import { TimeChart, type Series } from './TimeChart';

const ACCEL: Series[] = [
  { key: 'ax', label: 'X', color: '#2a78d6' },
  { key: 'ay', label: 'Y', color: '#eb6834' },
  { key: 'az', label: 'Z', color: '#1baf7a' },
];
const GYRO: Series[] = [
  { key: 'gx', label: 'X', color: '#2a78d6' },
  { key: 'gy', label: 'Y', color: '#eb6834' },
  { key: 'gz', label: 'Z', color: '#1baf7a' },
];

function AxisValues({ series, values }: { series: Series[]; values: (number | null)[] }) {
  return (
    <div className="axis-values">
      {series.map((s, i) => (
        <span key={String(s.key)} className="axis-val">
          <i style={{ background: s.color }} />
          {s.label}
          <b>{fmt(values[i], 2)}</b>
        </span>
      ))}
    </div>
  );
}

export function MpuPanel() {
  useFrame(8);
  const version = live.samples.version;
  // Charts only get a new array when a packet arrived; the 8 Hz tick alone does not redraw them.
  const samples = useMemo(() => recentSamples(), [version]);
  const p = live.watch.latest;
  const mag = p && p.ax != null && p.ay != null && p.az != null ? Math.hypot(p.ax, p.ay, p.az) : null;

  return (
    <section className="card">
      <div className="card-head">
        MPU-6050 · Motion
        <span className="sub">last 60 s</span>
        <div className="right">|a| {fmt(mag, 2)} m/s²</div>
      </div>
      <div className="card-body mpu-body">
        <div className="mpu-col">
          <div className="mpu-title">
            <span>Accel <small>m/s²</small></span>
            <AxisValues series={ACCEL} values={[p?.ax ?? null, p?.ay ?? null, p?.az ?? null]} />
          </div>
          <div className="chart-box">
            {/* MPU range is ±8 g (≈ ±78 m/s²); ±25 keeps normal motion readable, spikes clip at the edge */}
            <TimeChart samples={samples} series={ACCEL} unit="m/s²" domain={[-25, 25]} ticks={[-20, 0, 20]} digits={2} />
          </div>
        </div>
        <div className="mpu-col">
          <div className="mpu-title">
            <span>Gyro <small>°/s</small></span>
            <AxisValues series={GYRO} values={[p?.gx ?? null, p?.gy ?? null, p?.gz ?? null]} />
          </div>
          <div className="chart-box">
            <TimeChart samples={samples} series={GYRO} unit="°/s" domain={[-500, 500]} ticks={[-400, 0, 400]} digits={1} />
          </div>
        </div>
      </div>
    </section>
  );
}
