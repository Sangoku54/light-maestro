import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Toast = { id: number; msg: string; kind: 'ok' | 'err' };
let nextId = 1;
let pushFn: ((t: Toast) => void) | null = null;

/**
 * Un message qui ressemble a une cle i18n ("stage3D.toastSnapOn") est
 * traduit a l'affichage ; sinon il est affiche tel quel.
 */
const I18N_KEY_RE = /^[a-zA-Z][\w-]*(\.[\w-]+)+$/;

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
  const { t } = useTranslation();
  useEffect(() => {
    pushFn = (t) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 6000);
    };
    return () => { pushFn = null; };
  }, []);
  return (
    <div className="fixed left-1/2 top-1/3 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none max-w-lg w-max">
      {items.map((item) => (
        <div key={item.id} className={`px-4 py-3 rounded-xl text-sm font-semibold shadow-2xl border pointer-events-auto ${item.kind === 'ok' ? 'bg-[#12121a] border-emerald-500/40 text-emerald-100' : 'bg-[#1a0a0a] border-red-500/40 text-red-100'}`}>
          {I18N_KEY_RE.test(item.msg) ? t(item.msg) : item.msg}
        </div>
      ))}
    </div>
  );
};
