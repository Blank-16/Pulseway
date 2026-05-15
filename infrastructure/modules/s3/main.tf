variable "environment" { type = string }

resource "aws_s3_bucket" "assets" {
  bucket = "pulseway-${var.environment}-assets"
  tags   = { Name = "pulseway-${var.environment}-assets" }
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

output "assets_bucket_id"     { value = aws_s3_bucket.assets.id }
output "assets_bucket_arn"    { value = aws_s3_bucket.assets.arn }
output "assets_bucket_domain" { value = aws_s3_bucket.assets.bucket_regional_domain_name }
