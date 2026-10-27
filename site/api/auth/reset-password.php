<?php
/**
 * GET/POST /auth/reset-password.php
 * Valide le jeton et met à jour le mot de passe.
 *
 * GET  : affiche le formulaire
 * POST : { token, newPassword } → 200 { ok: true } ou erreur
 */

require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $token = $_GET['token'] ?? '';
    if (!$token) {
        http_response_code(400);
        die('<html><body><p>Token manquant.</p></body></html>');
    }

    // Vérifie le token
    try {
        $decoded = \Firebase\JWT\JWT::decode($token, new Key(JWT_SECRET, 'HS256'));
        if ($decoded->type !== 'password_reset') throw new Exception('Invalid token type');
        $userId = (int)$decoded->sub;

        // Vérifie que le token correspond à celui en base
        $stmt = db()->prepare('SELECT password_reset_token, password_reset_expires FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        $row = $stmt->fetch();
        if (!$row || !$row['password_reset_expires'] || strtotime($row['password_reset_expires']) < time()) {
            http_response_code(400);
            die('<html><body><p>Token expiré ou invalide.</p></body></html>');
        }
        if (hash('sha256', $token) !== $row['password_reset_token']) {
            http_response_code(400);
            die('<html><body><p>Token invalide.</p></body></html>');
        }

        // Affiche le formulaire
        ?>
        <!doctype html>
        <html lang="fr">
        <head>
            <meta charset="utf-8"/>
            <meta name="viewport" content="width=device-width, initial-scale=1"/>
            <title>Réinitialiser le mot de passe — Light Maestro</title>
            <link rel="stylesheet" href="./assets/site.css"/>
        </head>
        <body>
        <header class="nav">
          <div class="nav-inner">
            <a class="brand" href="./index.html"><img src="./assets/logo.svg" alt="Light Maestro" style="width:34px;height:34px;border-radius:10px"/><span class="brand-word">LIGHT <span>MAESTRO</span></span></a>
          </div>
        </header>
        <section class="section">
          <div class="wrap" style="max-width:480px">
            <div class="card">
              <h3 class="h3">Créer un nouveau mot de passe</h3>
              <p style="margin-top:8px;color:#9ca3af;font-size:13px">Ton nouveau mot de passe doit contenir au moins 6 caractères.</p>
              <div style="display:flex; flex-direction:column; gap:10px; margin-top:16px">
                <input id="new-pass" type="password" placeholder="Nouveau mot de passe" style="padding:10px 12px; border-radius:10px; border:1px solid #2a2a3a; background:#0d0d14; color:white; font-size:14px"/>
                <input id="confirm-pass" type="password" placeholder="Confirmer le mot de passe" style="padding:10px 12px; border-radius:10px; border:1px solid #2a2a3a; background:#0d0d14; color:white; font-size:14px"/>
                <button id="submit-reset" class="btn btn-primary">Réinitialiser</button>
              </div>
              <div id="msg" class="meta" style="margin-top:10px"></div>
              <a href="./index.html" style="display:block;margin-top:12px;font-size:12px;color:#8b5cf6;text-decoration:none">← Retour à l'accueil</a>
            </div>
          </div>
        </section>
        <script>
          var TOKEN = <?= json_encode($token) ?>;
          $('submit-reset').addEventListener('click', function() {
            var p1 = $('new-pass').value.trim();
            var p2 = $('confirm-pass').value.trim();
            var msg = $('msg');
            if (p1.length < 6) { msg.textContent = 'Le mot de passe doit contenir au moins 6 caractères.'; msg.style.color = '#f87171'; return; }
            if (p1 !== p2) { msg.textContent = 'Les mots de passe ne correspondent pas.'; msg.style.color = '#f87171'; return; }
            msg.textContent = 'En cours…'; msg.style.color = '';
            fetch('/auth/reset-password', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({token: TOKEN, newPassword: p1})
            }).then(function(r){ return r.json().then(function(d){ if(!r.ok) throw new Error(d.message||d.error); return d; }); })
              .then(function(){
                msg.textContent = 'Mot de passe mis à jour ! Redirection…';
                msg.style.color = '#22c55e';
                setTimeout(function(){ window.location.href = './index.html'; }, 1500);
              }).catch(function(e){ msg.textContent = 'Erreur : ' + e.message; msg.style.color = '#f87171'; });
          });
        </script>
        </body>
        </html>
        <?php
        exit;
    } catch (Exception $e) {
        http_response_code(400);
        die('<html><body><p>Token invalide : ' . htmlspecialchars($e->getMessage()) . '</p></body></html>');
    }
}

// POST : mise à jour du mot de passe
$b = body();
$token = (string)($b['token'] ?? '');
$newPassword = (string)($b['newPassword'] ?? '');

if (!$token || strlen($newPassword) < 6) {
    respond(['error' => 'invalid_input', 'message' => 'Token ou mot de passe invalide'], 400);
}

try {
    $decoded = \Firebase\JWT\JWT::decode($token, new Key(JWT_SECRET, 'HS256'));
    if ($decoded->type !== 'password_reset') throw new Exception('Invalid token type');
    $userId = (int)$decoded->sub;

    // Vérifie l'expiration
    $stmt = db()->prepare('SELECT password_reset_expires FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    if (!$row || !$row['password_reset_expires'] || strtotime($row['password_reset_expires']) < time()) {
        respond(['error' => 'token_expired', 'message' => 'Token expiré'], 400);
    }

    // Vérifie le token
    if (hash('sha256', $token) !== $row['password_reset_token']) {
        respond(['error' => 'invalid_token', 'message' => 'Token invalide'], 400);
    }

    // Met à jour le mot de passe
    $hash = password_hash($newPassword, PASSWORD_DEFAULT);
    $stmt = db()->prepare('UPDATE users SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL WHERE id = ?');
    $stmt->execute([$hash, $userId]);

    notify_admin('Mot de passe réinitialisé', 'Utilisateur #' . $userId . ' a changé son mot de passe');
    respond(['ok' => true]);
} catch (Exception $e) {
    respond(['error' => 'invalid_token', 'message' => $e->getMessage()], 400);
}
