import { z } from "zod";

// Skip zod's `new Function` capability probe: under our production CSP (no 'unsafe-eval') browsers report it as a
// policy violation even though zod catches it. Validation behaves the same without the JIT.
z.config({ jitless: true });

export { z };
