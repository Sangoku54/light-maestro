' Light Maestro - Build EXE avec auto-pull
' Double-clic = git pull + npm run dist (silencieux, log dans build.log)
Dim WshShell, fso, scriptDir
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

' 1) git pull si dépôt
On Error Resume Next
If fso.FolderExists(".git") Then
    WshShell.Run "cmd /c git pull --ff-only > build.log 2>&1", 0, True
End If
On Error GoTo 0

' 2) npm install si besoin
If Not fso.FolderExists("node_modules") Then
    WshShell.Run "cmd /c npm install >> build.log 2>&1", 0, True
End If

' 3) Build complet + package exe
WshShell.Run "cmd /c npm run dist >> build.log 2>&1", 0, True

' 4) Ouvre le dossier release à la fin (visible)
WshShell.Run "explorer.exe """ & scriptDir & "\release""", 1, False
