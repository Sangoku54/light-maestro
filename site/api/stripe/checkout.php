<?php
/**
 * POST /stripe/checkout.php
 * Crée une session de paiement Stripe (paiement unique) pour une édition.
 *
 * header : Authorization: Bearer <token>   (compte connecté)
 * body   : { edition: 'standard' | 'full' }
 * 200    : { url }   (URL de redirection vers le checkout Stripe)
 */

require_once __DIR__ . '/../helpers.php';

use Stripe\StripeClient;

$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
preg_match('/^Bearer\s+(.+)$/i', $auth, $m);
$userId = verify_token($m[1] ?? null);
if ($userId === null) {
    respond(['error' => 'invalid_token', 'message' => 'Non connecté'], 401);
}

$b = body();
$edition = $b['edition'] ?? '';
$priceId = $edition === 'full' ? STRIPE_PRICE_FULL : ($edition === 'standard' ? STRIPE_PRICE_STANDARD : '');

if (!$priceId) {
    respond(['error' => 'invalid_edition', 'message' => "Édition inconnue: $edition"], 400);
}

// Anti-double-paiement : un user Standard qui achète Full paierait 99 €
// alors qu'il ne devrait payer que la différence (upgrade.php).
$stmt = db()->prepare('SELECT edition, stripe_customer_id, email FROM users WHERE id = ?');
$stmt->execute([$userId]);
$user = $stmt->fetch();
if (!$user) respond(['error' => 'invalid_token', 'message' => 'Utilisateur introuvable'], 401);
if ($edition === 'standard' && $user['edition'] === 'standard') {
    respond(['error' => 'already_owned', 'message' => 'Vous avez déjà la version Standard'], 400);
}
if ($edition === 'full' && $user['edition'] === 'full') {
    respond(['error' => 'already_owned', 'message' => 'Vous avez déjà la version Complète'], 400);
}
if ($edition === 'full' && $user['edition'] === 'standard') {
    // Redirige vers l'upgrade (différentiel 30 €)
    respond(['error' => 'use_upgrade', 'message' => 'Vous avez la version Standard — utilisez l\'upgrade (30 € de différence)', 'upgrade_url' => '/api/stripe/upgrade.php'], 409);
}

$stripe = new StripeClient(STRIPE_SECRET_KEY);

// Réutilise le customer Stripe existant ou en crée un.
$customerId = $user['stripe_customer_id'];
if (!$customerId) {
    $customer = $stripe->customers->create(['email' => $user['email']]);
    $customerId = $customer->id;
    $upd = db()->prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?');
    $upd->execute([$customerId, $userId]);
}

$session = $stripe->checkout->sessions->create([
    'mode' => 'payment',
    'customer' => $customerId,
    'line_items' => [[ 'price' => $priceId, 'quantity' => 1 ]],
    'metadata' => [
        'user_id' => (string)$userId,
        'edition' => $edition,
    ],
    'success_url' => 'https://light-maestro.com/merci.html',
    'cancel_url'  => 'https://light-maestro.com/tarifs.html',
]);

respond(['url' => $session->url]);
