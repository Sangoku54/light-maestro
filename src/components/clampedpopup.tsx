/**
 * ClampedPopup — popover/menu contextuel qui reste TOUJOURS dans la fenêtre.
 *
 * Bug corrigé : les menus ouverts près d'un bord (clic en bas/droite/gauche)
 * débordaient hors de l'écran et devenaient inutilisables. Ce wrapper calcule
 * sa position après montage (dimensions réelles via useLayoutEffect, donc sans
 * flash) et borne left/top à [margin, viewport - taille - margin].
 *
 * La classe CSS du popover est conservée telle quelle (ex. `fixed z-50 …`) :
 * seuls left/top sont pilotés par le clamp.
 */

import React, { useLayoutEffect, useRef, useState } from 'react';

/** Borne une position dans le viewport (fonction pure, testable). */
export function clampRect(
  x: number, y: number, w: number, h: number,
  vw: number, vh: number, margin = 8,
): { left: number; top: number } {
  const left = Math.max(margin, Math.min(x, Math.max(margin, vw - w - margin)));
  const top = Math.max(margin, Math.min(y, Math.max(margin, vh - h - margin)));
  return { left, top };
}

type ClampedPopupProps = {
  x: number;
  y: number;
  margin?: number;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
};

export const ClampedPopup = React.forwardRef<HTMLDivElement, ClampedPopupProps>(
  ({ x, y, margin = 8, className, style, children }, ref) => {
    const innerRef = useRef<HTMLDivElement>(null);
    const resolvedRef = (ref ?? innerRef) as React.MutableRefObject<HTMLDivElement | null>;
    const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

    useLayoutEffect(() => {
      const el = resolvedRef.current;
      if (!el) return;
      setPos(clampRect(x, y, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight, margin));
    }, [x, y, margin]);

    return (
      <div ref={resolvedRef} className={className} style={{ ...style, left: pos.left, top: pos.top }}>
        {children}
      </div>
    );
  },
);
ClampedPopup.displayName = 'ClampedPopup';