<?php
/**
 * GET /fixtures/get.php
 * Récupère une fixture custom par def_id.
 *
 * query param : defId
 * 200 : { fixture: { defId, manufacturer, model, type, channels, modes, definition } }
 * 404 : { error: 'not_found' }
 */

require_once __DIR__ . '/../helpers.php';

$defId = trim((string)($_GET['defId'] ?? ''));
if (!$defId) {
    respond(['error' => 'invalid_input', 'message' => 'defId requis'], 400);
}

try {
    $stmt = db()->prepare('SELECT cf.*, cfd.definition FROM custom_fixtures cf LEFT JOIN custom_fixture_defs cfd ON cfd.fixture_id = cf.id WHERE cf.def_id = ?');
    $stmt->execute([$defId]);
    $row = $stmt->fetch();

    if (!$row) {
        respond(['error' => 'not_found'], 404);
    }

    respond(['fixture' => $row]);
} catch (Throwable $e) {
    error_log('[fixtures:get] ' . $e->getMessage());
    respond(['error' => 'server', 'message' => 'Erreur serveur'], 500);
}
