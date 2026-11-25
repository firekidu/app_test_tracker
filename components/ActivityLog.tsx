'use client';
import { ArrowLeft, Download } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ChangeLogEntry } from '@/lib/types';
import { AppIcon, api } from './ui';

/** Every change in the tracker: when, which row and cell, old → new value, and who. */
export default function ActivityLog() {
  const [items, setItems] = useState<ChangeLogEntry[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [field, setField] = useState('');
  const [who, setWho] = useState('');
  const [row, setRow] = useState('');

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('row')) setRow(p.get('row')!);
    api<ChangeLogEntry[]>('GET', '/api/changes').then(setItems, (e) => setError((e as Error).message));
  }, []);

  const fields = useMemo(() => [...new Set((items ?? []).map((e) => e.field))].sort(), [items]);
  const people = useMemo(() => [...new Set((items ?? []).map((e) => e.by).filter(Boolean))].sort(), [items]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (items ?? []).filter(
      (e) =>
        (!field || e.field === field) &&
        (!who || e.by === who) &&
        (!row || e.sheetRow === row.trim()) &&
        (!t || `${e.bug} ${e.from} ${e.to} ${e.note}`.toLowerCase().includes(t)),
    );
  }, [items, q, field, who, row]);

  function exportCsv() {
    const head = ['Timestamp', 'Row', 'Bug', 'Field', 'From', 'To', 'By', 'Source', 'Note'];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [head, ...shown.map((e) => [e.timestamp, e.sheetRow, e.bug, e.field, e.from, e.to, e.by, e.source, e.note])].map((r) => r.map((v) => esc(v ?? '')).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = 'smprd-activity-log.csv';
    a.click();
  }

  return (
    <>
      <header className="header">
        <div className="brand">
          <AppIcon />
          <div>
            <h1>Activity log</h1>
            <div className="sync-line">Every change: when, which cell, old → new value, and who made it</div>
          </div>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={exportCsv} disabled={!shown.length}>
            <Download className="icon" /> Export
          </button>
          <Link className="btn" href="/">
            <ArrowLeft className="icon" /> Back to the sheet
          </Link>
        </div>
      </header>
      <main className="page">
        <div className="toolbar">
          <input className="input" style={{ width: 220, minHeight: 32 }} placeholder="Search text" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search text" />
          <input className="input" style={{ width: 90, minHeight: 32 }} placeholder="Row #" value={row} onChange={(e) => setRow(e.target.value)} aria-label="Row number" inputMode="numeric" />
          <select className="input" style={{ width: 'auto', minHeight: 32 }} value={field} onChange={(e) => setField(e.target.value)} aria-label="Field">
            <option value="">All fields</option>
            {fields.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <select className="input" style={{ width: 'auto', minHeight: 32 }} value={who} onChange={(e) => setWho(e.target.value)} aria-label="User">
            <option value="">All users</option>
            {people.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {items ? `${shown.length} of ${items.length} changes` : ''}
          </span>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="table-card">
          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 170px)', overflow: 'auto' }}>
            <table className="plain activity">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Row</th>
                  <th>Bug</th>
                  <th>Field</th>
                  <th>From</th>
                  <th>To</th>
                  <th>By</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                      {e.timestamp}
                    </td>
                    <td className="mono">{e.sheetRow}</td>
                    <td style={{ maxWidth: 260 }}>
                      <span className="clamp2">{e.bug}</span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{e.field}</td>
                    <td className="muted" style={{ maxWidth: 200 }}>
                      <span className="clamp2">{e.from}</span>
                    </td>
                    <td style={{ maxWidth: 200 }}>
                      <span className="clamp2">{e.to}</span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{e.by}</td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {e.source}
                      {e.note ? ` · ${e.note}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {items && !shown.length && <div className="empty">No changes match.</div>}
            {!items && !error && <div className="empty">Loading…</div>}
          </div>
        </div>
      </main>
    </>
  );
}
