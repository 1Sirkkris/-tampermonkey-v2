V3.lifecycle = (() => {
  function create(name = 'module') {
    const controller = new AbortController();
    const disposers = new Set();
    let disposed = false;

    const own = fn => { if (typeof fn === 'function') disposers.add(fn); return fn; };
    const on = (target, type, listener, options = {}) => {
      if (disposed || !target?.addEventListener) return () => {};
      const opts = typeof options === 'boolean'
        ? { capture: options, signal: controller.signal }
        : { ...options, signal: controller.signal };
      target.addEventListener(type, listener, opts);
      return () => target.removeEventListener(type, listener, opts);
    };
    const observe = (target, callback, options) => {
      if (disposed || !target || typeof MutationObserver === 'undefined') return null;
      const observer = new MutationObserver(callback);
      observer.observe(target, options);
      own(() => observer.disconnect());
      return observer;
    };
    const timeout = (fn, ms) => {
      if (disposed) return 0;
      let cancel = null;
      const timer = setTimeout(() => {
        if (cancel) disposers.delete(cancel);
        if (!disposed) fn();
      }, Math.max(0, Number(ms) || 0));
      cancel = () => clearTimeout(timer);
      own(cancel);
      return timer;
    };
    const interval = (fn, ms) => {
      if (disposed) return 0;
      const timer = setInterval(() => { if (!disposed) fn(); }, Math.max(50, Number(ms) || 0));
      own(() => clearInterval(timer));
      return timer;
    };
    const sleep = ms => V3.base.sleep(ms, controller.signal);
    const child = label => {
      const nested = create(name + ':' + label);
      own(() => nested.dispose());
      return nested;
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      controller.abort(name + ' disposed');
      for (const fn of [...disposers]) { try { fn(); } catch {} }
      disposers.clear();
    };

    return Object.freeze({
      name, signal: controller.signal, own, on, observe, timeout, interval, sleep, child, dispose,
      get disposed() { return disposed; }
    });
  }
  return Object.freeze({ create });
})();