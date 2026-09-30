/**
 * LicenseModal — connexion / inscription + affichage de l'édition active +
 * achat (redirection vers le checkout Stripe) + crédits & sécurité.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLicenseStore, type LicenseEdition } from '../../stores/licenseStore';
import { version as appVersion } from '../../../package.json';
import { toast } from '../Toast';

const EDITION_META: Record<LicenseEdition, { labelKey: string; descKey: string; color: string }> = {
  free: { labelKey: 'license.edFreeLabel', descKey: 'license.edFreeDesc', color: 'text-gray-400 border-gray-600' },
  standard: { labelKey: 'license.edStandardLabel', descKey: 'license.edStandardDesc', color: 'text-blue-400 border-blue-500/50' },
  full: { labelKey: 'license.edFullLabel', descKey: 'license.edFullDesc', color: 'text-purple-300 border-purple-500/50' },
};

export const LicenseModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const state = useLicenseStore();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  // Vrai après l'ouverture du checkout Stripe : propose la vérification
  // d'achat (le webhook a entre-temps activé l'édition côté serveur).
  const [checkoutPending, setCheckoutPending] = useState(false);

  const doSubmit = async () => {
    if (!email || !password) return;
    setBusy(true);
    if (mode === 'register') {
      const ok = await state.register(email, password);
      setBusy(false);
      if (ok) {
        onClose();
        try { toast(t('toasts.registered', { email }), 'ok'); } catch {}
      }
    } else {
      const ok = await state.login(email, password);
      setBusy(false);
      if (ok) {
        onClose();
        try { toast(t('toasts.welcomeBack'), 'ok'); } catch {}
      }
    }
  };

  const doCheckout = async (edition: 'standard' | 'full') => {
    setBusy(true);
    const url = await state.checkout(edition);
    setBusy(false);
    if (url) setCheckoutPending(true);
  };

  const doVerifyPurchase = async () => {
    setBusy(true);
    await state.refresh();
    setBusy(false);
    const cur = useLicenseStore.getState();
    if (cur.licensed) {
      setCheckoutPending(false);
      try {
        const meta = EDITION_META[cur.edition] ?? EDITION_META.free;
        toast(t('license.purchaseReady', { label: t(meta.labelKey) }), 'ok');
      } catch {}
      onClose();
    } else {
      try { toast(t('license.purchaseWaiting'), 'err'); } catch {}
    }
  };

  const info = EDITION_META[state.edition] ?? EDITION_META.free;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#12121a] border border-gray-700 rounded-xl shadow-2xl w-[420px] max-w-[95vw] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-800/50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">{t('license.title')}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Édition courante */}
          <div className={`border rounded-lg px-4 py-3 ${info.color}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">{t('license.edition', { label: t(info.labelKey) })}</span>
              {state.licensed && state.email && (
                <span className="text-[10px] opacity-70">{state.email}</span>
              )}
            </div>
            <p className="text-[11px] mt-1 opacity-80">{t(info.descKey)}</p>
          </div>

          {state.licensed ? (
            <div className="space-y-2">
              {/* Upgrade possible depuis standard vers full */}
              {state.edition === 'standard' && (
                <button
                  onClick={() => doCheckout('full')}
                  disabled={busy}
                  className="w-full px-3 py-2 rounded-md bg-purple-600 text-white text-xs font-semibold hover:bg-purple-500 disabled:opacity-40"
                >
                  {t('license.checkoutFull')}
                </button>
              )}
              {checkoutPending && (
                <button
                  onClick={doVerifyPurchase}
                  disabled={busy}
                  className="w-full px-3 py-2 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 disabled:opacity-40"
                >
                  {busy ? t('license.busy') : t('license.checkPurchase')}
                </button>
              )}
              <button
                onClick={() => {
                  if (!confirmLogout) { setConfirmLogout(true); return; }
                  setConfirmLogout(false);
                  state.logout();
                }}
                onBlur={() => setConfirmLogout(false)}
                className={`w-full px-3 py-2 rounded-md text-xs font-semibold border transition-colors ${confirmLogout ? 'bg-red-600/30 border-red-500/50 text-red-200 hover:bg-red-600/40' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}
              >
                {confirmLogout ? t('license.confirmLogout') : t('license.logout')}
              </button>
            </div>
          ) : state.email ? (
            <div className="space-y-2">
              <p className="text-[11px] text-gray-400 leading-relaxed">
                {t('license.connectedAs')} <span className="text-gray-200 font-semibold">{state.email}</span> — {t('license.freeConnected')}
              </p>
              <button
                onClick={() => doCheckout('standard')}
                disabled={busy}
                className="w-full px-3 py-2 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 disabled:opacity-40"
              >
                {t('license.checkoutStandard')}
              </button>
              <button
                onClick={() => doCheckout('full')}
                disabled={busy}
                className="w-full px-3 py-2 rounded-md bg-purple-600 text-white text-xs font-semibold hover:bg-purple-500 disabled:opacity-40"
              >
                {t('license.checkoutFullFree')}
              </button>
              {checkoutPending && (
                <button
                  onClick={doVerifyPurchase}
                  disabled={busy}
                  className="w-full px-3 py-2 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 disabled:opacity-40"
                >
                  {busy ? t('license.busy') : t('license.checkPurchase')}
                </button>
              )}
              <button
                onClick={() => {
                  if (!confirmLogout) { setConfirmLogout(true); return; }
                  setConfirmLogout(false);
                  state.logout();
                }}
                onBlur={() => setConfirmLogout(false)}
                className={`w-full px-3 py-2 rounded-md text-xs font-semibold border transition-colors ${confirmLogout ? 'bg-red-600/30 border-red-500/50 text-red-200 hover:bg-red-600/40' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}
              >
                {confirmLogout ? t('license.confirmLogoutShort') : t('license.logout')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Onglets connexion / inscription */}
              <div className="flex rounded-lg overflow-hidden border border-gray-700">
                <button
                  onClick={() => setMode('login')}
                  className={`flex-1 py-1.5 text-xs font-semibold ${mode === 'login' ? 'bg-purple-600/30 text-purple-200' : 'bg-gray-800/50 text-gray-400'}`}
                >
                  {t('license.loginTab')}
                </button>
                <button
                  onClick={() => setMode('register')}
                  className={`flex-1 py-1.5 text-xs font-semibold ${mode === 'register' ? 'bg-purple-600/30 text-purple-200' : 'bg-gray-800/50 text-gray-400'}`}
                >
                  {t('license.registerTab')}
                </button>
              </div>

              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('license.email')}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('license.emailPlaceholder')}
                  className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-200 focus:outline-none focus:border-purple-500/50"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('license.password')}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') doSubmit(); }}
                  placeholder="••••••••"
                  className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-200 focus:outline-none focus:border-purple-500/50"
                />
              </div>

              {state.loginError && (
                <p className="text-[11px] text-red-400">{t('license.err.' + state.loginError, { defaultValue: state.loginError })}</p>
              )}

              <button
                onClick={doSubmit}
                disabled={busy || !email || !password}
                className="w-full px-3 py-2 rounded-md bg-purple-600 text-white text-xs font-semibold hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? t('license.busy') : mode === 'register' ? t('license.doRegister') : t('license.doLogin')}
              </button>

              <div className="pt-2 border-t border-gray-800 text-[10px] text-gray-600 space-y-1">
                <p>{t('license.priceStandard')}</p>
                <p>{t('license.priceFull')}</p>
              </div>
            </div>
          )}

          {/* Crédits & sécurité — attribution de licence obligatoire */}
          <div className="pt-3 border-t border-gray-800 text-[10px] text-gray-500 space-y-1">
            <p className="uppercase tracking-wider text-gray-600">{t('safety.creditsTitle')}</p>
            <p>{t('safety.ofl')}</p>
            <p>{t('safety.appLine')} v{appVersion}</p>
          </div>
        </div>
      </div>
    </div>
  );
};