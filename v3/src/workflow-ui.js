V3.workflowUI = (() => {
  const C = V3.core;
  const formKey = key => 'bwu2.v3.form.' + key;
  const read = (key, fallback = '') => localStorage.getItem(formKey(key)) ?? fallback;
  const write = (key, value) => localStorage.setItem(formKey(key), String(value ?? ''));
  const buttonRow = '<div class="v3-row"><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-stop disabled>STOP AFTER CURRENT</button><button class="v3-btn danger" data-attn hidden>I VERIFIED IT · CLEAR ATTENTION</button></div><div class="v3-note" data-status>Ready</div><div data-progress></div>';
  const field = (label, key, type = 'input', extra = '') => '<label class="v3-field">' + label + '<' + type + ' data-field="' + key + '" ' + extra + '></' + type + '></label>';
  const select = (label, key, values) => field(label, key, 'select').replace('</select>', values.map(value => '<option>' + C.esc(value) + '</option>').join('') + '</select>');
  const modes = values => '<div class="v3-tabs">' + values.map(([key, label]) => '<button class="v3-btn" data-mode="' + key + '">' + label + '</button>').join('') + '</div>';
  function mount(root, {prefix, html, defaults, defaultMode, run, stop, resolveAttention, paintMode, quantity} = {}) {
    let busy = false, disposed = false, mode = read(prefix + '.mode', defaultMode || '');
    let attention = read('aft.attention', '') || read(prefix + '.running', '');let runInfo=null;try{runInfo=JSON.parse(read(prefix+'.journal','null'));}catch{attention='Saved progress unreadable — verify previous work';}
    root.innerHTML = '<section class="v3-section">' + html + buttonRow + '</section>';
    const q = selector => root.querySelector(selector), values = {};
    for (const element of root.querySelectorAll('[data-field]')) {
      const key = element.dataset.field; element.value = read(prefix + '.' + key, defaults?.[key] || '');
      values[key] = element;
      element.addEventListener(element.tagName === 'SELECT' ? 'change' : 'input', () => write(prefix + '.' + key, element.value));
    }
    const status = (message, kind = '') => { if (disposed) return; q('[data-status]').className = 'v3-note ' + (kind ? 'v3-' + kind : ''); q('[data-status]').textContent = message; };
    const controls = () => {
      for (const element of root.querySelectorAll('input,textarea,select,[data-mode]')) element.disabled = busy;
      q('[data-run]').disabled = busy || Boolean(attention); q('[data-stop]').disabled = !busy;
      q('[data-attn]').hidden = !attention;
    };
    const paint = () => { for (const button of root.querySelectorAll('[data-mode]')) button.classList.toggle('active', button.dataset.mode === mode); paintMode?.(root, mode); };
    for (const button of root.querySelectorAll('[data-mode]')) button.onclick = () => { if (busy) return; mode = button.dataset.mode; write(prefix + '.mode', mode); paint(); };
    const progress = info => {
      write(prefix+'.journal',JSON.stringify({info,items:(values.items||values.locations||values.rows)?.value||''}));
      if (disposed) return;
      status((info.current ? info.current + '/' + info.total + ' · ' : '') + info.stage + (info.sku || info.barcode ? ' · ' + (info.sku || info.barcode) : ''), 'warn');
      q('[data-progress]').textContent = info.confirmed != null ? 'Confirmed: ' + info.confirmed + (info.total != null ? ' / ' + info.total : '') : '';
      quantity?.(root, info);
    };
    const replaceItems = rows => {
      const element = values.items || values.locations || values.rows;
      if (!element) return;
      element.value = rows.map(row => typeof row === 'string' ? row : [row.location, row.asin, row.fnsku || row.date].filter(Boolean).join(' ')).join('\n');
      write(prefix + '.' + element.dataset.field, element.value);
    };
    q('[data-run]').onclick = async () => {
      if (busy || attention || disposed) return;
      busy = true; write(prefix + '.running', 'Previous run ended without confirmation'); controls(); status('Starting…', 'warn');
      try {
        const input = Object.fromEntries(Object.entries(values).map(([key, element]) => [key, element.value]));
        const result = await run({...input, mode, onProgress: progress});
        const failed = result.failed || [];
        replaceItems([...(result.remaining||[]),...failed.map(row=>row.sku||row.location).filter(Boolean)]);
        status((result.stopped||result.remaining?.length ? 'STOPPED · ' : 'DONE ✓ ') + (result.confirmed ?? result.flipped ?? 0) +
          (result.total != null ? '/' + result.total : '') + (result.zero ? ' · ' + result.zero + ' zero' : '') +
          (failed.length ? ' · ' + failed.length + ' rejected' : ''), failed.length || result.stopped ? 'warn' : 'ok');
      } catch (error) {
        if(error.aftPartial?.remaining)replaceItems(error.aftPartial.remaining);else if(error.outcome==='unknown'){const input=values.items||values.locations||values.rows;if(input){write(prefix+'.uncertain',input.value);replaceItems([]);}}
        if (error.outcome === 'unknown') { attention = C.clean(error.message || error); write('aft.attention', attention); }
        status((attention ? 'OUTCOME UNKNOWN — VERIFY BEFORE RETRY · ' : 'STOPPED · ') + C.clean(error.message || error), attention ? 'bad' : 'warn');
      } finally { busy = false; localStorage.removeItem(formKey(prefix + '.running'));localStorage.removeItem(formKey(prefix+'.journal')); controls(); }
    };
    q('[data-stop]').onclick = () => { stop?.(); status('Stop requested — finishing current action', 'warn'); };
    q('[data-attn]').onclick = async () => {
      if (busy) return;
      try { await resolveAttention?.(); attention = ''; localStorage.removeItem(formKey('aft.attention')); localStorage.removeItem(formKey(prefix + '.running'));localStorage.removeItem(formKey(prefix+'.journal')); controls(); status('Attention cleared'); }
      catch (error) { status(error.message, 'bad'); }
    };
    if(attention&&runInfo){const lines=String(runInfo.items||'').split(/\r?\n/).filter(Boolean),skip=Number(runInfo.info?.current||runInfo.info?.confirmed||0);write(prefix+'.uncertain',lines.slice(0,skip).join('\n'));replaceItems(lines.slice(skip));}
    paint(); controls(); if (attention) status('VERIFY PREVIOUS RUN · ' + attention, 'bad');
    return Object.freeze({get isBusy() { return busy; }, dispose() { disposed = true; stop?.(); }});
  }
  function mountMove(root, {run, stop, resolveAttention, prefix = 'move'} = {}) {
    return mount(root, {prefix, stop, resolveAttention, defaultMode: 'all', defaults: {qty: '1'},
      html: modes([['all','ALL'],['each','EACH = 1'],['qty','QTY']]) +
        '<div data-qty-wrap hidden>' + field('Quantity', 'qty', 'input', 'type="number" min="1"') + '</div>' +
        field('Source','source') + field('Destination','destination') + field('Items','items','textarea'),
      paintMode: (node, mode) => { node.querySelector('[data-qty-wrap]').hidden = mode !== 'qty'; },
      run: input => run({...input, qty: Number(input.qty)})});
  }
  function mountEdit(root, {runEach, runSku, stop, resolveAttention, prefix = 'edit'} = {}) {
    const states = ['Sellable','Pending Research','Unsellable'], dispositions = ['Defective','Amazon Damage','Distributor Damage','Expired'];
    return mount(root, {prefix, stop, resolveAttention, defaultMode: 'sku',
      defaults: {sourceState: 'Sellable', sourceDamage: 'Defective', destState: 'Pending Research', destDamage: 'Defective'},
      html: modes([['each','EACH'],['sku','SKU']]) + '<div data-source-wrap>' +
        select('Source state','sourceState',states) + select('Source disposition','sourceDamage',dispositions) + '</div>' +
        select('Target state','destState',states) + select('Target disposition','destDamage',dispositions) +
        field('<span data-items-label>Items</span>','items','textarea') + '<div data-qty></div>',
      paintMode: (node, mode) => { node.querySelector('[data-source-wrap]').hidden = mode === 'each';
        node.querySelector('[data-items-label]').textContent = mode === 'each' ? 'TOTE  ASIN  [FNSKU] — one row per item' : 'SKU / ASIN / FNSKU / FCSKU — one per line'; },
      quantity: (node, info) => { if (info.inventory) node.querySelector('[data-qty]').textContent = 'Qty: S ' + (info.inventory.SELLABLE ?? '—') + ' · P ' + (info.inventory.PENDING_RESEARCH ?? '—') + ' · U ' + (info.inventory.UNSELLABLE ?? '—'); },
      run: input => input.mode === 'each' ? runEach(input) : runSku(input)});
  }
  const mountFcsku = (root, {run, stop, resolveAttention, prefix = 'fcsku'} = {}) => mount(root, {prefix, run, stop, resolveAttention,
    html: field('OLD FCSKU','oldCode') + field('NEW FCSKU','newCode') + field('Locations / Containers','locations','textarea')});
  const mountDate = (root, {run, stop, resolveAttention, prefix = 'date'} = {}) => mount(root, {prefix, stop, resolveAttention,
    html: field('LOCATION  ASIN  YYYY-MM-DD','rows','textarea'), run: input => run({...input, rows: input.rows.split(/\r?\n/).map(C.clean).filter(Boolean).map(line => {
      const [location, asin, date] = line.split(/\s+/); return {location, asin, date}; })})});
  return Object.freeze({mountMove, mountEdit, mountFcsku, mountDate});
})();
