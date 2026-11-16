' Light Maestro - Launcher de TEST (toujours à jour)
' Double-clic = git pull + rebuild complet + lancement Electron (silencieux)
Dim WshShell, fso, scriptDir
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

' Auto-pull si dépôt git
On Error Resume Next
If fso.FolderExists(".git") Then
    WshShell.Run "cmd /c git pull --ff-only", 0, True
End If
On Error GoTo 0

' Dépendances
If Not fso.FolderExists("node_modules") Then
    WshShell.Run "cmd /c npm install", 0, True
End If

' Rebuild systématique (toujours à jour à chaque modif)
If fso.FileExists("dist\tsconfig.electron.tsbuildinfo") Then
    fso.DeleteFile "dist\tsconfig.electron.tsbuildinfo", True
End If
WshShell.Run "cmd /c npx tsc -p tsconfig.electron.json", 0, True
WshShell.Run "cmd /c npx vite build", 0, True

If fso.FileExists("electron\dmx\usb-output.js") Then
    fso.CopyFile "electron\dmx\usb-output.js", "dist\electron\dmx\usb-output.js", True
End If
If fso.FileExists("electron\splash.html") Then
    fso.CopyFile "electron\splash.html", "dist\electron\splash.html", True
End If

' Lancement test (silencieux)
WshShell.Run "cmd /c npx electron .", 0, False
