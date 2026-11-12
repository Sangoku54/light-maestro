<?php
/**
 * GET /logs/debug.php?tail=N
 * Affiche les N dernières lignes du log d'événements (téléchargements, inscriptions, paiements).
 * ⚠️ À retirer ou protéger par mot de passe avant mise en production !
 *
 * Requêtes :
 *   GET /api/logs/debug.php          → 50 dernières lignes
 *   GET /api/logs/debug.php?tail=20  → 20 dernières lignes
 */

require_once __DIR__ . '/../helpers.php';

// Fichier log créé par notify_admin() dans helpers.php
$logFile = dirname(__DIR__) . '/logs/events.log';

$tail = max(1, min(200, (int)($_GET['tail'] ?? 50)));

if (!is_file($logFile)) {
    respond(['ok' => true, 'lines' => [], 'note' => 'Aucun log encore enregistré']);
}

$lines = array_slice(file($logFile, FILE_IGNORE_NEW_LINES), -$tail);

respond([
    'ok'     => true,
    'file'   => $logFile,
    'totalLines' => count(file($logFile)),
    'tail'   => $tail,
    'lines'  => $lines,
]);
