<?php
/**
 * Helpers partagés : envoi JSON, lecture du corps, CORS, tokens signés.
 * Aucune dépendance externe — fonctionne sur LWS sans Composer.
 *
 * ⚠️ Config (DB_HOST, DB_USER, DB_PASS, JWT_SECRET, Stripe) dans config.php.
 */

// `config.php` n'est PAS versionné dans git (il contient les identifiants
// du serveur — le modèle de référence est `config.php.example`). Si le
// fichier est absent, on répond en JSON propre au lieu d'une erreur PHP
// fatale (page blanche) qui ne dit rien de la cause.
if (!file_exists(__DIR__ . '/config.php')) {
    header('Access-Control-Allow-Origin: *');
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(500);
    echo json_encode([
        'error' => 'server',
        'message' => 'Configuration serveur absente (config.php manquant)',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

require_once __DIR__ . '/config.php';

/**
 * Origines autorisées à appeler l'API depuis un navigateur.
 *
 * L'app Electron (process main) n'est pas soumise au CORS et n'envoie pas
 * d'en-tête Origin. Aucune page du site n'appelle l'API en cross-origin
 * (le formulaire de contact est en same-origin). La liste ci-dessous
 * remplace donc le `Access-Control-Allow-Origin: *` sans impacter l'app.
 */
function cors_allowed_origin(?string $origin): ?string {
    if (!$origin) return null;
    $allowed = [
        'https://light-maestro.com',
        'https://www.light-maestro.com',
    ];
    if (in_array($origin, $allowed, true)) return $origin;
    // Valeur explicite dans config.php (si elle n'est pas '*').
    if (defined('CORS_ORIGIN') && CORS_ORIGIN !== '*' && CORS_ORIGIN === $origin) return $origin;
    return null;
}

$requestOrigin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
$allowedOrigin = cors_allowed_origin($requestOrigin !== '' ? $requestOrigin : null);
if ($allowedOrigin) {
    header('Access-Control-Allow-Origin: ' . $allowedOrigin);
    header('Vary: Origin');
} elseif ($requestOrigin !== '') {
    error_log('[api] origine refusée : ' . $requestOrigin);
}
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

/**
 * Secret JWT effectif.
 *
 * Fail-closed : si le secret n'est pas configuré (vide) ou s'il s'agit du
 * placeholder public présent dans le dépôt, on ne signe ni ne vérifie
 * AUCUN jeton. Sans cela, n'importe qui pouvait forger un jeton pour un
 * `sub` arbitraire et se faire passer pour un compte (licence payante
 * comprise) via me.php.
 *
 * Aucun seuil de longueur n'est imposé ici : la valeur du serveur est
 * inconnue et un seuil strict risquerait de couper l'accès à l'API.
 */
function jwt_secret(): string {
    static $alreadyWarned = false;
    $secret = defined('JWT_SECRET') ? trim((string)JWT_SECRET) : '';
    if ($secret === '' || $secret === 'light-maestro-change-me') {
        if (!$alreadyWarned) {
            error_log('[license] JWT_SECRET absent ou placeholder — signature/vérification de jetons suspendue');
            $alreadyWarned = true;
        }
        return '';
    }
    return $secret;
}

function sign_token(int $userId): string {
    $secret = jwt_secret();
    if ($secret === '') {
        // Message volontairement neutre côté client (le détail est dans le log).
        throw new RuntimeException('Configuration serveur invalide (clé de signature absente)');
    }
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

    $secret = jwt_secret();
    if ($secret === '') return null; // fail-closed : aucun jeton n'est accepté

    // Normalize: strip any padding and convert to base64url for consistent processing
    $clean = str_replace(['+', '/', '='], ['-', '_', ''], $token);
    $parts = explode('.', $clean);
    if (count($parts) !== 3) return null;

    $computed = b64url_encode(hash_hmac('sha256', $parts[0] . '.' . $parts[1], $secret, true));
    if (!hash_equals($computed, $parts[2])) return null;

    $payload = json_decode(b64url_decode($parts[1]), true);
    if (!$payload || !isset($payload['sub']) || !isset($payload['exp'])) return null;
    if ($payload['exp'] < time()) return null;

    $sub = $payload['sub'];
    return is_numeric($sub) ? (int)$sub : null;
}

/**
 * Signe un jeton de réinitialisation de mot de passe (HS256, sans librairie).
 *
 * Les endpoints `forgot-password.php` / `reset-password.php` utilisaient
 * `firebase/php-jwt` : la dépendance est absente du serveur (pas de dossier
 * `vendor/`), donc les deux endpoints renvoyaient une erreur PHP fatale
 * (« Class "Key" not found »). On réutilise les helpers JWT déjà présents
 * ici (b64url_encode + hash_hmac), aucune installation n'est nécessaire.
 *
 * TTL : 1 heure par défaut.
 */
function sign_reset_token(int $userId, int $ttl = 3600): string {
    $secret = jwt_secret();
    if ($secret === '') {
        throw new RuntimeException('Configuration serveur invalide (clé de signature absente)');
    }
    $now = time();

    $header = b64url_encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT'], JSON_UNESCAPED_UNICODE));
    $payload = b64url_encode(json_encode([
        'sub' => $userId,
        'type' => 'password_reset',
        'iat' => $now,
        'exp' => $now + $ttl,
    ], JSON_UNESCAPED_UNICODE));
    $sig = b64url_encode(hash_hmac('sha256', $header . '.' . $payload, $secret, true));

    return $header . '.' . $payload . '.' . $sig;
}

/**
 * Vérifie un jeton de réinitialisation et retourne l'id utilisateur, ou null.
 *
 * Fail-closed : sans secret configuré, aucun jeton n'est accepté.
 * Le contrôle décisif reste la comparaison avec le hash stocké en base
 * (voir forgot-password.php / reset-password.php) : un jeton valide mais
 * révoqué est refusé.
 */
function verify_reset_token(?string $token): ?int {
    if (!$token) return null;

    $secret = jwt_secret();
    if ($secret === '') return null;

    $clean = str_replace(['+', '/', '='], ['-', '_', ''], $token);
    $parts = explode('.', $clean);
    if (count($parts) !== 3) return null;

    $computed = b64url_encode(hash_hmac('sha256', $parts[0] . '.' . $parts[1], $secret, true));
    if (!hash_equals($computed, $parts[2])) return null;

    $payload = json_decode(b64url_decode($parts[1]), true);
    if (!is_array($payload)) return null;
    if (($payload['type'] ?? '') !== 'password_reset') return null;
    if (!isset($payload['sub'], $payload['exp'])) return null;
    if ((int)$payload['exp'] < time()) return null;

    $sub = $payload['sub'];
    return is_numeric($sub) ? (int)$sub : null;
}

/**
 * URL publique du site (lien de réinitialisation envoyé par email).
 * Surchargeable via SITE_URL dans config.php.
 */
function site_base_url(): string {
    if (defined('SITE_URL') && SITE_URL) return rtrim((string)SITE_URL, '/');
    return 'https://light-maestro.com';
}

/**
 * Lien de réinitialisation envoyé par email.
 *
 * Le lien pointe vers le formulaire web de réinitialisation (endpoint GET de
 * reset-password.php) : l'ancien lien `https://light-maestro.com/reset-password.php`
 * renvoyait un 404 (le fichier n'existe qu'un peu plus haut dans l'arborescence).
 */
function password_reset_url(string $token): string {
    return site_base_url() . '/api/auth/reset-password.php?token=' . urlencode($token);
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
 *
 * SOURCE DE VÉRITÉ SERVEUR. Le client Electron (electron/license/types.ts)
 * en est le miroir : toute divergence se voit dans les tests
 * (src/__tests__/license-server.test.ts).
 */
function edition_limits(string $edition): array {
    switch ($edition) {
        case 'full':     return ['maxFixtures' => PHP_INT_MAX, 'maxUniverses' => PHP_INT_MAX];
        case 'standard': return ['maxFixtures' => PHP_INT_MAX, 'maxUniverses' => 1];
        default:         return ['maxFixtures' => 1, 'maxUniverses' => 1];
    }
}

// ── Limitation des tentatives d'authentification ─────────────────
//
// Compteur par IP, sur les ÉCHECS uniquement (une connexion réussie ne
// consomme rien). Stockage en fichier dans le dossier temporaire : aucune
// dépendance, aucun accès base nécessaire.

/** Adresse IP de l'appelant. */
function client_ip(): string {
    return (string)($_SERVER['REMOTE_ADDR'] ?? 'inconnu');
}

/** Chemin du fichier de compteur pour un couple (bucket, IP). */
function rl_file(string $bucket, string $ip): string {
    $dir = sys_get_temp_dir() . '/lm-ratelimit';
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    return $dir . '/' . md5($bucket . '|' . $ip) . '.json';
}

/** Nombre d'échecs encore dans la fenêtre glissante. */
function rl_failures(string $bucket, int $windowSec, string $ip): int {
    $file = rl_file($bucket, $ip);
    if (!is_file($file)) return 0;
    $data = json_decode((string)@file_get_contents($file), true);
    if (!is_array($data)) return 0;
    $now = time();
    $count = 0;
    foreach ((array)($data['stamps'] ?? []) as $stamp) {
        if (is_numeric($stamp) && (int)$stamp > $now - $windowSec) $count++;
    }
    return $count;
}

/** Enregistre un échec. */
function rl_record_failure(string $bucket, string $ip): void {
    $file = rl_file($bucket, $ip);
    $data = is_file($file) ? json_decode((string)@file_get_contents($file), true) : [];
    $stamps = is_array($data) ? (array)($data['stamps'] ?? []) : [];
    $stamps[] = time();
    if (count($stamps) > 50) $stamps = array_slice($stamps, -50);
    @file_put_contents($file, json_encode(['stamps' => array_values($stamps)]));
}

/** Remet le compteur à zéro (succès). */
function rl_clear(string $bucket, string $ip): void {
    @unlink(rl_file($bucket, $ip));
}

/**
 * Refuse la requête si trop d'échecs ont été accumulés pour cette IP.
 * Renvoie 429 + Retry-After si le seuil est atteint.
 */
function rl_check(string $bucket, int $maxFailures, int $windowSec): void {
    $ip = client_ip();
    if (rl_failures($bucket, $windowSec, $ip) >= $maxFailures) {
        header('Retry-After: ' . $windowSec);
        respond([
            'error' => 'rate_limited',
            'message' => 'Trop de tentatives. Réessayez dans quelques minutes.',
        ], 429);
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
        // mail() renvoie false en cas d'échec (il n lève pas d'exception) :
        // sans ce test, un envoi impossible ne laissait aucune trace.
        if (!@mail($email, $subject, $body, $headers)) {
            error_log('[license] envoi email confirmation impossible vers ' . $email);
        }
    } catch (Throwable $e) {
        error_log('[license] envoi email confirmation impossible : ' . $e->getMessage());
    }
}

/**
 * Envoie un email de réinitialisation de mot de passe.
 *
 * Le corps contient le lien web ET le code du jeton : ce code permet de
 * réinitialiser le mot de passe depuis l'application (Compte & Licence →
 * Réinitialiser le mot de passe), sans avoir à ouvrir le navigateur.
 */
function send_reset_email(string $email, string $displayName, string $resetUrl, string $token = ''): void {
    $nameSafe = htmlspecialchars($displayName, ENT_QUOTES, 'UTF-8');
    $urlSafe = htmlspecialchars($resetUrl, ENT_QUOTES, 'UTF-8');
    $subject = 'Réinitialisation de ton mot de passe — Light Maestro';
    $codeBlock = '';
    if ($token !== '') {
        $tokenSafe = htmlspecialchars($token, ENT_QUOTES, 'UTF-8');
        $codeBlock = '<p style="color:#9ca3af;line-height:1.7;">Tu peux aussi le faire directement dans l\'application Light Maestro : <b style="color:#fff;">Compte & Licence → Mot de passe oublié → Réinitialiser</b>, puis colle ce code :</p>'
            . '<div style="background:#12121a;border:1px solid #2a2a3e;border-radius:12px;padding:14px 16px;margin:16px 0;word-break:break-all;font-family:Consolas,monospace;font-size:13px;color:#c084fc;">'
            . $tokenSafe . '</div>';
    }
    $body = '<!doctype html><html lang="fr"><body style="margin:0;background:#0a0a0f;color:#ede8dc;font-family:Arial,sans-serif;">'
        . '<div style="max-width:560px;margin:0 auto;padding:32px 24px;">'
        . '<div style="font-weight:900;letter-spacing:.18em;font-size:13px;"><span style="display:inline-block;background:#8b5cf6;color:#fff;border-radius:8px;padding:4px 8px;margin-right:8px;">LM</span>LIGHT MAESTRO</div>'
        . '<h1 style="margin:24px 0 8px;font-size:22px;">Réinitialiser le mot de passe</h1>'
        . '<p style="color:#9ca3af;line-height:1.7;">Salut ' . $nameSafe . ',</p>'
        . '<p style="color:#9ca3af;line-height:1.7;">Tu as demandé la réinitialisation de ton mot de passe. Clique sur le bouton ci-dessous pour en créer un nouveau.</p>'
        . '<div style="margin:24px 0;"><a href="' . $urlSafe . '" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Réinitialiser mon mot de passe</a></div>'
        . $codeBlock
        . '<p style="color:#6b7280;font-size:12px;line-height:1.6;">Ce lien expire dans 1 heure. Si tu n\'as pas fait cette demande, ignore cet email.</p>'
        . '<p style="margin-top:24px;font-size:12px;color:#6b7280;">Light Maestro — <a href="https://light-maestro.com" style="color:#8b5cf6;">light-maestro.com</a></p>'
        . '</div></body></html>';
    $headers = "MIME-Version: 1.0\r\n"
        . "Content-Type: text/html; charset=UTF-8\r\n"
        . "From: Light Maestro <contact@light-maestro.com>\r\n"
        . "Reply-To: contact@light-maestro.com\r\n";
    try {
        if (!@mail($email, $subject, $body, $headers)) {
            error_log('[forgot-password] envoi email impossible vers ' . $email);
        }
    } catch (Throwable $e) {
        error_log('[forgot-password] envoi email impossible : ' . $e->getMessage());
    }
}

/**
 * Alerte admin par email + écriture d'un log fichier (fallback si mail() échoue).
 */
function notify_admin(string $event, string $detail): void {
    $adminEmail = defined('ADMIN_EMAIL') ? ADMIN_EMAIL : '';

    // ── 1. Tentative d'envoi email ────────────────────────────────────────
    $sentMail = false;
    if ($adminEmail) {
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
            . "From: Light Maestro <contact@light-maestro.com>\r\n"
            . "Reply-To: contact@light-maestro.com\r\n";
        try {
            if (@mail($adminEmail, $subject, $body, $headers)) {
                $sentMail = true;
            } else {
                error_log('[notify_admin] mail() a retourné false pour ' . $adminEmail);
            }
        } catch (Throwable $e) {
            error_log('[notify_admin] exception mail : ' . $e->getMessage());
        }
    }

    // ── 2. Log fichier permanent (toujours présent, même si mail échoue) ──
    $logDir = dirname(__DIR__) . '/logs';
    if (!is_dir($logDir)) @mkdir($logDir, 0755, true);
    $logFile = $logDir . '/events.log';
    $logLine = sprintf(
        "[%s] %s | %s | IP:%s | User-Agent:%s\n",
        date('Y-m-d H:i:s'),
        $event,
        $detail,
        $_SERVER['REMOTE_ADDR'] ?? '?',
        substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 120)
    );
    @file_put_contents($logFile, $logLine, FILE_APPEND | LOCK_EX);

    // ── 3. Rapport si le mail n'est pas parti ─────────────────────────────
    if (!$sentMail && $adminEmail) {
        error_log('[notify_admin] ⚠ Email NON envoyé vers ' . $adminEmail
            . ' — vérifie la configuration mail() de PHP ou consulte site/api/logs/events.log');
    }
}