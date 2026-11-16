<?php
/**
 * POST /track.php — DEBUG VERSION
 * Affiche chaque étape pour identifier l'erreur 500.
 */
error_reporting(E_ALL);
ini_set('display_errors', 1);
header('Content-Type: application/json; charset=utf-8');

$out = [];
$r = &$out;

try {
    $r['step1_require'] = 'ok';
    require_once __DIR__ . '/helpers.php';
    $r['step2_after_require'] = 'ok';
    
    $b = body();
    $r['step3_body'] = $b;
    
    $file = trim((string)($b['file'] ?? ''));
    $r['step4_file'] = $file;
    
    if (!in_array($file, ['portable', 'setup'], true)) {
        http_response_code(400);
        echo json_encode(['error' => 'invalid_input', 'message' => 'Fichier invalide']);
        exit;
    }
    
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    preg_match('/^Bearer\s+(.+)$/i', $auth, $m);
    $userId = verify_token($m[1] ?? null);
    $r['step5_auth'] = ['userId' => $userId];
    
    $email = 'anonyme';
    if ($userId) {
        try {
            $stmt = db()->prepare('SELECT email FROM users WHERE id = ?');
            $stmt->execute([$userId]);
            $u = $stmt->fetch();
            $email = $u ? $u['email'] : 'anonyme';
        } catch (Throwable $e) {
            $r['db_select_error'] = $e->getMessage();
        }
    }
    $r['step6_email'] = $email;
    
    try {
        $stmt = db()->prepare(
            'INSERT INTO downloads (user_id, file, ip, downloaded_at) VALUES (?, ?, ?, NOW())'
        );
        $stmt->execute([$userId, $file, $_SERVER['REMOTE_ADDR'] ?? '']);
        $r['step7_insert'] = 'ok';
    } catch (Throwable $e) {
        $r['step7_insert_error'] = $e->getMessage();
    }
    
    $label = $file === 'portable' ? 'Version portable' : 'Installeur Windows';
    $version = trim((string)($_POST['version'] ?? ''));
    $detail = sprintf('%s • %s • v%s • IP:%s', $email, $label, $version ?: '?', $_SERVER['REMOTE_ADDR'] ?? '?');
    $r['step8_detail'] = $detail;
    
    notify_admin('Nouveau téléchargement', $detail);
    $r['step9_notify'] = 'ok';
    
    http_response_code(200);
    echo json_encode(['ok' => true]);
    
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'fatal_error' => $e->getMessage(),
        'file' => $e->getFile(),
        'line' => $e->getLine(),
        'trace' => explode("\n", $e->getTraceAsString()),
    ]);
}
