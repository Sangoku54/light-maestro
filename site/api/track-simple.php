<?php
/**
 * POST /track-simple.php
 * Version minimale sans helpers.php — pour isoler le problème 500.
 */
header('Content-Type: application/json; charset=utf-8');

// Lecture brut du corps
$raw = file_get_contents('php://input');
$b = json_decode($raw, true) ?: [];

$file = trim((string)($b['file'] ?? ''));
if (!in_array($file, ['portable', 'setup'], true)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_input', 'message' => 'Fichier invalide']);
    exit;
}

// Log fichier direct
$logDir = dirname(__DIR__) . '/logs';
if (!is_dir($logDir)) @mkdir($logDir, 0755, true);
$logFile = $logDir . '/events.log';
$logLine = sprintf(
    "[%s] Nouveau téléchargement | %s • IP:%s\n",
    date('Y-m-d H:i:s'),
    $file === 'portable' ? 'Version portable' : 'Installeur Windows',
    $_SERVER['REMOTE_ADDR'] ?? '?'
);
@file_put_contents($logFile, $logLine, FILE_APPEND | LOCK_EX);

http_response_code(200);
echo json_encode(['ok' => true, 'logged' => true]);
