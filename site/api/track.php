<?php
/**
 * POST /track.php
 * Log un téléchargement + alerte admin.
 * Le log fichier est la source de vérité principale (fallback si DB indisponible).
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
$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
preg_match('/^Bearer\s+(.+)$/i', $auth, $m);
$userId = verify_token($m[1] ?? null);
$email = 'anonyme';
if ($userId) {
    try {
        $stmt = db()->prepare('SELECT email FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        $u = $stmt->fetch();
        $email = $u ? $u['email'] : 'anonyme';
    } catch (Throwable $e) {
        error_log('[track] DB query failed: ' . $e->getMessage());
    }
}

// ── Insertion en base (non bloquante) ────────────────────────────────────────
try {
    $stmt = db()->prepare(
        'INSERT INTO downloads (user_id, file, ip, downloaded_at) VALUES (?, ?, ?, NOW())'
    );
    $stmt->execute([$userId, $file, $_SERVER['REMOTE_ADDR'] ?? '']);
} catch (Throwable $e) {
    // Table absente ou DB indisponible → logger mais continuer
    error_log('[track] INSERT failed: ' . $e->getMessage());
}

// ── Notification admin + log fichier ──────────────────────────────────────────
$label = $file === 'portable' ? 'Version portable' : 'Installeur Windows';
$detail = sprintf('%s • %s • v%s • IP:%s', $email, $label, $version ?: '?', $_SERVER['REMOTE_ADDR'] ?? '?');
notify_admin('Nouveau téléchargement', $detail);

respond(['ok' => true]);
