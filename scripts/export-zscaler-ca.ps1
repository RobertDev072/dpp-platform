# Exporteert Zscaler's root-CA-certificaat naar PEM zodat Node.js (via
# NODE_EXTRA_CA_CERTS) TLS-verkeer door de Zscaler-proxy kan vertrouwen.
# Alleen nodig op ontwikkelmachines achter Zscaler; raakt productie niet.
$certs = @(
  Get-ChildItem Cert:\CurrentUser\Root, Cert:\LocalMachine\Root -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -match 'Zscaler' } |
    Sort-Object Thumbprint -Unique
)

if ($certs.Count -eq 0) {
  Write-Output 'GEEN Zscaler-certificaat gevonden'
  exit 1
}

$lines = @()
foreach ($c in $certs) {
  $b64 = [Convert]::ToBase64String($c.RawData, 'InsertLineBreaks')
  $lines += '-----BEGIN CERTIFICATE-----'
  $lines += $b64
  $lines += '-----END CERTIFICATE-----'
  Write-Output ('gevonden: ' + $c.Subject)
}

$target = Join-Path $env:USERPROFILE 'zscaler-root-ca.pem'
Set-Content -Path $target -Value ($lines -join "`n") -Encoding ascii
Write-Output ('PEM geschreven naar ' + $target)
