param(
  [string]$ClusterName = "nau-segmentation",
  [switch]$ReuseExisting
)

$ErrorActionPreference = "Stop"
$labRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $labRoot

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Program failed with exit code $LASTEXITCODE"
  }
}

foreach ($program in @("docker", "kind", "kubectl")) {
  if (-not (Get-Command $program -ErrorAction SilentlyContinue)) {
    throw "Missing $program. Install Docker Desktop, kind and kubectl before deploying."
  }
}

$envFile = Join-Path $labRoot ".env"
if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Copy .env.example to .env and set POSTGRES_PASSWORD first."
}
$passwordLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^POSTGRES_PASSWORD=' } | Select-Object -Last 1
if (-not $passwordLine) { throw "POSTGRES_PASSWORD is missing from .env" }
$password = $passwordLine.Substring("POSTGRES_PASSWORD=".Length)
if (-not $password) { throw "POSTGRES_PASSWORD cannot be empty" }

$clusters = & kind get clusters
if ($LASTEXITCODE -ne 0) { throw "Cannot query kind clusters" }
if ($clusters -contains $ClusterName) {
  if (-not $ReuseExisting) {
    throw "Kind cluster '$ClusterName' already exists. Run this script with -ReuseExisting to check and use the existing deployment without deleting data."
  }
  Invoke-Checked "kind" @("export", "kubeconfig", "--name", $ClusterName)
  Invoke-Checked "kubectl" @("config", "use-context", "kind-$ClusterName")
  Invoke-Checked "kubectl" @("--context", "kind-$ClusterName", "-n", "kube-system", "rollout", "status", "daemonset/calico-node", "--timeout=300s")
  Invoke-Checked "kubectl" @("--context", "kind-$ClusterName", "wait", "--for=condition=Ready", "nodes", "--all", "--timeout=300s")
  foreach ($deployment in @("recipe-db", "recipe-api", "recipe-web")) {
    Invoke-Checked "kubectl" @("--context", "kind-$ClusterName", "-n", "nau-lab", "rollout", "status", "deployment/$deployment", "--timeout=300s")
  }
  Write-Host "Existing deployment ready. No images, resources or database data were changed."
  Write-Host "Run: node scripts/test-network.js k8s"
  Write-Host "To browse: kubectl --context kind-$ClusterName -n nau-lab port-forward svc/web 8080:80"
  return
}
if ($ReuseExisting) { throw "Cluster '$ClusterName' does not exist. Run without -ReuseExisting to create it." }

Invoke-Checked "kind" @("create", "cluster", "--name", $ClusterName, "--config", "kind/config.yaml")
Invoke-Checked "kubectl" @("config", "use-context", "kind-$ClusterName")

$calicoManifest = "https://raw.githubusercontent.com/projectcalico/calico/v3.33.0/manifests/calico.yaml"
$calicoText = (Invoke-WebRequest -Uri $calicoManifest -UseBasicParsing -TimeoutSec 60).Content.Replace([string]([char]13 + [char]10), [string][char]10)
$needle = '            # - name: CALICO_IPV4POOL_CIDR' + [char]10 + '            #   value: "192.168.0.0/16"'
$replacement = '            - name: CALICO_IPV4POOL_CIDR' + [char]10 + '              value: "10.244.0.0/16"'
if (-not $calicoText.Contains($needle)) {
  throw "Pinned Calico manifest no longer matches the expected IP pool stanza."
}
$calicoText = $calicoText.Replace($needle, $replacement)
$evidenceDir = Join-Path $labRoot "evidence"
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
$calicoFile = Join-Path $evidenceDir "calico-v3.33.0-10.244.yaml"
[System.IO.File]::WriteAllText($calicoFile, $calicoText, [System.Text.UTF8Encoding]::new($false))
Invoke-Checked "kubectl" @("create", "-f", $calicoFile)
Invoke-Checked "kubectl" @("-n", "kube-system", "rollout", "status", "daemonset/calico-node", "--timeout=300s")
Invoke-Checked "kubectl" @("wait", "--for=condition=Ready", "nodes", "--all", "--timeout=300s")

Invoke-Checked "kubectl" @("apply", "-f", "k8s/namespaces.yaml")
Invoke-Checked "kubectl" @("apply", "-f", "k8s/policies.yaml")
Invoke-Checked "kubectl" @("apply", "-f", "k8s/calico-web-api.yaml")
Invoke-Checked "kubectl" @("-n", "nau-lab", "create", "secret", "generic", "db-credentials", "--from-literal=password=$password")
Invoke-Checked "kubectl" @("-n", "nau-lab", "create", "configmap", "db-init", "--from-file=init.sql=db/init.sql")

Invoke-Checked "docker" @("build", "-t", "nau-segmentation-api:1.0.0", "./api")
Invoke-Checked "docker" @("build", "-t", "nau-segmentation-web:1.0.0", "./web")
Invoke-Checked "docker" @("build", "-t", "nau-segmentation-probe:1.0.0", "./probe")
Invoke-Checked "kind" @("load", "docker-image", "nau-segmentation-api:1.0.0", "--name", $ClusterName)
Invoke-Checked "kind" @("load", "docker-image", "nau-segmentation-web:1.0.0", "--name", $ClusterName)
Invoke-Checked "kind" @("load", "docker-image", "nau-segmentation-probe:1.0.0", "--name", $ClusterName)

Invoke-Checked "kubectl" @("apply", "-f", "k8s/workloads.yaml")
foreach ($deployment in @("recipe-db", "recipe-api", "recipe-web")) {
  Invoke-Checked "kubectl" @("-n", "nau-lab", "rollout", "status", "deployment/$deployment", "--timeout=300s")
}

Write-Host "Deployment ready. Run: node scripts/test-network.js k8s"
Write-Host "To browse the site: kubectl -n nau-lab port-forward svc/web 8080:80"
