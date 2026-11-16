<?php
/**
 * GET /api/logs/test.php
 * Vérification rapide : écrit une ligne dans events.log puis retourne son contenu.
 */
header('Content-Type: application/json; charset=utf-8');

$logDir = dirname(__DIR__) . '/logs';
if (!is_dir($logDir)) @mkdir($logDir, 0755, true);
$logFile = $logDir . '/events.log';

// Écriture directe — pas de dépendance
$line = '[' . date('Y-m-d H:i:s') . '] TEST_MANUEL | IP:' . ($_SERVER['REMOTE_ADDR'] ?? '?') . "\n";
@file_put_contents($logFile, $line, FILE_APPEND | LOCK_EX);

$lines = [];
if (is_file($logFile)) {
    $lines = array_slice(file($logFile, FILE_IGNORE_NEW_LINES), -20);
}

echo json_encode([
    'ok'          => true,
    'logExists'   => is_file($logFile),
    'logWritable' => is_writable($logFile),
    'totalLines'  => count(file($logFile)),
    'tail'        => $lines,
]);
