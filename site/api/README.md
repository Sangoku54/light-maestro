# Backend de licence Light Maestro — installation LWS

Backend PHP/MySQL qui relie l'app Light Maestro à Stripe (paiement unique, licence perpétuelle).

## Arborescence

```
site/api/
  composer.json
  schema.sql
  config.php
  helpers.php
  auth/register.php
  auth/login.php
  auth/me.php
  stripe/checkout.php
  stripe/webhook.php
```

## Étapes d'installation chez LWS

### 1. Créer la base MySQL
- Dans le panneau LWS (ou cPanel), crée une base + un utilisateur MySQL.
- Dans phpMyAdmin, importe `schema.sql` (crée `users` + `payments`).

### 2. Déployer les fichiers
- Uploade le dossier `api/` sur le serveur, par exemple sous `https://ton-domaine.fr/api/`.
- Le fichier `config.php` et `helpers.php` doivent rester **hors de portée web** si possible, mais ici ils sont dans le même dossier : ils ne renvoient rien si appelés directement (pas de sortie), c'est sans risque.

### 3. Installer les dépendances (Composer)
LWS mutualisé inclut souvent PHP avec Composer. Si l'accès SSH/Composer n'est pas dispo :
- Lancer `composer install` en local dans `site/api/` (génère le dossier `vendor/`).
- Uploade le dossier `vendor/` complet sur le serveur.

Cela installe `stripe/stripe-php` et `firebase/php-jwt`.

### 4. Renseigner `config.php`
```php
DB_HOST / DB_NAME / DB_USER / DB_PASS     ← identifiants MySQL LWS
STRIPE_SECRET_KEY                          ← sk_live_... (dashboard Stripe)
STRIPE_WEBHOOK_SECRET                      ← whsec_... (dashboard Stripe → Webhooks)
STRIPE_PRICE_STANDARD                      ← id du price 69 €
STRIPE_PRICE_FULL                          ← id du price 99 €
JWT_SECRET                                 ← chaîne aléatoire longue
```

### 5. Créer les produits/prix dans Stripe
Deux produits en mode **paiement unique (one-time)** :
- « Standard » → prix 6900 (69 €) → note l'id → `STRIPE_PRICE_STANDARD`
- « Full » → prix 9900 (99 €) → note l'id → `STRIPE_PRICE_FULL`

### 6. Configurer le webhook Stripe
- Dashboard Stripe → **Webhooks** → ajouter un endpoint : `https://ton-domaine.fr/api/stripe/webhook.php`
- Événements : cocher `checkout.session.completed`
- Récupérer le secret de signature → `STRIPE_WEBHOOK_SECRET`

## Flux complet

1. **Inscription** : l'app appelle `POST /auth/register.php` → crée le compte (`free`).
2. **Connexion** : l'app appelle `POST /auth/login.php` → reçoit `edition` + `token`.
3. **Achat** : l'app appelle `POST /stripe/checkout.php` (avec token + `edition`) → reçoit une `url` de checkout, redirige l'utilisateur.
4. **Paiement** : Stripe appelle `POST /stripe/webhook.php` → met `users.edition` à jour.
5. **Réouverture** : l'app rappelle `login` (ou `me`) → reçoit la nouvelle édition.

## Côté application (à faire après déploiement)

Dans `electron/license/server.ts` :
- `LICENSE_API_URL` = `https://ton-domaine.fr/api`
- `LICENSE_OFFLINE_MODE` = `false`

Et dans `electron/license/server.ts`, ajouter l'appel `register` lors de la création de compte (voir câblage UI).