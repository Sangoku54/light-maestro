<?php
// Test minimal : vérifie si config.php existe et si la DB répond
header('Content-Type: application/json; charset=utf-8');

$configPath = __DIR__ . '/config.php';
$configExists = file_exists($configPath);

$result = [
    'config_exists' => $configExists,
];

if ($configExists) {
    try {
        require_once $configPath;
        $result['db_host'] = defined('DB_HOST') ? DB_HOST : 'not-defined';
        $result['db_name'] = defined('DB_NAME') ? DB_NAME : 'not-defined';
        
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $stmt = $pdo->query("SHOW TABLES LIKE 'downloads'");
        $tableExists = (bool)$stmt->fetch();
        $result['table_downloads_exists'] = $tableExists;
        
        // List tables for debugging
        $stmt = $pdo->query("SHOW TABLES");
        $tables = [];
        while ($row = $stmt->fetch()) {
            $tables[] = array_values($row)[0];
        }
        $result['tables'] = $tables;
        
    } catch (Throwable $e) {
        $result['error'] = $e->getMessage();
    }
} else {
    $result['error'] = 'config.php not found at ' . $configPath;
}

echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
