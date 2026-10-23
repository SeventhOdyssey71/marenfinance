import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { createPublicClient, defineChain } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mezoTransport } from './transport';

/**
 * A socket that never opens must not take the app down with it.
 *
 * viem only starts a request's timeout once its WebSocket is open, so a connection that
 * stalls held every read forever and the HTTP fallback behind it never ran: with the
 * socket blocked in a browser, /app sat sixty seconds with no data and no HTTP request.
 *
 * This reproduces the stall without a network: a TCP server that accepts the connection
 * and never answers the upgrade, in front of a plain JSON-RPC server. The reads must come
 * back from HTTP inside the deadline, and once the socket has missed it, the next read
 * must skip the socket outright rather than wait again.
 */

let stall: TcpServer;
let rpc: HttpServer;
const held: Socket[] = [];
let wsUrl = '';
let httpUrl = '';

beforeAll(async () => {
  stall = createTcpServer((socket) => {
    held.push(socket); // accept, then say nothing: the upgrade never completes
  });
  await new Promise<void>((resolve) => stall.listen(0, '127.0.0.1', resolve));
  wsUrl = `ws://127.0.0.1:${(stall.address() as AddressInfo).port}`;

  rpc = createHttpServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const { id } = JSON.parse(body) as { id: number };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result: '0x2a' }));
    });
  });
  await new Promise<void>((resolve) => rpc.listen(0, '127.0.0.1', resolve));
  httpUrl = `http://127.0.0.1:${(rpc.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const socket of held) socket.destroy();
  await new Promise((resolve) => stall.close(resolve));
  await new Promise((resolve) => rpc.close(resolve));
});

describe('mezoTransport with a stalled socket', () => {
  it('falls back to HTTP inside the deadline, then skips the socket', async () => {
    const chain = defineChain({
      id: 31611,
      name: 'stall test',
      nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
      rpcUrls: { default: { http: [httpUrl], webSocket: [wsUrl] } },
    });
    const client = createPublicClient({ chain, transport: mezoTransport(chain, 300) });

    const t0 = performance.now();
    expect(await client.getBlockNumber({ cacheTime: 0 })).toBe(42n);
    const first = performance.now() - t0;
    // One deadline (300ms) on the socket, then HTTP. Generous ceiling for a busy runner.
    expect(first).toBeLessThan(2_000);

    const t1 = performance.now();
    expect(await client.getBlockNumber({ cacheTime: 0 })).toBe(42n);
    // Cooling off: the socket is skipped, so this is an HTTP round trip and nothing more.
    expect(performance.now() - t1).toBeLessThan(250);
  });
});
