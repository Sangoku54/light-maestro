<?php
/**
 * POST /auth/forgot-password.php
 * Génère un jeton de réinitialisation et envoie un email avec le lien.
 *
 * body : { email }
 * 200  : { ok: true }  (toujours, même si l'email n'existe pas — sécurité)
 * 400  : { error: 'invalid_input' }
 */

require_once __DIR__ . '/helpers.php';

$b = body();
$email = trim((string)($b['email'] ?? ''));

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(['error' => 'invalid_input', 'message' => 'Email invalide'], 400);
}

$email = strtolower($email);

try {
    $stmt = db()->prepare('SELECT id, display_name FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if ($user) {
        // Génère un jeton JWT signé avec expiration 1h
        $token = \Firebase\JWT\JWT::encode(
            [
                'sub' => (int)$user['id'],
                'type' => 'password_reset',
                'iat' => time(),
                'exp' => time() + 3600,
            ],
            JWT_SECRET,
            'HS256'
        );

        // Stocke le hash du jeton dans la base (pour révocation)
        $stmt = db()->prepare('UPDATE users SET password_reset_token = ?, password_reset_expires = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = ?');
        $stmt->execute([hash('sha256', $token), (int)$user['id']]);

        // Envoie l'email
        $name = $user['display_name'] ?: explode('@', $email)[0];
        $resetUrl = 'https://light-maestro.com/reset-password.php?token=' . urlencode($token);
        send_reset_email($email, $name, $resetUrl);

        notify_admin('Réinitialisation demandée', 'Utilisateur : ' . $email);
    }

    // Toujours répondre 200 pour éviter l'énumération des emails
    respond(['ok' => true]);
} catch (Throwable $e) {
    error_log('[forgot-password] ' . $e->getMessage());
    respond(['error' => 'server', 'message' => 'Erreur serveur'], 500);
}
