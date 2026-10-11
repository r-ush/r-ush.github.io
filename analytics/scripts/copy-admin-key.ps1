$ErrorActionPreference = 'Stop'
$keyPath = Join-Path $env:LOCALAPPDATA 'rush-analytics\admin-token.clixml'
if (!(Test-Path -LiteralPath $keyPath)) {
    throw 'No saved administrator key exists for this Windows account.'
}
$protectedKey = Import-Clixml -LiteralPath $keyPath
$credential = New-Object System.Management.Automation.PSCredential('analytics', $protectedKey)
Set-Clipboard -Value $credential.GetNetworkCredential().Password
Write-Output 'Administrator key copied. Paste it into the analytics login form.'
