variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "ap-south-1"
}

variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
  default     = "amacc"
}

variable "cluster_version" {
  description = "Kubernetes version for EKS"
  type        = string
  default     = "1.31"
}

variable "node_instance_type" {
  description = "EC2 instance type for the EKS managed node group"
  type        = string
  default     = "t3.large"
}

variable "node_desired_size" {
  type    = number
  default = 3
}

variable "node_min_size" {
  type    = number
  default = 2
}

variable "node_max_size" {
  type    = number
  default = 4
}

# Custom services with their own Dockerfile under services/<name> that get
# built and pushed to ECR. Excludes archived services (esg, revenue, ml,
# data-quality — see archived-services/README.md) which have no active
# source under services/ and are not part of the Wave 5+ deployment set.
variable "service_images" {
  description = "List of ECR repository names for AMACC custom-built images"
  type        = list(string)
  default = [
    "web",
    "auth-service",
    "tenant-service",
    "gl-service",
    "eom-service",
    "payroll-service",
    "apar-service",
    "recon-service",
    "fs-service",
    "coa-service",
    "cashflow-service",
    "notification-service",
    "audit-service",
    "connector-service",
    "approval-service",
    "onboarding-service",
    "webhook-service",
    "document-service",
    "group-service",
    "agent-gl",
    "agent-eom",
    "agent-payroll",
    "agent-apar",
    "agent-t1",
    "user-service",
    "query-service",
    "analytics-service",
    "orchestrator-service",
    "compliance-service",
    "migrator",
  ]
}
