<?php
/**
 * GET/POST /auth/reset-password.php
 * Valide le jeton et met à jour le mot de passe.
 *
 * GET  : affiche le formulaire (token dans l'URL)
 * POST : { token, newPassword } → 200 { ok: true } ou erreur
 *
 * Corrections apportées :
 *  - le jeton était décodé avec `firebase/php-jwt`, absent du serveur
 *    (pas de dossier vendor/) → erreur PHP fatale « Class "Key" not found » ;
 *    on utilise désormais le helper natif `verify_reset_token()` ;
 *  - le formulaire GET utilisait `$('id')`, fourni par assets/site.js qui
 *    n'était PAS chargé sur cette page → le script ne démarrait jamais ;
 *    le formulaire est désormais autonome (`document.getElementById`) ;
 *  - les chemins des assets (`./assets/...`) et du `fetch` (`/auth/...`)
 *    étaient faux depuis le dossier /api/auth/ ;
 *  - le message d'erreur renvoyait le texte de l'exception PHP (fuite
 *    d'information) → message générique.
 */

require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Cette branche renvoie une page HTML (et non du JSON).
    header('Content-Type: text/html; charset=utf-8');

    $token = trim((string)($_GET['token'] ?? ''));
    $error = null;

    if ($token === '') {
        $error = 'Lien incomplet : le code de réinitialisation est manquant.';
    } else {
        $userId = verify_reset_token($token);
        if (!$userId) {
            $error = 'Ce lien est invalide ou a expiré. Demande-en un nouveau depuis l\'application Light Maestro.';
        } else {
            try {
                $stmt = db()->prepare('SELECT password_reset_token, password_reset_expires FROM users WHERE id = ?');
                $stmt->execute([$userId]);
                $row = $stmt->fetch();
                if (!$row || !$row['password_reset_expires'] || strtotime((string)$row['password_reset_expires']) < time()) {
                    $error = 'Ce lien a expiré. Demande-en un nouveau depuis l\'application Light Maestro.';
                } elseif (!hash_equals((string)$row['password_reset_token'], hash('sha256', $token))) {
                    $error = 'Ce lien n\'est plus valable. Demande-en un nouveau depuis l\'application Light Maestro.';
                }
            } catch (Throwable $e) {
                error_log('[reset-password] lecture impossible : ' . $e->getMessage());
                $error = 'Service temporairement indisponible. Réessaie dans un instant.';
            }
        }
    }

    $errorSafe = $error !== null ? htmlspecialchars($error, ENT_QUOTES, 'UTF-8') : '';
    ?>
    <!doctype html>
    <html lang="fr">
    <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>Réinitialiser le mot de passe — Light Maestro</title>
        <link rel="stylesheet" href="/assets/site.css"/>
    </head>
    <body>
    <header class="nav">
      <div class="nav-inner">
        <a class="brand" href="/index.html"><img src="/assets/logo.svg" alt="Light Maestro" style="width:34px;height:34px;border-radius:10px"/><span class="brand-word">LIGHT <span>MAESTRO</span></span></a>
      </div>
    </header>
    <section class="section">
      <div class="wrap" style="max-width:480px">
        <div class="card">
          <?php if ($error !== null): ?>
            <h3 class="h3">Lien invalide</h3>
            <p style="margin-top:8px;color:#f87171;font-size:13px"><?= $errorSafe ?></p>
            <p style="margin-top:10px;color:#9ca3af;font-size:12px">Réinitialisation possible directement dans le logiciel : <b style="color:#fff">Compte & Licence → Mot de passe oublié</b>.</p>
            <a href="/index.html" style="display:block;margin-top:12px;font-size:12px;color:#8b5cf6;text-decoration:none">&#8592; Retour au site</a>
          <?php else: ?>
            <h3 class="h3">Créer un nouveau mot de passe</h3>
            <p style="margin-top:8px;color:#9ca3af;font-size:13px">Ton nouveau mot de passe doit contenir au moins 6 caractères.</p>
            <form id="reset-form" autocomplete="off">
              <div style="display:flex; flex-direction:column; gap:10px; margin-top:16px">
                <input id="new-pass" type="password" placeholder="Nouveau mot de passe" style="padding:10px 12px; border-radius:10px; border:1px solid #2a2a3a; background:#0d0d14; color:white; font-size:14px"/>
                <input id="confirm-pass" type="password" placeholder="Confirmer le mot de passe" style="padding:10px 12px; border-radius:10px; border:1px solid #2a2a3a; background:#0d0d14; color:white; font-size:14px"/>
                <button id="submit-reset" type="submit" class="btn btn-primary">Réinitialiser</button>
              </div>
              <div id="msg" class="meta" style="margin-top:10px"></div>
            </form>
            <a href="/index.html" style="display:block;margin-top:12px;font-size:12px;color:#8b5cf6;text-decoration:none">← Retour au site</a>
          <?php endif; ?>
        </div>
      </div>
    </section>
    <?php if ($error === null): ?>
    <script>
      (function () {
        var TOKEN = <?= json_encode($token, JSON_UNESCAPED_SLASHES) ?>;
        var form = document.getElementById('reset-form');
        var msg = document.getElementById('msg');
        var p1 = document.getElementById('new-pass');
        var p2 = document.getElementById('confirm-pass');
        var btn = document.getElementById('submit-reset');

        function fail(text) {
          msg.textContent = text;
          msg.style.color = '#f87171';
        }

        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var a = p1.value;
          var b = p2.value;
          if (a.length < 6) { fail('Le mot de passe doit contenir au moins 6 caractères.'); return; }
          if (a !== b) { fail('Les mots de passe ne correspondent pas.'); return; }
          msg.textContent = 'En cours…';
          msg.style.color = '#9ca3af';
          btn.disabled = true;
          fetch('/api/auth/reset-password.php', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({token: TOKEN, newPassword: a})
          })
            .then(function (r) {
              return r.json().then(function (d) {
                if (!r.ok) throw new Error(d.message || d.error || 'Erreur');
                return d;
              });
            })
            .then(function () {
              msg.textContent = 'Mot de passe mis à jour ! Redirection…';
              msg.style.color = '#22c55e';
              setTimeout(function () { window.location.href = '/index.html'; }, 1500);
            })
            .catch(function (e) {
              btn.disabled = false;
              fail('Erreur : ' + e.message);
            });
        });
      })();
    </script>
    <?php endif; ?>
    </body>
    </html>
    <?php
    exit;
}

// ── POST : mise à jour du mot de passe ────────────────────────────
$b = body();
$token = trim((string)($b['token'] ?? ''));
$newPassword = (string)($b['newPassword'] ?? '');

if (!$token || strlen($newPassword) < 6) {
    respond(['error' => 'invalid_input', 'message' => 'Code ou mot de passe invalide (6 caractères minimum).'], 400);
}

try {
    // Vérifie la signature et l'expiration (fail-closed sans secret).
    $userId = verify_reset_token($token);
    if (!$userId) {
        respond(['error' => 'token_invalid', 'message' => 'Code de réinitialisation invalide ou expiré.'], 400);
    }

    // Vérifie que le token correspond à celui en base (révocable).
    $stmt = db()->prepare('SELECT password_reset_token, password_reset_expires FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    if (!$row || !$row['password_reset_expires'] || strtotime((string)$row['password_reset_expires']) < time()) {
        respond(['error' => 'token_expired', 'message' => 'Ce code a expiré. Demande un nouveau lien.'], 400);
    }
    if (!hash_equals((string)$row['password_reset_token'], hash('sha256', $token))) {
        respond(['error' => 'token_invalid', 'message' => 'Ce code n\'est plus valable.'], 400);
    }

    // Met à jour le mot de passe et révoque le code.
    $hash = password_hash($newPassword, PASSWORD_DEFAULT);
    $stmt = db()->prepare('UPDATE users SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL WHERE id = ?');
    $stmt->execute([$hash, $userId]);

    notify_admin('Mot de passe réinitialisé', 'Utilisateur #' . $userId . ' a changé son mot de passe');
    respond(['ok' => true, 'message' => 'Mot de passe mis à jour.']);
} catch (Throwable $e) {
    error_log('[reset-password] ' . $e->getMessage());
    respond(['error' => 'server', 'message' => 'Erreur serveur'], 500);
}
