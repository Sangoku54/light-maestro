<?php
/**
 * POST /auth/me.php
 * Rafraîchit l'état de licence à partir d'un jeton existant.
 *
 * header : Authorization: Bearer <token>
 * 200 : { edition, email, displayName, stripeCustomerId }
 * 401 : { error: 'invalid_token' }
 */

require_once __DIR__ . '/../helpers.php';

$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
preg_match('/^Bearer\s+(.+)$/i', $auth, $m);
$userId = verify_token($m[1] ?? null);
if ($userId === null) {
    respond(['error' => 'invalid_token', 'message' => 'Jeton invalide ou expiré'], 401);
}

$stmt = db()->prepare('SELECT email, display_name, edition, stripe_customer_id FROM users WHERE id = ?');
$stmt->execute([$userId]);
$user = $stmt->fetch();

if (!$user) {
    respond(['error' => 'invalid_token', 'message' => 'Utilisateur introuvable'], 401);
}

respond([
    'edition' => $user['edition'],
    'email' => $user['email'],
    'displayName' => $user['display_name'] ?: null,
    'stripeCustomerId' => $user['stripe_customer_id'] ?: null,
]);