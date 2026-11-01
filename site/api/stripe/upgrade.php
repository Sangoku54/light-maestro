<?php
/**
 * POST /stripe/upgrade.php
 * Paiement de la DIFFÉRENCE Standard → Full (30 € au lieu de 99 €).
 * Sans dépendance externe — utilise l'API Stripe via cURL natif.
 *
 * header : Authorization: Bearer <token>   (compte connecté)
 * 200    : { url }   (URL de redirection vers le checkout Stripe)
 * 403    : { error: 'not_standard' }
 * 400    : { error: 'price_not_configured' }
 */

require_once __DIR__ . '/../helpers.php';

$userId = verify_token($_SERVER['HTTP_AUTHORIZATION'] ?? null);
if ($userId === null) {
    respond(['error' => 'invalid_token', 'message' => 'Non connecté'], 401);
}

if (!defined('STRIPE_PRICE_UPGRADE') || !STRIPE_PRICE_UPGRADE) {
    respond(['error' => 'price_not_configured', 'message' => 'Prix upgrade non configuré'], 400);
}

// Vérifie que l'utilisateur est bien Standard
$stmt = db()->prepare('SELECT email, edition, stripe_customer_id FROM users WHERE id = ?');
$stmt->execute([$userId]);
$user = $stmt->fetch();
if (!$user) respond(['error' => 'invalid_token', 'message' => 'Utilisateur introuvable'], 401);
if ($user['edition'] !== 'standard') {
    respond(['error' => 'not_standard', 'message' => 'L\'upgrade est réservé aux détenteurs de la version Standard'], 403);
}

// --- API Stripe via cURL ---
$secretKey = STRIPE_SECRET_KEY;
$baseUrl = 'https://api.stripe.com/v1';

// 1. Créer ou récupérer le customer Stripe
$customerId = $user['stripe_customer_id'];
if (!$customerId) {
    $data = ['email' => $user['email'], 'metadata' => ['user_id' => (string)$userId]];
    $ch = curl_init("$baseUrl/customers");
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($data));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Authorization: Bearer ' . $secretKey]);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    $resp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($httpCode < 200 || $httpCode >= 300) {
        respond(['error' => 'stripe_error', 'message' => 'Erreur Stripe customer'], 500);
    }
    $customer = json_decode($resp, true);
    if (!isset($customer['id'])) {
        respond(['error' => 'stripe_error', 'message' => 'Réponse invalide Stripe (customer)'], 500);
    }
    $customerId = $customer['id'];
    db()->prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?')->execute([$customerId, $userId]);
}

// 2. Créer la session de checkout (upgrade)
$checkoutData = [
    'mode' => 'payment',
    'customer' => $customerId,
    'line_items[0][price]' => STRIPE_PRICE_UPGRADE,
    'line_items[0][quantity]' => '1',
    'metadata[user_id]' => (string)$userId,
    'metadata[edition]' => 'full',
    'metadata[upgrade_from]' => 'standard',
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