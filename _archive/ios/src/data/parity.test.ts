import { describe, expect, it } from 'vitest';

import * as live from './live';
import * as mock from './mock';
import * as source from './source';

/**
 * The swap promise, enforced by CI rather than by a comment.
 *
 * `mock.ts` has said since it was written: "Every function here has the signature its
 * viem replacement will have... Swapping to live data means replacing the bodies in this
 * file with contract reads, and nothing else." That sentence was true when it was
 * written and would have quietly stopped being true the first time somebody added an
 * argument to one side, which is exactly the kind of drift a promise in a comment cannot
 * survive.
 *
 * So it is asserted. If the two modules ever stop exporting the same functions with the
 * same arities, this fails, and `source.ts` cannot switch between them at run time
 * without a caller noticing. That is the entire point: the switch is only safe while the
 * two are interchangeable, so the thing that makes it safe is checked.
 *
 * WHAT IS COMPARED AND WHAT IS NOT. Functions, by name and by `Function.length`.
 * Non-function exports are excluded, and deliberately: `mock.ts` also exports the demo
 * cast and their invented ledger (`MOCK_ADDRESS`, `MOCK_HANDLE`, `MOCK_ACTIVITY`), and
 * requiring `live.ts` to export an equivalent would mean requiring the live module to
 * invent something. The rule is about the CALLABLE surface, which is what callers bind
 * to.
 *
 * A note on `Function.length`: it counts parameters before the first default or rest,
 * which is what makes it the right measure here. A live implementation that quietly
 * added a required context parameter would change it and fail; one that added an
 * optional argument would not, and would still be callable everywhere the mock is.
 */

type Surface = Record<string, unknown>;

function functionArities(module: Surface): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(module)) {
    if (typeof value === 'function') out[name] = value.length;
  }
  return out;
}

/** The `mutate` object's methods, flattened as `mutate.borrow` and so on. */
function mutateArities(module: Surface): Record<string, number> {
  const mutate = module.mutate;
  if (typeof mutate !== 'object' || mutate === null) return {};
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(mutate as Surface)) {
    if (typeof value === 'function') out[`mutate.${name}`] = value.length;
  }
  return out;
}

function callableSurface(module: Surface): Record<string, number> {
  return { ...functionArities(module), ...mutateArities(module) };
}

describe('live.ts and mock.ts are interchangeable', () => {
  const liveSurface = callableSurface(live as Surface);
  const mockSurface = callableSurface(mock as Surface);

  it('exports the same function names', () => {
    expect(Object.keys(liveSurface).sort()).toEqual(Object.keys(mockSurface).sort());
  });

  it('exports those functions with the same arities', () => {
    expect(liveSurface).toEqual(mockSurface);
  });

  /**
   * The reads take no arguments, and that is the load-bearing half of the promise.
   *
   * It would have been easy to write `live.readPosition(ctx)` and update every call site,
   * which is what the web app does. Doing it here would have meant the swap changed
   * something outside these two files, so the account and the network are carried in
   * `data/context.ts` instead. This is the assertion that keeps that decision from being
   * undone by accident.
   */
  it('keeps the account-scoped reads argument-free', () => {
    for (const name of ['readPrice', 'readPosition', 'readBalances', 'readEarn', 'readActivity']) {
      expect(`${name}/${liveSurface[name]}`).toBe(`${name}/0`);
    }
  });

  /** The switch can only forward what both sides have. */
  it('is fully covered by the data-source switch', () => {
    const switched = callableSurface(source as Surface);
    for (const name of Object.keys(mockSurface)) {
      expect(switched).toHaveProperty(name);
    }
  });
});

describe('the data source defaults to live', () => {
  /**
   * The single most important line in this file.
   *
   * A mock that is off by default is a development tool. A mock that is on by default is
   * how an app ends up rendering invented transaction hashes as working explorer links,
   * which is what the web app deleted its own mock over. The default is asserted so it
   * cannot be flipped for a demo and left flipped.
   */
  it('reads the chain unless somebody deliberately turns that off', () => {
    expect(source.getDataSource()).toBe('live');
    expect(source.isDemoData()).toBe(false);
  });

  it('reports demo data honestly when it is selected', () => {
    source.setDataSource('mock');
    expect(source.isDemoData()).toBe(true);
    source.setDataSource('live');
    expect(source.isDemoData()).toBe(false);
  });
});
