<?php
/**
 * Helpers partagés : envoi JSON, lecture du corps, CORS, JWT.
 */

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

require_once __DIR__ . '/config.php';

header('Access-Control-Allow-Origin: ' . CORS_ORIGIN);
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/** Répond en JSON et termine. */
function respond($data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Lit le corps JSON de la requête. */
function body(): array {
    $raw = file_get_contents('php://input');
    $decoded = json_decode($raw ?: '', true);
    return is_array($decoded) ? $decoded : [];
}

/** Signe un jeton d'accès pour l'app (id utilisateur). */
function sign_token(int $userId): string {
    $now = time();
    $payload = [
        'sub' => $userId,
        'iat' => $now,
        'exp' => $now + JWT_TTL,
    ];
    return JWT::encode($payload, JWT_SECRET, 'HS256');
}

/**
 * Valide un jeton Bearer et retourne l'id utilisateur, ou null si invalide.
 */
function verify_token(?string $header): ?int {
    if (!$header || !preg_match('/^Bearer\s+(.+)$/i', $header, $m)) return null;
    try {
        $decoded = JWT::decode($m[1], new Key(JWT_SECRET, 'HS256'));
        $sub = $decoded->sub ?? null;
        return is_numeric($sub) ? (int)$sub : null;
    } catch (Throwable $e) {
        return null;
    }
}

/**
 * Édition → limite d'univers (contrat aligné avec l'app : electron/license/types.ts).
 */
function edition_limits(string $edition): array {
    switch ($edition) {
        case 'full':     return ['maxFixtures' => PHP_INT_MAX, 'maxUniverses' => PHP_INT_MAX];
        case 'standard': return ['maxFixtures' => PHP_INT_MAX, 'maxUniverses' => 1];
        default:         return ['maxFixtures' => 1, 'maxUniverses' => 1];
    }
}