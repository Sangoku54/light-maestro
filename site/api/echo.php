<?php
/**
 * Test endpoint — reçoit n'importe quelle requête et renvoie les détails.
 */
error_reporting(E_ALL);
ini_set('display_errors', 1);
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Lire le corps même si empty
$input = file_get_contents('php://input');
$headers = getallheaders();

$response = [
    'method' => $_SERVER['REQUEST_METHOD'],
    'script' => $_SERVER['SCRIPT_NAME'],
    'uri' => $_SERVER['REQUEST_URI'],
    'input_length' => strlen($input),
    'input' => $input,
    'headers' => $headers,
    'server_vars' => [
        'DOCUMENT_ROOT' => $_SERVER['DOCUMENT_ROOT'] ?? '',
        'SCRIPT_FILENAME' => $_SERVER['SCRIPT_FILENAME'] ?? '',
        'CONTENT_TYPE' => $_SERVER['CONTENT_TYPE'] ?? '',
        'HTTP_AUTHORIZATION' => $_SERVER['HTTP_AUTHORIZATION'] ?? '',
    ],
];

http_response_code(200);
echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
exit;