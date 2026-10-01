V3.screenshot = (() => {
  function install(options = {}) {
    const life = options.life;
    const roots = options.roots || [];
    const state = { hidden:false };
    const apply = () => {
      for (const root of roots) {
        if (!root?.style) continue;
        if (state.hidden) root.style.setProperty('display','none','important');
        else root.style.removeProperty('display');
      }
    };
    life.on(document,'keydown',event => {
      if (!(event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && String(event.key).toLowerCase() === 'q')) return;
      event.preventDefault();
      state.hidden = !state.hidden;
      apply();
    }, true);
    return Object.freeze({
      get hidden() { return state.hidden; },
      toggle() { state.hidden = !state.hidden; apply(); return state.hidden; }
    });
  }
  return Object.freeze({ install });
})();