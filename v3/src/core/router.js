V3.router = (() => {
  function create(options) {
    const life = options.life;
    const resolve = options.resolve;
    const onChange = options.onChange;
    let current = '';

    const sync = () => {
      const next = resolve(location);
      if (next === current) return;
      const previous = current;
      current = next;
      onChange(next, previous);
    };

    life.on(window,'hashchange',sync);
    life.on(window,'popstate',sync);
    try { life.on(window,'urlchange',sync); } catch {}
    sync();

    return Object.freeze({ sync, get current() { return current; } });
  }
  return Object.freeze({ create });
})();