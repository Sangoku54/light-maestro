<?php
/**
 * POST /track.php
 * Log un téléchargement (après login) + alerte admin.
 *
 * body : { file: 'portable' | 'setup', version?: string }
 * Auth : Bearer token (optionnel — si absent, loggue en anonyme avec IP).
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

// Autoriser le tracking anonyme (pas de compte requis sur la page télécharger).
$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
preg_match('/^Bearer\s+(.+)$/i', $auth, $m);
$userId = verify_token($m[1] ?? null);

try {
    // Récupère l'email seulement si utilisateur authentifié
    $email = 'anonyme';
    if ($userId) {
        $stmt = db()->prepare('SELECT email FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        $u = $stmt->fetch();
        $email = $u ? $u['email'] : 'inconnu';
    }

    // Log en base (NULL user_id pour anonymes)
    $stmt = db()->prepare(
        'INSERT INTO downloads (user_id, file, ip, version, downloaded_at) VALUES (?, ?, ?, ?, NOW())'
    );
    $stmt->execute([
        $userId,
        $file,
        $_SERVER['REMOTE_ADDR'] ?? '',
        $version ?: null,
    ]);

    $label = $file === 'portable' ? 'Version portable' : 'Installeur Windows';
    $detail = sprintf('%s • %s • v%s • IP:%s', $email, $label, $version ?: '?', $_SERVER['REMOTE_ADDR'] ?? '?');
    notify_admin('Nouveau téléchargement', $detail);

    respond(['ok' => true]);
} catch (Throwable $e) {
    respond(['error' => 'server', 'message' => 'Erreur serveur'], 500);
}
