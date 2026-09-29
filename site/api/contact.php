<?php
/**
 * POST /api/contact.php
 * Formulaire de contact du site : relaie vers contact@light-maestro.com.
 *
 * body JSON : { name, email, subject, message, company?, filename?, filedata? }
 *   filename/filedata : image PNG/JPG/WebP/GIF encodée base64 (5 Mo max décodés).
 * 200  : { ok: true }
 * 400  : { error: 'invalid_input' }
 * 413  : { error: 'file_too_large' }
 * 415  : { error: 'file_type' }
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

// Pièce jointe optionnelle : image base64, 5 Mo max après décodage.
$attachment = null;
$rawFilename = trim((string)($b['filename'] ?? ''));
$rawFiledata = (string)($b['filedata'] ?? '');
if ($rawFilename !== '' || $rawFiledata !== '') {
    $bin = base64_decode($rawFiledata, true);
    if ($bin === false || strlen($bin) === 0 || strlen($bin) > 5 * 1024 * 1024) {
        respond(['error' => 'file_too_large', 'message' => 'Image trop lourde : 5 Mo maximum.'], 413);
    }
    $finfo = class_exists('finfo') ? new finfo(FILEINFO_MIME_TYPE) : null;
    $mime = $finfo ? $finfo->buffer($bin) : null;
    // Sans fileinfo : contrôle minimal par signature magique (PNG/JPEG/GIF/WebP).
    if ($mime === null) {
        $head8 = substr($bin, 0, 12);
        if (str_starts_with($bin, "\x89PNG\r\n\x1a\n")) $mime = 'image/png';
        elseif (str_starts_with($bin, "\xFF\xD8\xFF")) $mime = 'image/jpeg';
        elseif (str_starts_with($bin, 'GIF87a') || str_starts_with($bin, 'GIF89a')) $mime = 'image/gif';
        elseif (str_starts_with($bin, 'RIFF') && substr($bin, 8, 4) === 'WEBP') $mime = 'image/webp';
    }
    $allowed = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp', 'image/gif' => 'gif'];
    if (!isset($allowed[$mime])) {
        respond(['error' => 'file_type', 'message' => 'Images uniquement (PNG, JPG, WebP, GIF).'], 415);
    }
    $clean = preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($rawFilename));
    if ($clean === '' || $clean === '.' ) $clean = 'capture.' . $allowed[$mime];
    $attachment = ['name' => $clean, 'mime' => $mime, 'data' => $bin];
}

$safe = fn(string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
$bodyHtml = '<!doctype html><html lang="fr"><body style="margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,sans-serif;">'
    . '<div style="max-width:560px;margin:0 auto;padding:24px;">'
    . '<h2 style="margin:0 0 4px;">Message site — ' . $safe($subject) . '</h2>'
    . '<p style="color:#52525b;">De : <b>' . $safe($name) . '</b> &lt;' . $safe($email) . '&gt; — IP ' . $safe($ip) . '</p>'
    . '<div style="background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:16px;white-space:pre-wrap;">' . $safe($message) . '</div>'
    . '</div></body></html>';

$headers = "MIME-Version: 1.0\r\n"
    . "From: Light Maestro <contact@light-maestro.com>\r\n"
    . "Reply-To: " . $replyName . " <" . $email . ">\r\n";

if ($attachment !== null) {
    // Multipart manuel (pas de PHPMailer en dépendance) : HTML + pièce jointe.
    $boundary = 'LM' . bin2hex(random_bytes(12));
    $headers .= "Content-Type: multipart/mixed; boundary=\"" . $boundary . "\"\r\n";
    $fullBody = "--" . $boundary . "\r\n"
        . "Content-Type: text/html; charset=UTF-8\r\n"
        . "Content-Transfer-Encoding: 8bit\r\n\r\n"
        . $bodyHtml . "\r\n"
        . "--" . $boundary . "\r\n"
        . "Content-Type: " . $attachment['mime'] . "; name=\"" . $attachment['name'] . "\"\r\n"
        . "Content-Transfer-Encoding: base64\r\n"
        . "Content-Disposition: attachment; filename=\"" . $attachment['name'] . "\"\r\n\r\n"
        . chunk_split(base64_encode($attachment['data'])) . "\r\n"
        . "--" . $boundary . "--";
} else {
    $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
    $fullBody = $bodyHtml;
}

$sent = false;
try {
    $sent = @mail(CONTACT_TO, '[Site] ' . $subject . ' — ' . $name, $fullBody, $headers);
} catch (Throwable $e) { /* ci-dessous */ }

if (!$sent) respond(['error' => 'send_failed', 'message' => 'Envoi impossible, écrivez à ' . CONTACT_TO], 500);
respond(['ok' => true, 'attachment' => $attachment !== null]);
