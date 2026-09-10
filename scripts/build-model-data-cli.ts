import { main } from "./build-model-data";

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
