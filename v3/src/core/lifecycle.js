// V3 source module: single-owner lifecycle primitives.
// Bundled into production userscripts; not loaded with runtime @require.

export function createLifecycle(name = 'module') {
  const controller = new AbortController();
  const disposers = new Set();
  let disposed = false;

  const on = (target, type, listener, options = {}) => {
    if (!target?.addEventListener || disposed) return () => {};
    const merged = typeof options === 'boolean'
      ? { capture: options, signal: controller.signal }
      : { ...options, signal: controller.signal };
    target.addEventListener(type, listener, merged);
    return () => target.removeEventListener(type, listener, merged);
  };

  const observe = (target, callback, options) => {
    if (!target || disposed) return null;
    const observer = new MutationObserver(callback);
    observer.observe(target, options);
    disposers.add(() => observer.disconnect());
    return observer;
  };

  const own = disposer => {
    if (typeof disposer === 'function') disposers.add(disposer);
    return disposer;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    for (const disposer of [...disposers]) {
      try { disposer(); } catch {}
    }
    disposers.clear();
  };

  return {
    name,
    signal: controller.signal,
    on,
    observe,
    own,
    dispose,
    get disposed() { return disposed; }
  };
}
