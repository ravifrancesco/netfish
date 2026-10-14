; The Netfish for Windows installer (made by build.sh with NSIS).
; Installs for the current person only (no administrator rights needed) into
; %LOCALAPPDATA%\Programs\Netfish, with Start menu and desktop shortcuts.

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

Name "Netfish"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Netfish"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Netfish ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Netfish"
VIAddVersionKey "FileDescription" "Netfish installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "Netfish"
VIAddVersionKey "LegalCopyright" "Netfish"

!define MUI_ICON "build/Netfish.ico"
!define MUI_UNICON "build/Netfish.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Netfish.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open Netfish"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "Netfish needs 64-bit Windows 10 or 11." /SD IDOK
    Abort
  ${EndIf}
FunctionEnd

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Netfish"

; Netfish has to be closed before its files can be replaced.
!macro CloseNetfish
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq Netfish.exe" /NH | find /I "Netfish.exe"'
  Pop $0 ; 0: it's running
  Pop $1
  ${If} $0 == 0
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Netfish is open. It will be closed to continue." /SD IDOK IDOK +2
    Abort
    nsExec::Exec 'taskkill /IM Netfish.exe'
    Pop $0
    Sleep 1500
    nsExec::Exec 'taskkill /F /IM Netfish.exe'
    Pop $0
  ${EndIf}
!macroend

Section "Netfish"
  !insertmacro CloseNetfish
  SetOutPath "$INSTDIR"
  File /r "build/publish/*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Netfish.lnk" "$INSTDIR\Netfish.exe"
  CreateShortcut "$DESKTOP\Netfish.lnk" "$INSTDIR\Netfish.exe"

  ; Listed in Settings → Apps, so it can be removed like any app.
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Netfish"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Netfish"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\Netfish.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  !insertmacro CloseNetfish
  Delete "$SMPROGRAMS\Netfish.lnk"
  Delete "$DESKTOP\Netfish.lnk"
  RMDir /r "$LOCALAPPDATA\Programs\Netfish"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  ; Downloads and settings (%LOCALAPPDATA%\Netfish) stay unless asked.
  MessageBox MB_YESNO|MB_ICONQUESTION "Also delete the movies and episodes downloaded in Netfish, and its settings?" /SD IDNO IDNO keep
  RMDir /r "$LOCALAPPDATA\Netfish"
  keep:
SectionEnd
