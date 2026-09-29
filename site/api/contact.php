<?php
/**
 * POST /api/contact.php
 * Formulaire de contact du site : relaie vers contact@light-maestro.com.
 *
 * body JSON : { name, email, subject, message, company? }
 * 200  : { ok: true }
 * 400  : { error: 'invalid_input' }
 * 429  : { error: 'rate_limited' }
 * 500  : { error: 'send_failed' }
 *
 * Anti-spam : champ piège `company` (doit rester vide) + quota simple par IP
 * (fichier JSON, 5 envois / heure). Échec silencieux côté visiteur si le mail
 * ne part pas ? Non : on renvoie 500 pour que le visiteur réessaie par email.
 */

require_once __DIR__ . '/helpers.php';

const CONTACT_TO = 'contact@light-maestro.com';
const CONTACT_RATE_FILE = __DIR__ . '/contact-rate.json';
const CONTACT_RATE_MAX = 5;
const CONTACT_RATE_WINDOW = 3600;

function contact_rate_ok(string $ip): bool {
    $now = time();
    $data = [];
    try {
        if (file_exists(CONTACT_RATE_FILE)) {
            $data = json_decode((string)file_get_contents(CONTACT_RATE_FILE), true) ?: [];
        }
    } catch (Throwable $e) { /* repart à zéro */ }
    $hits = array_values(array_filter($data[$ip] ?? [], fn($t) => ($now - (int)$t) < CONTACT_RATE_WINDOW));
    if (count($hits) >= CONTACT_RATE_MAX) return false;
    $hits[] = $now;
    $data[$ip] = $hits;
    try { file_put_contents(CONTACT_RATE_FILE, json_encode($data), LOCK_EX); } catch (Throwable $e) { /* non bloquant */ }
    return true;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['error' => 'method'], 405);
}

$b = body();
$name = trim((string)($b['name'] ?? ''));
$email = trim((string)($b['email'] ?? ''));
$subject = trim((string)($b['subject'] ?? 'Question générale'));
$message = trim((string)($b['message'] ?? ''));
$honeypot = trim((string)($b['company'] ?? ''));

// Robot : on fait semblant que ça marche.
if ($honeypot !== '') respond(['ok' => true]);

if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $name === '' || $message === '' || strlen($message) > 10000) {
    respond(['error' => 'invalid_input', 'message' => 'Nom, email valide et message requis.'], 400);
}

$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
if (!contact_rate_ok($ip)) {
    respond(['error' => 'rate_limited', 'message' => 'Trop de messages, réessayez dans une heure.'], 429);
}

// Anti-injection d'en-têtes : le nom part dans Reply-To.
$replyName = trim(preg_replace('/[\r\n]+/', ' ', $name));

$allowedSubjects = ['Question générale', 'Bug / Support', 'Fixture manquante'];
if (!in_array($subject, $allowedSubjects, true)) $subject = 'Question générale';

$safe = fn(string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
$bodyHtml = '<!doctype html><html lang="fr"><body style="margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,sans-serif;">'
    . '<div style="max-width:560px;margin:0 auto;padding:24px;">'
    . '<h2 style="margin:0 0 4px;">Message site — ' . $safe($subject) . '</h2>'
    . '<p style="color:#52525b;">De : <b>' . $safe($name) . '</b> &lt;' . $safe($email) . '&gt; — IP ' . $safe($ip) . '</p>'
    . '<div style="background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:16px;white-space:pre-wrap;">' . $safe($message) . '</div>'
    . '</div></body></html>';

$headers = "MIME-Version: 1.0\r\n"
    . "Content-Type: text/html; charset=UTF-8\r\n"
    . "From: Light Maestro <contact@light-maestro.com>\r\n"
    . "Reply-To: " . $replyName . " <" . $email . ">\r\n";

$sent = false;
try {
    $sent = @mail(CONTACT_TO, '[Site] ' . $subject . ' — ' . $name, $bodyHtml, $headers);
} catch (Throwable $e) { /* ci-dessous */ }

if (!$sent) respond(['error' => 'send_failed', 'message' => 'Envoi impossible, écrivez à ' . CONTACT_TO], 500);
respond(['ok' => true]);
