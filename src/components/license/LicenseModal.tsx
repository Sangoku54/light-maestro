/**
 * LicenseModal — connexion / inscription + affichage de l'édition active +
 * achat (redirection vers le checkout Stripe) + crédits & sécurité.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLicenseStore, type LicenseEdition } from '../../stores/licenseStore';
import { version as appVersion } from '../../../package.json';
import { toast } from '../Toast';

/** Validation email minimal (miroir du filtre PHP FILTER_VALIDATE_EMAIL). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

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
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  // Vrai après l'ouverture du checkout Stripe : propose la vérification
  // d'achat (le webhook a entre-temps activé l'édition côté serveur).
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // À l'ouverture : on efface l'erreur précédente (issue d'une autre
  // opération — checkout, session précédente…) pour n'afficher que
  // l'erreur réellement liée à la tentative en cours.
  useEffect(() => {
    state.clearLoginError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSubmit = async () => {
    if (!email || !password) return;
    // Validation locale : évite un aller-retour serveur et affiche tout de
    // suite la cause exacte (le serveur renvoie 400 « invalid_input »).
    if (!EMAIL_RE.test(email.trim()) || password.length < MIN_PASSWORD_LENGTH) {
      useLicenseStore.setState({
        loginError: 'invalid_input',
        loginErrorDetail: null,
      });
      return;
    }
    setBusy(true);
    if (mode === 'register') {
      const ok = await state.register(email.trim(), password);
      setBusy(false);
      if (ok) {
        onClose();
        try { toast(t('toasts.registered', { email }), 'ok'); } catch {}
      }
    } else {
      const ok = await state.login(email.trim(), password);
      setBusy(false);
      if (ok) {
        onClose();
        try { toast(t('toasts.welcomeBack'), 'ok'); } catch {}
      }
    }
  };

  const doCheckout = async (edition: 'standard' | 'full') => {
    console.log('[modal] doCheckout', edition, 'busy=', busy, 'email=', state.email);
    setBusy(true);
    setCheckoutError(null);
    const url = await state.checkout(edition);
    console.log('[modal] checkout retourne url?', url !== null);
    setBusy(false);
    if (url) {
      setCheckoutPending(true);
    } else {
      // Afficher l'erreur même si loginError n'est pas défini
      const err = state.loginError;
      console.log('[modal] checkoutError possible:', err);
      if (err) setCheckoutError(err === 'network' ? 'Erreur réseau — vérifiez votre connexion et réessayez.' : err);
    }
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
                  {t('license.checkoutUpgrade')}
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
              {checkoutError && (
                <p className="text-[11px] text-red-400 text-center">{checkoutError}</p>
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
                {email.trim().length > 0 && !EMAIL_RE.test(email.trim()) && (
                  <p className="text-[10px] text-red-400 mt-1">{t('license.emailInvalid')}</p>
                )}
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('license.password')}</label>
                <div className="relative w-full mt-1">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') doSubmit(); }}
                    placeholder={showPassword ? '' : '••••••••'}
                    className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-200 focus:outline-none focus:border-purple-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-purple-400 focus:outline-none"
                    aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  >
                    <svg
                      className={`inline w-4 h-4 ${showPassword ? 'text-purple-400' : 'text-gray-400'}`}
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path
                        d="M1.5 4.5c0-.83.67-1.5 1.5-1.5h15c.83 0 1.5.67 1.5 1.5v9c0 .83-.67 1.5-1.5 1.5h-15c-.83 0-1.5-.67-1.5-1.5v-9zM7 9.5c0-.83.67-1.5 1.5-1.5h4c.83 0 1.5.67 1.5 1.5v4c0 .83-.67 1.5-1.5 1.5h-4c-.83 0-1.5-.67-1.5-1.5v-4zM7 16.5c0-.83.67-1.5 1.5-1.5h4c.83 0 1.5.67 1.5 1.5v4c0 .83-.67 1.5-1.5 1.5h-4c-.83 0-1.5-.67-1.5-1.5v-4zM3.5 12c0-.83.67-1.5 1.5-1.5h13c.83 0 1.5.67 1.5 1.5v4c0 .83-.67 1.5-1.5 1.5h-13c-.83 0-1.5-.67-1.5-1.5v-4zM20.5 12c0-.83.67-1.5 1.5-1.5h4c.83 0 1.5.67 1.5 1.5v4c0 .83-.67 1.5-1.5 1.5h-4c-.83 0-1.5-.67-1.5-1.5v-4z"
                      />
                    </svg>
                  </button>
                </div>
                {/* Règle de longueur du mot de passe : affichée en permanence
                    (le serveur PHP impose 6 caractères minimum) + état en direct. */}
                <p
                  className={`text-[10px] mt-1 ${
                    password.length === 0
                      ? 'text-gray-500'
                      : password.length < MIN_PASSWORD_LENGTH
                        ? 'text-red-400'
                        : 'text-green-400/80'
                  }`}
                >
                  {password.length === 0
                    ? t('license.passwordMinLength')
                    : password.length < MIN_PASSWORD_LENGTH
                      ? t('license.passwordTooShort', { count: MIN_PASSWORD_LENGTH - password.length })
                      : t('license.passwordOk')}
                </p>
              </div>

              {state.loginError && (
                <p className="text-[11px] text-red-400">
                  {t('license.err.' + state.loginError, { defaultValue: state.loginError })}
                  {state.loginErrorDetail && state.loginErrorDetail !== state.loginError && (
                    <span className="block text-red-300/80 mt-0.5">{state.loginErrorDetail}</span>
                  )}
                </p>
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