<?php
/**
 * POST /track.php
 * Log un téléchargement + alerte admin.
 * Version robuste : tolère les erreurs DB et SMTP.
 *
 * body : { file: 'portable' | 'setup', version?: string }
 * 200  : { ok: true }
 * 400  : { error: 'invalid_input' }
 */

require_once __DIR__ . '/helpers.php';

$b = body();
$file = trim((string)($b['file'] ?? ''));
$version = trim((string)($b['version'] ?? ''));
if (!in_array($file, ['portable', 'setup'], true)) {
    respond(['error' => 'invalid_input', 'message' => 'Fichier invalide'], 400);
}

// ── Auth (optionnel) ──────────────────────────────────────────────────────────
$email = 'anonyme';
try {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
        $token = $m[1];
        if ($token) {
            $userId = verify_token($token);
            if ($userId) {
                try {
                    $u = db()->query("SELECT email FROM users WHERE id = " . (int)$userId)->fetch();
                    if ($u) $email = $u['email'];
                } catch (Throwable $ignored) {/* DB indisponible */}
            }
        }
    }
} catch (Throwable $ignored) {/* auth ignorée */}

// ── Insertion en base (non bloquante) ────────────────────────────────────────
try {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    db()->exec(
        "INSERT INTO downloads (user_id, file, ip, downloaded_at) VALUES ("
        . (intval($userId ?? 0)) . ", '" . addslashes($file) . "', '" . addslashes($ip) . "', NOW())"
    );
} catch (Throwable $ignored) {/* table absente ou DB indisponible */}

// ── Notification admin + log fichier ──────────────────────────────────────────
try {
    $label = $file === 'portable' ? 'Version portable' : 'Installeur Windows';
    $ip = $_SERVER['REMOTE_ADDR'] ?? '?';
    $ver = $version ?: '?';
    notify_admin('Nouveau téléchargement', "$email • $label • v$ver • IP:$ip");
} catch (Throwable $ignored) {/* notification ignorée */}

respond(['ok' => true]);
