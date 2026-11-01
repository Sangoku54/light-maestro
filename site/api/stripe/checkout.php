<?php
/**
 * POST /stripe/checkout.php
 * Crée une session de paiement Stripe (paiement unique) pour une édition.
 * Sans dépendance externe — utilise l'API Stripe via cURL natif.
 *
 * header : Authorization: Bearer <token>   (compte connecté)
 * body   : { edition: 'standard' | 'full' }
 * 200    : { url }   (URL de redirection vers le checkout Stripe)
 */

require_once __DIR__ . '/../helpers.php';

$userId = verify_token($_SERVER['HTTP_AUTHORIZATION'] ?? null);
if ($userId === null) {
    respond(['error' => 'invalid_token', 'message' => 'Non connecté'], 401);
}

$b = body();
$edition = $b['edition'] ?? '';
$priceId = $edition === 'full' ? STRIPE_PRICE_FULL : ($edition === 'standard' ? STRIPE_PRICE_STANDARD : '');

if (!$priceId) {
    respond(['error' => 'invalid_edition', 'message' => "Édition inconnue: $edition"], 400);
}

// Vérifie l'utilisateur et l'édition actuelle
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

// --- Appels API Stripe via cURL (pas de SDK nécessaire) ---
$secretKey = STRIPE_SECRET_KEY;
$baseUrl = 'https://api.stripe.com/v1';

// 1. Créer ou récupérer le customer Stripe
$customerId = $user['stripe_customer_id'];
if (!$customerId) {
    $data = [
        'email' => $user['email'],
        'metadata' => ['user_id' => (string)$userId],
    ];
    $ch = curl_init("$baseUrl/customers");
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($data));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Authorization: Bearer ' . $secretKey]);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    $resp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($httpCode < 200 || $httpCode >= 300) {
        respond(['error' => 'stripe_error', 'message' => 'Erreur Stripe lors de la création du client'], 500);
    }
    $customer = json_decode($resp, true);
    if (!isset($customer['id'])) {
        respond(['error' => 'stripe_error', 'message' => 'Réponse invalide Stripe (customer)'], 500);
    }
    $customerId = $customer['id'];
    // Sauvegarde le customer ID
    db()->prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?')->execute([$customerId, $userId]);
}

// 2. Créer la session de checkout
$checkoutData = [
    'mode' => 'payment',
    'customer' => $customerId,
    'line_items[0][price]' => $priceId,
    'line_items[0][quantity]' => '1',
    'metadata[user_id]' => (string)$userId,
    'metadata[edition]' => $edition,
    'success_url' => 'https://light-maestro.com/merci.html',
    'cancel_url' => 'https://light-maestro.com/tarifs.html',
];

$ch = curl_init("$baseUrl/checkout/sessions");
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($checkoutData));
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Authorization: Bearer ' . $secretKey]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$resp = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode < 200 || $httpCode >= 300) {
    respond(['error' => 'stripe_error', 'message' => 'Erreur Stripe: ' . substr($resp ?: '', 0, 200)], 500);
}

$session = json_decode($resp, true);
if (!isset($session['url'])) {
    respond(['error' => 'stripe_error', 'message' => 'Pas d\'URL de checkout dans la réponse Stripe'], 500);
}

respond(['url' => $session['url']]);