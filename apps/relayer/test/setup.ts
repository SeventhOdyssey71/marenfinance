/**
 * Every test builds its own environment object explicitly. A developer who has
 * a real `RELAYER_PRIVATE_KEY` exported in their shell must not be able to make
 * the fail-closed test pass by accident — that test asserts the behaviour of an
 * EMPTY environment, so the environment has to actually be empty.
 */
/**
 * Preserved BEFORE the scrub below, because it is a CI signal rather than
 * relayer configuration: when the environment names a Mezo RPC, the chain
 * integration tests are expected to run, and an unavailable anvil must fail
 * rather than skip. Stripping it first is how that check was silently disarmed.
 */
if (
  process.env['MEZO_TESTNET_RPC_URL']?.trim() ||
  process.env['MEZO_MAINNET_RPC_URL']?.trim() ||
  process.env['MAREN_REQUIRE_CHAIN_TESTS']?.trim()
) {
  process.env['MAREN_REQUIRE_CHAIN_TESTS'] = '1';
}

for (const key of Object.keys(process.env)) {
  if (key.startsWith('RELAYER_') || key.startsWith('MEZO_') || key.startsWith('UPSTASH_')) {
    delete process.env[key];
  }
}
process.env['LOG_LEVEL'] = 'silent';
