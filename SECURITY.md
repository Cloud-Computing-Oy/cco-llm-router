# Security policy

## Supported versions

Security fixes are applied to the latest release. Pin an exact release tag or
commit and review release notes before upgrading.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or exposed secret.
Use GitHub's private vulnerability reporting for this repository:

1. Open the repository **Security** tab.
2. Select **Report a vulnerability**.
3. Include affected versions, impact, reproduction steps, and a minimal proof
   of concept that contains no real credentials or customer data.

We aim to acknowledge a report within five business days. We will coordinate
validation, remediation, disclosure, and credit with the reporter.

## Security boundaries

- This library reads provider credentials from the caller's environment. It
  never provisions, rotates, or stores API keys.
- Local cost tracking is a best-effort safety net, not a billing authority or
  distributed hard limit. Configure hard budgets with each provider.
- Data classification is supplied by the caller. The router cannot determine
  whether a prompt contains personal, confidential, regulated, or restricted
  information.
- Experimental providers require explicit code-level opt-in. They must not be
  added to general fallback chains without a privacy and contractual review.
- A direct provider selector obeys the local budget guard unless the caller
  explicitly approves `bypassBudget` / `bypass_budget`.

Never include credentials, production prompts, customer data, or usage-state
files in a vulnerability report.
