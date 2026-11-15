import type { SessionSubscribeOptions } from './sessions.js';

/** Dedicated product observer transport. Protocol/application failures are terminal. */
export async function subscribeSession(
  url: URL,
  sessionId: string,
  handler: (frame: Record<string, unknown>) => void | Promise<void>,
  options: SessionSubscribeOptions,
): Promise<void> {
  let Socket = globalThis.WebSocket;
  if (!Socket || Function.prototype.toString.call(Socket).startsWith('class _WebSocket')) {
    // Keep the browser entry free of Node dependencies, as with voice sockets.
    const moduleName = 'ws';
    Socket = (await import(moduleName)).default as typeof WebSocket;
  }
  let delay = 250;
  let request = 0;
  while (!options.signal?.aborted) {
    const started = Date.now();
    const ws = new Socket(url.toString());
    const requestId = String(++request);
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      let ready = false;
      let subscribed = false;
      let processing = Promise.resolve();
      const finish = (error?: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        if (ws.readyState < 2) ws.close();
        if (error && !options.signal?.aborted) reject(error);
        else resolve();
      };
      const abort = () => {
        if (subscribed && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'sessionUnsubscribe', requestId: String(++request), sessionId }));
        }
        finish();
      };
      const timer = setTimeout(() => finish(new Error('Session subscription acknowledgement timed out')), 10_000);
      options.signal?.addEventListener('abort', abort, { once: true });
      // Node exposes rejected HTTP upgrades; browsers only expose an opaque
      // network close, which follows the ordinary reconnect policy.
      (ws as WebSocket & { on?: (name: string, handler: (request: unknown, response: {
        statusCode: number; resume(): void;
      }) => void) => void }).on?.('unexpected-response', (_request, response) => {
        response.resume();
        finish([401, 403].includes(response.statusCode)
          ? new Error(`Session observer authorization failed (${response.statusCode})`) : undefined);
      });
      ws.addEventListener('message', (event) => {
        processing = processing.then(async () => {
          if (finished || options.signal?.aborted) return;
          const text = typeof event.data === 'string' ? event.data :
            event.data instanceof Blob ? await event.data.text() : String(event.data);
          const frame = JSON.parse(text) as Record<string, unknown>;
          if (!frame || typeof frame !== 'object') throw new Error('Invalid session observer frame');
          if (!ready) {
            if (frame.type !== 'ready') throw new Error('Session observer did not send ready');
            ready = true;
            ws.send(JSON.stringify({ type: 'sessionSubscribe', requestId, sessionId }));
            return;
          }
          if (frame.type === 'sessionSubscriptionError') {
            if (frame.requestId !== requestId || frame.sessionId !== sessionId) throw new Error('Uncorrelated session subscription error');
            throw new Error(typeof frame.message === 'string' ? frame.message : 'Session subscription rejected');
          }
          if (!subscribed) {
            if (frame.type !== 'sessionSubscribed' || frame.requestId !== requestId || frame.sessionId !== sessionId) {
              throw new Error('Invalid session subscription acknowledgement');
            }
            subscribed = true;
            clearTimeout(timer);
            await options.onReady?.();
            return;
          }
          if (frame.type !== 'sessionMessage' || frame.sessionId !== sessionId) throw new Error('Invalid session observer event');
          await handler(frame);
        }).catch(finish);
      });
      // Transport loss retries; explicit authorization close codes do not.
      ws.addEventListener('error', () => { /* close carries the transport outcome */ });
      ws.addEventListener('close', (event) => {
        void processing.then(() => finish([1008, 4401, 4403].includes(event.code)
          ? new Error(`Session observer rejected connection (${event.code})`) : undefined));
      });
      if (options.signal?.aborted) abort();
    });
    if (options.signal?.aborted) break;
    if (Date.now() - started >= 10_000) delay = 250;
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, delay);
      options.signal?.addEventListener('abort', done, { once: true });
      if (options.signal?.aborted) done();
    });
    delay = Math.min(delay * 2, 5_000);
  }
}
