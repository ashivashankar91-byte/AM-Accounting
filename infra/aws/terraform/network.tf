# EKS Fargate requires its subnets to be private (egress via NAT Gateway,
# not a direct Internet Gateway route) -- the default VPC's existing subnets
# are all public, so we add a small set of private subnets + a single NAT
# Gateway purely to satisfy that requirement. One shared NAT Gateway (not
# one per AZ) is used to keep cost down; acceptable since this isn't a
# high-availability requirement for the current deployment.
resource "aws_subnet" "private" {
  for_each                = local.private_subnet_cidrs
  vpc_id                  = data.aws_vpc.default.id
  cidr_block              = each.value
  availability_zone       = each.key
  map_public_ip_on_launch = false

  tags = {
    Name                                        = "amacc-private-${each.key}"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
    "kubernetes.io/role/internal-elb"           = "1"
  }
}

locals {
  private_subnet_cidrs = {
    "ap-south-1a" = "172.31.48.0/20"
    "ap-south-1b" = "172.31.64.0/20"
    "ap-south-1c" = "172.31.80.0/20"
  }
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "amacc-nat" }
}

resource "aws_nat_gateway" "this" {
  allocation_id = aws_eip.nat.id
  subnet_id     = data.aws_subnets.default.ids[0] # existing public subnet
  tags          = { Name = "amacc-nat" }
}

resource "aws_route_table" "private" {
  vpc_id = data.aws_vpc.default.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this.id
  }
  tags = { Name = "amacc-private-rt" }
}

resource "aws_route_table_association" "private" {
  for_each       = aws_subnet.private
  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}
