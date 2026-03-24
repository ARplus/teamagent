$src = "D:\Projects\teamagent\skills\teamagent-client-skill"
$tmp = "D:\Projects\teamagent\tmp-zip-v130\teamagent-client-skill"
$zip = "D:\Projects\teamagent\teamagent-client-skill-v130.zip"

if (Test-Path "D:\Projects\teamagent\tmp-zip-v130") { Remove-Item -Recurse -Force "D:\Projects\teamagent\tmp-zip-v130" }
if (Test-Path $zip) { Remove-Item -Force $zip }

New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Copy-Item "$src\SKILL.md" $tmp
Copy-Item "$src\BOOTSTRAP.md" $tmp
Copy-Item "$src\HEARTBEAT.md" $tmp
Copy-Item "$src\PROTOCOL.md" $tmp
Copy-Item "$src\SOUL.md.template" $tmp
Copy-Item "$src\gaia-decompose-SKILL.md" $tmp
Copy-Item "$src\gaia-template-exec-SKILL.md" $tmp
Copy-Item "$src\gaia-template-publish-SKILL.md" $tmp
Copy-Item "$src\agent-worker.js" $tmp
Copy-Item "$src\decompose-handler.js" $tmp
Copy-Item "$src\teamagent-client.js" $tmp

Compress-Archive -Path "D:\Projects\teamagent\tmp-zip-v130\teamagent-client-skill" -DestinationPath $zip
Write-Host "ZIP created: $zip"
Get-Item $zip | Select-Object Name, Length
