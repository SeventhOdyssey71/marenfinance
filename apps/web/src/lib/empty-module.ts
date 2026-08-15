/**
 * Deliberate empty stub.
 *
 * Turbopack cannot alias a module to `false` the way webpack can, so optional
 * dependencies that no browser code path in Maren can reach are pointed here
 * instead. See the `turbopack.resolveAlias` block in `next.config.ts` for which
 * ones and why.
 *
 * If something ever genuinely imports one of these at runtime it will get an
 * empty object and fail loudly at the call site, which is the correct outcome —
 * far better than a multi-screen webpack trace on every compile.
 */
export default {};
