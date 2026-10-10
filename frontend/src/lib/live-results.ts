export type LiveStatus = 'connecting' | 'live' | 'polling' | 'offline';

/** Stream with a polling fallback, cancellation and monotonic snapshot ordering. */
export function connectResults<T extends { generated_at: string }>(options: {
  url: string; load: () => Promise<T>; onSnapshot: (snapshot: T) => void;
  onStatus: (status: LiveStatus) => void; onUnauthorized: () => void;
}) {
  let disposed = false, streaming = false, pending = false, lastStream = Date.now(), latest = -Infinity;
  let stream: EventSource | null = null;
  const receive = (snapshot: T) => {
    const timestamp = Date.parse(snapshot.generated_at);
    if (!Number.isFinite(timestamp)) throw new Error('Invalid results timestamp');
    if (disposed || timestamp < latest) return;
    latest = timestamp; options.onSnapshot(snapshot);
  };
  const refresh = async () => {
    if (disposed || pending) return;
    pending = true;
    try {
      receive(await options.load());
      if (!disposed && !streaming) options.onStatus('polling');
    } catch (error) {
      if (!disposed) {
        if ((error as { status?: number }).status === 401) options.onUnauthorized();
        else if (!streaming) options.onStatus('offline');
      }
    } finally { pending = false; }
  };
  const fallback = () => {
    if (disposed) return;
    streaming = false; options.onStatus('polling'); void refresh();
  };
  options.onStatus('connecting');
  try {
    stream = new EventSource(options.url);
    stream.addEventListener('results', event => {
      try {
        receive(JSON.parse((event as MessageEvent).data));
        if (disposed) return;
        streaming = true; lastStream = Date.now(); options.onStatus('live');
      } catch { fallback(); }
    });
    stream.onerror = fallback;
  } catch { fallback(); }
  void refresh();
  const timer = setInterval(() => {
    if (!streaming || Date.now() - lastStream >= 30000) fallback();
  }, 5000);
  return () => { disposed = true; stream?.close(); clearInterval(timer); };
}
