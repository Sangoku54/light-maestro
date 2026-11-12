# ────────────────────────────────────────────────────────────────
# deploy-release.ps1
# Uploade latest.yml + .exe + .blockmap vers releases.lightmaestro.app/win/
#
# Usage:
#   .\scripts\deploy-release.ps1
# ────────────────────────────────────────────────────────────────
param(
    [string]$Host = '',
    [string]$User = '',
    [SecureString]$Pass = $null
)

Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'

$releaseDir  = Join-Path $PSScriptRoot '..\release'
$siteWin     = Join-Path $PSScriptRoot '..\site\win'
$versionFile = Join-Path $releaseDir 'latest.yml'

if (-not (Test-Path $versionFile)) {
    Write-Error "Aucun latest.yml dans release/ — lance d'abord npm run dist"
    exit 1
}

$content  = Get-Content $versionFile -Raw
$version  = ([regex]::Match($content, 'version:\s*(.+)')).Groups[1].Value.Trim()
$pathMain = ([regex]::Match($content, 'path:\s*(.+)')).Groups[1].Value.Trim()
$fileUrls = [regex]::Matches($content, '- url:\s*(.+)') | ForEach-Object { $_.Groups[1].Value.Trim() }

Write-Host "`n[deploy] Version: $version"

if (-not $Host) {
    $Host = Read-Host "Hote FTP (ex: ftp.lightmaestro.com)"
    $User = Read-Host "Utilisateur"
    $Pass = Read-Host "Mot de passe" -AsSecureString
}

# Synchro locale site/win/latest.yml
Copy-Item $versionFile (Join-Path $siteWin 'latest.yml') -Force
Write-Host "[deploy] site/win/latest.yml sincronise"

# Liste des fichiers a uploader
$targets  = @($pathMain) + $fileUrls
$toUpload = @()
foreach ($f in $targets) {
    $toUpload += $f
    if ($f -notlike '*.blockmap') { $toUpload += "$f.blockmap" }
}

# Helper: conversion SecureString -> plain text
function Get-PlainPassword($sec) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    $plain
}

$ok = 0; $fail = 0
foreach ($name in $toUpload) {
    $local = Join-Path $releaseDir $name
    if (-not (Test-Path $local)) {
        Write-Host "  SKIP  $name  (absent)" -ForegroundColor Yellow
        continue
    }
    try {
        $request      = [System.Net.FtpWebRequest]::Create("ftp://$Host/win/$name")
        $cred         = New-Object System.Net.NetworkCredential($User, $(Get-PlainPassword $Pass))
        $request.Credentials = $cred
        $request.Method        = [System.Net.WebRequestMethods+Ftp]::UploadFile
        $request.UseBinary     = $true
        $request.KeepAlive     = $false

        $bytes     = [System.IO.File]::ReadAllBytes($local)
        $request.ContentLength = $bytes.Length
        $stream    = $request.GetRequestStream()
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Close()

        $resp  = $request.GetResponse()
        Write-Host "  OK    $name  ($( $resp.StatusCode ))"
        $resp.Close()
        $ok++
    } catch {
        Write-Host "  FAIL  $name  — $($_.Exception.Message)" -ForegroundColor Red
        $fail++
    }
}

Write-Host ""
Write-Host "[deploy] Termine: $ok uploades, $fail echecs"
Write-Host "Verifie : https://$Host/win/latest.yml"
if ($fail -gt 0) { exit 1 }
