V3.identity = (() => {
  const LOGIN_RE = /^[a-z][a-z0-9-]{2,31}$/i;
  const RESERVED = /^(?:login|username|user|employee|alias|autoid|logout|logoff|signout|signin|sign-in|profile|account|settings|search|inventory|product|history)$/i;
  const normalize = value => {
    const login = V3.base.lower(value);
    return LOGIN_RE.test(login) && !RESERVED.test(login) ? login : '';
  };
  const readCookie = (doc,name) => {
    try {
      for (const raw of String(doc?.cookie || '').split(';')) {
        const part = raw.trim();
        const split = part.indexOf('=');
        if (split < 1 || part.slice(0,split).trim().toLowerCase() !== name.toLowerCase()) continue;
        let value = part.slice(split + 1).trim();
        try { value = decodeURIComponent(value); } catch {}
        return value;
      }
    } catch {}
    return '';
  };
  const fromObject = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 1) return '';
    for (const key of ['employeeLogin','userLogin','username','login','alias','autoId','autoID']) {
      const found = normalize(value[key]);
      if (found) return found;
    }
    for (const [key,child] of Object.entries(value).slice(0,24)) {
      if (!/(?:current|employee|user|profile|identity|operator)/i.test(key)) continue;
      if (/(?:token|secret|cookie|auth|csrf|session)/i.test(key)) continue;
      const found = fromObject(child, depth + 1);
      if (found) return found;
    }
    return '';
  };

  function resolve(options = {}) {
    const doc = options.doc || document;
    const pageWindow = options.pageWindow || window;
    const globals = [
      ['employeeLogin',pageWindow?.employeeLogin],
      ['userLogin',pageWindow?.userLogin],
      ['autoId',pageWindow?.autoId],
      ['autoID',pageWindow?.autoID],
      ['currentUser',pageWindow?.currentUser],
      ['user',pageWindow?.user],
      ['employee',pageWindow?.employee],
      ['bootstrapData',pageWindow?.bootstrapData],
      ['__INITIAL_STATE__',pageWindow?.__INITIAL_STATE__]
    ];
    for (const [source,value] of globals) {
      const login = typeof value === 'string' ? normalize(value) : fromObject(value);
      if (login) return { login, source:'global:' + source };
    }

    const selectors = [
      '.app-user-name','[data-test-id="user-name"]','.nav-user','.user-name',
      '[data-employee-login]','[data-user-login]','[data-username]','[data-autoid]',
      'meta[name="employeeLogin"]','meta[name="username"]','meta[name="autoid"]'
    ];
    for (const selector of selectors) {
      const element = doc?.querySelector?.(selector);
      if (!element) continue;
      const login = normalize(
        element.dataset?.employeeLogin || element.dataset?.userLogin ||
        element.dataset?.username || element.dataset?.autoid ||
        element.content || element.textContent
      );
      if (login) return { login, source:'dom:' + selector };
    }

    for (const name of ['employeeLogin','userLogin','username','autoid']) {
      const login = normalize(readCookie(doc,name));
      if (login) return { login, source:'cookie:' + name };
    }
    const fcMenu = readCookie(doc,'fcmenu-employeeId');
    if (/[a-z]/i.test(fcMenu)) {
      const login = normalize(fcMenu);
      if (login) return { login, source:'cookie:fcmenu-employeeId' };
    }
    return { login:'', source:'' };
  }

  async function resolveWiki(gm = V3.api.gmRequest) {
    try {
      const response = await gm('https://w.amazon.com/bin/view/Main/', { timeout:10000 });
      const raw = String(response.raw || '');
      const candidates = [
        raw.match(/[?&]userAlias=([a-z][a-z0-9-]{2,31})/i)?.[1],
        raw.match(/\b(?:currentUser|userAlias|employeeLogin)\s*[:=]\s*["']([a-z][a-z0-9-]{2,31})/i)?.[1],
        raw.match(/data-(?:user|employee)-(?:alias|login)=["']([a-z][a-z0-9-]{2,31})/i)?.[1]
      ];
      for (const candidate of candidates) {
        const login = normalize(candidate);
        if (login) return { login, source:'wiki-current-user' };
      }
    } catch {}
    return { login:'', source:'' };
  }

  return Object.freeze({ normalize, resolve, resolveWiki });
})();