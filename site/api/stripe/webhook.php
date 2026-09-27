<?php
/**
 * POST /stripe/webhook.php
 * Reçoit les événements Stripe et active la licence après paiement réussi.
 *
 * Événement traité : checkout.session.completed
 *   → lit metadata.edition + metadata.user_id
 *   → met à jour users.edition
 *
 * ⚠️ Enregistrer cet endpoint dans Stripe (Dashboard → Webhooks) et y associer
 *    STRIPE_WEBHOOK_SECRET. Ne jamais désactiver la vérification de signature.
 */

require_once __DIR__ . '/../helpers.php';

use Stripe\StripeClient;
use Stripe\Exception\SignatureVerificationException;

$payload = @file_get_contents('php://input');
$sigHeader = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';

try {
    $stripe = new StripeClient(STRIPE_SECRET_KEY);
    $event = \Stripe\Webhook::constructEvent($payload, $sigHeader, STRIPE_WEBHOOK_SECRET);
} catch (SignatureVerificationException $e) {
    respond(['error' => 'invalid_signature'], 400);
}

if ($event->type === 'checkout.session.completed') {
    $session = $event->data->object;
    $metadata = $session->metadata ?? [];
    $userId = (int)($metadata['user_id'] ?? 0);
    $edition = $metadata['edition'] ?? '';

    if ($userId > 0 && ($edition === 'standard' || $edition === 'full')) {
        // Active la licence (paiement unique → edition persistée).
        db()->prepare('UPDATE users SET edition = ? WHERE id = ?')->execute([$edition, $userId]);

        // Trace le paiement (audit / SAV). Ignore les doublons (même intent).
        try {
            $pi = $session->payment_intent ?? null;
            if ($pi) {
                $amount = $session->amount_total ?? 0;
                db()->prepare(
                    'INSERT IGNORE INTO payments (user_id, stripe_payment_intent, edition, amount_cents) VALUES (?, ?, ?, ?)'
                )->execute([$userId, $pi, $edition, $amount]);
            }
        } catch (Throwable $ignore) {
            // L'audit ne doit jamais faire échouer l'activation.
        }
    }
}

// Toujours répondre 200 à Stripe (sinon il rejoue l'événement).
respond(['received' => true]);