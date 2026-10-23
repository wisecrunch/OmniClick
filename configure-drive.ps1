param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[\w-]+\.apps\.googleusercontent\.com$')]
  [string]$ClientId
)
$omniManifestPath = Join-Path $PSScriptRoot 'manifest.json'
$omniManifestData = Get-Content -LiteralPath $omniManifestPath -Raw | ConvertFrom-Json
if ($omniManifestData.name -ne 'OmniClick') { throw 'This is not the OmniClick manifest.' }
$omniOAuth = @{ client_id = $ClientId; scopes = @('https://www.googleapis.com/auth/drive.file') }
$omniManifestData | Add-Member -NotePropertyName oauth2 -NotePropertyValue $omniOAuth -Force
$omniManifestData | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $omniManifestPath -Encoding utf8
Write-Output 'OAuth client ID configured. Reload OmniClick at chrome://extensions, then open Google Drive sync in its popup.'
