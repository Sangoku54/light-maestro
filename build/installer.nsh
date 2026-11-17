; Light Maestro — script NSIS d'installation (personnalisation electron-builder)
;
; OBJECTIF : le serveur Remote LAN (TCP 8080) doit être joignable depuis le
; téléphone/tablette. Sans règle "Allow" entrante, Windows Firewall bloque les
; connexions → le scan du QR code n'affiche qu'une page web VIDE sur le
; téléphone (constaté : règle "Block" créée quand l'utilisateur a refusé
; l'invite Windows).
;
; On ajoute donc la règle à l'installation, et on la retire à la désinstallation.
;
; Documentation electron-builder : `nsis.include` (macros customInstall /
; customUnInstall).

!macro customInstall
  ; Autorise l'exécutable installé (chemin réel : $INSTDIR\Light Maestro.exe).
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Light Maestro (Remote LAN)" dir=in action=allow program="$INSTDIR\Light Maestro.exe" protocol=TCP localport=8080 profile=any enable=yes'
!macroend

!macro customUnInstall
  ; Nettoyage de la règle à la désinstallation.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Light Maestro (Remote LAN)"'
!macroend
