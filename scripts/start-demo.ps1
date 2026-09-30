param([switch]$Deploy)
$ErrorActionPreference = 'Stop'
$projectDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectDir
$deploymentConfig = Get-Content -LiteralPath 'vercel.json' -Raw | ConvertFrom-Json
if (($deploymentConfig.rewrites | Where-Object source -eq '/api/:path*').destination -eq '/api') {
  throw 'This checkout uses the cloud API. Do not replace it with a local tunnel. See docs/CLOUD-DEPLOYMENT.md; use npm run start:local for a local review.'
}
if (!(Test-Path -LiteralPath '.env')) { throw 'Configure .env first. See README.md.' }
New-Item -ItemType Directory -Force -Path 'data' | Out-Null
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$cloudflared = Join-Path $projectDir 'data/tools/cloudflared.exe'
if (!(Test-Path -LiteralPath $cloudflared)) { throw 'Install the official cloudflared binary at data/tools/cloudflared.exe first.' }
try { $healthy = (Invoke-RestMethod 'http://127.0.0.1:3001/api/health' -TimeoutSec 3).ok } catch { $healthy = $false }
if (!$healthy) {
  $backend = Start-Process -FilePath $nodeExe -ArgumentList '--import','tsx','server/index.ts' -WorkingDirectory $projectDir -WindowStyle Hidden -PassThru -RedirectStandardOutput 'data/backend.log' -RedirectStandardError 'data/backend-error.log'
  $backend.Id | Set-Content -LiteralPath 'data/backend.pid'
}
$tunnel = Start-Process -FilePath $cloudflared -ArgumentList 'tunnel','--url','http://127.0.0.1:3001','--no-autoupdate' -WorkingDirectory $projectDir -WindowStyle Hidden -PassThru -RedirectStandardOutput 'data/tunnel.log' -RedirectStandardError 'data/tunnel-error.log'
$tunnel.Id | Set-Content -LiteralPath 'data/tunnel.pid'
$tunnelUrl = $null
for ($attempt=0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Seconds 1
  if (Test-Path -LiteralPath 'data/tunnel-error.log') {
    $match = [regex]::Match((Get-Content -LiteralPath 'data/tunnel-error.log' -Raw), 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($match.Success) { $tunnelUrl=$match.Value; break }
  }
}
if (!$tunnelUrl) { throw 'Tunnel URL not ready. Check data/tunnel-error.log.' }
$config = Get-Content -LiteralPath 'vercel.json' -Raw | ConvertFrom-Json
$apiRule = $config.rewrites | Where-Object source -eq '/api/:path*'
$apiRule.destination = "$tunnelUrl/api/:path*"
$config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath 'vercel.json' -Encoding utf8
Write-Output "Backend tunnel: $tunnelUrl"
Write-Output 'Keep this machine and Ollama running. Private configuration remains in .env.'
if ($Deploy) { npm exec --yes --package vercel -- vercel --prod --yes --scope olympusxvns-projects }
else { Write-Output 'Run npm exec --yes --package vercel -- vercel --prod --yes --scope olympusxvns-projects to update the API destination on Vercel.' }
