// PipingRoom: per-transfer Durable Object bridging PUT upload body → GET download stream
// Inspired by nwtgck/piping-server — pure HTTP pass-through, no storage, no buffering
//
// Key pattern (from Cloudflare Workers docs):
//   pipeTo(writable) WITHOUT await, then return immediately.
//   The stream continues flowing while the readable is consumed by another request.
export class PipingRoom {
    private readable: ReadableStream | null = null;
    private readableResolve: ((s: ReadableStream) => void) | null = null;

    async fetch(request: Request): Promise<Response> {
        if (request.method === 'PUT') {
            const { readable, writable } = new TransformStream<Uint8Array>();
            this.readable = readable;
            // Resolve any waiting GET handler
            if (this.readableResolve) {
                this.readableResolve(readable);
                this.readableResolve = null;
            }
            // Fire pipeTo without await — stream continues after fetch() returns
            request.body!.pipeTo(writable).catch(() => {});
            return new Response('ok', { status: 200 });
        }

        if (request.method === 'GET') {
            if (!this.readable) {
                this.readable = await new Promise<ReadableStream>(resolve => {
                    this.readableResolve = resolve;
                });
            }
            return new Response(this.readable, {
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-store',
                },
            });
        }

        return new Response('Method not allowed', { status: 405 });
    }
}
