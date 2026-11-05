# Revue du site — Light Maestro (landing page)

Fichier audité : `projects/website-9d9ad26fbe37326597b9cd32/index.html`
Date : 2026-08-19

## Résultat des contrôles

| Contrôle | Statut |
|---|---|
| 1. Langue (fr) | ✅ Conforme |
| 2. Tarifs (0/69/99 € + note de montée en gamme) | ✅ Conforme |
| 3. Ancres (`href="#..."`) | ✅ Aucune ancre cassée |
| 4. Validité HTML | ✅ Conforme |
| 5. Accessibilité / qualité | ✅ Conforme (2 NIT) |

---

## CRITICAL

Aucun.

## MINOR

Aucun.

## NIT

- **Liens auto-référents / placeholder dans le footer** : « Contact » (nav + footer), « Mentions légales », « CGV / CGU » et « Confidentialité » pointent tous vers `#footer`, qui ne contient ni coordonnées de contact ni contenu légal. Les ancres résolvent (donc pas de dangling anchor), mais elles sont sémantiquement vides. Suggestion : les laisser en `href="#"` ou créer de vraies sections si du contenu existe.
- **Boutons « Acheter 69 € » / « Acheter 99 € »** : pointent vers `#pricing` (la section où ils se trouvent déjà) → clic sans effet. Acceptable en l'absence de tunnel d'achat, mais à brancher sur une vraie cible (checkout / contact) le moment venu.
- **Légende décorative** : la caption de `hero-visual` (« Vue 3D de la scène · timeline · sortie DMX en temps réel ») est masquée aux lecteurs d'écran via `aria-hidden="true"` sur le conteneur. Sans conséquence (élément purement décoratif), noté pour mémoire.

---

### Détail des contrôles

**1. Langue** — Toutes les chaînes visibles (title, meta description, h1/h2/h3, corps, boutons, nav, footer, FAQ, alt/aria) sont en français. Les termes conservés sont dans la liste autorisée : « Light Maestro », « DMX », « Art-Net », « sACN », « FTDI », « Enttec », « Windows 64 bits », « USB-DMX ». Aucun anglicisme non autorisé détecté. Le `lang="fr"` est correct.

**2. Tarifs** — Exactement 3 paliers : 0 € (1 fixture, sans limite de temps), 69 € (1 univers = 512 canaux DMX, fixtures illimitées, mises à jour incluses, support e-mail), 99 € (univers/fixtures illimités, mises à jour incluses, support e-mail). Note de montée en gamme présente et exacte : « 69 € → 99 € = 30 € ».

**3. Ancres** — Toutes les cibles référencées existent : `#hero`, `#reassurance`, `#features`, `#demo`, `#pricing`, `#safety`, `#faq`, `#footer`. Aucune ancre cassée. (Les liens `#footer` et `#pricing` auto-référents sont signalés en NIT, pas en dangling anchor.)

**4. Validité HTML** — `<!doctype html>` présent, `lang="fr"`, `meta charset="utf-8"`, `meta viewport` et `title` présents. Balises équilibrées, `</html>` de fermeture présent.

**5. Accessibilité / qualité** — Structure sémantique propre (`header/main/section/footer`, `details/summary` pour la FAQ). `role="img"` + `aria-label` sur la démo vidéo, `aria-hidden` sur le visuel décoratif du hero. Aucune faute de frappe relevée dans la copie française (accents corrects : « régisseurs », « noir général », « débloquez », etc.).

---

VERDICT: SHIP
