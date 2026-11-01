<?php
/**
 * POST /track.php
 * Log un téléchargement (après login) + alerte admin.
 *
 * body : { file: 'portable' | 'setup' }
 * Auth : Bearer token (l'utilisateur est connecté pour voir les liens).
 * 200  : { ok: true }
 * 401  : { error: 'unauthorized' }
 * 400  : { error: 'invalid_input' }
 */

require_once __DIR__ . '/helpers.php';

$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
preg_match('/^Bearer\s+(.+)$/i', $auth, $m);
$userId = verify_token($m[1] ?? null);
if (!$userId) respond(['error' => 'unauthorized'], 401);

$b = body();
$file = trim((string)($b['file'] ?? ''));
if (!in_array($file, ['portable', 'setup'], true)) {
    respond(['error' => 'invalid_input', 'message' => 'Fichier invalide'], 400);
}

try {
    // Récupère l'email de l'utilisateur
    $stmt = db()->prepare('SELECT email FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    $email = $user ? $user['email'] : 'inconnu';

    // Log en base
    $stmt = db()->prepare('INSERT INTO downloads (user_id, file, ip, downloaded_at) VALUES (?, ?, ?, NOW())');
    $stmt->execute([$userId, $file, $_SERVER['REMOTE_ADDR'] ?? '']);

    $label = $file === 'portable' ? 'Version portable' : 'Installeur Windows';
    notify_admin('Nouveau téléchargement', $email . ' a téléchargé : ' . $label . ' (v1.0.39)');

    respond(['ok' => true]);
} catch (Throwable $e) {
    respond(['error' => 'server', 'message' => 'Erreur serveur'], 500);
}
