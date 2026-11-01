<?php
/**
 * Helpers partagés : envoi JSON, lecture du corps, CORS, tokens signés.
 * Aucune dépendance externe — fonctionne sur LWS sans Composer.
 *
 * ⚠️ Config (DB_HOST, DB_USER, DB_PASS, JWT_SECRET, Stripe) dans config.php.
 */

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

/**
 * Génère un token signé style JWT (HS256) sans librairie externe.
 * Format: base64(header).base64(payload).hmac_sha256(base64_header.base64_payload, secret)
 */
function b64url_encode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function b64url_decode(string $data): string {
    $pad = strlen($data) % 4;
    if ($pad) $data .= str_repeat('=', 4 - $pad);
    return base64_decode(strtr($data, '-_', '+/'));
}

function sign_token(int $userId): string {
    $secret = defined('JWT_SECRET') && JWT_SECRET ? JWT_SECRET : 'light-maestro-change-me';
    $ttl = defined('JWT_TTL') ? JWT_TTL : (60 * 60 * 24 * 30);
    $now = time();

    $header = b64url_encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT'], JSON_UNESCAPED_UNICODE));
    $payload = b64url_encode(json_encode([
        'sub' => $userId,
        'iat' => $now,
        'exp' => $now + $ttl,
    ], JSON_UNESCAPED_UNICODE));
    $sig = b64url_encode(hash_hmac('sha256', $header . '.' . $payload, $secret, true));

    return $header . '.' . $payload . '.' . $sig;
}

/**
 * Vérifie un token et retourne l'id utilisateur, ou null si invalide/expiré.
 * Supporte à la fois les anciens tokens (base64 avec padding ==) et les nouveaux (base64url).
 */
function verify_token(?string $token): ?int {
    if (!$token) return null;

    // Normalize: strip any padding and convert to base64url for consistent processing
    $clean = str_replace(['+', '/', '='], ['-', '_', ''], $token);
    $parts = explode('.', $clean);
    if (count($parts) !== 3) return null;

    $secret = defined('JWT_SECRET') && JWT_SECRET ? JWT_SECRET : 'light-maestro-change-me';
    $computed = b64url_encode(hash_hmac('sha256', $parts[0] . '.' . $parts[1], $secret, true));
    if (!hash_equals($computed, $parts[2])) return null;

    $payload = json_decode(b64url_decode($parts[1]), true);
    if (!$payload || !isset($payload['sub']) || !isset($payload['exp'])) return null;
    if ($payload['exp'] < time()) return null;

    $sub = $payload['sub'];
    return is_numeric($sub) ? (int)$sub : null;
}

/**
 * Lis le header Authorization Bearer et retourne l'user id, ou null.
 */
function auth_user_id(): ?int {
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer\s+(.+)$/i', $auth, $m)) return null;
    return verify_token($m[1]);
}

/**
 * Édition → limites.
 */
function edition_limits(string $edition): array {
    switch ($edition) {
        case 'full':     return ['maxFixtures' => PHP_INT_MAX, 'maxUniverses' => PHP_INT_MAX];
        case 'standard': return ['maxFixtures' => PHP_INT_MAX, 'maxUniverses' => 1];
        default:         return ['maxFixtures' => 1, 'maxUniverses' => 1];
    }
}

/**
 * Email HTML de confirmation d'inscription.
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
        . '<p style="color:#9ca3af;line-height:1.7;">Connectez-vous dans l\'application via <b style="color:#fff;">Compte & Licence</b> avec votre email :</p>'
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
 * Envoie un email de réinitialisation de mot de passe.
 */
function send_reset_email(string $email, string $displayName, string $resetUrl): void {
    $nameSafe = htmlspecialchars($displayName, ENT_QUOTES, 'UTF-8');
    $urlSafe = htmlspecialchars($resetUrl, ENT_QUOTES, 'UTF-8');
    $subject = 'Réinitialisation de ton mot de passe — Light Maestro';
    $body = '<!doctype html><html lang="fr"><body style="margin:0;background:#0a0a0f;color:#ede8dc;font-family:Arial,sans-serif;">'
        . '<div style="max-width:560px;margin:0 auto;padding:32px 24px;">'
        . '<div style="font-weight:900;letter-spacing:.18em;font-size:13px;"><span style="display:inline-block;background:#8b5cf6;color:#fff;border-radius:8px;padding:4px 8px;margin-right:8px;">LM</span>LIGHT MAESTRO</div>'
        . '<h1 style="margin:24px 0 8px;font-size:22px;">Réinitialiser le mot de passe</h1>'
        . '<p style="color:#9ca3af;line-height:1.7;">Salut ' . $nameSafe . ',</p>'
        . '<p style="color:#9ca3af;line-height:1.7;">Tu as demandé la réinitialisation de ton mot de passe. Clique sur le bouton ci-dessous pour en créer un nouveau.</p>'
        . '<div style="margin:24px 0;"><a href="' . $urlSafe . '" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Réinitialiser mon mot de passe</a></div>'
        . '<p style="color:#6b7280;font-size:12px;line-height:1.6;">Ce lien expire dans 1 heure. Si tu n\'as pas fait cette demande, ignore cet email.</p>'
        . '<p style="margin-top:24px;font-size:12px;color:#6b7280;">Light Maestro — <a href="https://light-maestro.com" style="color:#8b5cf6;">light-maestro.com</a></p>'
        . '</div></body></html>';
    $headers = "MIME-Version: 1.0\r\n"
        . "Content-Type: text/html; charset=UTF-8\r\n"
        . "From: Light Maestro <contact@light-maestro.com>\r\n"
        . "Reply-To: contact@light-maestro.com\r\n";
    try {
        @mail($email, $subject, $body, $headers);
    } catch (Throwable $e) {
        error_log('[forgot-password] envoi email impossible : ' . $e->getMessage());
    }
}

/**
 * Alerte admin par email.
 */
function notify_admin(string $event, string $detail): void {
    $adminEmail = defined('ADMIN_EMAIL') ? ADMIN_EMAIL : '';
    if (!$adminEmail) return;
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
        @mail($adminEmail, $subject, $body, $headers);
    } catch (Throwable $e) {
        error_log('[license] alerte admin impossible : ' . $e->getMessage());
    }
}