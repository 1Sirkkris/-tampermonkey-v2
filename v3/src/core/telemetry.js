V3.telemetry = (() => {
  const FORBIDDEN = /token|secret|cookie|authorization|csrf|password/i;
  const mask = value => {
    const text = V3.base.clean(value);
    if (!text || text.length <= 7) return text;
    return text.slice(0,3) + '…' + text.slice(-4) + '(' + text.length + ')';
  };
  const sanitize = (value, depth = 0) => {
    if (depth > 4) return '[depth]';
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.length > 600 ? value.slice(0,600) + '…' : value;
    if (Array.isArray(value)) return value.slice(0,30).map(item => sanitize(item, depth + 1));
    if (typeof value === 'object') {
      const out = {};
      for (const [key,item] of Object.entries(value).slice(0,50)) {
        out[key] = FORBIDDEN.test(key) ? '[redacted]' : sanitize(item, depth + 1);
      }
      return out;
    }
    return String(value);
  };

  function create(suite, version, options = {}) {
    const limit = Number(options.limit || 600);
    const store = V3.storage.create('telemetry.' + suite);
    let events = store.get('events', []);
    if (!Array.isArray(events)) events = [];

    const emit = (type, data = {}) => {
      const event = Object.assign({
        t:new Date().toISOString(), suite, version, type
      }, sanitize(data));
      events.push(event);
      if (events.length > limit) events.splice(0, events.length - limit);
      try { store.set('events', events); } catch {}
      return event;
    };

    const op = (operation, phase, data = {}) => emit('operation', Object.assign({
      opId:operation.id, kind:operation.kind, ref:operation.ref, phase
    }, data));

    const list = () => events.slice();
    const clear = () => { events = []; store.set('events', events); };
    const exportText = () => JSON.stringify({
      format:'BWU2-V3-OBS', suite, version,
      exportedAt:new Date().toISOString(), events:list()
    }, null, 2);

    return Object.freeze({ emit, op, list, clear, exportText, mask });
  }

  return Object.freeze({ create, mask, sanitize });
})();