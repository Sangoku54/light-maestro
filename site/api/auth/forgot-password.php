<?php
/**
 * POST /auth/forgot-password.php
 * Génère un jeton de réinitialisation et envoie un email avec le lien.
 *
 * body : { email }
 * 200  : { ok: true }  (toujours, même si l'email n'existe pas — sécurité)
 * 400  : { error: 'invalid_input' }
 * 429  : { error: 'rate_limited' }
 *
 * Corrections apportées :
 *  - `require_once __DIR__ . '/helpers.php'` ne trouvait pas le fichier
 *    (helpers.php est dans le dossier parent) → erreur PHP fatale ;
 *  - le jeton était signé avec `firebase/php-jwt`, absent du serveur
 *    (pas de dossier vendor/) → le helper natif `sign_reset_token()` est
 *    utilisé à la place ;
 *  - le lien pointait vers `https://light-maestro.com/reset-password.php`
 *    qui n'existe pas (404) → `password_reset_url()` vise la bonne URL.
 */

require_once __DIR__ . '/../helpers.php';

$b = body();
$email = trim((string)($b['email'] ?? ''));

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(['error' => 'invalid_input', 'message' => 'Email invalide'], 400);
}

$email = strtolower($email);

// Limitation des demandes par IP (l'endpoint est public et déclenche un
// email : sans cela, il sert de relais de spam).
rl_check('forgot', 10, 3600); // 10 demandes / heure

try {
    $stmt = db()->prepare('SELECT id, display_name FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();
} catch (Throwable $e) {
    // Panne de base : elle n'est pas liée au compte, on peut renvoyer 500.
    error_log('[forgot-password] lecture utilisateur impossible : ' . $e->getMessage());
    respond(['error' => 'server', 'message' => 'Erreur serveur'], 500);
}

if ($user) {
    try {
        // Jeton signé HS256 (helper natif — aucune dépendance externe).
        $token = sign_reset_token((int)$user['id'], 3600);

        // Stocke le hash du jeton dans la base (pour révocation)
        $stmt = db()->prepare('UPDATE users SET password_reset_token = ?, password_reset_expires = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = ?');
        $stmt->execute([hash('sha256', $token), (int)$user['id']]);

        // Envoie l'email (lien web + code utilisable dans l'application).
        $name = $user['display_name'] ?: explode('@', $email)[0];
        send_reset_email($email, $name, password_reset_url($token), $token);

        notify_admin('Réinitialisation demandée', 'Utilisateur : ' . $email);
    } catch (Throwable $e) {
        // On ne révèle PAS l'existence du compte : la réponse reste 200,
        // l'échec est journalisé côté serveur.
        error_log('[forgot-password] envoi impossible pour ' . $email . ' : ' . $e->getMessage());
    }
}

// Chaque demande compte dans le compteur (email connu ou non).
rl_record_failure('forgot', client_ip());

// Toujours répondre 200 pour éviter l'énumération des emails.
respond([
    'ok' => true,
    'message' => 'Si un compte existe avec cette adresse, un email de réinitialisation a été envoyé.',
]);
