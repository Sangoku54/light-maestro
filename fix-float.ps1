$ErrorActionPreference = 'Stop'
$dir = 'C:\Users\vitte\.openclaw-autoclaw\agents\mon-codeur\workspace\light-maestro\site'
$files = Get-ChildItem $dir -Filter *.html

$style = '<style>.dl-float{position:fixed;bottom:24px;right:24px;z-index:9999}.dl-float a{display:inline-flex;align-items:center;gap:8px;padding:12px 20px;background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;text-decoration:none;border-radius:12px;font-weight:700;font-size:14px;box-shadow:0 4px 14px rgba(168,85,247,.4);transition:transform .2s,box-shadow .2s}.dl-float a:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(168,85,247,.5)}.dl-float a::before{content:"⬇"}</style>'

foreach ($file in $files) {
    $content = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
    
    $styleStart = $content.IndexOf('<style>.dl-float{')
    $bodyEnd = $content.IndexOf('</body>')
    
    if ($styleStart -eq -1 -or $bodyEnd -eq -1) {
        Write-Host "SKIP (no float btn): $($file.Name)"
        continue
    }
    
    $lang = if ($file.Name -like "*-en.html") { "en" } else { "fr" }
    $btnText = if ($lang -eq "en") { "Download for free" } else { "Télécharger gratuitement" }
    $href = if ($lang -eq "en") { "./telecharger-en.html" } else { "./telecharger.html" }
    $btn = "<div class=`"dl-float`"><a href=`"$href`">$btnText</a></div>"
    
    $newContent = $content.Substring(0, $styleStart) + $style + $btn + $content.Substring($bodyEnd)
    
    [System.IO.File]::WriteAllText($file.FullName, $newContent, [System.Text.Encoding]::UTF8)
    Write-Host "OK: $($file.Name)"
}