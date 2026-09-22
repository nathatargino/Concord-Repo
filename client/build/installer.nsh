; NSIS Customization Script for Concord
; Ensures the "Publisher" registry key is correctly written to HKLM/HKCU Uninstall entries
; to comply with Microsoft Store certification requirement 10.2.7 (Product Removal / Publisher name)

!ifndef COMPANY_NAME
  !define COMPANY_NAME "Nathã S Targino"
!endif

!macro customInstall
  DetailPrint "Registering Publisher in Windows Uninstall keys: Nathã S Targino"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "Publisher" "Nathã S Targino"
!macroend
