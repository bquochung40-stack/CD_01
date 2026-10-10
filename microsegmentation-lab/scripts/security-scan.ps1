$ErrorActionPreference = "Stop"
$labRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $labRoot
$evidenceDir = Join-Path $labRoot "evidence"
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null

$npmCommand = if ($env:OS -eq "Windows_NT") { "npm.cmd" } else { "npm" }
if (-not (Get-Command $npmCommand -ErrorAction SilentlyContinue)) {
  throw "Node.js/npm is required."
}
& $npmCommand --prefix api audit --omit=dev --json | Out-File -LiteralPath (Join-Path $evidenceDir "npm-audit.json") -Encoding utf8
$npmExitCode = $LASTEXITCODE

if (-not (Get-Command trivy -ErrorAction SilentlyContinue)) {
  Write-Host "Trivy is not installed; image scan pending. Install from https://trivy.dev/latest/getting-started/installation/"
  exit 2
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker is required to build the images before scanning."
}

& docker build --quiet -t nau-segmentation-api:1.0.0 ./api
if ($LASTEXITCODE -ne 0) { throw "API image build failed" }
& docker build --quiet -t nau-segmentation-web:1.0.0 ./web
if ($LASTEXITCODE -ne 0) { throw "Web image build failed" }

$scanTargets = @(
  @{ Name = "api"; Image = "nau-segmentation-api:1.0.0" },
  @{ Name = "web"; Image = "nau-segmentation-web:1.0.0" },
  @{ Name = "db"; Image = "postgres:16-alpine" }
)
$scanSummary = @()
foreach ($target in $scanTargets) {
  $reportFile = Join-Path $evidenceDir ("trivy-" + $target.Name + ".json")
  & trivy image --quiet --scanners vuln --severity HIGH,CRITICAL --format json --output $reportFile $target.Image
  if ($LASTEXITCODE -ne 0) { throw "Trivy scan failed for $($target.Image)" }
  $report = Get-Content -LiteralPath $reportFile -Raw | ConvertFrom-Json
  $findings = @($report.Results | ForEach-Object { $_.Vulnerabilities } | Where-Object { $_ })
  $high = @($findings | Where-Object { $_.Severity -eq "HIGH" }).Count
  $critical = @($findings | Where-Object { $_.Severity -eq "CRITICAL" }).Count
  $scanSummary += [pscustomobject]@{ image = $target.Image; high = $high; critical = $critical; report = "trivy-$($target.Name).json" }
  Write-Host "$($target.Image): HIGH=$high CRITICAL=$critical"
}

$summary = [pscustomobject]@{
  timestamp = (Get-Date).ToUniversalTime().ToString("o")
  npmAuditExitCode = $npmExitCode
  images = $scanSummary
}
$summary | ConvertTo-Json -Depth 5 | Out-File -LiteralPath (Join-Path $evidenceDir "security-summary.json") -Encoding utf8
if ($npmExitCode -ne 0 -or @($scanSummary | Where-Object { $_.high -gt 0 -or $_.critical -gt 0 }).Count -gt 0) {
  throw "Scan completed with findings. Review evidence/security-summary.json and Trivy JSON reports."
}
Write-Host "Source dependency and image scans passed."
