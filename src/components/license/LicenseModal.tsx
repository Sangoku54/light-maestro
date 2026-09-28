/**
 * LicenseModal — connexion / inscription + affichage de l'édition active +
 * achat (redirection vers le checkout Stripe) + crédits & sécurité.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLicenseStore, type LicenseEdition } from '../../stores/licenseStore';
import { version as appVersion } from '../../../package.json';

const EDITION_LABEL: Record<LicenseEdition, { label: string; desc: string; color: string }> = {
  free: {
    label: 'Gratuite',
    desc: '1 fixture · 1 univers',
    color: 'text-gray-400 border-gray-600',
  },
  standard: {
    label: 'Standard',
    desc: 'Fixtures illimitées · 1 univers',
    color: 'text-blue-400 border-blue-500/50',
  },
  full: {
    label: 'Complète',
    desc: 'Fixtures et univers illimités',
    color: 'text-purple-300 border-purple-500/50',
  },
};

export const LicenseModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const state = useLicenseStore();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [justRegistered, setJustRegistered] = useState<string | null>(null);

  const doSubmit = async () => {
    if (!email || !password) return;
    setBusy(true);
    if (mode === 'register') {
      const ok = await state.register(email, password);
      if (ok) setJustRegistered(email);
    } else {
      await state.login(email, password);
    }
    setBusy(false);
  };

  const doCheckout = async (edition: 'standard' | 'full') => {
    setBusy(true);
    await state.checkout(edition);
    setBusy(false);
  };

  const info = EDITION_LABEL[state.edition] ?? EDITION_LABEL.free;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#12121a] border border-gray-700 rounded-xl shadow-2xl w-[420px] max-w-[95vw] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-800/50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Compte & Licence</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Édition courante */}
          <div className={`border rounded-lg px-4 py-3 ${info.color}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Édition : {info.label}</span>
              {state.licensed && state.email && (
                <span className="text-[10px] opacity-70">{state.email}</span>
              )}
            </div>
            <p className="text-[11px] mt-1 opacity-80">{info.desc}</p>
          </div>

          {state.licensed ? (
            justRegistered ? (
              <div className="space-y-3 text-center">
                <div className="mx-auto w-12 h-12 rounded-full bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center">
                  <span className="text-emerald-300 text-xl">✓</span>
                </div>
                <p className="text-sm font-semibold text-white">Compte créé, bienvenue !</p>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Un email de confirmation vient d'être envoyé à<br />
                  <span className="text-gray-200 font-semibold">{justRegistered}</span>
                </p>
                <button
                  onClick={onClose}
                  className="w-full px-3 py-2 rounded-md bg-purple-600 text-white text-xs font-semibold hover:bg-purple-500"
                >
                  C'est parti
                </button>
              </div>
            ) : (
            <div className="space-y-2">
              {/* Upgrade possible depuis standard vers full */}
              {state.edition === 'standard' && (
                <button
                  onClick={() => doCheckout('full')}
                  disabled={busy}
                  className="w-full px-3 py-2 rounded-md bg-purple-600 text-white text-xs font-semibold hover:bg-purple-500 disabled:opacity-40"
                >
                  Passer à la version Complète — 99€
                </button>
              )}
              <button
                onClick={state.logout}
                className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-gray-300 text-xs font-semibold hover:bg-gray-700"
              >
                Se déconnecter
              </button>
            </div>
          )) : (
            <div className="space-y-3">
              {/* Onglets connexion / inscription */}
              <div className="flex rounded-lg overflow-hidden border border-gray-700">
                <button
                  onClick={() => setMode('login')}
                  className={`flex-1 py-1.5 text-xs font-semibold ${mode === 'login' ? 'bg-purple-600/30 text-purple-200' : 'bg-gray-800/50 text-gray-400'}`}
                >
                  Connexion
                </button>
                <button
                  onClick={() => setMode('register')}
                  className={`flex-1 py-1.5 text-xs font-semibold ${mode === 'register' ? 'bg-purple-600/30 text-purple-200' : 'bg-gray-800/50 text-gray-400'}`}
                >
                  Créer un compte
                </button>
              </div>

              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vous@exemple.com"
                  className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-200 focus:outline-none focus:border-purple-500/50"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">Mot de passe</label>
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
                <p className="text-[11px] text-red-400">{state.loginError}</p>
              )}

              <button
                onClick={doSubmit}
                disabled={busy || !email || !password}
                className="w-full px-3 py-2 rounded-md bg-purple-600 text-white text-xs font-semibold hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? 'Patientez…' : mode === 'register' ? 'Créer le compte' : 'Se connecter'}
              </button>

              <div className="pt-2 border-t border-gray-800 text-[10px] text-gray-600 space-y-1">
                <p>Standard — 69 € · fixtures illimitées, 1 univers</p>
                <p>Complète — 99 € · fixtures et univers illimités</p>
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