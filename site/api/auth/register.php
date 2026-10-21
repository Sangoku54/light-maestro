<?php
/**
 * POST /auth/register.php
 * Crée un compte (édition free). Ce compte sert de point d'attache à la licence.
 *
 * body : { email, password, displayName? }
 * 200  : { token, edition, email, displayName }
 * 409  : { error: 'email_taken' }
 * 400  : { error: 'invalid_input' }
 */

require_once __DIR__ . '/../helpers.php';

$b = body();
$email = trim((string)($b['email'] ?? ''));
$password = (string)($b['password'] ?? '');
$displayName = trim((string)($b['displayName'] ?? ''));

if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 6) {
    respond(['error' => 'invalid_input', 'message' => 'Email invalide ou mot de passe trop court (min 6)'], 400);
}

try {
    $stmt = db()->prepare('SELECT id FROM users WHERE email = ?');
    $stmt->execute([strtolower($email)]);
    if ($stmt->fetch()) {
        respond(['error' => 'email_taken', 'message' => 'Un compte existe déjà avec cet email'], 409);
    }

    $hash = password_hash($password, PASSWORD_DEFAULT);
    $stmt = db()->prepare('INSERT INTO users (email, password_hash, display_name, edition) VALUES (?, ?, ?, "free")');
    $stmt->execute([strtolower($email), $hash, $displayName ?: null]);

    $userId = (int)db()->lastInsertId();
    send_confirmation_email(strtolower($email), $displayName ?: null);
    notify_admin('Nouvelle inscription', 'Compte créé : ' . strtolower($email) . ' (édition Gratuite)' . ($displayName ? ' — ' . $displayName : ''));
    respond([
        'token' => sign_token($userId),
        'edition' => 'free',
        'email' => strtolower($email),
        'displayName' => $displayName ?: null,
    ]);
} catch (Throwable $e) {
    respond(['error' => 'server', 'message' => 'Erreur serveur'], 500);
}