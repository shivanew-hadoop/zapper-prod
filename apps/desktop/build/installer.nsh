; Zapper installer additions (electron-builder nsis.include).
; Lets Chrome and Edge open the Zapper desktop app from zapperapp.in WITHOUT the
; "Open Zapper?" confirmation, so Create Session starts the host join automatically.
; Scope: only the zapper:// protocol, only from the Zapper website origins, current user only.
; Removed again on uninstall.
!macro customInstall
  WriteRegStr HKCU "Software\Policies\Google\Chrome\AutoLaunchProtocolsFromOrigins" "7201" '{"allowed_origins":["https://zapperapp.in","https://www.zapperapp.in"],"protocol":"zapper"}'
  WriteRegStr HKCU "Software\Policies\Microsoft\Edge\AutoLaunchProtocolsFromOrigins" "7201" '{"allowed_origins":["https://zapperapp.in","https://www.zapperapp.in"],"protocol":"zapper"}'
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Policies\Google\Chrome\AutoLaunchProtocolsFromOrigins" "7201"
  DeleteRegValue HKCU "Software\Policies\Microsoft\Edge\AutoLaunchProtocolsFromOrigins" "7201"
!macroend
