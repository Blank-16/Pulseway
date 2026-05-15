variable "environment" { type = string }
variable "cidr_block" { type = string }

locals {
  azs             = ["${data.aws_region.current.name}a", "${data.aws_region.current.name}b", "${data.aws_region.current.name}c"]
  public_cidrs    = [cidrsubnet(var.cidr_block, 4, 0), cidrsubnet(var.cidr_block, 4, 1), cidrsubnet(var.cidr_block, 4, 2)]
  private_cidrs   = [cidrsubnet(var.cidr_block, 4, 4), cidrsubnet(var.cidr_block, 4, 5), cidrsubnet(var.cidr_block, 4, 6)]
  isolated_cidrs  = [cidrsubnet(var.cidr_block, 4, 8), cidrsubnet(var.cidr_block, 4, 9), cidrsubnet(var.cidr_block, 4, 10)]
}

data "aws_region" "current" {}

resource "aws_vpc" "main" {
  cidr_block           = var.cidr_block
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = { Name = "pulseway-${var.environment}" }
}

resource "aws_subnet" "public" {
  count                   = 3
  vpc_id                  = aws_vpc.main.id
  cidr_block              = local.public_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true
  tags = { Name = "pulseway-${var.environment}-public-${count.index + 1}", Tier = "public" }
}

resource "aws_subnet" "private" {
  count             = 3
  vpc_id            = aws_vpc.main.id
  cidr_block        = local.private_cidrs[count.index]
  availability_zone = local.azs[count.index]
  tags = { Name = "pulseway-${var.environment}-private-${count.index + 1}", Tier = "private" }
}

resource "aws_subnet" "isolated" {
  count             = 3
  vpc_id            = aws_vpc.main.id
  cidr_block        = local.isolated_cidrs[count.index]
  availability_zone = local.azs[count.index]
  tags = { Name = "pulseway-${var.environment}-isolated-${count.index + 1}", Tier = "isolated" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "pulseway-${var.environment}" }
}

resource "aws_eip" "nat" {
  count  = 3
  domain = "vpc"
  tags   = { Name = "pulseway-${var.environment}-nat-${count.index + 1}" }
}

resource "aws_nat_gateway" "main" {
  count         = 3
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = { Name = "pulseway-${var.environment}-${count.index + 1}" }
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "pulseway-${var.environment}-public" }
}

resource "aws_route_table_association" "public" {
  count          = 3
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count  = 3
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[count.index].id
  }
  tags = { Name = "pulseway-${var.environment}-private-${count.index + 1}" }
}

resource "aws_route_table_association" "private" {
  count          = 3
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

output "vpc_id"             { value = aws_vpc.main.id }
output "public_subnet_ids"  { value = aws_subnet.public[*].id }
output "private_subnet_ids" { value = aws_subnet.private[*].id }
output "isolated_subnet_ids"{ value = aws_subnet.isolated[*].id }
