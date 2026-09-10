// Test-only module: sets OLLAMA_BASE_URL before `./router` (and its
// providers/ollama dependency) is evaluated, so ollama hops can be
// instantiated in tests regardless of the host environment. Import this
// FIRST in a test file. Providers are constructed lazily — no network
// call happens until a model is actually invoked.
process.env.OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/";
