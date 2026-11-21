; Additions to Tauri's installer for Tributary (bundle.windows.nsis.installerHooks).

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

  ; Tell Windows that programs' icons may have changed (SHCNE_ASSOCCHANGED, SHCNF_FLUSH), so
  ; that a new icon shows without waiting for Windows to notice.
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"
!macroend
