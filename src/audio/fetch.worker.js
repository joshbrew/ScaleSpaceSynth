self.onmessage = async (e) => {
  const m = e && e.data;
  if (!m || typeof m !== 'object' || m.type !== 'fetch') return;

  try {
    const res = await fetch(String(m.url || ''), m.init || {});
    if (!res.ok) {
      self.postMessage({
        id: m.id,
        ok: false,
        status: res.status,
        statusText: res.statusText || 'Fetch failed',
      });
      return;
    }

    const buf = await res.arrayBuffer();
    self.postMessage({ id: m.id, ok: true, buf }, [buf]);
  } catch (err) {
    self.postMessage({
      id: m && m.id,
      ok: false,
      status: 0,
      statusText: err && err.message ? err.message : 'Fetch failed',
    });
  }
};
