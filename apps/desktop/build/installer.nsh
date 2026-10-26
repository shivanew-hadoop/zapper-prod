; Close running Zapper instances before replacing executable files.
; This is installer/uninstaller-only and never touches user data or Google profiles.
!macro customInit
  DetailPrint "Closing running Zapper processes before installation..."
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "Zapper.exe"'
  Pop $0
  Sleep 500
!macroend

!macro customUnInit
  DetailPrint "Closing running Zapper processes before uninstallation..."
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "Zapper.exe"'
  Pop $0
  Sleep 500
!macroend
