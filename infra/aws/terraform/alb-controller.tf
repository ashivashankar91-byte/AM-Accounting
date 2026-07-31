# IAM role for the AWS Load Balancer Controller, using IRSA (IAM Roles for
# Service Accounts) against the cluster's OIDC provider. Required because
# Fargate pods have no EC2 instance for a NodePort/instance-mode LoadBalancer
# to target -- only the ALB controller's "ip" target-type mode works with
# Fargate, and it needs its own AWS permissions via a service-account role.

data "http" "alb_controller_iam_policy" {
  url = "https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v3.4.3/docs/install/iam_policy.json"
}

resource "aws_iam_policy" "alb_controller" {
  name   = "amacc-aws-load-balancer-controller"
  policy = data.http.alb_controller_iam_policy.response_body
}

data "aws_iam_policy_document" "alb_controller_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    condition {
      test     = "StringEquals"
      variable = "${replace(module.eks.oidc_provider, "https://", "")}:sub"
      values   = ["system:serviceaccount:kube-system:aws-load-balancer-controller"]
    }
    condition {
      test     = "StringEquals"
      variable = "${replace(module.eks.oidc_provider, "https://", "")}:aud"
      values   = ["sts.amazonaws.com"]
    }

    principals {
      type        = "Federated"
      identifiers = [module.eks.oidc_provider_arn]
    }
  }
}

resource "aws_iam_role" "alb_controller" {
  name               = "amacc-aws-load-balancer-controller"
  assume_role_policy = data.aws_iam_policy_document.alb_controller_assume_role.json
}

resource "aws_iam_role_policy_attachment" "alb_controller" {
  role       = aws_iam_role.alb_controller.name
  policy_arn = aws_iam_policy.alb_controller.arn
}

output "alb_controller_role_arn" {
  value = aws_iam_role.alb_controller.arn
}
