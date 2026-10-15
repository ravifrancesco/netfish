; The Netfish for Windows installer (made by build.sh with NSIS).
; Installs for the current person only (no administrator rights needed) into
; %LOCALAPPDATA%\Programs\Netfish, with Start menu and desktop shortcuts.
; Saved as UTF-8 with a BOM, so makensis reads the Italian text right on any system.

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"

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
!define MUI_FINISHPAGE_RUN_TEXT "$(OpenNetfish)"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; In Italian on Italian Windows, otherwise English (picked automatically).
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Italian"
LangString OpenNetfish ${LANG_ENGLISH} "Open Netfish"
LangString OpenNetfish ${LANG_ITALIAN} "Apri Netfish"
LangString Needs64Bit ${LANG_ENGLISH} "Netfish needs 64-bit Windows 10 or 11."
LangString Needs64Bit ${LANG_ITALIAN} "Netfish richiede Windows 10 o 11 a 64 bit."
LangString NetfishOpen ${LANG_ENGLISH} "Netfish is open. It will be closed to continue."
LangString NetfishOpen ${LANG_ITALIAN} "Netfish è aperto. Verrà chiuso per continuare."
LangString DeleteDownloads ${LANG_ENGLISH} "Also delete the movies and episodes downloaded in Netfish, and its settings?"
LangString DeleteDownloads ${LANG_ITALIAN} "Vuoi eliminare anche i film e gli episodi scaricati in Netfish e le sue impostazioni?"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "$(Needs64Bit)" /SD IDOK
    Abort
  ${EndIf}
FunctionEnd

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Netfish"

; Netfish has to be closed before its files can be replaced.
!macro CloseNetfish
  ; Started by Netfish as it closes (an update): give it up to 10 seconds to finish closing.
  ${If} ${Silent}
    StrCpy $2 0
    ${Do}
      nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq Netfish.exe" /NH | find /I "Netfish.exe"'
      Pop $0
      Pop $1
      ${If} $0 != 0
      ${OrIf} $2 >= 20
        ${ExitDo}
      ${EndIf}
      Sleep 500
      IntOp $2 $2 + 1
    ${Loop}
  ${EndIf}
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq Netfish.exe" /NH | find /I "Netfish.exe"'
  Pop $0 ; 0: it's running
  Pop $1
  ${If} $0 == 0
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "$(NetfishOpen)" /SD IDOK IDOK +2
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

  ; Updating from inside Netfish ("Netfish-windows.exe /S /UPDATE"): open it again when done.
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/UPDATE" $R1
  ${IfNot} ${Errors}
    Exec '"$INSTDIR\Netfish.exe"'
  ${EndIf}
SectionEnd

Section "Uninstall"
  !insertmacro CloseNetfish
  Delete "$SMPROGRAMS\Netfish.lnk"
  Delete "$DESKTOP\Netfish.lnk"
  RMDir /r "$LOCALAPPDATA\Programs\Netfish"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  ; Downloads and settings (%LOCALAPPDATA%\Netfish) stay unless asked.
  MessageBox MB_YESNO|MB_ICONQUESTION "$(DeleteDownloads)" /SD IDNO IDNO keep
  RMDir /r "$LOCALAPPDATA\Netfish"
  keep:
SectionEnd
