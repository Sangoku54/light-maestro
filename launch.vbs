Set WshShell = CreateObject("WScript.Shell")

' Get the script directory
scriptDir = WshShell.CurrentDirectory

' Change to the script directory
WshShell.CurrentDirectory = scriptDir

' Run the launch batch silently (0 = hidden window, False = don't wait)
WshShell.Run "cmd /c launch.bat", 0, False
