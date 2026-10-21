<?php
/**
 * POST /auth/login.php
 * Connexion compte — retourne l'édition de licence active.
 *
 * body : { email, password }
 * 200 : { token, edition, email, displayName }
 * 401 : { error: 'invalid_credentials' }
 */

require_once __DIR__ . '/../helpers.php';

$b = body();
$email = strtolower(trim((string)($b['email'] ?? '')));
$password = (string)($b['password'] ?? '');

$stmt = db()->prepare('SELECT id, email, password_hash, display_name, edition, stripe_customer_id FROM users WHERE email = ?');
$stmt->execute([$email]);
$user = $stmt->fetch();

if (!$user || !password_verify($password, $user['password_hash'])) {
    respond(['error' => 'invalid_credentials', 'message' => 'Identifiants invalides'], 401);
}

// Alerte admin : quelqu'un s'est connecté.
if (function_exists('notify_admin')) {
    notify_admin('Connexion', 'Utilisateur connecté : ' . $user['email'] . ' (édition ' . $user['edition'] . ')');
}

// Le client attend aussi `stripe_customer_id` (optionnel) pour relancer un checkout.
respond([
    'token' => sign_token((int)$user['id']),
    'edition' => $user['edition'],
    'email' => $user['email'],
    'displayName' => $user['display_name'] ?: null,
    'stripeCustomerId' => $user['stripe_customer_id'] ?: null,
]);
