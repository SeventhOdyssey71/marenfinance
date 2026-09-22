import { describe, expect, it } from 'vitest';
import { decodeFunctionResult, encodeFunctionData, toEventSelector, type AbiEvent } from 'viem';

import { marenVaultAbi, MAREN_EARN_EVENTS, MAREN_PAY_EVENTS, MAREN_VAULT_EVENTS } from './abis';

it('reads the accounted reserve independently of the vault token balance', () => {
  expect(encodeFunctionData({ abi: marenVaultAbi, functionName: 'reserveMUSD' })).toHaveLength(10);
  expect(
    decodeFunctionResult({
      abi: marenVaultAbi,
      functionName: 'reserveMUSD',
      data: `0x${'0'.repeat(62)}64`,
    }),
  ).toBe(100n);
});

/**
 * Event topics, pinned to the hashes the DEPLOYED contracts actually emit.
 *
 * WHY THIS FILE EXISTS. `eth_getLogs` matches on topic0, and topic0 is the keccak hash of
 * an event's FULL signature. That makes an event ABI unlike a function ABI in one cruel
 * respect: a wrong function selector fails loudly at the RPC, while a wrong event signature
 * fails SILENTLY and successfully. The filter is valid, the node answers, and the answer is
 * an empty array. Activity then renders "you have done nothing yet" over a real history.
 *
 * That is not hypothetical. Until 2026-08-19 `MAREN_PAY_EVENTS` declared `PaidToHandle`
 * with a sixth parameter, `string memo`, that `MarenPay.sol:107` does not have. It hashed
 * to 0x310129e9..., the chain emits 0xf0db1b29..., and every payment made to an `@handle`
 * was invisible in both apps. Nothing errored. Nothing logged. The only way to catch that
 * class of bug is to compare against the chain, which is what the constants below are.
 *
 * PROVENANCE. Each hash was verified on Mezo matsnet on 2026-08-19 by locating it in the
 * runtime bytecode of the deployed contract, so these are the topics the contract will
 * actually push, not a re-derivation of the same TypeScript this file is testing:
 *
 *   MarenPay   0xe475Ff919D54E055809f516E3bed8a5c7a101836
 *   MarenVault 0x46252B00AB59384518d9dB6D1f210ffF1221645b
 *
 *   cast keccak "PaidToHandle(bytes32,address,address,uint256,string)"
 *   cast code <contract> --rpc-url https://rpc.test.mezo.org | grep -i <hash without 0x>
 *
 * A failure here means one of two things, and they are not the same. Either an ABI was
 * edited away from the contract, which is a bug in this package; or a contract was
 * redeployed with a changed event, in which case the ABI AND the constant below both move
 * together, and every historical log written under the old topic needs a migration plan.
 * Do not "fix" a failure by copying the computed value in without deciding which it is.
 */

/** topic0 as read out of the deployed bytecode. Not derived from the ABIs under test. */
const ONCHAIN_TOPICS: Record<string, `0x${string}`> = {
  // MarenPay. `PaidToHandle` is the one that was wrong; the other four are the controls
  // that proved the extraction method sound before the mismatch was believed.
  Paid: '0x6a0fd984445e83c60cff7396568759fd390973afc48438db90000ea9750a35cc',
  PaidToHandle: '0xf0db1b294d6bbc31336b73cb68f72c857041a71d934da23f335b2aa2d56a38fd',
  RequestCreated: '0xfab7026c201703a6ce65999fa587d7f23b07a13c3f7f6c86456e6195e37f3c16',
  LinkCreated: '0xdf15c4cbacfc2b31e63a6e5d69d4bf8e4a7e43b4009022229982cc0ac28b5327',
  LinkClaimed: '0x2cd3d26e11c801b616a3c5ceef5e98251bc4bb198a074a1c6d292f1580ab804d',
};

describe('MarenPay event topics match the deployed contract', () => {
  for (const [name, topic] of Object.entries(ONCHAIN_TOPICS)) {
    it(`${name} hashes to the topic0 the chain emits`, () => {
      const event = MAREN_PAY_EVENTS.find((e) => e.name === name);
      expect(event, `${name} is missing from MAREN_PAY_EVENTS`).toBeDefined();
      expect(toEventSelector(event as AbiEvent)).toBe(topic);
    });
  }

  it('declares PaidToHandle with exactly the five parameters MarenPay.sol emits', () => {
    // Stated separately from the hash so a failure says WHAT is wrong, not just that two
    // hex strings differ. The trailing `string handle` is the only unindexed string.
    const event = MAREN_PAY_EVENTS.find((e) => e.name === 'PaidToHandle') as AbiEvent;
    expect(event.inputs.map((i) => `${i.type}${i.indexed ? ' indexed' : ''}`)).toEqual([
      'bytes32 indexed',
      'address indexed',
      'address indexed',
      'uint256',
      'string',
    ]);
  });
});

describe('every log-reading event is well formed', () => {
  const all = [...MAREN_VAULT_EVENTS, ...MAREN_PAY_EVENTS, ...MAREN_EARN_EVENTS];

  it('has a distinct topic0 per event, so no filter can match two of them', () => {
    const topics = all.map((e) => toEventSelector(e as AbiEvent));
    expect(new Set(topics).size).toBe(topics.length);
  });

  it('never indexes more than the three topics the EVM allows an anonymous-free event', () => {
    for (const event of all) {
      const indexed = (event as AbiEvent).inputs.filter((i) => i.indexed).length;
      expect(indexed, `${event.name} indexes ${indexed} parameters`).toBeLessThanOrEqual(3);
    }
  });
});
