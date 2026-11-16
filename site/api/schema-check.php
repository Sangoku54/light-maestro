<?php
/**
 * GET /api/schema-check.php
 * Vérifie que toutes les tables nécessaires existent.
 */
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/helpers.php';

try {
    $pdo = db();
    
    // List all tables
    $stmt = $pdo->query("SHOW TABLES");
    $tables = [];
    while ($row = $stmt->fetch()) {
        $tables[] = array_values($row)[0];
    }
    
    // Check downloads table structure
    $downloadsCols = [];
    if (in_array('downloads', $tables)) {
        $stmt = $pdo->query("DESCRIBE downloads");
        while ($row = $stmt->fetch()) {
            $downloadsCols[] = $row['Field'];
        }
    }
    
    // Check users table structure
    $usersCols = [];
    if (in_array('users', $tables)) {
        $stmt = $pdo->query("DESCRIBE users");
        while ($row = $stmt->fetch()) {
            $usersCols[] = $row['Field'];
        }
    }
    
    respond([
        'ok'              => true,
        'tables'          => $tables,
        'downloads_cols'  => $downloadsCols,
        'users_cols'      => $usersCols,
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'error'       => $e->getMessage(),
        'file'        => $e->getFile(),
        'line'        => $e->getLine(),
        'trace_first' => explode("\n", $e->getTraceAsString())[0] ?? '',
    ]);
}
