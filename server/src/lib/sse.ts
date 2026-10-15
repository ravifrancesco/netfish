import type { ServerResponse } from 'node:http';
import type { FastifyReply } from 'fastify';

/** Opens a server-sent events line: no buffering on the way, reconnect quickly if it drops. */
export function openLine(reply: FastifyReply): ServerResponse {
  reply.hijack();
  const stream = reply.raw;
  stream.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // nginx and friends: pass every message on at once.
    'x-accel-buffering': 'no',
  });
  stream.write('retry: 2000\n\n');
  return stream;
}

export function send(stream: ServerResponse, event: unknown) {
  try {
    stream.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    /* gone: the close handler tidies up */
  }
}

/** A comment line: keeps the connection open through proxies that drop quiet ones. */
export function ping(stream: ServerResponse) {
  try {
    stream.write(': still here\n\n');
  } catch {
    /* gone */
  }
}
