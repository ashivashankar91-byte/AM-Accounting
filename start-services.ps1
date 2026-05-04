# AMACC — Start all local services
# Run from amacc/ directory; infrastructure (postgres, redis, rabbitmq) must be running in Docker

$base = "C:\Projects\jira-bulk-export\amacc"
$env:DATABASE_URL = "postgresql://amacc:amacc_dev@localhost:5433/amacc"
$env:RABBITMQ_URL = "amqp://guest:guest@localhost:5672"
$env:REDIS_URL = "redis://localhost:6380"
$env:NODE_ENV = "development"
$env:AMACC_JWT_SECRET = "dev-jwt-secret-change-in-production-min16"
$env:JWT_SECRET = "dev-jwt-secret-change-in-production-min16"
$env:ADMIN_API_KEY = "amacc-admin-dev-key"
$env:ANTHROPIC_API_KEY = $env:ANTHROPIC_API_KEY ?? "sk-ant-placeholder"
$env:GL_SERVICE_URL = "http://localhost:3010"
$env:EOM_SERVICE_URL = "http://localhost:3011"
$env:PAYROLL_SERVICE_URL = "http://localhost:3012"
$env:APAR_SERVICE_URL = "http://localhost:3013"
$env:RECON_SERVICE_URL = "http://localhost:3014"
$env:FS_SERVICE_URL = "http://localhost:3015"
$env:APPROVAL_SERVICE_URL = "http://localhost:3033"

$services = @(
    @("auth-service", 3001),
    @("tenant-service", 3002),
    @("gl-service", 3010),
    @("eom-service", 3011),
    @("payroll-service", 3012),
    @("apar-service", 3013),
    @("recon-service", 3014),
    @("fs-service", 3015),
    @("coa-service", 3016),
    @("agent-gl", 3020),
    @("agent-eom", 3021),
    @("agent-payroll", 3022),
    @("agent-apar", 3023),
    @("agent-t1", 3024),
    @("notification-service", 3030),
    @("audit-service", 3031),
    @("connector-service", 3032),
    @("approval-service", 3033),
    @("onboarding-service", 3035),
    @("webhook-service", 3036),
    @("cashflow-service", 3037),
    @("document-service", 3038),
    @("group-service", 3039),
    @("query-service", 3045),
    @("analytics-service", 3046),
    @("ml-service", 3047),
    @("orchestrator-service", 3048)
)

foreach ($svc in $services) {
    $name = $svc[0]
    $port = $svc[1]
    $dir = "$base\services\$name"
    if (Test-Path "$dir\src\index.ts") {
        $env:PORT = $port
        Start-Process -NoNewWindow -FilePath "npx" -ArgumentList "tsx","src/index.ts" -WorkingDirectory $dir -RedirectStandardOutput "NUL" -RedirectStandardError "NUL"
        Write-Host "  Started $name :$port" -ForegroundColor Green
    }
}

Write-Host "`nAll services started. Frontend at http://localhost:5174/amacc/" -ForegroundColor Cyan
