<?php
/**
 * Test direct des endpoints API — sans mod_rewrite.
 */
error_reporting(E_ALL);
ini_set('display_errors', 1);
header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Test API Direct</title>
<style>body{background:#0a0a0f;color:#ede8dc;font-family:sans-serif;padding:20px}
.ok{color:#4ade80}.err{color:#f87171}.warn{color:#fbbf20}</style>
</head><body>
<h1>Test Direct API</h1>

<?php
$host = $_SERVER['HTTP_HOST'];
$base = 'https://' . $host;

// Liste des URLs à tester
$tests = [
    ['name' => 'register.php', 'path' => '/api/auth/register.php'],
    ['name' => 'login.php', 'path' => '/api/auth/login.php'],
    ['name' => 'forgot-password.php', 'path' => '/api/auth/forgot-password.php'],
    ['name' => 'track.php', 'path' => '/api/track.php'],
];

foreach ($tests as $t) {
    $url = $base . $t['path'];
    echo "<h3>{$t['name']}</h3>";
    echo "<p>URL: <code>$url</code></p>";
    
    // 1. Vérifier si le fichier existe physiquement
    $realpath = __DIR__ . $t['path'];
    if (file_exists($realpath)) {
        echo "<p class='ok'>✓ Fichier physique trouvé : $realpath</p>";
    } else {
        echo "<p class='err'>✗ Fichier introuvable : $realpath</p>";
        continue;
    }
    
    // 2. Test HTTP direct
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['email' => 'test@test.com', 'password' => 'testpass123']));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
    $resp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    
    if ($err) {
        echo "<p class='err'>cURL error: $err</p>";
    } else {
        echo "<p>HTTP Code: <code>$httpCode</code></p>";
        if ($httpCode === 404) {
            echo "<p class='err'>Le serveur retourne 404 même avec le chemin complet — le .htaccess ou la configuration Apache bloque l'accès.</p>";
        } elseif ($httpCode >= 500) {
            echo "<p class='err'>Erreur serveur $httpCode</p>";
            echo "<pre>" . htmlspecialchars(substr($resp, 0, 500)) . "</pre>";
        } elseif ($httpCode === 403) {
            echo "<p class='warn'>⚠ Forbidden (403) — vérifier les permissions ou .htaccess parent</p>";
        } else {
            echo "<p class='ok'>Réponse reçue : " . htmlspecialchars(substr($resp ?: '(vide)', 0, 200)) . "</p>";
        }
    }
    curl_close($ch);
    echo "<hr>";
}

// 3. Lister les fichiers dans le dossier api/
echo "<h3>Fichiers présents dans /api/</h3>";
$files = glob(__DIR__ . '/*');
foreach ($files as $f) {
    echo "<p>✓ " . basename($f) . " (" . round(filesize($f)/1024, 1) . " Ko)</p>";
}
$authFiles = glob(__DIR__ . '/auth/*');
foreach ($authFiles as $f) {
    echo "<p>  auth/" . basename($f) . " (" . round(filesize($f)/1024, 1) . " Ko)</p>";
}
?>

<hr>
<p class='warn'>⚠ Supprimez ce fichier après usage !</p>
</body></html>