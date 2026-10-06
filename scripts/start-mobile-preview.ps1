$ErrorActionPreference = 'Stop'
$taskProject = Split-Path -Parent $PSScriptRoot
$taskSdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$taskAdb = Join-Path $taskSdk 'platform-tools/adb.exe'
$taskEmulator = Join-Path $taskSdk 'emulator/emulator.exe'
if (!(Test-Path -LiteralPath $taskAdb) -or !(Test-Path -LiteralPath $taskEmulator)) { throw 'Install Android SDK tools before starting the mobile preview.' }
$env:ANDROID_HOME = $taskSdk
$env:ANDROID_SDK_ROOT = $taskSdk
$env:EXPO_NO_TELEMETRY = '1'
# ADB reverse connects to IPv4 loopback. Node must resolve localhost the same way.
$env:NODE_OPTIONS = '--dns-result-order=ipv4first'
$taskDevices = & $taskAdb devices
if (!($taskDevices -match '^emulator-\d+\s+device$')) {
  Start-Process -FilePath $taskEmulator -ArgumentList @('-avd', 'Recharge_Pixel', '-gpu', 'auto', '-memory', '4096', '-no-audio', '-no-boot-anim') -WindowStyle Normal
  & $taskAdb wait-for-device
  $taskDeadline = (Get-Date).AddMinutes(5)
  while ((& $taskAdb shell getprop sys.boot_completed).Trim() -ne '1') {
    if ((Get-Date) -gt $taskDeadline) { throw 'The emulator did not finish starting. Check the emulator window and try again.' }
    Start-Sleep -Seconds 2
  }
}
Push-Location (Join-Path $taskProject 'mobile')
try { & npx.cmd expo start --localhost --android --port 8081 } finally { Pop-Location }
