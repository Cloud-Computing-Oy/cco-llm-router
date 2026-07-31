# Migration guide

Migrate one bounded workflow at a time. Keep the existing provider path
available until the shared router passes functional, cost, latency, and data
handling checks in the target environment.

1. Pin an exact router release.
2. Configure provider credentials outside source control.
3. Choose a stable alias or an explicit provider selector.
4. Classify request data before resolving a model.
5. Set provider-side hard budgets and optional local warning budgets.
6. Compare old and new outputs on non-sensitive test cases.
7. Record actual tokens, cost, latency, fallback behavior, and corrections.
8. Roll out gradually and retain an application-level rollback switch.

TypeScript:

```ts
import { resolveModel } from '@cloud-computing-oy/llm-router';
import { generateText } from 'ai';

const { model } = resolveModel('auto:smart', { dataClass: 'internal' });
const result = await generateText({ model, prompt });
```

Python:

```python
from cco_llm_router import resolve_model

model = resolve_model("auto:smart", data_class="internal")
text = model.call(system="Be concise", prompt="Summarize this text")
```

Do not migrate confidential or regulated workflows until every possible
provider in the selected chain is contractually and technically approved for
that data class. The router does not inspect prompt contents.
