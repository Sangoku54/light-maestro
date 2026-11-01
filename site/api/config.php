<?php
/**
 * ⚠️⚠️⚠️ NE JAMAIS UPLOADER CE FICHIER DEPUIS GIT VERS LE SERVEUR ⚠️⚠️⚠️
 *
 * Ce fichier contient les identifiants MySQL, Stripe et JWT du SERVEUR.
 * La version git a des valeurs VIDES (sécurité).
 * Remplissez TOUS les champs ci-dessous sur le serveur.
 */

// ── Base de données ────────────────────────────────────────────────
define('DB_HOST', '127.0.0.1');
define('DB_NAME', 'light2862516');
define('DB_USER', '');       // À REMPLIR — identifiant MySQL LWS
define('DB_PASS', '');       // À REMPLIR — mot de passe MySQL LWS

// ── Clés d'API Stripe ──────────────────────────────────────────────
define('STRIPE_SECRET_KEY', '');       // sk_live_... ou sk_test_...
define('STRIPE_WEBHOOK_SECRET', '');   // whsec_...
define('STRIPE_PRICE_STANDARD', '');   // ID du prix Standard (69 €)
define('STRIPE_PRICE_FULL', '');       // ID du prix Full (99 €)
define('STRIPE_PRICE_UPGRADE', '');    // ID du prix Upgrade (30 €)

// ── JWT (token de session) ────────────────────────────────────────
define('JWT_SECRET', '');    // Chaîne aléatoire longue (≥32 caractères)
define('JWT_TTL', 60 * 60 * 24 * 30); // 30 jours

// ── CORS ────────────────────────────────────────────────────────────
define('CORS_ORIGIN', '*');

// ── Alerte admin ─────────────────────────────────────────────────────
define('ADMIN_EMAIL', 'admintrack@light-maestro.com');

/** Retourne une connexion PDO unique. */
function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }
    return $pdo;
}