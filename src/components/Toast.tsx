import React, { useEffect, useState } from 'react';

type Toast = { id: number; msg: string; kind: 'ok' | 'err' };
let nextId = 1;
let pushFn: ((t: Toast) => void) | null = null;

export function toast(msg: string, kind: Toast['kind'] = 'ok') {
  const t = { id: nextId++, msg, kind };
  if (pushFn) pushFn(t);
  else console.log(`[toast ${kind}] ${msg}`);
}

export const ToastHost: React.FC = () => {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    pushFn = (t) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 2600);
    };
    return () => { pushFn = null; };
  }, []);
  return (
    <div className="fixed bottom-3 right-3 z-[9999] flex flex-col gap-2 pointer-events-none">
      {items.map((t) => (
        <div key={t.id} className={`px-3 py-2 rounded-lg text-xs font-medium shadow-xl border pointer-events-auto ${t.kind === 'ok' ? 'bg-[#12121a] border-emerald-500/30 text-emerald-200' : 'bg-[#1a0a0a] border-red-500/30 text-red-200'}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
};
