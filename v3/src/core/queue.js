V3.queue = (() => {
  function create(options) {
    const name = options.name;
    const life = options.life;
    const telemetry = options.telemetry;
    const validator = options.validator || V3.base.validContainer;
    const store = V3.storage.create('queue.' + name);
    const owner = V3.base.id('tab');
    const lockKey = 'bwu2.v3.lock.' + name + '.v1';
    let corrupt = false;

    const loaded = store.read('state', null);
    corrupt = !loaded.ok;
    let state = loaded.ok && loaded.value && Array.isArray(loaded.value.items)
      ? loaded.value
      : { running:false, currentId:'', phase:'idle', message:'', items:[] };

    state.items = state.items
      .filter(item => item && validator(item.id))
      .map(item => ({
        id:V3.base.clean(item.id),
        status:['queued','active','done','rejected','attention'].includes(item.status) ? item.status : 'queued',
        error:V3.base.clean(item.error),
        phase:V3.base.clean(item.phase || 'idle')
      }));

    const active = state.items.find(item => item.status === 'active' || item.id === state.currentId);
    if (active) {
      active.status = 'attention';
      active.error = 'Previous session ended while this item was active — verify before retry';
    }
    if (active || /submit|mutation|move|bind|unbind/i.test(state.phase || '')) {
      state.running = false;
      state.currentId = '';
      state.phase = 'idle';
      state.message = 'Recovered with UNKNOWN/attention work';
    }

    const save = () => {
      if (corrupt) {
        telemetry?.emit('queue.corrupt', { name });
        corrupt = false;
      }
      store.set('state', state);
    };
    save();

    const readLock = () => { try { return JSON.parse(localStorage.getItem(lockKey) || 'null'); } catch { return null; } };
    const acquire = () => {
      const now = Date.now();
      const lock = readLock();
      if (lock && lock.owner !== owner && Number(lock.expires) > now) return false;
      localStorage.setItem(lockKey, JSON.stringify({ owner, expires:now + 8000 }));
      return true;
    };
    const renew = () => {
      const lock = readLock();
      if (lock?.owner === owner) localStorage.setItem(lockKey, JSON.stringify({ owner, expires:Date.now() + 8000 }));
    };
    const release = () => {
      const lock = readLock();
      if (lock?.owner === owner) localStorage.removeItem(lockKey);
    };

    life.interval(() => { if (state.running) renew(); }, 2500);
    life.own(release);

    const addMany = values => {
      const seen = new Set(state.items.map(item => V3.base.upper(item.id)));
      for (const raw of values) {
        const value = V3.base.clean(raw);
        const key = V3.base.upper(value);
        if (!validator(value) || seen.has(key)) continue;
        seen.add(key);
        state.items.push({ id:value, status:'queued', error:'', phase:'idle' });
      }
      save();
      return state.items;
    };
    const next = () => state.items.find(item => item.status === 'queued') || null;
    const set = patch => { Object.assign(state, patch); save(); };
    const itemSet = (item,patch) => { Object.assign(item, patch); save(); };
    const clearDone = () => { state.items = state.items.filter(item => item.status !== 'done'); save(); };
    const clearAll = () => {
      if (state.running) throw new Error('Stop queue before clearing');
      state.running=false;state.currentId='';state.phase='idle';state.message='';state.items=[];
      save();
    };

    return Object.freeze({
      state, owner, addMany, next, set, itemSet, save, acquire, release, clearDone, clearAll
    });
  }
  return Object.freeze({ create });
})();