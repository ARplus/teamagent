$src = "D:\Projects\teamagent\skills\teamagent-client-skill"
$tmp = "D:\Projects\teamagent\tmp-zip-v131\teamagent-client-skill"
$zip = "D:\Projects\teamagent\teamagent-client-skill-v131.zip"
if (Test-Path "D:\Projects\teamagent\tmp-zip-v131") { Remove-Item -Recurse -Force "D:\Projects\teamagent\tmp-zip-v131" }
if (Test-Path $zip) { Remove-Item -Force $zip }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Get-ChildItem "$src\*" -File | Copy-Item -Destination $tmp
Compress-Archive -Path "D:\Projects\teamagent\tmp-zip-v131\teamagent-client-skill" -DestinationPath $zip
Write-Host "ZIP: $zip"
(Get-Item $zip).Length
