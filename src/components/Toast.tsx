import React, { useEffect, useState } from 'react';

type Toast = { id: number; msg: string; kind: 'ok' | 'err' };
let nextId = 1;
let pushFn: ((t: Toast) => void) | null = null;

export function toast(msg: string, kind: Toast['kind'] = 'ok') {
  const t = { id: nextId++, msg, kind };
  if (pushFn) pushFn(t);
  else console.log(`[toast ${kind}] ${msg}`);
}

// Expose to non-React callers (Stage3D, ProgrammerBar…).
(window as any).__lm_toast = (msg: string, kind?: string) => {
  toast(msg, kind === 'err' ? 'err' : 'ok');
};

export const ToastHost: React.FC = () => {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    pushFn = (t) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 6000);
    };
    return () => { pushFn = null; };
  }, []);
  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none max-w-md">
      {items.map((t) => (
        <div key={t.id} className={`px-4 py-3 rounded-xl text-sm font-semibold shadow-2xl border pointer-events-auto ${t.kind === 'ok' ? 'bg-[#12121a] border-emerald-500/40 text-emerald-100' : 'bg-[#1a0a0a] border-red-500/40 text-red-100'}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
};
