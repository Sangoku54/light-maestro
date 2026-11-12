<?php
/**
 * POST /stripe/webhook.php
 * Reçoit les événements Stripe et active la licence après paiement réussi.
 *
 * Événement traité : checkout.session.completed
 *   → lit metadata.edition + metadata.user_id
 *   → met à jour users.edition
 *   → notifie admin par email
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
        // Anti-downgrade : on ne monte que l'édition (un rachat standard
        // par erreur ne doit jamais faire perdre une édition full).
        $rank = ['free' => 0, 'standard' => 1, 'full' => 2];
        $cur = db()->prepare('SELECT edition FROM users WHERE id = ?');
        $cur->execute([$userId]);
        $row = $cur->fetch();
        $current = is_array($row) ? (string)($row['edition'] ?? 'free') : 'free';
        if (($rank[$edition] ?? 0) > ($rank[$current] ?? 0)) {
            // Active la licence (paiement unique → edition persistée).
            db()->prepare('UPDATE users SET edition = ? WHERE id = ?')->execute([$edition, $userId]);
        }

        // Trace le paiement (audit / SAV). Ignore les doublons (même intent).
        try {
            $pi = $session->payment_intent ?? null;
            if ($pi) {
                $amount = $session->amount_total ?? 0;
                db()->prepare(
                    'INSERT IGNORE INTO payments (user_id, stripe_payment_intent, edition, amount_cents) VALUES (?, ?, ?, ?)'
                )->execute([$userId, $pi, $edition, $amount]);
            }
        } catch (Throwable $e) {
            error_log('[stripe] audit paiement impossible : ' . $e->getMessage());
        }

        // Notifie l'admin par email (montant, édition, user_id).
        try {
            // Récupère l'email de l'utilisateur pour le rapport.
            $emStmt = db()->prepare('SELECT email, display_name FROM users WHERE id = ?');
            $emStmt->execute([$userId]);
            $uInfo = $emStmt->fetch();
            $emailAddr = $uInfo ? $uInfo['email'] : "user #$userId";
            $displayName = $uInfo ? ($uInfo['display_name'] ?: '') : '';
            $labelEdition = $edition === 'standard' ? 'Standard (69 €)' : 'Complète (99 €)';
            $upgradeTag = ($metadata['upgrade_from'] ?? '') === 'standard' ? ' — Upgrade Standard→Full (30 €)' : '';
            notify_admin(
                'Nouveau paiement Stripe',
                "$emailAddr" . ($displayName ? " ($displayName)" : "")
                . " — Édition $labelEdition" . $upgradeTag
                . " — Montant brut : " . number_format($amount / 100, 2, ',', ' ') . " €"
                . " — Intent : " . ($pi ?? '?')
            );
        } catch (Throwable $e) {
            error_log('[stripe] notify_admin paiement échoué : ' . $e->getMessage());
        }
    }
}

// Toujours répondre 200 à Stripe (sinon il rejoue l'événement).
respond(['received' => true]);
