<?php
/**
 * POST /track.php — version ultra-simple pour diagnostic.
 * Si ça marche → le problème est dans helpers.php ou la DB.
 * Si ça plante → le problème est ailleurs.
 */

// ── Copie minimale de body() et respond() ─────────────────────────────────────
function body(): array {
    $raw = file_get_contents('php://input');
    $decoded = json_decode($raw ?: '', true);
    return is_array($decoded) ? $decoded : [];
}

function respond($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Log direct sans helpers.php ───────────────────────────────────────────────
$b = body();
$file = trim((string)($b['file'] ?? ''));
$version = trim((string)($b['version'] ?? ''));

if (!in_array($file, ['portable', 'setup'], true)) {
    respond(['error' => 'invalid_input', 'message' => 'Fichier invalide'], 400);
}

// Écriture directe du log
$logDir = __DIR__ . '/logs';
if (!is_dir($logDir)) @mkdir($logDir, 0755, true);
$logFile = $logDir . '/events.log';
$label = $file === 'portable' ? 'Version portable' : 'Installeur Windows';
$ip = $_SERVER['REMOTE_ADDR'] ?? '?';
$logLine = "[" . date('Y-m-d H:i:s') . "] Nouveau téléchargement | $file ($label) • v$version • IP:$ip\n";
@file_put_contents($logFile, $logLine, FILE_APPEND | LOCK_EX);

respond(['ok' => true, 'logged' => true]);
