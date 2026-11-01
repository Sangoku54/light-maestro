<?php
/**
 * POST /stripe/webhook.php
 * Reçoit les événements Stripe et active la licence après paiement réussi.
 * Sans dépendance externe — vérifie la signature Stripe manuellement.
 *
 * Événement traité : checkout.session.completed
 *   → lit metadata.edition + metadata.user_id
 *   → met à jour users.edition
 *
 * ⚠️ Enregistrer cet endpoint dans Stripe (Dashboard → Webhooks) et y associer
 *    STRIPE_WEBHOOK_SECRET. Ne jamais désactiver la vérification de signature.
 */

require_once __DIR__ . '/../helpers.php';

$payload = @file_get_contents('php://input');
$sigHeader = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';

// Vérification manuelle de la signature Stripe (sans SDK)
function verifyStripeSignature(string $payload, string $sigHeader, string $secret): bool {
    if (!$sigHeader) return false;
    $parts = explode(',', $sigHeader);
    $timestamp = '';
    $signature = '';
    foreach ($parts as $part) {
        $kv = explode('=', $part, 2);
        if ($kv[0] === 't') $timestamp = $kv[1];
        if ($kv[0] === 'v1') $signature = $kv[1];
    }
    if (!$timestamp || !$signature) return false;
    $signedPayload = $timestamp . '.' . $payload;
    $expectedSig = hash_hmac('sha256', $signedPayload, $secret);
    return hash_equals($expectedSig, $signature);
}

if (!verifyStripeSignature($payload, $sigHeader, STRIPE_WEBHOOK_SECRET)) {
    respond(['error' => 'invalid_signature'], 400);
}

$data = json_decode($payload, true);
if (!$data || !isset($data['type'])) {
    respond(['received' => false], 400);
}

if ($data['type'] === 'checkout.session.completed') {
    $session = $data['data']['object'] ?? null;
    if (!$session) {
        respond(['received' => true]);
        exit;
    }
    $metadata = $session['metadata'] ?? [];
    $userId = (int)($metadata['user_id'] ?? 0);
    $edition = $metadata['edition'] ?? '';

    if ($userId > 0 && ($edition === 'standard' || $edition === 'full')) {
        // Anti-downgrade
        $rank = ['free' => 0, 'standard' => 1, 'full' => 2];
        $stmt = db()->prepare('SELECT edition FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        $row = $stmt->fetch();
        $current = is_array($row) ? (string)($row['edition'] ?? 'free') : 'free';
        if (($rank[$edition] ?? 0) > ($rank[$current] ?? 0)) {
            db()->prepare('UPDATE users SET edition = ? WHERE id = ?')->execute([$edition, $userId]);
        }

        // Trace le paiement
        try {
            $pi = $session['payment_intent'] ?? null;
            if ($pi) {
                $amount = (int)($session['amount_total'] ?? 0);
                db()->prepare(
                    'INSERT IGNORE INTO payments (user_id, stripe_payment_intent, edition, amount_cents) VALUES (?, ?, ?, ?)'
                )->execute([$userId, $pi, $edition, $amount]);
            }
        } catch (Throwable $ignore) {}
    }
}

respond(['received' => true]);