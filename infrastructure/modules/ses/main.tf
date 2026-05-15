variable "environment" { type = string }
variable "domain"      { type = string }

resource "aws_ses_domain_identity" "main" {
  domain = var.domain
}

resource "aws_ses_domain_dkim" "main" {
  domain = aws_ses_domain_identity.main.domain
}

resource "aws_ses_domain_mail_from" "main" {
  domain           = aws_ses_domain_identity.main.domain
  mail_from_domain = "mail.${var.domain}"
}

output "dkim_tokens"          { value = aws_ses_domain_dkim.main.dkim_tokens }
output "verification_token"   { value = aws_ses_domain_identity.main.verification_token }
