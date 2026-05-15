variable "environment"       { type = string }
variable "s3_bucket_id"     { type = string }
variable "s3_bucket_domain" { type = string }
variable "certificate_arn"  { type = string }

resource "aws_cloudfront_origin_access_control" "assets" {
  name                              = "pulseway-${var.environment}-assets"
  description                       = "OAC for Pulseway assets bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "assets" {
  enabled         = true
  is_ipv6_enabled = true
  price_class     = "PriceClass_100"

  origin {
    domain_name              = var.s3_bucket_domain
    origin_id                = "s3-assets"
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-assets"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000
  }

  viewer_certificate {
    acm_certificate_arn      = var.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }
}

output "distribution_id"     { value = aws_cloudfront_distribution.assets.id }
output "distribution_domain" { value = aws_cloudfront_distribution.assets.domain_name }
