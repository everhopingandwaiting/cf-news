// PipingRoom: per-transfer Durable Object bridging PUT upload body → GET download stream
// Inspired by nwtgck/piping-server — pure HTTP pass-through, no storage, no buffering
//
// The PUT side returns only after the stream is consumed so clients can detect failures.
export class PipingRoom {
    private readable: ReadableStream | null = null;
    private readableResolve: ((s: ReadableStream) => void) | null = null;
    private readonly pairingTimeoutMs = 60_000;

    async fetch(request: Request): Promise<Response> {
        if (request.method === 'PUT') {
            if (!request.body) return new Response('Missing body', { status: 400 });
            const { readable, writable } = new TransformStream<Uint8Array>();
            this.readable = readable;
            // Resolve any waiting GET handler
            if (this.readableResolve) {
                this.readableResolve(readable);
                this.readableResolve = null;
            }
            await request.body.pipeTo(writable);
            return new Response('ok', { status: 200 });
        }

        if (request.method === 'GET') {
            let stream: ReadableStream;
            if (!this.readable) {
                const pending = new Promise<ReadableStream>(resolve => {
                    this.readableResolve = resolve;
                });
                const timeout = new Promise<ReadableStream>((_, reject) => {
                    setTimeout(() => reject(new Error('Transfer not started')), this.pairingTimeoutMs);
                });
                try {
                    this.readable = await Promise.race([pending, timeout]);
                } catch {
                    this.readableResolve = null;
                    return new Response('Transfer not started', { status: 504 });
                }
            }
            stream = this.readable;
            this.readable = null;
            return new Response(stream, {
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
