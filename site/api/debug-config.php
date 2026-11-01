<?php
/**
 * Debug endpoint — vérifie l'état de la config serveur.
 * NE PAS mettre en production : supprimer après débug.
 * GET /api/debug-config.php
 */
require_once __DIR__ . '/helpers.php';

$cfg = [
    'DB_HOST'       => defined('DB_HOST')      ? DB_HOST      : 'UNDEFINED',
    'DB_NAME'       => defined('DB_NAME')      ? DB_NAME      : 'UNDEFINED',
    'DB_USER_SET'   => defined('DB_USER')      && DB_USER !== '' ? 'YES' : 'NO (EMPTY!)',
    'DB_PASS_SET'   => defined('DB_PASS')      && DB_PASS !== '' ? 'YES' : 'NO (EMPTY!)',
    'JWT_SECRET_SET'=> defined('JWT_SECRET')   && JWT_SECRET !== '' ? 'YES' : 'NO (EMPTY!)',
    'JWT_SECRET_LEN'=> defined('JWT_SECRET')   ? strlen(JWT_SECRET) : 0,
    'STRIPE_SK_SET' => defined('STRIPE_SECRET_KEY') && STRIPE_SECRET_KEY !== '' ? 'YES' : 'NO (EMPTY!)',
    'STRIPE_PRICE_STD_SET' => defined('STRIPE_PRICE_STANDARD') && STRIPE_PRICE_STANDARD !== '' ? 'YES' : 'NO (EMPTY!)',
    'STRIPE_PRICE_FULL_SET'=> defined('STRIPE_PRICE_FULL')     && STRIPE_PRICE_FULL     !== '' ? 'YES' : 'NO (EMPTY!)',
];

// Test DB connexion
$dbOk = false;
$dbErr = '';
try {
    $pdo = db();
    $pdo->query('SELECT 1');
    $dbOk = true;
} catch (Throwable $e) {
    $dbErr = substr($e->getMessage(), 0, 120);
}
$cfg['DB_OK'] = $dbOk ? 'YES' : 'NO';
$cfg['DB_ERROR'] = $dbErr;

// Test JWT verify with a dummy token
$testToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5OTkiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMDAwMH0.dummy';
$cfg['JWT_ALGO'] = 'HS256';

respond($cfg);
