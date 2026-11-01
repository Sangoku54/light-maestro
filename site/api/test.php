<?php
/**
 * Test de connexion API — à uploader sur LWS puis supprimer après usage.
 * Visitez : https://light-maestro.com/api/test.php
 */

error_reporting(E_ALL);
ini_set('display_errors', 1);
header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>Test Connexion API</title>
<style>body{background:#0a0a0f;color:#ede8dc;font-family:sans-serif;padding:20px}
.ok{color:#4ade80}.err{color:#f87171}.warn{color:#fbbf24}
pre{background:#12121a;padding:12px;border-radius:8px;overflow-x:auto;font-size:13px}</style>
</head>
<body>
<h1>Test Connexion API — Light Maestro</h1>

<?php
// ── 1. Vérifier config.php existe et est lisible ──────────────────
echo "<h2>1. Fichier config.php</h2>";
$configPath = __DIR__ . '/config.php';
if (file_exists($configPath)) {
    echo "<p class='ok'>✓ config.php trouvé : $configPath</p>";
    require_once $configPath;
    echo "<pre>";
    echo "DB_HOST  = " . (defined('DB_HOST') ? DB_HOST : '<span class="err">NON DEFINI</span>') . "\n";
    echo "DB_NAME  = " . (defined('DB_NAME') ? DB_NAME : '<span class="err">NON DEFINI</span>') . "\n";
    echo "DB_USER  = " . (defined('DB_USER') && DB_USER ? '<span class="ok">' . DB_USER . '</span>' : '<span class="err">VIDE — À REMPLIR !</span>') . "\n";
    echo "DB_PASS  = " . (defined('DB_PASS') && DB_PASS ? '<span class="ok">***' . substr(DB_PASS, -3) . '</span>' : '<span class="err">VIDE — À REMPLIR !</span>') . "\n";
    echo "JWT_SECRET = " . (defined('JWT_SECRET') && JWT_SECRET ? '<span class="ok">***' . substr(JWT_SECRET, -4) . ' (' . strlen(JWT_SECRET) . ' chars)</span>' : '<span class="err">VIDE — À REMPLIR !</span>') . "\n";
    echo "</pre>";
} else {
    echo "<p class='err'>✗ config.php introuvable !</p>";
}

// ── 2. Test connexion MySQL ────────────────────────────────────────
echo "<h2>2. Connexion MySQL</h2>";
if (!defined('DB_HOST')) {
    echo "<p class='err'>Impossible : config.php non chargé</p>";
} else {
    try {
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        echo "<p class='ok'>✓ Connexion MySQL réussie</p>";
        echo "<pre>Host: " . DB_HOST . "\nBase: " . DB_NAME . "\nDriver: " . get_class($pdo) . "</pre>";

        // 2a. Tables existantes
        echo "<h2>2a. Tables présentes</h2>";
        $tables = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
        if ($tables) {
            foreach ($tables as $t) echo "<p class='ok'>✓ $t</p>";
        } else {
            echo "<p class='err'>✗ Aucune table trouvée — exécutez schema.sql dans phpMyAdmin</p>";
        }

        // 2b. Structure table users
        if (in_array('users', $tables)) {
            echo "<h2>2b. Colonnes de users</h2>";
            $cols = $pdo->query("DESCRIBE users")->fetchAll(PDO::FETCH_COLUMN, 0);
            foreach ($cols as $c) echo "<p>· $c</p>";
        }

        // 2c. Test inscription SQL
        echo "<h2>2c. Test insertion (compte test)</h2>";
        try {
            $testEmail = 'test-lm-' . time() . '@example.com';
            $testPass = 'testpass123';
            $hash = password_hash($testPass, PASSWORD_DEFAULT);
            $stmt = $pdo->prepare("INSERT INTO users (email, password_hash, display_name, edition) VALUES (?, ?, ?, 'free')");
            $stmt->execute([$testEmail, $hash, 'Test']);
            $testId = (int)$pdo->lastInsertId();
            echo "<p class='ok'>✓ Insertion réussie — user ID #$testId</p>";
            // Supprimer le test
            $pdo->prepare("DELETE FROM users WHERE id = ?")->execute([$testId]);
            echo "<p class='ok'>✓ Test nettoyé (compte supprimé)</p>";
        } catch (Throwable $e) {
            echo "<p class='err'>✗ Erreur INSERT : " . htmlspecialchars($e->getMessage()) . "</p>";
            echo "<pre>" . $e->getTraceAsString() . "</pre>";
        }

        // 2d. Test SELECT email
        echo "<h2>2d. Compte existants</h2>";
        try {
            $users = $pdo->query("SELECT id, email, edition, created_at FROM users ORDER BY id DESC LIMIT 5")->fetchAll();
            if ($users) {
                foreach ($users as $u) {
                    echo "<p class='ok'>#{$u['id']} — {$u['email']} ({$u['edition']})</p>";
                }
            } else {
                echo "<p class='warn'>⚠ Aucun compte dans la base</p>";
            }
        } catch (Throwable $e) {
            echo "<p class='err'>✗ SELECT users : " . htmlspecialchars($e->getMessage()) . "</p>";
        }

    } catch (PDOException $e) {
        echo "<p class='err'>✗ Erreur PDO : " . htmlspecialchars($e->getMessage()) . "</p>";
        echo "<pre>Code: " . $e->getCode() . "\nFile: " . $e->getFile() . ":" . $e->getLine() . "</pre>";
    }
}

// ── 3. Test endpoint register ─────────────────────────────────────
echo "<h2>3. Test endpoint /auth/register</h2>";
$registerUrl = 'https://' . $_SERVER['HTTP_HOST'] . '/api/auth/register';
echo "<p>URL testée : <code>$registerUrl</code></p>";
try {
    $ch = curl_init($registerUrl);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
        'email' => 'test-' . time() . '@example.com',
        'password' => 'testpass123',
        'displayName' => 'Test User'
    ]));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    $resp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($err) {
        echo "<p class='err'>✗ cURL error : $err</p>";
    } else {
        echo "<p>HTTP Code: <code>$httpCode</code></p>";
        echo "<pre>" . htmlspecialchars($resp ?: '(vide)') . "</pre>";
    }
} catch (Throwable $e) {
    echo "<p class='err'>✗ Exception : " . htmlspecialchars($e->getMessage()) . "</p>";
}

// ── 4. Test endpoint login ────────────────────────────────────────
echo "<h2>4. Test endpoint /auth/login</h2>";
$loginUrl = 'https://' . $_SERVER['HTTP_HOST'] . '/api/auth/login';
echo "<p>URL testée : <code>$loginUrl</code></p>";
try {
    $ch = curl_init($loginUrl);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
        'email' => 'test-' . time() . '@example.com',
        'password' => 'testpass123'
    ]));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    $resp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($err) {
        echo "<p class='err'>✗ cURL error : $err</p>";
    } else {
        echo "<p>HTTP Code: <code>$httpCode</code></p>";
        echo "<pre>" . htmlspecialchars($resp ?: '(vide)') . "</pre>";
    }
} catch (Throwable $e) {
    echo "<p class='err'>✗ Exception : " . htmlspecialchars($e->getMessage()) . "</p>";
}

echo "<hr><p class='warn'>⚠ Supprimez ce fichier après usage !</p>";