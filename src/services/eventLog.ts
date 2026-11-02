import type { LogEvent } from '../types';

const COLUMNS: (keyof LogEvent)[] = ['t', 'kind', 'message', 'lat', 'lng', 'bpm', 'spo2', 'conf'];

function cell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with an ISO timestamp and a local-time column for the report. */
export function eventsToCsv(events: LogEvent[]): string {
  const header = ['iso_time', 'local_time', ...COLUMNS.slice(1)].join(',');
  const rows = events.map((e) =>
    [
      new Date(e.t).toISOString(),
      new Date(e.t).toLocaleString(),
      ...COLUMNS.slice(1).map((k) => (k === 'lat' || k === 'lng') && e[k] != null ? (e[k] as number).toFixed(7) : e[k]),
    ]
      .map(cell)
      .join(','),
  );
  return [header, ...rows].join('\r\n') + '\r\n';
}

export function downloadCsv(events: LogEvent[]): void {
  const blob = new Blob(['﻿' + eventsToCsv(events)], { type: 'text/csv;charset=utf-8' }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `beach-safety-events-${stamp}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
