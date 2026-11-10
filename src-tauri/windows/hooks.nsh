; Additions to Tauri's installer for Tributary (bundle.windows.nsis.installerHooks).

; Uninstalling opens Tributary's own uninstall window (tributary-uninstall.exe, the setup
; without the installers in it, installed with the app by the release build), which runs
; uninstall.exe silently. Tools that uninstall without a window keep uninstall.exe itself.
!macro NSIS_HOOK_POSTINSTALL
  ${If} ${FileExists} "$INSTDIR\tributary-uninstall.exe"
    WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\tributary-uninstall.exe$\""
    WriteRegStr SHCTX "${UNINSTKEY}" "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"
  ${EndIf}
!macroend
