/**
 * Every test builds its own environment object explicitly. A developer who has
 * a real `RELAYER_PRIVATE_KEY` exported in their shell must not be able to make
 * the fail-closed test pass by accident — that test asserts the behaviour of an
 * EMPTY environment, so the environment has to actually be empty.
 */
for (const key of Object.keys(process.env)) {
  if (key.startsWith('RELAYER_') || key.startsWith('MEZO_') || key.startsWith('UPSTASH_')) {
    delete process.env[key];
  }
}
process.env['LOG_LEVEL'] = 'silent';
