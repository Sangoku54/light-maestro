<?php
/**
 * POST /stripe/upgrade.php
 * Paiement de la DIFFÉRENCE Standard → Full (30 € au lieu de 99 €).
 *
 * header : Authorization: Bearer <token>   (compte connecté)
 * 200    : { url }   (URL de redirection vers le checkout Stripe)
 * 403    : { error: 'not_standard' }  (seuls les users Standard peuvent upgrader)
 * 400    : { error: 'price_not_configured' }
 *
 * Le webhook existant (checkout.session.completed) active l'édition 'full'
 * via metadata — aucun changement nécessaire côté webhook (l'anti-downgrade
 * laisse passer full > standard).
 *
 * ⚠️ Stripe dashboard : créer un produit "Upgrade" avec un prix one-shot
 *    de 30 € (la différence 99 € - 69 €) et renseigner STRIPE_PRICE_UPGRADE
 *    dans config.php.
 */

require_once __DIR__ . '/../helpers.php';

use Stripe\StripeClient;

$userId = verify_token($_SERVER['HTTP_AUTHORIZATION'] ?? null);
if ($userId === null) {
    respond(['error' => 'invalid_token', 'message' => 'Non connecté'], 401);
}

if (!defined('STRIPE_PRICE_UPGRADE') || !STRIPE_PRICE_UPGRADE) {
    respond(['error' => 'price_not_configured', 'message' => 'Prix upgrade non configuré'], 400);
}

// Seuls les users Standard peuvent upgrader (free → acheter Full direct,
// full → déjà au max).
$stmt = db()->prepare('SELECT email, edition, stripe_customer_id FROM users WHERE id = ?');
$stmt->execute([$userId]);
$user = $stmt->fetch();
if (!$user) respond(['error' => 'invalid_token', 'message' => 'Utilisateur introuvable'], 401);
if ($user['edition'] !== 'standard') {
    respond(['error' => 'not_standard', 'message' => 'L\'upgrade est réservé aux détenteurs de la version Standard'], 403);
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
    'line_items' => [[ 'price' => STRIPE_PRICE_UPGRADE, 'quantity' => 1 ]],
    'metadata' => [
        'user_id' => (string)$userId,
        'edition' => 'full',       // le webhook activera 'full'
        'upgrade_from' => 'standard',
    ],
    'success_url' => 'https://light-maestro.com/merci.html',
    'cancel_url'  => 'https://light-maestro.com/tarifs.html',
]);

respond(['url' => $session->url]);
