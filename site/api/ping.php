<?php
header('Content-Type: application/json; charset=utf-8');
echo json_encode([
    'ok' => true,
    'php_version' => phpversion(),
    'time' => date('Y-m-d H:i:s'),
]);
