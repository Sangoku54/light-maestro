<?php
/**
 * GET /fixtures/list.php
 * Liste les fixtures custom partagées (filtre par manufacturer/model/type).
 *
 * query params : manufacturer?, model?, type?, q? (recherche texte)
 * 200 : { fixtures: [{ id, defId, manufacturer, model, type, channels, createdAt }] }
 */

require_once __DIR__ . '/../helpers.php';

$manufacturer = trim((string)($_GET['manufacturer'] ?? ''));
$model = trim((string)($_GET['model'] ?? ''));
$type = trim((string)($_GET['type'] ?? ''));
$q = trim((string)($_GET['q'] ?? ''));

try {
    $sql = 'SELECT id, def_id, manufacturer, model, type, channels, created_at FROM custom_fixtures';
    $conditions = [];
    $params = [];

    if ($manufacturer) {
        $conditions[] = 'manufacturer LIKE ?';
        $params[] = '%' . $manufacturer . '%';
    }
    if ($model) {
        $conditions[] = 'model LIKE ?';
        $params[] = '%' . $model . '%';
    }
    if ($type) {
        $conditions[] = 'type = ?';
        $params[] = $type;
    }
    if ($q) {
        $conditions[] = '(manufacturer LIKE ? OR model LIKE ? OR type LIKE ?)';
        $params[] = '%' . $q . '%';
        $params[] = '%' . $q . '%';
        $params[] = '%' . $q . '%';
    }

    if ($conditions) {
        $sql .= ' WHERE ' . implode(' AND ', $conditions);
    }
    $sql .= ' ORDER BY created_at DESC LIMIT 100';

    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    $fixtures = $stmt->fetchAll();

    respond(['fixtures' => $fixtures]);
} catch (Throwable $e) {
    error_log('[fixtures:list] ' . $e->getMessage());
    respond(['error' => 'server', 'message' => 'Erreur serveur'], 500);
}
