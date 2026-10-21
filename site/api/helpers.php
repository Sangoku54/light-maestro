<?php
/**
 * Helpers partagés : envoi JSON, lecture du corps, CORS, JWT.
 */

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

require_once __DIR__ . '/config.php';

header('Access-Control-Allow-Origin: ' . CORS_ORIGIN);
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/** Répond en JSON et termine. */
function respond($data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Lit le corps JSON de la requête. */
function body(): array {
    $raw = file_get_contents('php://input');
    $decoded = json_decode($raw ?: '', true);
    return is_array($decoded) ? $decoded : [];
}

/** Signe un jeton d'accès pour l'app (id utilisateur). */
function sign_token(int $userId): string {
    $now = time();
    $payload = [
        'sub' => $userId,
        'iat' => $now,
        'exp' => $now + JWT_TTL,
    ];
    return JWT::encode($payload, JWT_SECRET, 'HS256');
}

/**
 * Valide un jeton Bearer et retourne l'id utilisateur, ou null si invalide.
 */
function verify_token(?string $header): ?int {
    if (!$header || !preg_match('/^Bearer\s+(.+)$/i', $header, $m)) return null;
    try {
        $decoded = JWT::decode($m[1], new Key(JWT_SECRET, 'HS256'));
        $sub = $decoded->sub ?? null;
        return is_numeric($sub) ? (int)$sub : null;
    } catch (Throwable $e) {
        return null;
    }
}

/**
 * Édition → limite d'univers (contrat aligné avec l'app : electron/license/types.ts).
 */
function edition_limits(string $edition): array {
    switch ($edition) {
        case 'full':     return ['maxFixtures' => PHP_INT_MAX, 'maxUniverses' => PHP_INT_MAX];
        case 'standard': return ['maxFixtures' => PHP_INT_MAX, 'maxUniverses' => 1];
        default:         return ['maxFixtures' => 1, 'maxUniverses' => 1];
    }
}

/**
 * Email HTML de confirmation d'inscription, aux couleurs Light Maestro.
 * Ne contient JAMAIS le mot de passe (envoyé en clair = compromis dès la
 * première fuite de boîte mail) : l'utilisateur le connaît déjà, il vient
 * de le choisir. Échec silencieux (log serveur) pour ne jamais faire
 * échouer l'inscription à cause du mail.
 */
function send_confirmation_email(string $email, ?string $displayName): void {
    $name = $displayName ?: explode('@', $email)[0];
    $nameSafe = htmlspecialchars($name, ENT_QUOTES, 'UTF-8');
    $subject = 'Bienvenue sur Light Maestro — compte créé';
    $body = '<!doctype html><html lang="fr"><body style="margin:0;background:#0a0a0f;color:#ede8dc;font-family:Arial,sans-serif;">'
        . '<div style="max-width:560px;margin:0 auto;padding:32px 24px;">'
        . '<div style="font-weight:900;letter-spacing:.18em;font-size:13px;"><span style="display:inline-block;background:#8b5cf6;color:#fff;border-radius:8px;padding:4px 8px;margin-right:8px;">LM</span>LIGHT MAESTRO</div>'
        . '<h1 style="margin:24px 0 8px;font-size:24px;">Bienvenue, ' . $nameSafe . '.</h1>'
        . '<p style="color:#9ca3af;line-height:1.7;">Votre compte est créé (édition <b style="color:#fff;">Gratuite</b> : 1 fixture, 1 univers, sans limite de temps).</p>'
        . '<p style="color:#9ca3af;line-height:1.7;">Connectez-vous dans l’application via <b style="color:#fff;">Compte &amp; Licence</b> avec votre email :</p>'
        . '<div style="background:#12121a;border:1px solid #2a2a3e;border-radius:12px;padding:14px 16px;margin:16px 0;">'
        . '<div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;">Email du compte</div>'
        . '<div style="font-size:16px;font-weight:800;margin-top:4px;">' . htmlspecialchars($email, ENT_QUOTES, 'UTF-8') . '</div></div>'
        . '<p style="color:#9ca3af;line-height:1.7;">Bon premier show — pensez à prévenir le public avant les strobes.</p>'
        . '<p style="margin-top:24px;font-size:12px;color:#6b7280;">Light Maestro — <a href="https://light-maestro.com" style="color:#8b5cf6;">light-maestro.com</a></p>'
        . '</div></body></html>';
    $headers = "MIME-Version: 1.0\r\n"
        . "Content-Type: text/html; charset=UTF-8\r\n"
        . "From: Light Maestro <contact@light-maestro.com>\r\n"
        . "Reply-To: contact@light-maestro.com\r\n";
    try {
        @mail($email, $subject, $body, $headers);
    } catch (Throwable $e) {
        error_log('[license] envoi email confirmation impossible : ' . $e->getMessage());
    }
}

/**
 * Alerte admin : notifie ADMIN_EMAIL (config.php) à chaque événement notable
 * (inscription, téléchargement). Échec silencieux — ne jamais bloquer la
 * requête utilisateur à cause du mail d'alerte.
 */
function notify_admin(string $event, string $detail): void {
    if (!defined('ADMIN_EMAIL') || !ADMIN_EMAIL) return;
    $subject = '[Light Maestro] ' . $event;
    $body = '<!doctype html><html lang="fr"><body style="margin:0;background:#0a0a0f;color:#ede8dc;font-family:Arial,sans-serif;">'
        . '<div style="max-width:560px;margin:0 auto;padding:32px 24px;">'
        . '<div style="font-weight:900;letter-spacing:.18em;font-size:13px;"><span style="display:inline-block;background:#8b5cf6;color:#fff;border-radius:8px;padding:4px 8px;margin-right:8px;">LM</span>LIGHT MAESTRO — Alerte</div>'
        . '<h2 style="margin:24px 0 8px;font-size:18px;">' . htmlspecialchars($event, ENT_QUOTES, 'UTF-8') . '</h2>'
        . '<p style="color:#9ca3af;line-height:1.7;">' . htmlspecialchars($detail, ENT_QUOTES, 'UTF-8') . '</p>'
        . '<p style="margin-top:16px;font-size:12px;color:#6b7280;">' . date('d/m/Y H:i:s') . ' — IP : ' . ($_SERVER['REMOTE_ADDR'] ?? '?') . '</p>'
        . '</div></body></html>';
    $headers = "MIME-Version: 1.0\r\n"
        . "Content-Type: text/html; charset=UTF-8\r\n"
        . "From: Light Maestro <contact@light-maestro.com>\r\n";
    try {
        @mail(ADMIN_EMAIL, $subject, $body, $headers);
    } catch (Throwable $e) {
        error_log('[license] alerte admin impossible : ' . $e->getMessage());
    }
}