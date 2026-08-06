module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.31"

  # Fargate profiles need the private route (via NAT) to already exist on
  # their subnets before EKS will accept them as valid Fargate subnets.
  depends_on = [aws_route_table_association.private]

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version

  cluster_endpoint_public_access = true

  vpc_id     = data.aws_vpc.default.id
  subnet_ids = data.aws_subnets.default.ids

  enable_cluster_creator_admin_permissions = true

  # EC2-based managed node groups hit this account's EC2 "Running On-Demand
  # Standard instances" vCPU quota (1 vCPU, already exhausted by other
  # running instances on this account). Fargate profiles run pods on
  # AWS-managed compute outside that EC2 quota entirely, so the cluster can
  # come up without requesting an AWS quota increase.
  fargate_profiles = {
    amacc = {
      subnet_ids = [for s in aws_subnet.private : s.id]
      selectors = [
        { namespace = "amacc" }
      ]
    }
    kube_system = {
      name       = "kube-system"
      subnet_ids = [for s in aws_subnet.private : s.id]
      selectors = [
        { namespace = "kube-system" }
      ]
    }
  }

  tags = {
    "app.kubernetes.io/part-of" = "amacc"
  }
}
