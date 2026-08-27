# Standards for Open Model Family Catalog

- Provider credentials remain environment-only and must never be logged.
- New providers use OpenAI Chat Completions explicitly when compatible;
  Responses API is used only after provider-specific verification.
- Paid models with unknown prices are excluded from automatic aliases.
- Catalog entries distinguish API availability from weight-distribution terms.
- Direct model selection remains possible when the provider is configured,
  subject to budget and data-class controls.
- TypeScript and Python provider identifiers, prices, and default aliases stay
  synchronized.
- Model lifecycle and official IDs are verified from primary vendor sources.
- Every automatic catalog entry has capability and pricing tests.
