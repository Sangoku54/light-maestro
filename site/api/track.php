<?php
/**
 * POST /track.php
 * Log un téléchargement + alerte admin.
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
$userId = null;

try {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
        $token = $m[1];
        if ($token) {
            $userId = verify_token($token);
            if ($userId) {
                try {
                    $stmt = db()->prepare('SELECT email FROM users WHERE id = ?');
                    $stmt->execute([(int)$userId]);
                    $u = $stmt->fetch();
                    if ($u) $email = $u['email'];
                } catch (Throwable $ignored) {/* DB indisponible */}
            }
        }
    }
} catch (Throwable $ignored) {/* auth ignorée */}

// ── Insertion en base (non bloquante) ────────────────────────────────────────
$ip = $_SERVER['REMOTE_ADDR'] ?? '';
try {
    $stmt = db()->prepare(
        'INSERT INTO downloads (user_id, file, ip, downloaded_at) VALUES (?, ?, ?, NOW())'
    );
    $stmt->execute([
        $userId ? (int)$userId : null,
        $file,
        $ip,
    ]);
} catch (Throwable $ignored) {/* table absente ou DB indisponible */}

// ── Notification admin + log fichier ──────────────────────────────────────────
try {
    $label = $file === 'portable' ? 'Version portable' : 'Installeur Windows';
    $ver = $version ?: '?';
    notify_admin('Nouveau téléchargement', "$email • $label • v$ver • IP:$ip");
} catch (Throwable $ignored) {/* notification ignorée */}

respond(['ok' => true]);
