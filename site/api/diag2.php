<?php
/**
 * Diagnostic complet — teste les URLs HTTP directement.
 */
error_reporting(E_ALL);
ini_set('display_errors', 1);
header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Test API</title>
<style>body{background:#0a0a0f;color:#ede8dc;font-family:sans-serif;padding:20px}
.ok{color:#4ade80}.err{color:#f87171}.warn{color:#fbbf20}</style>
</head><body>
<h1>Diagnostic API — light-maestro.com</h1>

<?php
echo "<h3>Environnement</h3>";
echo "<p>HTTP_HOST: <code>" . $_SERVER['HTTP_HOST'] . "</code></p>";
echo "<p>DOCUMENT_ROOT: <code>" . ($_SERVER['DOCUMENT_ROOT'] ?? 'non défini') . "</code></p>";
echo "<p>SCRIPT_FILENAME: <code>" . ($_SERVER['SCRIPT_FILENAME'] ?? 'non défini') . "</code></p>";
echo "<p>__DIR__: <code>" . __DIR__ . "</code></p>";
echo "<p>SCRIPT_NAME: <code>" . $_SERVER['SCRIPT_NAME'] . "</code></p>";
echo "<hr>";

// Déterminer le chemin de base correct
$scriptName = $_SERVER['SCRIPT_NAME']; // ex: /api/diag.php
$scriptDir = dirname($scriptName);    // ex: /api
echo "<p>Chemin basé sur SCRIPT_NAME: <code>$scriptDir</code></p>";

// URLs de test
$tests = [
    ['name' => 'register.php', 'path' => $scriptDir . '/auth/register.php'],
    ['name' => 'login.php',    'path' => $scriptDir . '/auth/login.php'],
    ['name' => 'track.php',    'path' => $scriptDir . '/track.php'],
];

foreach ($tests as $t) {
    $url = 'https://' . $_SERVER['HTTP_HOST'] . $t['path'];
    echo "<h3>{$t['name']}</h3>";
    echo "<p>URL: <code>$url</code></p>";
    echo "<p>Chemin local: <code>" . __DIR__ . $t['path'] . "</code></p>";
    
    // Vérifier existence locale
    $localPath = __DIR__ . $t['path'];
    if (file_exists($localPath)) {
        echo "<p class='ok'>✓ Fichier physique trouvé</p>";
    } else {
        echo "<p class='err'>✗ Fichier introuvable localement : $localPath</p>";
        echo "<hr>";
        continue;
    }
    
    // Test HTTP
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['email'=>'test@test.com','password'=>'test123']));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
    $resp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    
    if ($err) {
        echo "<p class='err'>cURL: $err</p>";
    } else {
        echo "<p>HTTP: <code>$httpCode</code></p>";
        if ($httpCode === 404) {
            echo "<p class='err'>⚠ 404 HTTP — le fichier existe physiquement mais le serveur ne le sert pas.</p>";
            echo "<p class='warn'>→ Vérifiez si un .htaccess au niveau supérieur bloque l'accès.</p>";
        } elseif ($httpCode >= 500) {
            echo "<p class='err'>Erreur $httpCode: " . htmlspecialchars(substr($resp ?: '(vide)', 0, 300)) . "</p>";
        } else {
            echo "<p class='ok'>OK: " . htmlspecialchars(substr($resp ?: '(vide)', 0, 200)) . "</p>";
        }
    }
    echo "<hr>";
}

// Test GET simple pour voir ce que le serveur répond
echo "<h3>Test GET brut</h3>";
$testUrl = 'https://' . $_SERVER['HTTP_HOST'] . $scriptDir . '/auth/register.php';
echo "<p>GET $testUrl</p>";
$ch = curl_init($testUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 5);
curl_setopt($ch, CURLOPT_NOBODY, false);
$resp = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
echo "<p>Code: $httpCode</p>";
if ($httpCode === 404) {
    echo "<p class='err'>404 — le fichier n'est pas servi par Apache.</p>";
    echo "<p class='warn'>Peut-être un VirtualHost qui ne pointe pas sur le bon dossier, ou un .htaccess parent qui redirige.</p>";
}
curl_close($ch);

echo "<hr><p class='warn'>⚠ Supprimez ce fichier après usage !</p>";
?>
</body></html>
