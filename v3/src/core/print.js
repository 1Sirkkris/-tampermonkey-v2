V3.print = (() => {
  const hex = value => Array.from(new TextEncoder().encode(String(value ?? '')))
    .map(byte => byte.toString(16).padStart(2,'0')).join('');
  const cookie = name => {
    try {
      for (const raw of String(document.cookie || '').split(';')) {
        const part = raw.trim();
        const split = part.indexOf('=');
        if (split < 1 || part.slice(0,split).trim() !== name) continue;
        let value = part.slice(split + 1);
        try { value = decodeURIComponent(value); } catch {}
        return value;
      }
    } catch {}
    return '';
  };

  async function barcode(code, options = {}) {
    const value = V3.base.clean(code);
    if (!value) throw new Error('Barcode required');
    const quantity = Math.max(1, Math.min(999, Number(options.quantity) || 1));
    const description = V3.base.clean(options.description || '');
    const badge = V3.base.clean(cookie('fcmenu-employeeId'));
    const url = 'http://localhost:5965/printer?action=print&type=barcode' +
      '&data=' + hex(value) +
      '&text=' + hex(value) +
      '&quantity=' + quantity +
      '&desc=' + hex(description) +
      '&badgeid=' + encodeURIComponent(badge) +
      '&seq=' + Date.now();

    const result = await V3.api.gmRequest(url, { timeout:5000, telemetry:options.telemetry });
    options.telemetry?.emit('print', {
      code:V3.telemetry.mask(value),
      quantity,
      descriptionBound:Boolean(description),
      status:result.status
    });
    return result;
  }

  return Object.freeze({ barcode });
})();