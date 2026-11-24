; Additions to Tauri's installer for Tributary (bundle.windows.nsis.installerHooks).

; One of Explorer's Open in Tributary entries, at `KEY`.
!macro TributaryExplorerMenu KEY
  WriteRegStr SHCTX "${KEY}" "" "Open in Tributary"
  WriteRegStr SHCTX "${KEY}" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "${KEY}\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%V$\""
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Uninstalling opens Tributary's own uninstall window (tributary-uninstall.exe, the setup
  ; without the installers in it, installed with the app by the release build), which runs
  ; uninstall.exe silently. Tools that uninstall without a window keep uninstall.exe itself.
  ${If} ${FileExists} "$INSTDIR\tributary-uninstall.exe"
    WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\tributary-uninstall.exe$\""
    WriteRegStr SHCTX "${UNINSTKEY}" "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"
  ${EndIf}

  ; The Start menu shortcut, which Windows search finds Tributary by. The setup runs the
  ; installer with /NS, so that the desktop shortcut is its own choice, but /NS skips the
  ; Start menu shortcut too, and updates skip it always. So it's made here, as the installer
  ; makes it, whenever it's missing: updates add it for anyone installed without one. The
  ; uninstaller removes it.
  ${IfNot} ${FileExists} "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  ${EndIf}

  ; Open in Tributary, in Explorer: on a folder's menu, and on the menu of the space inside an
  ; open folder (its background). Each starts Tributary with the folder (%V), which opens it,
  ; or hands it to the Tributary already running (src-tauri/src/open_folder.rs). For you, or
  ; for everyone on the PC, as Tributary was installed (SHCTX). Updates write them again, so
  ; anyone who installed Tributary before has them after the next update.
  !insertmacro TributaryExplorerMenu "Software\Classes\Directory\shell\Tributary"
  !insertmacro TributaryExplorerMenu "Software\Classes\Directory\Background\shell\Tributary"

  ; Until 0.19 the installer named its publisher `github` (from Tributary's identifier), and
  ; kept the install folder under Software\github\Tributary. It's Software\Bogdan Roatis\Tributary
  ; now, so the old key goes. Only Tributary's own key: Software\github may hold other programs'.
  DeleteRegKey SHCTX "Software\github\Tributary"
  DeleteRegKey HKCU "Software\github\Tributary"

  ; Tell Windows that programs' icons may have changed (SHCNE_ASSOCCHANGED, SHCNF_FLUSH), so
  ; that a new icon shows without waiting for Windows to notice.
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Explorer's Open in Tributary entries go with Tributary.
  DeleteRegKey SHCTX "Software\Classes\Directory\shell\Tributary"
  DeleteRegKey SHCTX "Software\Classes\Directory\Background\shell\Tributary"
!macroend
