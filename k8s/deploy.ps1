# AMACC Kubernetes Deployment Script
# ====================================
# Prerequisites:
#   - Docker Desktop with Kubernetes enabled, OR minikube, OR k3s
#   - kubectl configured and pointing to your cluster
#
# Free Options:
#   1. Docker Desktop K8s (Windows/Mac) — Enable in Docker Desktop > Settings > Kubernetes
#   2. minikube (any OS)                — minikube start --memory=8192 --cpus=4
#   3. k3s on Oracle Cloud free VM      — curl -sfL https://get.k3s.io | sh -
#
# Usage:
#   .\deploy.ps1              — Build images + deploy all 35 services
#   .\deploy.ps1 -SkipBuild   — Deploy only (images already built)
#   .\deploy.ps1 -Teardown    — Delete everything

param(
    [switch]$SkipBuild,
    [switch]$Teardown
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path "$ROOT\amacc")) { $ROOT = Split-Path -Parent $PSScriptRoot }

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  AMACC Kubernetes Deployment" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── Teardown ──────────────────────────────────────────────────────────────────
if ($Teardown) {
    Write-Host "[TEARDOWN] Deleting amacc namespace..." -ForegroundColor Yellow
    kubectl delete namespace amacc --ignore-not-found
    Write-Host "[DONE] Namespace deleted." -ForegroundColor Green
    exit 0
}

# ── Verify kubectl ────────────────────────────────────────────────────────────
try {
    $ctx = kubectl config current-context
    Write-Host "[1/4] kubectl context: $ctx" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] kubectl not found or no cluster configured." -ForegroundColor Red
    Write-Host "  Install Docker Desktop and enable Kubernetes, or run:" -ForegroundColor Yellow
    Write-Host "    minikube start --memory=8192 --cpus=4" -ForegroundColor Yellow
    exit 1
}

# ── Build Docker images ──────────────────────────────────────────────────────
if (-not $SkipBuild) {
    Write-Host "[2/4] Building Docker images for all services..." -ForegroundColor Cyan

    $services = @(
        # Core (8)
        @{name="gl-service";       dockerfile="services/gl-service/Dockerfile";       port=3010},
        @{name="eom-service";      dockerfile="services/eom-service/Dockerfile";      port=3011},
        @{name="payroll-service";  dockerfile="services/payroll-service/Dockerfile";  port=3012},
        @{name="apar-service";     dockerfile="services/apar-service/Dockerfile";     port=3013},
        @{name="recon-service";    dockerfile="services/recon-service/Dockerfile";    port=3014},
        @{name="fs-service";       dockerfile="services/fs-service/Dockerfile";       port=3015},
        @{name="coa-service";      dockerfile="services/coa-service/Dockerfile";      port=3016},
        @{name="cashflow-service"; dockerfile="services/cashflow-service/Dockerfile"; port=3037},
        # Agents (5)
        @{name="agent-gl";        dockerfile="services/agent-gl/Dockerfile";        port=3020},
        @{name="agent-eom";       dockerfile="services/agent-eom/Dockerfile";       port=3021},
        @{name="agent-payroll";   dockerfile="services/agent-payroll/Dockerfile";   port=3022},
        @{name="agent-apar";      dockerfile="services/agent-apar/Dockerfile";      port=3023},
        @{name="agent-t1";        dockerfile="services/agent-t1/Dockerfile";        port=3024},
        # Platform (10)
        @{name="auth-service";          dockerfile="services/auth-service/Dockerfile";          port=3001},
        @{name="tenant-service";        dockerfile="services/tenant-service/Dockerfile";        port=3002},
        @{name="notification-service";  dockerfile="services/notification-service/Dockerfile";  port=3030},
        @{name="audit-service";         dockerfile="services/audit-service/Dockerfile";         port=3031},
        @{name="connector-service";     dockerfile="services/connector-service/Dockerfile";     port=3032},
        @{name="approval-service";      dockerfile="services/approval-service/Dockerfile";      port=3033},
        @{name="onboarding-service";    dockerfile="services/onboarding-service/Dockerfile";    port=3035},
        @{name="webhook-service";       dockerfile="services/webhook-service/Dockerfile";       port=3036},
        @{name="document-service";      dockerfile="services/document-service/Dockerfile";      port=3038},
        @{name="group-service";         dockerfile="services/group-service/Dockerfile";         port=3039},
        # Extended (9)
        @{name="user-service";           dockerfile="services/user-service/Dockerfile";           port=3040},
        @{name="data-quality-service";   dockerfile="services/data-quality-service/Dockerfile";   port=3041},
        @{name="esg-service";            dockerfile="services/esg-service/Dockerfile";            port=3042},
        @{name="compliance-service";     dockerfile="services/compliance-service/Dockerfile";     port=3043},
        @{name="revenue-service";        dockerfile="services/revenue-service/Dockerfile";        port=3044},
        @{name="query-service";          dockerfile="services/query-service/Dockerfile";          port=3045},
        @{name="analytics-service";      dockerfile="services/analytics-service/Dockerfile";      port=3046},
        @{name="ml-service";             dockerfile="services/ml-service/Dockerfile";             port=3047},
        @{name="orchestrator-service";   dockerfile="services/orchestrator-service/Dockerfile";   port=3048},
        # Frontend
        @{name="web";  dockerfile="apps/web/Dockerfile"; port=5174}
    )

    $amaccDir = Join-Path $ROOT "amacc"
    $total = $services.Count
    $i = 0
    foreach ($svc in $services) {
        $i++
        $df = Join-Path $amaccDir $svc.dockerfile
        if (Test-Path $df) {
            Write-Host "  [$i/$total] Building amacc/$($svc.name)..." -ForegroundColor DarkGray
            docker build -t "amacc/$($svc.name):latest" -f $df $amaccDir 2>&1 | Out-Null
        } else {
            Write-Host "  [$i/$total] SKIP $($svc.name) — Dockerfile not found" -ForegroundColor Yellow
        }
    }
    Write-Host "  Images built." -ForegroundColor Green
} else {
    Write-Host "[2/4] Skipping image build (--SkipBuild)" -ForegroundColor Yellow
}

# ── Deploy with kustomize ────────────────────────────────────────────────────
Write-Host "[3/4] Applying Kubernetes manifests..." -ForegroundColor Cyan
$k8sDir = Join-Path (Split-Path -Parent $PSScriptRoot) "k8s"
if (-not (Test-Path $k8sDir)) { $k8sDir = $PSScriptRoot }
kubectl apply -k $k8sDir
Write-Host "  Manifests applied." -ForegroundColor Green

# ── Wait for infrastructure ──────────────────────────────────────────────────
Write-Host "[4/4] Waiting for infrastructure pods..." -ForegroundColor Cyan
kubectl wait --for=condition=ready pod -l app=postgres -n amacc --timeout=120s 2>$null
kubectl wait --for=condition=ready pod -l app=redis -n amacc --timeout=60s 2>$null
kubectl wait --for=condition=ready pod -l app=rabbitmq -n amacc --timeout=90s 2>$null
Write-Host "  Infrastructure ready." -ForegroundColor Green

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  AMACC deployed to Kubernetes!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Namespace:  amacc" -ForegroundColor White
Write-Host "  Services:   35 microservices + 3 infra + gateway + frontend" -ForegroundColor White
Write-Host ""
Write-Host "  View pods:        kubectl get pods -n amacc" -ForegroundColor Yellow
Write-Host "  View services:    kubectl get svc -n amacc" -ForegroundColor Yellow
Write-Host "  Watch rollout:    kubectl get pods -n amacc -w" -ForegroundColor Yellow
Write-Host "  View logs:        kubectl logs -n amacc deploy/gl-service" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Access the app:" -ForegroundColor White
Write-Host "    kubectl port-forward svc/web 5174:5174 -n amacc" -ForegroundColor Yellow
Write-Host "    kubectl port-forward svc/api-gateway 8081:80 -n amacc" -ForegroundColor Yellow
Write-Host "    Then open: http://localhost:5174" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Teardown:" -ForegroundColor White
Write-Host "    .\deploy.ps1 -Teardown" -ForegroundColor Yellow
