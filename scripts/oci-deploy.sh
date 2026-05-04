#!/bin/bash
# AMACC — Oracle Cloud one-shot deploy script
# Paste this entire script into Oracle Cloud Shell and wait.
set -e

echo "=== AMACC Oracle Cloud Deploy ==="
echo ""

# ── 1. Set variables ─────────────────────────────────────────────────────────
COMPARTMENT_ID=$OCI_TENANCY
AD=$(oci iam availability-domain list --query 'data[0].name' --raw-output)
IMAGE_ID=$(oci compute image list --compartment-id $COMPARTMENT_ID --operating-system "Canonical Ubuntu" --operating-system-version "22.04" --shape "VM.Standard.A1.Flex" --sort-by TIMECREATED --sort-order DESC --query 'data[0].id' --raw-output)

echo "[1/9] IDs ready"
echo "  Compartment: $COMPARTMENT_ID"
echo "  AD: $AD"
echo "  Image: $IMAGE_ID"

# ── 2. Create VCN ────────────────────────────────────────────────────────────
VCN_ID=$(oci network vcn create --compartment-id $COMPARTMENT_ID --cidr-block "10.0.0.0/16" --display-name "amacc-vcn" --query 'data.id' --raw-output --wait-for-state AVAILABLE 2>/dev/null | grep -oP 'ocid1\.vcn\.[^\s"]+' || oci network vcn list --compartment-id $COMPARTMENT_ID --display-name "amacc-vcn" --query 'data[0].id' --raw-output)
echo "[2/9] VCN: $VCN_ID"

# ── 3. Create Internet Gateway ───────────────────────────────────────────────
IGW_ID=$(oci network internet-gateway create --compartment-id $COMPARTMENT_ID --vcn-id $VCN_ID --is-enabled true --display-name "amacc-igw" --query 'data.id' --raw-output 2>/dev/null || oci network internet-gateway list --compartment-id $COMPARTMENT_ID --vcn-id $VCN_ID --query 'data[0].id' --raw-output)
echo "[3/9] IGW: $IGW_ID"

# ── 4. Update Route Table ────────────────────────────────────────────────────
RT_ID=$(oci network route-table list --compartment-id $COMPARTMENT_ID --vcn-id $VCN_ID --query 'data[0].id' --raw-output)
oci network route-table update --rt-id $RT_ID --route-rules "[{\"destination\":\"0.0.0.0/0\",\"networkEntityId\":\"$IGW_ID\"}]" --force > /dev/null 2>&1
echo "[4/9] Route table updated"

# ── 5. Create Subnet ─────────────────────────────────────────────────────────
SUBNET_ID=$(oci network subnet create --compartment-id $COMPARTMENT_ID --vcn-id $VCN_ID --cidr-block "10.0.1.0/24" --display-name "amacc-subnet" --query 'data.id' --raw-output 2>/dev/null || oci network subnet list --compartment-id $COMPARTMENT_ID --vcn-id $VCN_ID --query 'data[0].id' --raw-output)
echo "[5/9] Subnet: $SUBNET_ID"

# ── 6. Open firewall ports ───────────────────────────────────────────────────
SL_ID=$(oci network security-list list --compartment-id $COMPARTMENT_ID --vcn-id $VCN_ID --query 'data[0].id' --raw-output)
oci network security-list update --security-list-id $SL_ID --ingress-security-rules '[{"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},{"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},{"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":5174,"max":5174}}},{"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":8080,"max":8080}}},{"source":"0.0.0.0/0","protocol":"1","isStateless":false}]' --force > /dev/null 2>&1
echo "[6/9] Firewall ports opened (22, 80, 5174, 8080)"

# ── 7. Generate SSH key ──────────────────────────────────────────────────────
if [ ! -f ~/.ssh/amacc-key ]; then
  ssh-keygen -t rsa -b 2048 -f ~/.ssh/amacc-key -N "" -q
fi
echo "[7/9] SSH key ready"

# ── 8. Launch VM (4 OCPU, 24GB RAM — Always Free) ────────────────────────────
INSTANCE_ID=$(oci compute instance launch \
  --compartment-id $COMPARTMENT_ID \
  --availability-domain "$AD" \
  --shape "VM.Standard.A1.Flex" \
  --shape-config '{"ocpus":4,"memoryInGBs":24}' \
  --image-id $IMAGE_ID \
  --subnet-id $SUBNET_ID \
  --assign-public-ip true \
  --display-name "amacc-hub" \
  --ssh-authorized-keys-file ~/.ssh/amacc-key.pub \
  --query 'data.id' --raw-output)

echo "[8/9] Instance launching: $INSTANCE_ID"
echo "  Waiting for RUNNING state (1-2 min)..."

# Wait for instance to be running
while true; do
  STATE=$(oci compute instance get --instance-id $INSTANCE_ID --query 'data."lifecycle-state"' --raw-output)
  if [ "$STATE" = "RUNNING" ]; then break; fi
  echo "  State: $STATE ..."
  sleep 10
done

# ── 9. Get public IP ─────────────────────────────────────────────────────────
sleep 15
PUBLIC_IP=$(oci compute instance list-vnics --instance-id $INSTANCE_ID --query 'data[0]."public-ip"' --raw-output)
echo "[9/9] Instance RUNNING!"
echo ""
echo "=========================================="
echo "  Public IP: $PUBLIC_IP"
echo "  SSH:  ssh -i ~/.ssh/amacc-key ubuntu@$PUBLIC_IP"
echo "=========================================="
echo ""
echo "Waiting 30s for SSH to be ready..."
sleep 30

# ── 10. Deploy AMACC on the VM ───────────────────────────────────────────────
echo "Deploying AMACC..."
ssh -o StrictHostKeyChecking=no -i ~/.ssh/amacc-key ubuntu@$PUBLIC_IP << 'REMOTE'
set -e

echo ">>> Installing Docker..."
sudo apt-get update -qq
sudo apt-get install -y -qq docker.io docker-compose-v2 git nodejs npm > /dev/null 2>&1
sudo systemctl enable docker && sudo systemctl start docker
sudo usermod -aG docker ubuntu

echo ">>> Creating AMACC project..."
mkdir -p ~/amacc
cd ~/amacc

# Create docker-compose directly (no git clone needed)
cat > docker-compose.yml << 'COMPOSE'
x-service-env: &service-env
  DATABASE_URL: postgresql://amacc:amacc_dev@postgres:5432/amacc
  RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672
  REDIS_URL: redis://redis:6379
  NODE_ENV: development

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: amacc
      POSTGRES_PASSWORD: amacc_dev
      POSTGRES_DB: amacc
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U amacc"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  rabbitmq:
    image: rabbitmq:3-management-alpine
    ports: ["5672:5672", "15672:15672"]
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "check_running"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
COMPOSE

echo ">>> Starting infrastructure (postgres, redis, rabbitmq)..."
sudo docker compose up -d
echo ">>> Waiting for postgres to be healthy..."
until sudo docker compose exec -T postgres pg_isready -U amacc > /dev/null 2>&1; do sleep 2; done
echo ">>> Infrastructure ready!"

echo ""
echo "============================================"
echo "  AMACC infrastructure deployed!"
echo "  Postgres: running on :5432"
echo "  Redis:    running on :6379"
echo "  RabbitMQ: running on :5672 (mgmt: :15672)"
echo "============================================"
REMOTE

echo ""
echo "============================================================"
echo "  AMACC Oracle Cloud deployment complete!"
echo ""
echo "  VM IP:      $PUBLIC_IP"
echo "  SSH:        ssh -i ~/.ssh/amacc-key ubuntu@$PUBLIC_IP"
echo ""
echo "  Next: push your full docker-compose + services with:"
echo "    scp -i ~/.ssh/amacc-key -r ./amacc ubuntu@$PUBLIC_IP:~/"
echo "============================================================"
