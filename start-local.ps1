# AMACC Local Development Startup Script
# Starts Docker infrastructure + all backend services natively + frontend
# Usage: .\start-local.ps1  OR  npm run dev

$ErrorActionPreference = "Continue"
$scriptDir = $PSScriptRoot

# ─── Load .env ───────────────────────────────────────────────────────────────
$envFile = Join-Path $scriptDir ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $key = $Matches[1].Trim()
            $val = $Matches[2].Trim()
            [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
        }
    }
    Write-Host "  Loaded .env" -ForegroundColor Gray
}

# Allow override from shell env (compatible with PowerShell 5.1+)
if (-not $env:DATABASE_URL)     { $env:DATABASE_URL     = "postgresql://amacc:amacc_dev@localhost:5433/amacc" }
if (-not $env:RABBITMQ_URL)     { $env:RABBITMQ_URL     = "amqp://guest:guest@localhost:5672" }
if (-not $env:REDIS_URL)        { $env:REDIS_URL        = "redis://localhost:6380" }
if (-not $env:NODE_ENV)         { $env:NODE_ENV         = "development" }
if (-not $env:JWT_SECRET)       { $env:JWT_SECRET       = "dev-jwt-secret-change-in-production-min16" }
$env:AMACC_JWT_SECRET = $env:JWT_SECRET
if (-not $env:JWT_ISSUER)       { $env:JWT_ISSUER       = "amacc" }
if (-not $env:ADMIN_API_KEY)    { $env:ADMIN_API_KEY    = "amacc-admin-dev-key" }
if (-not $env:ANTHROPIC_API_KEY){ $env:ANTHROPIC_API_KEY = "sk-ant-placeholder" }

# Inter-service URLs (for agents that call other services)
$env:GL_SERVICE_URL       = "http://localhost:3010"
$env:EOM_SERVICE_URL      = "http://localhost:3011"
$env:PAYROLL_SERVICE_URL  = "http://localhost:3012"
$env:APAR_SERVICE_URL     = "http://localhost:3013"
$env:RECON_SERVICE_URL    = "http://localhost:3014"
$env:FS_SERVICE_URL       = "http://localhost:3015"
$env:APPROVAL_SERVICE_URL = "http://localhost:3033"

# ─── Step 1: Ensure Docker infrastructure is running ─────────────────────────
Write-Host ""
Write-Host "=== Step 1: Docker Infrastructure ===" -ForegroundColor Cyan

$infraContainers = @("amacc-postgres-1", "amacc-redis-1", "amacc-rabbitmq-1")
$needInfra = $false
foreach ($c in $infraContainers) {
    $status = docker inspect -f '{{.State.Running}}' $c 2>$null
    if ($status -ne "true") { $needInfra = $true; break }
}

if ($needInfra) {
    Write-Host "  Starting postgres, redis, rabbitmq..." -ForegroundColor Yellow
    docker compose -f (Join-Path $scriptDir "docker-compose.yml") up -d postgres redis rabbitmq
    Write-Host "  Waiting for infrastructure to be healthy..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
} else {
    Write-Host "  postgres, redis, rabbitmq already running" -ForegroundColor Green
}

# ─── Step 2: Detect services already running in Docker ───────────────────────
$dockerPorts = @()
$dockerServices = docker ps --format "{{.Names}} {{.Ports}}" 2>$null | Where-Object { $_ -match "^amacc-" -and $_ -notmatch "postgres|redis|rabbitmq" }
foreach ($line in $dockerServices) {
    if ($line -match ":(\d{4})->") {
        $dockerPorts += [int]$Matches[1]
    }
}
if ($dockerPorts.Count -gt 0) {
    Write-Host "  Docker services already on ports: $($dockerPorts -join ', ')" -ForegroundColor Gray
}

# ─── Step 3: Start backend services natively ─────────────────────────────────
Write-Host ""
Write-Host "=== Step 2: Backend Services ===" -ForegroundColor Cyan

$services = @(
    @{ Name = "auth-service";         Port = 3001 },
    @{ Name = "tenant-service";       Port = 3002 },
    @{ Name = "gl-service";           Port = 3010 },
    @{ Name = "eom-service";          Port = 3011 },
    @{ Name = "payroll-service";      Port = 3012 },
    @{ Name = "apar-service";         Port = 3013 },
    @{ Name = "recon-service";        Port = 3014 },
    @{ Name = "fs-service";           Port = 3015 },
    @{ Name = "coa-service";          Port = 3016 },
    @{ Name = "agent-gl";             Port = 3020 },
    @{ Name = "agent-eom";            Port = 3021 },
    @{ Name = "agent-payroll";        Port = 3022 },
    @{ Name = "agent-apar";           Port = 3023 },
    @{ Name = "agent-t1";             Port = 3024 },
    @{ Name = "notification-service"; Port = 3030 },
    @{ Name = "audit-service";        Port = 3031 },
    @{ Name = "connector-service";    Port = 3032 },
    @{ Name = "approval-service";     Port = 3033 },
    @{ Name = "onboarding-service";   Port = 3035 },
    @{ Name = "webhook-service";      Port = 3036 },
    @{ Name = "cashflow-service";     Port = 3037 },
    @{ Name = "document-service";     Port = 3038 },
    @{ Name = "group-service";        Port = 3039 },
    @{ Name = "user-service";         Port = 3040 },
    @{ Name = "data-quality-service"; Port = 3041 },
    @{ Name = "esg-service";          Port = 3042 },
    @{ Name = "compliance-service";   Port = 3043 },
    @{ Name = "revenue-service";      Port = 3044 },
    @{ Name = "query-service";        Port = 3045 },
    @{ Name = "analytics-service";    Port = 3046 },
    @{ Name = "ml-service";           Port = 3047 },
    @{ Name = "orchestrator-service"; Port = 3048 }
)

$jobs = @()
$started = 0
$skipped = 0

foreach ($svc in $services) {
    $svcDir = Join-Path (Join-Path $scriptDir "services") $svc.Name
    $indexFile = Join-Path (Join-Path $svcDir "src") "index.ts"

    # Skip if no source file
    if (-not (Test-Path $indexFile)) {
        continue
    }

    # Skip if already running in Docker
    if ($dockerPorts -contains $svc.Port) {
        Write-Host "  DOCKER $($svc.Name) :$($svc.Port)" -ForegroundColor DarkGray
        $skipped++
        continue
    }

    $port = $svc.Port
    $name = $svc.Name

    $job = Start-Job -Name $name -ScriptBlock {
        param($dir, $port, $dbUrl, $rabbitUrl, $redisUrl, $jwtSecret, $adminKey, $anthropicKey,
              $glUrl, $eomUrl, $payrollUrl, $aparUrl, $reconUrl, $fsUrl, $approvalUrl)
        $env:DATABASE_URL       = $dbUrl
        $env:RABBITMQ_URL       = $rabbitUrl
        $env:REDIS_URL          = $redisUrl
        $env:NODE_ENV           = "development"
        $env:AMACC_JWT_SECRET   = $jwtSecret
        $env:JWT_SECRET         = $jwtSecret
        $env:JWT_ISSUER         = "amacc"
        $env:ADMIN_API_KEY      = $adminKey
        $env:ANTHROPIC_API_KEY  = $anthropicKey
        $env:PORT               = $port
        $env:GL_SERVICE_URL     = $glUrl
        $env:EOM_SERVICE_URL    = $eomUrl
        $env:PAYROLL_SERVICE_URL = $payrollUrl
        $env:APAR_SERVICE_URL   = $aparUrl
        $env:RECON_SERVICE_URL  = $reconUrl
        $env:FS_SERVICE_URL     = $fsUrl
        $env:APPROVAL_SERVICE_URL = $approvalUrl
        Set-Location $dir
        & npx tsx src/index.ts 2>&1
    } -ArgumentList $svcDir, $port, $env:DATABASE_URL, $env:RABBITMQ_URL, $env:REDIS_URL, `
        $env:JWT_SECRET, $env:ADMIN_API_KEY, $env:ANTHROPIC_API_KEY, `
        $env:GL_SERVICE_URL, $env:EOM_SERVICE_URL, $env:PAYROLL_SERVICE_URL, `
        $env:APAR_SERVICE_URL, $env:RECON_SERVICE_URL, $env:FS_SERVICE_URL, $env:APPROVAL_SERVICE_URL

    $jobs += $job
    Write-Host "  START  $name :$port" -ForegroundColor Green
    $started++
}

Write-Host ""
Write-Host "  $started native + $skipped Docker services" -ForegroundColor White

# ─── Step 3: Start Frontend ──────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Step 3: Frontend ===" -ForegroundColor Cyan
$webDir = Join-Path (Join-Path $scriptDir "apps") "web"
$webJob = Start-Job -Name "web" -ScriptBlock {
    param($dir)
    Set-Location $dir
    & npx vite --host 2>&1
} -ArgumentList $webDir
$jobs += $webJob
Write-Host "  START  web :5174" -ForegroundColor Green

# ─── Ready ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AMACC is running!" -ForegroundColor White
Write-Host "  UI:       http://localhost:5174/amacc/" -ForegroundColor White
Write-Host "  RabbitMQ: http://localhost:15672/" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Commands:" -ForegroundColor Yellow
Write-Host "  Ctrl+C                          Stop all services" -ForegroundColor Gray
Write-Host "  Receive-Job -Name gl-service    View logs for a service" -ForegroundColor Gray
Write-Host "  Get-Job                         List all service jobs" -ForegroundColor Gray
Write-Host ""

# ─── Monitor loop ────────────────────────────────────────────────────────────
try {
    while ($true) {
        Start-Sleep -Seconds 30
        $running = Get-Job | Where-Object { $_.State -eq 'Running' } | Measure-Object | Select-Object -ExpandProperty Count
        $failed  = Get-Job | Where-Object { $_.State -eq 'Failed' }  | Select-Object -ExpandProperty Name
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Running: $running services" -ForegroundColor Gray
        if ($failed) {
            Write-Host "  Failed: $($failed -join ', ')" -ForegroundColor Red
        }
    }
} finally {
    Write-Host "`nStopping all services..." -ForegroundColor Yellow
    Get-Job | Stop-Job
    Get-Job | Remove-Job
    Write-Host "All services stopped." -ForegroundColor Green
}
