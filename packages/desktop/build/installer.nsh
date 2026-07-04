; llama-addon.node (from @node-llama-cpp/win-x64) is MSVC-compiled and needs the VC++
; Redistributable at runtime, which a clean Windows machine doesn't have — that surfaces
; as a confusing NoBinaryFoundError instead of a clear "missing DLL" message. Bundle and
; silently install it here. vc_redist.x64.exe self-elevates and is a fast no-op if the
; runtime is already present, so this is safe to run unconditionally on every install.
!macro customInstall
  File /oname=$PLUGINSDIR\vc_redist.x64.exe "${BUILD_RESOURCES_DIR}\vc_redist.x64.exe"
  ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart'
!macroend
