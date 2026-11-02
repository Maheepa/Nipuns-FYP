import { memo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { config } from '../config';
import type { Sample } from '../types';

export interface Series {
  key: keyof Sample;
  label: string;
  color: string;
}

interface Props {
  samples: Sample[];
  series: Series[];
  unit: string;
  /** Fixed y-domain keeps the scale steady between updates. */
  domain?: [number | 'auto' | 'dataMin' | 'dataMax', number | 'auto' | 'dataMin' | 'dataMax'];
  /** Explicit y ticks — the panels are short, so automatic ticks get thinned unevenly. */
  ticks?: number[];
  digits?: number;
}

/** Rolling 60 s line chart. Data arrives at 1 Hz, so it re-renders at most ~1–2 Hz. */
export const TimeChart = memo(function TimeChart({ samples, series, unit, domain = ['auto', 'auto'], ticks, digits = 1 }: Props) {
  const end = samples.length ? samples[samples.length - 1].t : Date.now();
  const start = end - config.charts.windowMs;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={samples} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#e3e9ef" vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          domain={[start, end]}
          allowDataOverflow
          tickCount={4}
          tickFormatter={(t: number) => `${Math.round((t - end) / 1000)}s`}
          tick={{ fontSize: 10, fill: '#6a7a8f' }}
          stroke="#c5d0db"
        />
        <YAxis
          domain={domain}
          ticks={ticks}
          interval={0}
          allowDataOverflow
          tick={{ fontSize: 10, fill: '#6a7a8f' }}
          stroke="#c5d0db"
          width={36}
          tickFormatter={(v: number) => `${Math.round(v)}`}
        />
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: '#8a99ad', strokeWidth: 1 }}
          labelFormatter={(t: number) => new Date(t).toLocaleTimeString([], { hour12: false })}
          formatter={(v: number, name: string) => [v == null ? '—' : `${v.toFixed(digits)} ${unit}`, name]}
          contentStyle={{ fontSize: 12, borderRadius: 6, padding: '4px 8px' }}
        />
        {series.map((s) => (
          <Line
            key={String(s.key)}
            dataKey={s.key as string}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
            isAnimationActive={false}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
});
