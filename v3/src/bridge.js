V3.bridge = (() => {
  const C = V3.core, PROTOCOL = 'bwu2.v3.bridge';
  function client({origin, path, family, life, onEvent} = {}) {
    let frame, ready = false, waiting = null;
    const pending = new Map();
    const post = message => frame.contentWindow.postMessage({protocol: PROTOCOL, family, ...message}, origin);
    const ensureReady = () => {
      if (ready) return Promise.resolve();
      if (waiting) return waiting.promise;
      let resolve, reject;
      const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
      const timer = setTimeout(() => { waiting = null; reject(new Error(family + ' worker not ready — open its native page and sign in')); }, 20000);
      waiting = {promise, reject:()=>{clearTimeout(timer);reject(new Error('Worker startup cancelled'));},resolve: () => { clearTimeout(timer); waiting = null; resolve(); }};
      if (!frame?.isConnected) {
        frame = document.createElement('iframe'); frame.hidden = true; frame.tabIndex = -1;
        frame.setAttribute('aria-hidden', 'true'); frame.src = origin + path + '#v3-' + family + '-worker';
        life.on(frame, 'load', () => { ready = false; post({type: 'ping'}); });
        document.body.appendChild(frame);
      } else post({type: 'ping'});
      return promise;
    };
    const arm = (id, job) => { clearTimeout(job.timer); job.timer = setTimeout(() => {
      pending.delete(id); job.reject(new C.UnknownError(family + ' worker confirmation lost — verify before retry', {aftPartial: job.partial}));
    }, 210000); };
    life.on(window, 'message', event => {
      if (event.origin !== origin || event.source !== frame?.contentWindow) return;
      const msg = event.data; if (msg?.protocol !== PROTOCOL || msg.family !== family) return;
      if (msg.type === 'ready') { ready = true; waiting?.resolve(); return; }
      if (msg.type === 'event') { onEvent?.(msg.detail); return; }
      const job = pending.get(msg.id); if (!job) return;
      if (msg.type === 'progress') { arm(msg.id, job); job.partial = msg.progress; job.onProgress?.(msg.progress); return; }
      if (msg.type !== 'result') return;
      pending.delete(msg.id); clearTimeout(job.timer);
      if (msg.ok) job.resolve(msg.data);
      else { const Type = msg.outcome === 'unknown' ? C.UnknownError : msg.outcome === 'rejected' ? C.RejectedError : Error;
        const error = new Type(msg.error || family + ' worker failed'); error.aftPartial = msg.partial; job.reject(error); }
    });
    life.own(() => {waiting?.reject();waiting=null; for (const job of pending.values()) {
      clearTimeout(job.timer); job.reject(new C.UnknownError('Worker page closed — verify active workflow'));
    } pending.clear(); frame?.remove(); });
    return Object.freeze({async run(command, input = {}) {
      const {onProgress, ...payload} = input;
      const clone = structuredClone(payload); await ensureReady(); const id = C.id('rpc');
      return new Promise((resolve, reject) => { const job = {resolve, reject, onProgress, partial: null}; pending.set(id, job); arm(id, job);
        try { post({type: 'run', id, command, payload: clone}); }
        catch (error) { pending.delete(id); clearTimeout(job.timer); reject(error); }
      });
    }, stop() { if (ready) post({type: 'stop'}); }});
  }
  function server({family, life, commands, stop, allowed} = {}) {
    let busy = false, parentOrigin = '';
    const send = (source, origin, message) => source.postMessage({protocol: PROTOCOL, family, ...message}, origin);
    life.on(window, 'message', async event => {
      if (event.source !== window.parent || !allowed(event.origin)) return;
      const msg = event.data; if (msg?.protocol !== PROTOCOL || msg.family !== family) return;
      if (msg.type === 'ping') { parentOrigin = event.origin; send(event.source, event.origin, {type: 'ready'}); return; }
      if (msg.type === 'stop') { stop?.(); return; }
      if (msg.type !== 'run' || !msg.id) return;
      const answer = result => send(event.source, event.origin, {type: 'result', id: msg.id, ...result});
      if (busy) { answer({ok: false, error: 'Worker busy'}); return; }
      const run = commands[msg.command]; if (!run) { answer({ok: false, error: 'Unsupported command'}); return; }
      busy = true;
      try { const data = await run({...msg.payload, onProgress: progress => send(event.source, event.origin, {type: 'progress', id: msg.id, progress})}); answer({ok: true, data}); }
      catch (error) { answer({ok: false, error: C.clean(error.message || error), outcome: error.outcome || '', partial: error.aftPartial || null}); }
      finally { busy = false; }
    });
    life.on(window, 'bwu2-v3:event', event => { if (parentOrigin) send(window.parent, parentOrigin, {type: 'event', detail: event.detail}); });
  }
  const isFCR=origin=>{try{return ['fcresearch-fe.aka.amazon.com','qi-fcresearch-fe.corp.amazon.com','qi-fcresearch-jp.corp.amazon.com','qifcr.fe.aftx.amazonoperations.app'].includes(new URL(origin).hostname);}catch{return false;}};
  return Object.freeze({client, server,isFCR});
})();
