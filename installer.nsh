; MerosKassa Custom NSIS Installer Script
; This script preserves the data folder during uninstall

!macro customInstall
  ; Ensure data directory exists
  CreateDirectory "$INSTDIR\data"
!macroend

!macro customUninstall
  ; Remove everything except the data folder
  ; The data folder contains user's database and should be preserved
  RMDir /r "$INSTDIR\resources"
  Delete "$INSTDIR\MerosKassa.exe"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.exe"
  ; Keep $INSTDIR\data folder intact for next installation
!macroend
