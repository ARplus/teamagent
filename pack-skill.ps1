$srcDir = "D:\Projects\teamagent\skills\teamagent-client-skill-v2\teamagent-client-skill"
$tmpDir = Join-Path $env:TEMP "ta-zip-build"
$targetDir = Join-Path $tmpDir "teamagent-client-skill"
$zipDest = "D:\Projects\teamagent\public\downloads\teamagent-client-skill.zip"

# Clean
if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

# Copy skill files into teamagent-client-skill/ subfolder
Copy-Item -Path "$srcDir\*" -Destination $targetDir -Recurse -Force

# Pack
Remove-Item $zipDest -ErrorAction SilentlyContinue
Compress-Archive -Path $targetDir -DestinationPath $zipDest -Force
Copy-Item $zipDest "D:\Projects\teamagent\public\static\teamagent-client-skill.zip" -Force

# Verify
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipDest)
$zip.Entries | Select-Object -First 10 FullName
$zip.Dispose()

# Cleanup
Remove-Item $tmpDir -Recurse -Force
Write-Host "ZIP size:" (Get-Item $zipDest).Length "bytes"
