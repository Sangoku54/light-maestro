/**
 * RichTooltip — infobulle ludique et très explicite au survol d'un contrôle.
 *
 * Remplace les `title=` natifs (froids, ambigus) par un encart visuel :
 *   - icône + titre accrocheur
 *   - 1-2 lignes d'explication claire, vocabulaire simple
 *   - un exemple concret "Ex. :" pour ancrer l'usage
 *
 * Positionnement robuste (conteneurs transformés/filtrés non pris en compte :
 * on utilise `absolute` relatif au wrapper, PAS `fixed` qui serait cassé par
 * un ancêtre avec transform/filter/backdrop-filter) :
 *   - la bulle est mesurée (offsetWidth/offsetHeight), d'abord reléguée
 *     hors-écran (left:-9999) pour ne laisser aucun artefact,
 *   - puis placée en coordonnées wrapper-relative avec clamp au viewport
 *     (elle ne sort JAMAIS de la modale / de l'écran),
 *   - bascule haut/bas ou gauche/droite si le côté préféré manque de place,
 *   - flèche recalculée pour rester pointée vers le déclencheur.
 */
import React, { useLayoutEffect, useRef, useState } from 'react';

export type RichTooltipContent = {
  icon?: React.ReactNode;
  title: string;
  text: string;
  example?: string;
  tone?: 'info' | 'warn' | 'success' | 'danger';
};

const TONE_BORDER: Record<NonNullable<RichTooltipContent['tone']>, string> = {
  info: 'border-violet-500/40',
  warn: 'border-amber-500/40',
  success: 'border-emerald-500/40',
  danger: 'border-rose-500/40',
};
const TONE_ICON: Record<NonNullable<RichTooltipContent['tone']>, string> = {
  info: 'text-violet-300',
  warn: 'text-amber-300',
  success: 'text-emerald-300',
  danger: 'text-rose-300',
};

type TipStyle = {
  left: number;
  top: number;
  side: 'top' | 'bottom' | 'left' | 'right';
  arrow: number; // offset (px) de la flèche sur l'axe non centré (= bord de la bulle)
};

type ClampRect = { left: number; top: number; right: number; bottom: number };

const TIP_MARGIN = 8; // espace entre le trigger et la bulle
const EDGE_MARGIN = 6; // marge min au bord du conteneur (modale / viewport)

// Zone dans laquelle la bulle doit rester : la fenêtre ET le plus proche
// ancêtre "scrollable/qui clippe" (le panneau/modale qui contient le bouton).
// Pour un VRAI scroller (contenu qui déborde) on borne sur sa zone visible
// (clientWidth/clientHeight) ; sinon on garde la boîte complète. Les éléments
// non-layoutés (inline, vides) sont ignorés — jamais de rect nul qui écraserait
// le clamp.
function getClampRect(el: HTMLElement | null, vw: number, vh: number): ClampRect {
  let left = 0, top = 0, right = vw, bottom = vh;
  let node = el?.parentElement ?? null;
  while (node) {
    try {
      const cs = getComputedStyle(node);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const r = node.getBoundingClientRect();
        const L = r.left + node.clientLeft;
        const T = r.top + node.clientTop;
        const scrolled = node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth;
        const R = scrolled ? L + node.clientWidth : r.right;
        const B = scrolled ? T + node.clientHeight : r.bottom;
        if (R - L >= 1 && B - T >= 1) {
          left = Math.max(left, L);
          top = Math.max(top, T);
          right = Math.min(right, R);
          bottom = Math.min(bottom, B);
        }
      }
    } catch {
      /* ignore les éléments détachés */
    }
    node = node.parentElement;
  }
  return { left, top, right, bottom };
}

export function RichTooltip({
  content,
  children,
  placement = 'top',
  className,
}: {
  content: RichTooltipContent;
  children: React.ReactNode;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<TipStyle | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    const tip = tipRef.current;
    if (!wrap || !tip) return;
    // Mesure réelle de la bulle (montée hors-écran à left:-9999 → taille exacte)
    const wr = wrap.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cr = getClampRect(wrap, vw, vh);
    // Largeur de bulle adaptée à la place réelle dans la zone clampée : au lieu
    // de rogner la bulle au bord de la modale, on la rétrécit (le texte passe
    // en wraps) pour qu'elle reste entièrement visible et centrée sur le trigger.
    const natW = tip.offsetWidth || 256;
    const availW = Math.max(96, cr.right - cr.left - 2 * EDGE_MARGIN);
    if (natW > availW) tip.style.width = `${availW}px`;
    const tw = Math.min(natW, availW);
    const th = tip.offsetHeight || 120;
    const spaceT = wr.top - cr.top;
    const spaceB = cr.bottom - wr.bottom;
    const spaceL = wr.left - cr.left;
    const spaceR = cr.right - wr.right;

    // Le côté demandé convient-il ? Sinon bascule : opposé → meilleur côté perpendiculaire.
    const fits = (side: TipStyle['side']) =>
      side === 'top' ? spaceT >= th + TIP_MARGIN
        : side === 'bottom' ? spaceB >= th + TIP_MARGIN
          : side === 'left' ? spaceL >= tw + TIP_MARGIN
            : spaceR >= tw + TIP_MARGIN;

    const opp: TipStyle['side'] =
      placement === 'top' ? 'bottom' : placement === 'bottom' ? 'top' : placement === 'left' ? 'right' : 'left';
    const perpBest: TipStyle['side'] =
      placement === 'top' || placement === 'bottom'
        ? (spaceL >= spaceR ? 'left' : 'right')
        : (spaceT >= spaceB ? 'top' : 'bottom');
    const perpOther: TipStyle['side'] = perpBest === 'left' ? 'right' : perpBest === 'right' ? 'left' : perpBest === 'top' ? 'bottom' : 'top';

    let side: TipStyle['side'] = placement;
    if (!fits(side)) {
      if (fits(opp)) side = opp;
      else if (fits(perpBest)) side = perpBest;
      else if (fits(perpOther)) side = perpOther;
      // sinon on garde placement et on laisse le clamp ramener la bulle dans la modale.
    }

    // Coordonnées ÉCRAN préférées (centrées sur le trigger).
    let sx: number, sy: number, arrow = 0;
    if (side === 'top') {
      sx = wr.left + wr.width / 2 - tw / 2;
      sy = wr.top - th - TIP_MARGIN;
      arrow = wr.left + wr.width / 2 - sx;
    } else if (side === 'bottom') {
      sx = wr.left + wr.width / 2 - tw / 2;
      sy = wr.bottom + TIP_MARGIN;
      arrow = wr.left + wr.width / 2 - sx;
    } else if (side === 'left') {
      sx = wr.left - tw - TIP_MARGIN;
      sy = wr.top + wr.height / 2 - th / 2;
      arrow = wr.top + wr.height / 2 - sy;
    } else {
      sx = wr.right + TIP_MARGIN;
      sy = wr.top + wr.height / 2 - th / 2;
      arrow = wr.top + wr.height / 2 - sy;
    }

    // Clamp : la bulle reste 100% visible DANS la modale (et donc dans la fenêtre).
    sx = Math.min(Math.max(sx, cr.left + EDGE_MARGIN), Math.max(cr.left + EDGE_MARGIN, cr.right - EDGE_MARGIN - tw));
    sy = Math.min(Math.max(sy, cr.top + EDGE_MARGIN), Math.max(cr.top + EDGE_MARGIN, cr.bottom - EDGE_MARGIN - th));
    // Flèche clampée dans la bulle après clampage.
    if (side === 'top' || side === 'bottom') arrow = Math.min(Math.max(arrow, 12), tw - 12);
    else arrow = Math.min(Math.max(arrow, 12), th - 12);

    // Conversion en coordonnées relatif au wrapper (le transform/scène suit).
    setStyle({ left: sx - wr.left, top: sy - wr.top, side, arrow });
  }, [open, placement]);

  return (
    <span
      ref={wrapRef}
      className={`relative inline-flex ${className ?? ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => { setOpen(false); setStyle(null); }}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && content && (
        <span
          ref={tipRef}
          role="tooltip"
          className="pointer-events-none absolute z-50 w-64"
          style={style ? { left: style.left, top: style.top } : { left: -9999, top: 0, visibility: 'hidden' }}
        >
          <span
            className={`block rounded-lg border ${TONE_BORDER[content.tone ?? 'info']} bg-gray-900/95 px-3 py-2 text-left shadow-xl backdrop-blur`}
          >
            <span className="mb-1 flex items-center gap-1.5 text-[11px] font-bold leading-tight text-gray-100">
              {content.icon && <span className={`shrink-0 ${TONE_ICON[content.tone ?? 'info']}`}>{content.icon}</span>}
              <span>{content.title}</span>
            </span>
            <span className="whitespace-pre-wrap text-[10px] leading-snug text-gray-300">{content.text}</span>
            {content.example && (
              <span className="mt-1 block rounded bg-violet-500/10 px-1.5 py-0.5 text-[9px] italic leading-snug text-violet-200">
                Ex. : {content.example}
              </span>
            )}
          </span>
          <span
            className={`absolute h-0 w-0 border-4 border-transparent ${
              style?.side === 'top' ? 'top-full border-t-violet-500/50' :
              style?.side === 'bottom' ? 'bottom-full border-b-violet-500/50' :
              style?.side === 'left' ? '-left-2 border-r-violet-500/50' :
              '-right-2 border-l-violet-500/50'
            }`}
            style={
              style && (style.side === 'top' || style.side === 'bottom')
                ? { left: style.arrow }
                : style
                  ? { top: style.arrow }
                  : undefined
            }
          />
        </span>
      )}
    </span>
  );
}

export default RichTooltip;