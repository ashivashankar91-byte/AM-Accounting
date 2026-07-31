#!/usr/bin/env bash
# Builds and pushes all AMACC service images (+ web frontend) to ECR.
# Must be run from the repository root. Requires: docker, aws cli configured,
# and the ECR repositories already created via infra/aws/terraform.
set -euo pipefail

AWS_REGION="ap-south-1"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

SERVICES=(
  auth-service tenant-service gl-service eom-service payroll-service
  apar-service recon-service fs-service coa-service cashflow-service
  notification-service audit-service connector-service approval-service
  onboarding-service webhook-service document-service group-service
  agent-gl agent-eom agent-payroll agent-apar agent-t1
  user-service query-service analytics-service orchestrator-service
  compliance-service
)

echo "Logging in to ECR: ${REGISTRY}"
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${REGISTRY}"

build_and_push() {
  local name="$1" dockerfile="$2"
  local tag="${REGISTRY}/amacc/${name}:latest"
  echo "=== Building ${name} ==="
  docker build --platform linux/amd64 -f "${dockerfile}" -t "${tag}" .
  echo "=== Pushing ${name} ==="
  docker push "${tag}"
}

build_and_push "web" "apps/web/Dockerfile"
build_and_push "migrator" "infra/migrator/Dockerfile"

for svc in "${SERVICES[@]}"; do
  build_and_push "${svc}" "services/${svc}/Dockerfile"
done

echo "All images built and pushed."
