' Light Maestro - Silent Launcher (no console)
' Double-click this file to launch
Dim WshShell, fso, scriptDir
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

' Ensure node_modules exists
If Not fso.FolderExists("node_modules") Then
    WshShell.Run "cmd /c npm install", 0, True
End If

' Build if needed
' Build TypeScript (always rebuild by clearing cache)
If fso.FileExists("dist\tsconfig.electron.tsbuildinfo") Then
    fso.DeleteFile "dist\tsconfig.electron.tsbuildinfo", True
End If
WshShell.Run "cmd /c npx tsc -p tsconfig.electron.json", 0, True

' Always rebuild vite (fast incremental)
WshShell.Run "cmd /c npx vite build", 0, True

' Copy USB worker script and splash screen
If fso.FileExists("electron\dmx\usb-output.js") Then
    fso.CopyFile "electron\dmx\usb-output.js", "dist\electron\dmx\usb-output.js", True
End If
If fso.FileExists("electron\splash.html") Then
    fso.CopyFile "electron\splash.html", "dist\electron\splash.html", True
End If

' Launch Electron - hidden console (0 = SW_HIDE)
WshShell.Run "cmd /c npx electron .", 0, False
