param(
  [string]$ClusterName = "nau-l7"
)

$ErrorActionPreference = "Stop"
$labRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $labRoot

function Resolve-Program([string]$Name, [string]$Fallback) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  if ($Fallback -and (Test-Path -LiteralPath $Fallback)) { return $Fallback }
  throw "Missing $Name. Install it before deploying."
}

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Program failed with exit code $LASTEXITCODE"
  }
}

$kind = Resolve-Program "kind" (Join-Path $env:LOCALAPPDATA "Programs\kind\kind.exe")
$helm = Resolve-Program "helm" (Join-Path $env:LOCALAPPDATA "Programs\Helm\windows-amd64\helm.exe")
$docker = Resolve-Program "docker" ""
$kubectl = Resolve-Program "kubectl" ""

$envFile = Join-Path $labRoot ".env"
if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Copy .env.example to .env and set POSTGRES_PASSWORD first."
}
$passwordLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^POSTGRES_PASSWORD=' } | Select-Object -Last 1
if (-not $passwordLine) { throw "POSTGRES_PASSWORD is missing from .env" }
$password = $passwordLine.Substring("POSTGRES_PASSWORD=".Length)
if (-not $password) { throw "POSTGRES_PASSWORD cannot be empty" }

Invoke-Checked $docker @("info", "--format", "{{.ServerVersion}}")
$clusters = & $kind get clusters
if ($LASTEXITCODE -ne 0) { throw "Cannot query kind clusters" }
if ($clusters -contains $ClusterName) {
  throw "Kind cluster '$ClusterName' already exists. Reuse it manually or choose another ClusterName."
}

Invoke-Checked $kind @("create", "cluster", "--name", $ClusterName, "--config", "kind/cilium-config.yaml")
Invoke-Checked $kubectl @("config", "use-context", "kind-$ClusterName")
# Pull on the node before Cilium starts; avoid concurrent kubelet pulls on small Windows hosts.
Write-Host "Downloading Cilium image into kind node (this can take several minutes)..."
$imageReady = $false
for ($attempt = 1; $attempt -le 3; $attempt++) {
  & $docker exec "$ClusterName-control-plane" ctr --namespace=k8s.io images pull `
    --platform linux/amd64 quay.io/cilium/cilium:v1.20.2 1>$null
  if ($LASTEXITCODE -eq 0) { $imageReady = $true; break }
  Write-Warning "Cilium image download attempt $attempt failed."
  Start-Sleep -Seconds 10
}
if (-not $imageReady) { throw "Cilium image pull inside kind node failed three times" }
Invoke-Checked $helm @("repo", "add", "cilium", "https://helm.cilium.io/", "--force-update")
Invoke-Checked $helm @("repo", "update", "cilium")
Invoke-Checked $helm @("install", "cilium", "cilium/cilium", "--version", "1.20.2",
  "--namespace", "kube-system", "--set", "ipam.mode=kubernetes",
  "--set", "operator.replicas=1", "--set", "l7Proxy=true",
  "--set", "image.pullPolicy=IfNotPresent", "--wait", "--timeout", "10m")
Invoke-Checked $kubectl @("-n", "kube-system", "rollout", "status", "daemonset/cilium", "--timeout=600s")
Invoke-Checked $kubectl @("wait", "--for=condition=Ready", "nodes", "--all", "--timeout=600s")

Invoke-Checked $kubectl @("apply", "-f", "k8s/namespaces.yaml")
Invoke-Checked $kubectl @("apply", "-f", "k8s/policies.yaml")
Invoke-Checked $kubectl @("apply", "-f", "k8s/cilium-l7.yaml")
Invoke-Checked $kubectl @("-n", "nau-lab", "create", "secret", "generic", "db-credentials", "--from-literal=password=$password")
Invoke-Checked $kubectl @("-n", "nau-lab", "create", "configmap", "db-init", "--from-file=init.sql=db/init.sql")

Invoke-Checked $docker @("build", "-t", "nau-segmentation-api:1.0.0", "./api")
Invoke-Checked $docker @("build", "-t", "nau-segmentation-web:1.0.0", "./web")
Invoke-Checked $docker @("build", "-t", "nau-segmentation-probe:1.0.0", "./probe")
Invoke-Checked $kind @("load", "docker-image", "nau-segmentation-api:1.0.0", "--name", $ClusterName)
Invoke-Checked $kind @("load", "docker-image", "nau-segmentation-web:1.0.0", "--name", $ClusterName)
Invoke-Checked $kind @("load", "docker-image", "nau-segmentation-probe:1.0.0", "--name", $ClusterName)
Invoke-Checked $kubectl @("apply", "-f", "k8s/workloads.yaml")
foreach ($deployment in @("recipe-db", "recipe-api", "recipe-web")) {
  Invoke-Checked $kubectl @("-n", "nau-lab", "rollout", "status", "deployment/$deployment", "--timeout=300s")
}

Write-Host "Cilium deployment ready."
Write-Host "Run: node scripts/test-network.js cilium"
Write-Host "Run: node scripts/test-l7.js"
Write-Host "Browse: kubectl -n nau-lab port-forward svc/web 8080:80"
