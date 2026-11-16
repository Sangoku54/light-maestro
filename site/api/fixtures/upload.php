<?php
/**
 * POST /fixtures/upload.php
 * Upload une fixture custom depuis l'app Light Maestro.
 *
 * body : { defId, manufacturer, model, type, channels, modes, definition }
 * Auth : Bearer token
 * 200  : { ok: true, id: <db_id> }
 * 401  : { error: 'unauthorized' }
 * 409  : { error: 'already_exists' }
 */

require_once __DIR__ . '/../helpers.php';

$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
preg_match('/^Bearer\s+(.+)$/i', $auth, $m);
$userId = verify_token($m[1] ?? null);
if (!$userId) respond(['error' => 'unauthorized'], 401);

$b = body();
$defId = trim((string)($b['defId'] ?? ''));
$manufacturer = trim((string)($b['manufacturer'] ?? ''));
$model = trim((string)($b['model'] ?? ''));
$type = trim((string)($b['type'] ?? 'Other'));
$channels = (int)($b['channels'] ?? 0);
$modes = $b['modes'] ?? null;
$definition = $b['definition'] ?? null;

if (!$defId || !$manufacturer || !$model || $channels <= 0) {
    respond(['error' => 'invalid_input', 'message' => 'Champs manquants'], 400);
}

try {
    // Vérifie si la fixture existe déjà
    $stmt = db()->prepare('SELECT id FROM custom_fixtures WHERE def_id = ?');
    $stmt->execute([$defId]);
    if ($stmt->fetch()) {
        respond(['error' => 'already_exists', 'message' => 'Cette fixture existe déjà'], 409);
    }

    // Insère
    $stmt = db()->prepare(
        'INSERT INTO custom_fixtures (user_id, def_id, manufacturer, model, type, channels, modes) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $userId,
        $defId,
        $manufacturer,
        $model,
        $type,
        $channels,
        is_string($modes) ? $modes : json_encode($modes ?: null),
    ]);

    // Si la définition complète est envoyée, la stocker séparément
    if ($definition) {
        $stmt = db()->prepare('INSERT INTO custom_fixture_defs (fixture_id, definition) VALUES (?, ?) ON DUPLICATE KEY UPDATE definition = VALUES(definition)');
        $stmt->execute([(int)db()->lastInsertId(), is_string($definition) ? $definition : json_encode($definition)]);
    }

    notify_admin('Nouvelle fixture custom uploadée', $manufacturer . ' ' . $model . ' par user #' . $userId);

    respond(['ok' => true, 'id' => (int)db()->lastInsertId()]);
} catch (Throwable $e) {
    error_log('[fixtures:upload] ' . $e->getMessage());
    respond(['error' => 'server', 'message' => 'Erreur serveur'], 500);
}
