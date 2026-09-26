import React, { useState } from 'react';
import { Palette } from 'lucide-react';

/**
 * ColorPickerModal — sélecteur de couleur Light Maestro (modale centrée).
 *
 * Remplace l'astuce de l'<input type="color"> caché + clic programmatique,
 * dont l'événement change ne part pas fiablement sous Electron (la modale
 * native Windows s'ouvre mais la couleur n'est jamais appliquée).
 * Ici l'input natif est VISIBLE et manipulé directement par l'utilisateur,
 * avec pastilles prédéfinies + champ hexadécimal + validation explicite.
 */

interface ColorPickerModalProps {
  title: string;
  initial?: string;
  onPick: (color: string) => void;
  onClose: () => void;
}

const PRESET_COLORS = [
  '#ff0000', '#ff5500', '#ff8800', '#ffcc00',
  '#ffff00', '#88ff00', '#00ff00', '#00ff88',
  '#00ffff', '#0088ff', '#0000ff', '#8800ff',
  '#ff00ff', '#ff0088', '#ff0064', '#ffffff',
  '#ffd9e8', '#ffb3c7', '#888888', '#222222',
];

function normalizeHex(raw: string): string | null {
  let h = raw.trim().toLowerCase();
  if (!h.startsWith('#')) h = '#' + h;
  if (/^#[0-9a-f]{6}$/.test(h)) return h;
  const short = /^#([0-9a-f]{3})$/.exec(h);
  if (short) return '#' + short[1].split('').map((c) => c + c).join('');
  return null;
}

export const ColorPickerModal: React.FC<ColorPickerModalProps> = ({
  title,
  initial = '#ffffff',
  onPick,
  onClose,
}) => {
  const [color, setColor] = useState(() => normalizeHex(initial) || '#ffffff');
  const [hexText, setHexText] = useState(() => normalizeHex(initial) || '#ffffff');
  const [hexError, setHexError] = useState(false);

  const setBoth = (c: string) => {
    setColor(c);
    setHexText(c);
    setHexError(false);
  };

  const commitHex = () => {
    const n = normalizeHex(hexText);
    if (n) {
      setColor(n);
      setHexText(n);
      setHexError(false);
    } else {
      setHexError(true);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="relative z-10 bg-[#1a1a2e] border border-gray-700 rounded-xl shadow-2xl p-5 w-[340px] max-w-[95vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-semibold text-gray-200">{title}</span>
          </div>
          <button className="text-gray-500 hover:text-white text-lg px-1" onClick={onClose}>✕</button>
        </div>

        {/* Aperçu + sélecteur natif (visible : fiable sous Electron) */}
        <div className="flex items-center gap-3 mb-4">
          <span
            className="w-14 h-14 rounded-full border-2 border-gray-600 shadow-lg shrink-0"
            style={{ backgroundColor: color }}
          />
          <div className="flex-1">
            <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">
              Couleur personnalisée
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setBoth(e.target.value)}
                className="w-10 h-10 rounded-lg border-2 border-gray-700 cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={hexText}
                onChange={(e) => setHexText(e.target.value)}
                onBlur={commitHex}
                onKeyDown={(e) => { if (e.key === 'Enter') commitHex(); }}
                spellCheck={false}
                maxLength={7}
                className={`flex-1 min-w-0 px-2 py-1.5 bg-gray-800/50 border rounded text-xs text-gray-200 font-mono outline-none ${
                  hexError ? 'border-red-500/70' : 'border-gray-700 focus:border-purple-500/50'
                }`}
              />
            </div>
          </div>
        </div>

        {/* Pastilles prédéfinies */}
        <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">
          Couleurs rapides
        </label>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {PRESET_COLORS.map((hex) => (
            <button
              key={hex}
              onClick={() => setBoth(hex)}
              className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${
                color === hex ? 'border-white' : 'border-gray-700'
              }`}
              style={{ backgroundColor: hex }}
              title={hex}
            />
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs text-gray-400 border border-gray-700 hover:bg-gray-800"
          >
            Annuler
          </button>
          <button
            onClick={() => onPick(color)}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-purple-600 text-white hover:bg-purple-500"
          >
            Valider
          </button>
        </div>
      </div>
    </div>
  );
};
