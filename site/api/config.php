<?php
/**
 * Light Maestro — Licence backend : configuration.
 *
 * À personnaliser pour l'hébergement LWS :
 *   - les identifiants MySQL (fournis par LWS)
 *   - les clés d'API Stripe (tableau de bord Stripe → Développeurs → Clés d'API)
 *   - le secret du webhook (Stripe → Webhooks → votre endpoint → "Secret de signature")
 *
 * ⚠️ Ne jamais committer ce fichier avec de vraies valeurs secrètes.
 *    Fournir ici des valeurs par défaut vides et les renseigner sur le serveur.
 */

// ── Base de données ────────────────────────────────────────────────
define('DB_HOST', 'localhost');
define('DB_NAME', 'lightmaestro');
define('DB_USER', '');
define('DB_PASS', '');

// ── Clés d'API Stripe ──────────────────────────────────────────────
// Clé secrète (serveur uniquement) — commence par "sk_live_..." ou "sk_test_..."
define('STRIPE_SECRET_KEY', '');
// Secret de signature du webhook — commence par "whsec_..."
define('STRIPE_WEBHOOK_SECRET', '');

// Identifiants Stripe des produits/prix (à créer dans le dashboard Stripe).
// price_standard = 69 €, price_full = 99 € (one-shot).
define('STRIPE_PRICE_STANDARD', '');
define('STRIPE_PRICE_FULL', '');

// ── JWT ─────────────────────────────────────────────────────────────
// Secret servant à signer les jetons d'accès de l'app. Chaîne aléatoire longue.
define('JWT_SECRET', '');
// Durée de validité du jeton (secondes). 30 jours par défaut.
define('JWT_TTL', 60 * 60 * 24 * 30);

// ── CORS ────────────────────────────────────────────────────────────
// Origine autorisée. L'app Electron n'envoie pas d'Origin ; laisser '*' ou
// restreindre au(x) domaine(s) du site.
define('CORS_ORIGIN', '*');

/**
 * Retourne une connexion PDO unique.
 */
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

require_once __DIR__ . '/vendor/autoload.php'; // autoloader Composer (stripe-php, firebase/php-jwt)