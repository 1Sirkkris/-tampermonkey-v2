// ==UserScript==
// @name         V2 | Sideline + ISS Restructure 1.0
// @namespace    https://github.com/1Sirkkris
// @version      1.0.0
// @description  Clean V2 rebuild: Tote Queue + Lazy Sideline + QTY + ISS Console, one Sideline core.
// @match        https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*
// @include      *://aft-qt-*.corp.amazon.com/app/edititems*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      pandash.amazon.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Sideline_ISS_Restructure_1.0.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Sideline_ISS_Restructure_1.0.user.js
// @require      https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Fleet_Core.lib.js
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '1.0.0';
  const POIROT_ORIGIN = 'https://aft-poirot-website-nrt.nrt.proxy.amazon.com';
  const AFT_ORIGIN = 'https://aft-qt-jp.aka.nrt.corp.amazon.com';
  const AFT_WORKER_URL = AFT_ORIGIN + '/app/edititems?experience=Desktop#iss-console-worker';
  const FCR_TRUST_ORIGIN = 'https://qi-fcresearch-fe.corp.amazon.com';
  const TOOL = 'V3';
  const START_TRIGGER = '123START';

  /*
   * AFT remains the Edit/Move engine. Its current V2 worker bridge still checks
   * for an FCR parent. This same-file relay only normalizes the parent message
   * origin inside the hidden AFT worker; it does not implement AFT mutations.
   */
  if (/^aft-qt-/i.test(location.hostname) && /\.corp\.amazon\.com$/i.test(location.hostname)) {
    if (!location.hash.startsWith('#iss-console-worker')) return;
    window.addEventListener('message', event => {
      const message = event.data;
      if (
        event.origin !== POIROT_ORIGIN ||
        message?.type !== 'ISS_CONSOLE_RPC' ||
        message?.worker !== 'aft'
      ) return;

      try {
        window.dispatchEvent(new MessageEvent('message', {
          data: message,
          origin: FCR_TRUST_ORIGIN,
          source: window.parent
        }));
      } catch {}
    }, true);
    return;
  }

  if (location.origin !== POIROT_ORIGIN) return;
  if (window.__bwu2SidelineIssRestructure1) return;
  window.__bwu2SidelineIssRestructure1 = true;

  const Fleet = globalThis.BWU2Fleet || {};
  Fleet.registerRuntimeVersion?.('SIDELINE+ISS-R1', VERSION);

  const $ = (selector, root = document) => {
    try { return root.querySelector(selector); } catch { return null; }
  };
  const $$ = (selector, root = document) => {
    try { return [...root.querySelectorAll(selector)]; } catch { return []; }
  };
  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).replace(/\s+/g, ' ').toLowerCase();
  const upper = value => clean(value).toUpperCase();
  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const validContainer = value => /^(?:cs|ts)x[0-9a-z_-]+$/i.test(clean(value));
  const itemQty = item => Math.max(1, Number(item?.qty) || 1);
  const requestId = () => 'amzn1.fc.v1.common.request-id.v1.AFTPoirotWebsite.' +
    (crypto.randomUUID?.() || (Date.now() + '-' + Math.random().toString(16).slice(2)));

  const markUi = node => {
    if (!node) return node;
    node.setAttribute('data-bwu2-ui', 'sideline-iss-r1');
    node.setAttribute('data-r1-root', '1');
    return node;
  };

  const trace = (type, data = {}) => {
    try {
      Fleet.trace?.('SIDELINE_R1_' + type, { version: VERSION, ...data });
    } catch {}
  };

  const Store = {
    prefix: 'bwu2.sidelineIssR1.',
    get(key, fallback = '') {
      try {
        const value = localStorage.getItem(this.prefix + key);
        return value == null ? fallback : value;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(this.prefix + key, String(value)); } catch {}
    },
    json(key, fallback) {
      try {
        const value = JSON.parse(localStorage.getItem(this.prefix + key) || 'null');
        return value && typeof value === 'object' ? value : fallback;
      } catch {
        return fallback;
      }
    },
    setJson(key, value) {
      try { localStorage.setItem(this.prefix + key, JSON.stringify(value)); } catch {}
    }
  };

  const Api = (() => {
    const PATH = {
      bootstrap: '/api/get-bootstrap-data',
      scanSource: '/api/scan-source-container',
      closeContainer: '/api/close-container',
      scanItem: '/api/scanitem',
      moveItems: '/api/move-items'
    };

    async function request(path, options = {}) {
      const method = options.method || 'GET';
      let response;

      try {
        response = await fetch(path, {
          method,
          credentials: 'same-origin',
          cache: 'no-store',
          headers: options.body ? { 'content-type': 'application/json' } : undefined,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: options.signal
        });
      } catch (cause) {
        const error = new Error(options.label ? options.label + ': network failure' : 'Network failure');
        error.cause = cause;
        error.submitted = method !== 'GET';
        error.responseReceived = false;
        throw error;
      }

      let raw = '';
      try {
        raw = await response.text();
      } catch (cause) {
        const error = new Error(options.label ? options.label + ': unreadable response' : 'Unreadable response');
        error.cause = cause;
        error.submitted = method !== 'GET';
        error.responseReceived = true;
        throw error;
      }

      let payload = raw;
      try { payload = raw ? JSON.parse(raw) : null; } catch {}

      if (!response.ok && !options.allowHttpError) {
        const error = new Error((options.label || path) + ': HTTP ' + response.status);
        error.payload = payload;
        error.submitted = method !== 'GET';
        error.responseReceived = true;
        throw error;
      }

      return { response, payload };
    }

    function scanSourcePayload(container) {
      return { containerScannableId: container, requestId: requestId(), tool: TOOL };
    }

    function scanItemPayload(source, barcode) {
      return {
        containerScannableId: source,
        itemBarcode: barcode,
        isMasterpack: null,
        itemAndonContext: null,
        requestId: requestId(),
        tool: TOOL
      };
    }

    function closeContainerPayload(container, empty) {
      return {
        containerScannableId: container,
        containerEmpty: empty === true,
        directedLabel: false,
        processPath: 'UNDETERMINED',
        requestId: requestId(),
        tool: TOOL
      };
    }

    function payloadHasCustomerBound(value, seen = new Set()) {
      if (value == null) return false;
      if (typeof value === 'string') return /customer\s*bound\s*shipment/i.test(value);
      if (typeof value !== 'object' || seen.has(value)) return false;
      seen.add(value);
      if (Array.isArray(value)) return value.some(child => payloadHasCustomerBound(child, seen));
      return Object.entries(value).some(([key, child]) =>
        /customer\s*bound\s*shipment/i.test(key) || payloadHasCustomerBound(child, seen)
      );
    }

    async function warehouse() {
      try {
        const result = await request(PATH.bootstrap + '?tool=' + encodeURIComponent(TOOL), {
          label: 'Bootstrap'
        });
        const payload = result.payload;
        const info = payload?.warehouseInfo;
        return upper(
          (typeof info === 'string' ? info : '') ||
          info?.warehouseId || info?.id || info?.warehouse || info?.fc || info?.code ||
          payload?.warehouseId || ''
        );
      } catch {
        return '';
      }
    }

    async function scanSource(container, signal) {
      const code = clean(container);
      if (!validContainer(code)) throw new Error('Invalid source container');

      const result = await request(PATH.scanSource, {
        method: 'POST',
        body: scanSourcePayload(code),
        signal,
        label: 'Source scan'
      });
      const payload = result.payload;

      if (payloadHasCustomerBound(payload)) {
        const error = new Error('CUSTOMER-BOUND SHIPMENT');
        error.customerBound = true;
        error.payload = payload;
        throw error;
      }

      if (
        clean(payload?.['@type']) !== 'ScanSourceContainerResponse' ||
        payload?.success !== true
      ) {
        const error = new Error(clean(
          payload?.message || payload?.description || payload?.errorMessage ||
          payload?.['@type'] || 'SOURCE VALIDATION FAILED'
        ));
        error.payload = payload;
        throw error;
      }

      return payload;
    }

    async function closeContainer(container, empty) {
      const code = clean(container);
      if (!validContainer(code)) throw new Error('Invalid container');

      let result;
      try {
        result = await request(PATH.closeContainer, {
          method: 'POST',
          body: closeContainerPayload(code, empty),
          label: 'Close container'
        });
      } catch (error) {
        const unknown = new Error(
          'CLOSE OUTCOME UNKNOWN — ' + code + ' — VERIFY BEFORE RETRY'
        );
        unknown.outcomeUnknown = true;
        unknown.cause = error;
        throw unknown;
      }

      const payload = result.payload;
      if (
        clean(payload?.['@type']) !== 'CloseContainerResponse' ||
        payload?.success !== true
      ) {
        const error = new Error(
          'CLOSE NOT CONFIRMED — ' + code + ' — VERIFY BEFORE RETRY'
        );
        error.outcomeUnknown = true;
        error.payload = payload;
        throw error;
      }

      return payload;
    }

    async function scanItem(source, barcode, signal) {
      return (await request(PATH.scanItem, {
        method: 'POST',
        body: scanItemPayload(source, barcode),
        signal,
        allowHttpError: true,
        label: 'Item lookup'
      })).payload;
    }

    async function move(payload, signal) {
      return (await request(PATH.moveItems, {
        method: 'POST',
        body: payload,
        signal,
        allowHttpError: true,
        label: 'Move'
      })).payload;
    }

    return {
      PATH,
      warehouse,
      scanSource,
      scanItem,
      move,
      closeContainer,
      scanSourcePayload,
      scanItemPayload
    };
  })();

  const Hazmat = (() => {
    let warehousePromise = null;
    const restriction = new Map();
    const cache = new Map();
    const inflight = new Map();

    function gm(options) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          timeout: 8000,
          responseType: 'json',
          ...options,
          onload: response => {
            if (response.status >= 200 && response.status < 300) resolve(response.response);
            else reject(new Error('HTTP ' + (response.status || 0)));
          },
          onerror: () => reject(new Error('NETWORK ERROR')),
          ontimeout: () => reject(new Error('TIMEOUT'))
        });
      });
    }

    async function read(options) {
      let last;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try { return await gm(options); }
        catch (error) {
          last = error;
          if (attempt < 2) await sleep(150);
        }
      }
      throw last || new Error('HAZMAT LOOKUP FAILED');
    }

    async function warehouse() {
      if (!warehousePromise) warehousePromise = Api.warehouse();
      return warehousePromise;
    }

    async function eligibility(asinValue) {
      const asin = upper(asinValue);
      const fc = await warehouse();
      if (!/^B[A-Z0-9]{9}$/.test(asin) || !fc) throw new Error('HAZMAT LOOKUP CONTEXT MISSING');

      const key = fc + '|' + asin;
      if (cache.has(key)) return cache.get(key);
      if (inflight.has(key)) return inflight.get(key);

      const work = (async () => {
        let source = restriction.get(fc) || '';
        if (!source) {
          const bootstrap = await read({
            method: 'GET',
            url: 'https://pandash.amazon.com/GridServlet?fc=' + encodeURIComponent(fc)
          });
          source = clean(bootstrap?.restriction || 'default') || 'default';
          restriction.set(fc, source);
        }

        const body =
          'language=default&source=' + encodeURIComponent(source) + '-hazmat-FC' +
          '&marketPlaces=AU&asins=' + encodeURIComponent(asin) +
          '&rows=1&page=1&fc=' + encodeURIComponent(fc);

        const payload = await read({
          method: 'POST',
          url: 'https://pandash.amazon.com/GridServlet',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          data: body
        });

        const row = Array.isArray(payload?.rows)
          ? payload.rows.find(item => upper(item?.asin) === asin)
          : null;
        if (!row) throw new Error('NO PANDASH RESULT');

        const message = clean(row.message);
        const result = {
          asin,
          level: Number(row.level || 0),
          message,
          allowed: /can be processed/i.test(message)
        };
        cache.set(key, result);
        return result;
      })();

      inflight.set(key, work);
      try { return await work; }
      finally { inflight.delete(key); }
    }

    return { eligibility };
  })();

  const Rules = (() => {
    function problemLabels(response) {
      return (Array.isArray(response?.problems) ? response.problems : [])
        .filter(Boolean)
        .map(problem => clean(
          problem?.description || problem?.message || problem?.reason ||
          problem?.code || problem?.['@type'] || ''
        ))
        .filter(Boolean);
    }

    function hasPredicant(value) {
      if (value == null) return false;
      if (typeof value === 'string') return /predicant/i.test(value);
      if (Array.isArray(value)) return value.some(hasPredicant);
      if (typeof value !== 'object') return false;
      return Object.entries(value).some(([key, child]) => {
        if (/predicant/i.test(key)) {
          if (child === true) return true;
          if (typeof child === 'string' && child && !/^false$/i.test(child)) return true;
        }
        return hasPredicant(child);
      });
    }

    function hazmatRejected(response) {
      if (!response || typeof response !== 'object') return false;
      const filter = response.filterResult || {};
      const reason = filter.reason || {};
      const labels = [
        response.message, response.description, response.errorMessage, response.errorCode,
        typeof response.reason === 'string' ? response.reason : '',
        response.reason?.type, response.reason?.description, response.reason?.message,
        reason.type, reason.description, reason.message, reason['@type'],
        filter.filterType,
        ...problemLabels(response)
      ].map(clean).filter(Boolean);

      if (!labels.some(label => /hazmat|dangerous.?goods/i.test(label))) return false;
      return !!(
        response.success === false ||
        filter.compatible === false ||
        problemLabels(response).length ||
        response.errorMessage ||
        response.errorCode ||
        /error|reject|incompat|filter/i.test(clean(response['@type']))
      );
    }

    function damagedDestination(response) {
      const result = response?.filterResult;
      const reason = result?.reason;
      return !!(
        result?.compatible === false &&
        (
          reason?.containerDamaged === true ||
          norm(reason?.['@type']) === 'damageditemsfilterresultreason' ||
          /damageditemsfilter/i.test(clean(result?.filterType))
        )
      );
    }

    function overageLabel(value) {
      return /\boverage(?:s)?\b|\bitem\s+not\s+in\s+(?:source\s+)?container\b|\bnot\s+in\s+source\s+container\b/i
        .test(clean(value));
    }

    function benignOverageCompanion(value) {
      const label = clean(value);
      return !label || overageLabel(label) ||
        /^(?:bad request|conflict|request failed|http\s*[45]\d\d|[45]\d\d)$/i.test(label);
    }

    function allowedOverage(response) {
      if (!response || typeof response !== 'object') return false;
      const type = clean(response['@type']);
      if (type === 'InvalidBarcodeResponse' || type === 'RequestMultipleBarcodesResponse') return false;
      if (hazmatRejected(response) || hasPredicant(response) || damagedDestination(response)) return false;

      const filter = response.filterResult;
      const filterReason = clean(
        filter?.reason?.type || filter?.reason?.description ||
        filter?.reason?.message || filter?.reason?.['@type'] ||
        filter?.filterType || ''
      );
      if (filter?.compatible === false && !overageLabel(filterReason)) return false;

      const problems = problemLabels(response);
      if (problems.some(label => !overageLabel(label))) return false;

      const labels = [
        response.message, response.description, response.errorMessage,
        response.errorCode, filterReason, ...problems
      ].map(clean).filter(Boolean);
      const explicit = overageLabel(type) || labels.some(overageLabel);
      if (!explicit || labels.some(label => !benignOverageCompanion(label))) return false;

      return !/hazmat|dangerous.?goods|invalid\s+barcode|incompatib|damaged|predicant|customer\s*bound/i
        .test([type, ...labels].join(' '));
    }

    function resolveItem(response, barcode) {
      const type = clean(response?.['@type']);
      const overage = allowedOverage(response);
      if (!response || type === 'InvalidBarcodeResponse' || (response.success === false && !overage)) {
        return { ok: false, invalid: type === 'InvalidBarcodeResponse', type: type || 'Unknown' };
      }

      const records = (Array.isArray(response.items) ? response.items : [])
        .filter(record => record?.skuDetail);
      const item = records[0] || null;
      const sku = item?.skuDetail;

      if (!item || !sku) return { ok: false, invalid: false, type: type || 'Unknown' };

      return {
        ok: true,
        type,
        barcode,
        item,
        records,
        sku,
        asin: clean(sku.asin),
        fnsku: clean(sku.fnSku),
        fcsku: clean(sku.fcSku),
        dateType: clean(sku.datelotDetail?.expirationPromptType),
        dateDetail: sku.datelotDetail || {},
        hazmat: sku.hazmat === true,
        permissionLevel: upper(sku.itemDropzoneRecommendation?.permissionLevel),
        overage
      };
    }

    function responseText(response) {
      return [
        response?.['@type'], response?.message, response?.description,
        response?.errorMessage, response?.errorCode,
        response?.filterResult?.filterType,
        response?.filterResult?.reason?.type,
        response?.filterResult?.reason?.description,
        response?.filterResult?.reason?.message,
        ...problemLabels(response)
      ].map(clean).filter(Boolean).join(' ');
    }

    async function classify(response, code) {
      const ctx = resolveItem(response, code);
      const text = responseText(response);

      if (/damaged/i.test(text)) return { kind: 'red', reason: 'DAMAGED / INCOMPATIBLE', ctx };
      if (hazmatRejected(response)) return { kind: 'red', reason: 'HAZMAT / DANGEROUS GOODS', ctx };

      if (!ctx.ok) {
        const reason = ctx.invalid
          ? 'INVALID BARCODE'
          : ctx.type === 'RequestMultipleBarcodesResponse'
            ? 'MULTIPLE BARCODE MATCHES'
            : (ctx.type && ctx.type !== 'Unknown' ? ctx.type : 'NO ITEM DETAILS');
        return { kind: 'red', reason, ctx };
      }

      if (ctx.permissionLevel === 'UNDER_REVIEW') {
        return {
          kind: 'red',
          reason: ctx.hazmat
            ? 'HAZMAT / UNDER REVIEW — RIVER REQUIRED'
            : 'ASIN UNDER REVIEW — RIVER REQUIRED',
          ctx
        };
      }

      let result = (ctx.dateType === 'EXPIRATION_DATE' || ctx.dateType === 'PRODUCTION_DATE')
        ? {
            kind: 'yellow',
            reason: ctx.dateType === 'PRODUCTION_DATE' ? 'PRODUCTION DATE' : 'EXPIRY DATE',
            ctx
          }
        : { kind: 'green', reason: 'GOOD TO GO', ctx };

      if (!ctx.hazmat) return result;

      try {
        const hazmat = await Hazmat.eligibility(ctx.asin);
        if (!hazmat.allowed) {
          return {
            kind: 'red',
            reason: 'HAZMAT L' + hazmat.level + ' — NOT PROCESSABLE',
            ctx,
            hazmat
          };
        }
        result = {
          ...result,
          reason: result.kind === 'yellow'
            ? result.reason
            : 'HAZMAT L' + hazmat.level + ' — OK TO PROCESS',
          hazmat
        };
        return result;
      } catch (error) {
        return {
          kind: 'retry',
          reason: 'HAZMAT CHECK FAILED — ' + clean(error?.message || error),
          ctx
        };
      }
    }

    function moveOk(response) {
      if (allowedOverage(response)) return true;
      return !!(
        response &&
        response.success === true &&
        response.filterResult?.compatible !== false &&
        !hazmatRejected(response) &&
        !hasPredicant(response)
      );
    }

    function moveReason(response) {
      if (!response) return 'EMPTY MOVE RESPONSE';
      if (hazmatRejected(response)) return 'HAZMAT';
      if (allowedOverage(response)) return 'OVERAGE';
      if (damagedDestination(response)) return 'DESTINATION DAMAGED';

      const reason = response.filterResult?.reason;
      if (norm(reason?.['@type']) === 'rafilterresultreason') {
        return upper(reason?.type) || 'DESTINATION INCOMPATIBLE';
      }
      if (response.filterResult?.compatible === false) {
        return upper(reason?.type) || 'DESTINATION INCOMPATIBLE';
      }

      const problems = problemLabels(response);
      if (problems.length) return problems.join(', ');
      return clean(response?.['@type']).replace(/Response$/, '') || 'MOVE REJECTED';
    }

    return {
      hasPredicant,
      hazmatRejected,
      damagedDestination,
      allowedOverage,
      resolveItem,
      classify,
      moveOk,
      moveReason
    };
  })();

  class PreflightSession {
    constructor(source, onResult) {
      this.source = clean(source);
      this.onResult = typeof onResult === 'function' ? onResult : () => {};
      this.cache = new Map();
      this.jobs = new Map();
      this.queue = [];
      this.active = 0;
      this.limit = 5;
      this.generation = 1;
      this.controllers = new Set();
    }

    key(code) {
      return upper(code);
    }

    get(code) {
      return this.cache.get(this.key(code)) || null;
    }

    ensure(code) {
      const barcode = clean(code);
      const key = this.key(barcode);
      if (!barcode) return Promise.resolve(null);
      if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
      if (this.jobs.has(key)) return this.jobs.get(key).promise;

      let resolve;
      const promise = new Promise(done => { resolve = done; });
      const job = {
        key,
        code: barcode,
        generation: this.generation,
        resolve,
        promise,
        settled: false
      };
      this.jobs.set(key, job);
      this.queue.push(job);
      this.pump();
      return promise;
    }

    async ensureAll(items) {
      return Promise.all(items.map(item => this.ensure(item.code)));
    }

    finish(job, result) {
      if (!job || job.settled) return;
      job.settled = true;
      this.jobs.delete(job.key);
      if (result && result.kind !== 'retry') this.cache.set(job.key, result);
      job.resolve(result);
      try { this.onResult(job.code, result); } catch {}
    }

    pump() {
      while (this.active < this.limit && this.queue.length) {
        const job = this.queue.shift();
        if (!job || job.generation !== this.generation) {
          this.finish(job, null);
          continue;
        }

        this.active++;
        const controller = new AbortController();
        this.controllers.add(controller);

        Api.scanItem(this.source, job.code, controller.signal)
          .then(payload => Rules.classify(payload, job.code))
          .then(result => this.finish(job, result))
          .catch(() => this.finish(job, null))
          .finally(() => {
            this.controllers.delete(controller);
            this.active = Math.max(0, this.active - 1);
            this.pump();
          });
      }
    }

    cancel() {
      this.generation++;
      for (const controller of this.controllers) {
        try { controller.abort(); } catch {}
      }
      this.controllers.clear();
      while (this.queue.length) this.finish(this.queue.shift(), null);
      for (const job of [...this.jobs.values()]) this.finish(job, null);
      this.cache.clear();
    }
  }

  const Expiry = (() => {
    let active = null;
    const MONTHS = [
      ['JAN', 1], ['FEB', 2], ['MAR', 3], ['APR', 4],
      ['MAY', 5], ['JUN', 6], ['JUL', 7], ['AUG', 8],
      ['SEP', 9], ['OCT', 10], ['NOV', 11], ['DEC', 12]
    ];

    function maxDay(month, year) {
      return new Date(year || 2028, month, 0).getDate();
    }

    function validDate(month, day, year) {
      const date = new Date(year, month - 1, day, 0, 0, 0, 0);
      return date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
        ? date.getTime()
        : 0;
    }

    function todayStart() {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    }

    function pao900() {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + 900);
      return date.getTime();
    }

    function label(ms) {
      const date = new Date(ms);
      return String(date.getMonth() + 1).padStart(2, '0') + '/' +
        String(date.getDate()).padStart(2, '0') + '/' +
        date.getFullYear();
    }

    function imageUrl(ctx) {
      return clean(ctx?.sku?.imageUrls?.[0])
        .replace(/^http:\/\/ecx\.images-amazon\.com\/images\/I\//i, 'https://m.media-amazon.com/images/I/')
        .replace(/^http:\/\//i, 'https://');
    }

    function close(value) {
      if (!active) return;
      const { root, resolve } = active;
      active = null;
      root.remove();
      resolve(value);
    }

    function pick(options = {}) {
      if (active) return Promise.resolve(null);

      return new Promise(resolve => {
        const mode = options.mode === 'production' ? 'production' : 'expiration';
        const ctx = options.ctx || {};
        const currentYear = new Date().getFullYear();
        const selection = { month: null, day: 1, year: null };

        const root = markUi(document.createElement('div'));
        root.id = 'r1-expiry';
        root.innerHTML = '<div class="r1-expiry-card"></div>';
        document.body.appendChild(root);
        active = { root, resolve };

        const card = $('.r1-expiry-card', root);

        const render = () => {
          const years = mode === 'production'
            ? Array.from({ length: 16 }, (_, index) => currentYear - index)
            : Array.from({ length: 16 }, (_, index) => currentYear + index);
          const monthName = MONTHS.find(([, value]) => value === selection.month)?.[0] || '—';
          const title = clean(options.title || ctx?.sku?.title || ctx?.sku?.normalizedTitle || 'Item');
          const img = clean(options.image || imageUrl(ctx));
          const asin = clean(options.asin || ctx.asin || '—');
          const fnsku = clean(options.fnsku || ctx.fnsku || '—');
          const scan = clean(options.scan || ctx.barcode || '—');

          const months = MONTHS.map(([name, value]) =>
            '<button type="button" data-date="month" data-value="' + value + '"' +
            (selection.month === value ? ' class="selected"' : '') + '>' + name + '</button>'
          ).join('');

          const days = Array.from({ length: 31 }, (_, index) => index + 1).map(value => {
            const disabled = !selection.month || value > maxDay(selection.month, selection.year || currentYear);
            return '<button type="button" data-date="day" data-value="' + value + '"' +
              (selection.day === value ? ' class="selected"' : '') +
              (disabled ? ' disabled' : '') + '>' + value + '</button>';
          }).join('');

          const yearButtons = years.map(value => {
            const ms = validDate(selection.month, selection.day, value);
            const allowed = ms && (
              mode === 'production'
                ? ms <= Date.now()
                : ms >= todayStart()
            );
            return '<button type="button" data-date="year" data-value="' + value + '"' +
              (selection.year === value ? ' class="selected"' : '') +
              (!allowed ? ' disabled' : '') + '>' + value + '</button>';
          }).join('');

          card.innerHTML =
            '<div class="r1-expiry-head">REQUIRES ' +
              (mode === 'production' ? 'PRODUCTION' : 'EXPIRATION') + ' DATE</div>' +
            '<div class="r1-expiry-item">' +
              (img ? '<img src="' + esc(img) + '" alt="">' : '<div></div>') +
              '<div><strong>' + esc(title) + '</strong>' +
                '<span>ASIN ' + esc(asin) + '</span>' +
                '<span>FNSKU ' + esc(fnsku) + '</span>' +
                '<code>' + esc(scan) + '</code></div>' +
            '</div>' +
            '<div class="r1-date-grid">' +
              '<section><b>MONTH · ' + esc(monthName) + '</b><div class="months">' + months + '</div></section>' +
              '<section><b>DAY · ' + String(selection.day || '—') + '</b><div class="days">' + days + '</div></section>' +
              '<section><b>YEAR · ' + String(selection.year || '—') + '</b><div class="years">' + yearButtons + '</div></section>' +
            '</div>' +
            '<div class="r1-expiry-actions">' +
              (mode === 'expiration'
                ? '<button type="button" data-date="pao">PAO +900 DAYS · ' + label(pao900()) + '</button>'
                : '') +
              '<button type="button" class="primary" data-date="apply"' +
                (selection.month && selection.day && selection.year ? '' : ' disabled') + '>USE DATE</button>' +
              '<button type="button" data-date="cancel">CANCEL</button>' +
            '</div>';
        };

        root.addEventListener('click', event => {
          const button = event.target.closest('button[data-date]');
          if (!button || button.disabled) return;
          const action = button.dataset.date;
          const value = Number(button.dataset.value);

          if (action === 'month') {
            selection.month = value;
            selection.day = 1;
            selection.year = null;
            render();
            return;
          }
          if (action === 'day') {
            selection.day = value;
            selection.year = null;
            render();
            return;
          }
          if (action === 'year') {
            selection.year = value;
            render();
            return;
          }
          if (action === 'cancel') {
            close(null);
            return;
          }
          if (action === 'pao') {
            const enteredMs = pao900();
            close({ enteredMs, finalExpirationMs: enteredMs });
            return;
          }
          if (action === 'apply') {
            const enteredMs = validDate(selection.month, selection.day, selection.year);
            if (!enteredMs) return;
            const finalExpirationMs = mode === 'production'
              ? enteredMs + Number(ctx?.dateDetail?.shelfLife || 0)
              : enteredMs;
            close({ enteredMs, finalExpirationMs });
          }
        });

        render();
      });
    }

    class Session {
      constructor(destination) {
        this.destination = clean(destination);
        this.cache = new Map();
        this.establishedExpiration = null;
        this.chain = Promise.resolve();
      }

      get(code) {
        return this.cache.get(upper(code)) || null;
      }

      resolve(item, ctx) {
        const key = upper(item.code);
        if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));

        const task = this.chain.then(async () => {
          if (this.cache.has(key)) return this.cache.get(key);
          const chosen = await pick({
            mode: ctx.dateType === 'PRODUCTION_DATE' ? 'production' : 'expiration',
            ctx,
            scan: item.code
          });
          if (!chosen) return null;

          if (
            this.establishedExpiration != null &&
            chosen.finalExpirationMs !== this.establishedExpiration
          ) {
            const conflict = {
              conflict: true,
              enteredMs: chosen.enteredMs,
              finalExpirationMs: chosen.finalExpirationMs
            };
            this.cache.set(key, conflict);
            return conflict;
          }

          if (this.establishedExpiration == null) {
            this.establishedExpiration = chosen.finalExpirationMs;
          }
          this.cache.set(key, chosen);
          return chosen;
        });

        this.chain = task.catch(() => null);
        return task;
      }

      clear() {
        this.cache.clear();
        this.establishedExpiration = null;
        this.chain = Promise.resolve();
      }
    }

    return { pick, Session, label, active: () => !!active };
  })();

  const Native = (() => {
    const waiters = new Set();
    const listeners = new Set();
    let observer = null;
    let notifyQueued = false;
    let lastSource = '';

    function own(el) {
      return !!el?.closest?.('[data-r1-root]');
    }

    function visible(el) {
      if (!(el instanceof Element) || !el.isConnected || el.hidden || own(el)) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        rect.width > 0 &&
        rect.height > 0;
    }

    function text() {
      const selectors = 'h1,h2,h3,h4,label,legend,[role="heading"],button';
      return $$(selectors)
        .filter(visible)
        .slice(0, 140)
        .map(el => clean(el.innerText || el.textContent || el.value))
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    }

    function step() {
      const value = text();
      if (value.includes('enter quantity')) return 'QTY';
      if (value.includes('verify item')) return 'VERIFY';
      if (value.includes('production date')) return 'PRODUCTION';
      if (value.includes('expiration date') || value.includes('expiry date')) return 'EXPIRY';
      if (value.includes('scan destination container')) return 'DEST';
      if (value.includes('scan source container')) return 'SOURCE';
      if (value.includes('scan item')) return 'ITEM';
      return 'OTHER';
    }

    function input() {
      const direct = $('#scan-text-input');
      if (visible(direct)) return direct;
      return $$('input,textarea,[role="textbox"],[contenteditable="true"]')
        .find(el => {
          if (!visible(el)) return false;
          const type = norm(el.type);
          return !type || ['text', 'search', 'tel', 'number'].includes(type) ||
            el.tagName === 'TEXTAREA' || el.isContentEditable;
        }) || null;
    }

    function button(pattern) {
      const direct = $('#confirm-button');
      if (direct && visible(direct) && pattern.test(norm(direct.innerText || direct.textContent || direct.value))) {
        return direct;
      }
      return $$('button,[role="button"],input[type="button"],input[type="submit"]')
        .find(el => visible(el) && pattern.test(norm(el.innerText || el.textContent || el.value || ''))) || null;
    }

    function confirm() {
      const direct = $('#confirm-button');
      if (direct && visible(direct)) return direct;
      return button(/^(confirm|item match|continue|submit|enter)\b/);
    }

    function setValue(inputElement, value) {
      if (!inputElement) return false;
      const prototype = Object.getPrototypeOf(inputElement);
      const descriptor =
        Object.getOwnPropertyDescriptor(prototype, 'value') ||
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      const old = inputElement.value;
      if (descriptor?.set) descriptor.set.call(inputElement, String(value));
      else inputElement.value = String(value);
      inputElement._valueTracker?.setValue?.(old);
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    function fire() {
      notifyQueued = false;
      for (const waiter of [...waiters]) {
        let value = null;
        try { value = waiter.test(); } catch {}
        if (!value) continue;
        waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(value);
      }
      for (const listener of listeners) {
        try { listener(); } catch {}
      }
    }

    function notify() {
      if (notifyQueued) return;
      notifyQueued = true;
      queueMicrotask(fire);
    }

    function waitFor(test, timeout = 300000) {
      let initial = null;
      try { initial = test(); } catch {}
      if (initial) return Promise.resolve(initial);

      return new Promise(resolve => {
        const waiter = { test, resolve, timer: 0 };
        waiter.timer = setTimeout(() => {
          waiters.delete(waiter);
          resolve(null);
        }, timeout);
        waiters.add(waiter);
      });
    }

    function onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function captureSourceFromPage() {
      if (lastSource) return lastSource;
      const value = clean(document.body?.innerText || '').match(
        /source\s+container[\s:]*((?:ts|cs)x[0-9a-z_-]+)/i
      )?.[1];
      return clean(value);
    }

    function currentItemInfo() {
      const candidates = $$('a,h1,h2,h3,h4,strong')
        .filter(visible)
        .map(el => clean(el.innerText || el.textContent))
        .filter(value => value.length >= 18)
        .sort((a, b) => b.length - a.length);
      const pageText = clean(document.body?.innerText || '');
      const image = $$('img').filter(visible)
        .sort((a, b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return (br.width * br.height) - (ar.width * ar.height);
        })[0];

      return {
        title: candidates[0] || '',
        image: clean(image?.currentSrc || image?.src || ''),
        asin: upper(pageText.match(/\basin\s*:?\s*([a-z0-9]{10})\b/i)?.[1] || ''),
        fnsku: upper(pageText.match(/\bfnsku\s*:?\s*([a-z0-9]{10})\b/i)?.[1] || ''),
        barcode: upper(pageText.match(/\b(?:barcode|scan(?:ned)?)\s*:?\s*([a-z0-9_-]{8,24})\b/i)?.[1] || '')
      };
    }

    function dateInputs() {
      const inputs = $$('input,textarea').filter(visible);
      const hint = el => norm(
        (el.name || '') + ' ' + (el.id || '') + ' ' +
        (el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || '')
      );
      const month = inputs.find(el => /\b(mm|month)\b/.test(hint(el)));
      const day = inputs.find(el => /\b(dd|day)\b/.test(hint(el)));
      const year = inputs.find(el => /\b(yyyy|year)\b/.test(hint(el)));
      if (month && day && year) return { month, day, year };
      return inputs.length >= 3 ? { month: inputs[0], day: inputs[1], year: inputs[2] } : null;
    }

    async function submitDate(ms) {
      const inputs = await waitFor(dateInputs, 8000);
      if (!inputs) throw new Error('Native date fields not found');
      const date = new Date(ms);
      const values = [
        [inputs.month, String(date.getMonth() + 1).padStart(2, '0')],
        [inputs.day, String(date.getDate()).padStart(2, '0')],
        [inputs.year, String(date.getFullYear())]
      ];

      for (const [field, value] of values) {
        setValue(field, value);
        field.dispatchEvent(new Event('blur', { bubbles: true }));
      }

      const submit = confirm();
      if (!submit) throw new Error('Native date confirm button not found');
      submit.click();
    }

    async function runQty(qty, status) {
      const report = message => {
        if (typeof status === 'function') status(message);
      };

      report('QTY ' + qty + ' selected');
      if (step() === 'VERIFY') {
        const verify = confirm();
        if (!verify) throw new Error('Verify button not found');
        verify.click();
        report('QTY ' + qty + ' — Verify passed');
      }

      const quantityInput = await waitFor(() => step() === 'QTY' && input(), 300000);
      if (!quantityInput) throw new Error('Timed out waiting for quantity screen');

      setValue(quantityInput, qty);
      const submit = confirm();
      if (submit) submit.click();
      else quantityInput.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true
      }));
      report('QTY ' + qty + ' sent');
    }

    async function clearCurrent() {
      const change = button(/^change container\b/);
      if (!change) throw new Error('No open container');
      change.click();
      const yes = await waitFor(() => button(/^(yes|yes close|yes, close|empty|empty container)\b/), 5000);
      if (!yes) throw new Error('Clear confirmation not found');
      yes.click();
    }

    function start() {
      if (observer || !document.body) return;
      observer = new MutationObserver(notify);
      observer.observe(document.body, { childList: true, subtree: true });

      document.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        if (step() !== 'SOURCE') return;
        const scan = input();
        if (event.target !== scan) return;
        const value = clean(scan?.value);
        if (validContainer(value)) lastSource = value;
      }, true);

      notify();
    }

    return {
      start,
      step,
      input,
      confirm,
      setValue,
      waitFor,
      onChange,
      runQty,
      clearCurrent,
      currentSource: captureSourceFromPage,
      currentItemInfo,
      submitDate
    };
  })();

  const NativeExpiry = (() => {
    let busy = false;

    async function check() {
      if (busy || Expiry.active() || LazyEngine.active()) return;
      const step = Native.step();
      if (step !== 'EXPIRY' && step !== 'PRODUCTION') return;

      busy = true;
      try {
        const info = Native.currentItemInfo();
        const choice = await Expiry.pick({
          mode: step === 'PRODUCTION' ? 'production' : 'expiration',
          title: info.title,
          image: info.image,
          asin: info.asin,
          fnsku: info.fnsku,
          scan: info.barcode
        });
        if (choice) await Native.submitDate(choice.enteredMs);
      } catch (error) {
        trace('NATIVE_EXPIRY_ERROR', { message: clean(error?.message || error).slice(0, 160) });
      } finally {
        busy = false;
      }
    }

    function start() {
      Native.onChange(() => { void check(); });
      void check();
    }

    return { start };
  })();

  function parseContainers(text) {
    const seen = new Set();
    return (String(text).match(/\b(?:tsX|csX)[A-Za-z0-9_-]+\b/gi) || [])
      .filter(value => {
        const key = upper(value);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function parseItems(text, source = '', destination = '') {
    const map = new Map();
    const skip = new Set([upper(source), upper(destination), upper(START_TRIGGER)].filter(Boolean));

    for (const raw of String(text || '').split(/\r?\n/)) {
      const code = clean(raw);
      if (!code || skip.has(upper(code))) continue;
      const key = upper(code);
      const existing = map.get(key);
      if (existing) existing.qty++;
      else map.set(key, {
        code,
        qty: 1,
        status: '',
        ctx: null,
        issue: ''
      });
    }
    return [...map.values()];
  }

  function movePayload(source, destination, sourceMeta, ctx, qty, expirationMs) {
    const item = ctx.item;
    const sku = ctx.sku;
    const records = ctx.records?.length ? ctx.records : [item];

    return {
      itemExternalId: null,
      sourceContainerScannableId: source,
      destinationContainerScannableId: destination,
      scannableId: clean(item.scannableId || ctx.barcode),
      quantity: String(Math.max(1, Number(qty) || 1)),
      itemDetails: records.map(record => {
        const recordSku = record.skuDetail || sku;
        return {
          fcsku: clean(recordSku.fcSku),
          quantity: Number.isFinite(Number(record.quantity)) ? Number(record.quantity) : 0,
          consumerType: record.consumer ?? null,
          disposition: record.disposition ?? null,
          referenceId: record.referenceId ?? null,
          fnsku: clean(recordSku.fnSku)
        };
      }),
      foundProblems: [null, null, null],
      scannedSourceContainerAsDestination: false,
      datelotDetail: sku.datelotDetail || null,
      userEnteredExpirationDate: expirationMs ?? null,
      mlcCaptureDetail: {
        mlcClass: sku.mlcDetail?.mlcClass ?? 'UNKNOWN',
        userEnteredLotCode: null,
        mlcMissing: sku.mlcDetail?.mlcMissing ?? false,
        mlcNotEnteredReason: null,
        mlcCaptureMethod: null
      },
      itemMovedToISS: false,
      candidatePurchaseOrders: [],
      packHierarchyDetail: null,
      itemAndonContext: null,
      processPath: sourceMeta?.processPath ?? 'UNDETERMINED',
      requestId: requestId(),
      tool: TOOL
    };
  }

  const QueueEngine = (() => {
    let state = {
      running: false,
      paused: false,
      index: 0,
      items: [],
      failed: [],
      note: ''
    };
    let generation = 0;
    let view = () => {};

    const emit = () => {
      try { view({ ...state, items: [...state.items], failed: [...state.failed] }); } catch {}
    };

    async function start(text, listener) {
      if (state.running) return;
      view = typeof listener === 'function' ? listener : () => {};
      generation++;
      const run = generation;
      state = {
        running: true,
        paused: false,
        index: 0,
        items: parseContainers(text),
        failed: [],
        note: 'starting'
      };
      if (!state.items.length) {
        state.running = false;
        state.note = 'no containers';
        emit();
        return;
      }

      trace('QUEUE_START', { total: state.items.length });
      emit();

      while (run === generation && state.running && state.index < state.items.length) {
        while (run === generation && state.running && state.paused) await sleep(80);
        if (run !== generation || !state.running) break;

        const code = state.items[state.index];
        state.note = 'validating';
        emit();

        try {
          try {
            await Api.scanSource(code);
          } catch (error) {
            if (error?.customerBound) {
              state.index++;
              state.note = 'customer-bound — skipped';
              emit();
              continue;
            }
            throw error;
          }

          state.note = 'emptying';
          emit();
          await Api.closeContainer(code, true);
          state.index++;
          state.note = 'cleared';
          emit();
        } catch (error) {
          if (error?.outcomeUnknown) {
            state.failed.push(code + ' — CLOSE UNKNOWN');
            state.running = false;
            state.paused = false;
            state.note = 'STOPPED — VERIFY TOTE STATE';
            trace('QUEUE_UNKNOWN', { index: state.index, total: state.items.length });
            emit();
            return;
          }

          state.failed.push(code + ' — ' + clean(error?.message || error));
          state.index++;
          state.note = 'failed — continuing';
          emit();
        }
      }

      if (run === generation && state.running) {
        state.running = false;
        state.note = 'done';
        trace('QUEUE_DONE', { total: state.items.length, failed: state.failed.length });
        emit();
      }
    }

    function pause() {
      if (!state.running) return;
      state.paused = !state.paused;
      state.note = state.paused ? 'paused' : 'resumed';
      emit();
    }

    function stop() {
      generation++;
      state.running = false;
      state.paused = false;
      state.note = 'stopped';
      emit();
    }

    return { start, pause, stop, active: () => state.running, state: () => state };
  })();

  const LazyEngine = (() => {
    let runSeq = 0;
    let state = idleState();
    let view = () => {};
    let pauseResolver = null;
    let predicantResolver = null;

    function idleState() {
      return {
        running: false,
        paused: false,
        attention: '',
        source: '',
        destination: '',
        originalDestination: '',
        damagedDestination: '',
        sourceMeta: null,
        items: [],
        index: 0,
        error: '',
        note: '',
        clearSource: false,
        delay: true,
        nextMoveAt: 0,
        preflight: null,
        dates: null,
        controller: null
      };
    }

    function metrics() {
      let total = 0;
      let moved = 0;
      let failed = 0;
      let unknown = 0;
      let skipped = 0;

      for (const item of state.items) {
        const qty = itemQty(item);
        total += qty;
        if (item.status === 'MOVED') moved += qty;
        else if (item.status === 'FAILED' || item.status === 'INVALID' || item.status === 'ASIDE') failed += qty;
        else if (item.status === 'UNKNOWN') unknown += qty;
        else if (item.status === 'SKIPPED') skipped += qty;
      }

      return {
        total,
        unique: state.items.length,
        moved,
        failed: failed + unknown,
        unknown,
        skipped,
        remaining: Math.max(0, total - moved - failed - unknown - skipped)
      };
    }

    function snapshot() {
      return {
        running: state.running,
        paused: state.paused,
        attention: state.attention,
        source: state.source,
        destination: state.destination,
        originalDestination: state.originalDestination,
        damagedDestination: state.damagedDestination,
        index: state.index,
        error: state.error,
        note: state.note,
        clearSource: state.clearSource,
        delay: state.delay,
        metrics: metrics(),
        items: state.items.map(item => ({
          code: item.code,
          qty: item.qty,
          status: item.status,
          asin: clean(item.ctx?.asin),
          fnsku: clean(item.ctx?.fnsku),
          issue: clean(item.issue || item.failReason),
          dateType: clean(item.ctx?.dateType)
        }))
      };
    }

    function emit() {
      try { view(snapshot()); } catch {}
    }

    function cancelled(run) {
      return run !== runSeq || !state.running || state.controller?.signal.aborted;
    }

    async function waitRunnable(run) {
      while (!cancelled(run) && state.paused) {
        await new Promise(resolve => {
          pauseResolver = resolve;
          setTimeout(resolve, 250);
        });
        pauseResolver = null;
      }
      return !cancelled(run);
    }

    async function pace(run) {
      while (!cancelled(run) && state.delay && state.nextMoveAt > Date.now()) {
        if (!await waitRunnable(run)) return false;
        const left = state.nextMoveAt - Date.now();
        state.note = 'delay ' + Math.max(1, Math.ceil(left / 1000)) + 's';
        emit();
        await sleep(Math.min(150, Math.max(20, left)));
      }
      return !cancelled(run);
    }

    async function preflightAll(run) {
      state.note = 'preflight';
      emit();

      const results = await state.preflight.ensureAll(state.items);
      if (cancelled(run)) return false;

      for (let index = 0; index < state.items.length; index++) {
        const item = state.items[index];
        const result = results[index];

        if (!result || result.kind === 'retry') {
          state.error = 'PREFLIGHT LOOKUP FAILED — ' + item.code;
          state.note = 'no moves sent';
          emit();
          return false;
        }

        item.ctx = result.ctx || null;

        if (result.kind === 'red') {
          item.status = result?.ctx?.invalid ? 'INVALID' : 'ASIDE';
          item.failReason = result.reason || 'PREFLIGHT REJECTED';
          continue;
        }

        if (result.kind === 'yellow') {
          item.status = 'DATE';
          emit();
          const chosen = await state.dates.resolve(item, result.ctx);
          if (cancelled(run)) return false;

          if (!chosen) {
            state.error = 'DATE REQUIRED — ' + item.code;
            state.note = 'no moves sent';
            emit();
            return false;
          }

          if (chosen.conflict) {
            item.status = 'ASIDE';
            item.failReason = 'MIXED EXPIRY — PROCESS IN NEXT WORKFLOW';
            continue;
          }

          item.expirationMs = chosen.finalExpirationMs;
        }

        item.status = 'READY';
      }

      const movable = state.items.filter(item => item.status === 'READY');
      if (!movable.length) {
        state.error = 'Nothing to process — all items are ASIDE';
        state.note = 'no moves sent';
        emit();
        return false;
      }

      return true;
    }

    async function recoverPredicant(item, run) {
      state.paused = true;
      state.attention = 'rescan-destination';
      state.note = 'RESCAN DESTINATION ' + state.destination + ' TO CONTINUE';
      emit();

      await new Promise(resolve => { predicantResolver = resolve; });
      predicantResolver = null;
      if (cancelled(run)) return false;

      state.attention = 'predicant-recovery';
      state.note = 'emptying destination';
      emit();

      try {
        await Api.closeContainer(state.destination, true);
      } catch (error) {
        state.running = false;
        state.paused = false;
        state.attention = '';
        state.error = clean(error?.message || error);
        state.note = 'VERIFY DESTINATION STATE — NO AUTO RETRY';
        emit();
        return false;
      }

      if (cancelled(run)) return false;
      state.paused = false;
      state.attention = '';
      state.note = 'destination emptied — retrying ' + item.code;
      emit();
      return true;
    }

    async function moveItem(item, run) {
      item.status = 'MOVING';
      emit();

      while (!cancelled(run)) {
        if (!await waitRunnable(run)) return false;
        if (!await pace(run)) return false;

        const payload = movePayload(
          state.source,
          state.destination,
          state.sourceMeta,
          item.ctx,
          item.qty,
          item.expirationMs ?? null
        );

        let response;
        try {
          response = await Api.move(payload, state.controller.signal);
        } catch (error) {
          if (error?.submitted && error?.responseReceived !== true) {
            item.status = 'UNKNOWN';
            item.failReason = 'MOVE OUTCOME UNKNOWN — VERIFY BEFORE RETRY';
            state.running = false;
            state.error = item.code + ' — MOVE OUTCOME UNKNOWN';
            state.note = 'RUN HALTED';
            trace('LAZY_MOVE_UNKNOWN', { index: state.index, total: state.items.length });
            emit();
            return false;
          }

          item.status = 'FAILED';
          item.failReason = 'MOVE API ERROR — ' + clean(error?.message || error);
          emit();
          return false;
        }

        if (Rules.hasPredicant(response) && !Rules.moveOk(response)) {
          if (!await recoverPredicant(item, run)) return false;
          continue;
        }

        if (Rules.damagedDestination(response)) {
          item.status = 'DEST_RETRY';
          item.failReason = 'DESTINATION DAMAGED — WAITING TO RETRY';
          state.damagedDestination = state.destination;
          state.paused = true;
          state.attention = 'damaged-destination';
          state.error = 'DESTINATION DAMAGED — ' + state.destination;
          state.note = 'Enter a NEW destination, then Resume';
          emit();
          if (!await waitRunnable(run)) return false;
          item.status = 'MOVING';
          item.failReason = '';
          continue;
        }

        if (!Rules.moveOk(response)) {
          item.status = 'FAILED';
          item.failReason = Rules.moveReason(response);
          emit();
          return false;
        }

        item.status = 'MOVED';
        item.failReason = '';
        state.error = '';
        state.nextMoveAt = state.delay
          ? Date.now() + 2000 + Math.floor(Math.random() * 6001)
          : 0;
        emit();
        return true;
      }

      return false;
    }

    async function start(options = {}) {
      if (state.running) throw new Error('Lazy already running');

      const source = clean(options.source);
      const destination = clean(options.destination);
      const items = parseItems(options.items, source, destination);

      if (!validContainer(source)) throw new Error('Invalid source container');
      if (!validContainer(destination)) throw new Error('Invalid destination container');
      if (upper(source) === upper(destination)) throw new Error('Source and destination cannot match');
      if (!items.length) throw new Error('No item barcodes');

      runSeq++;
      const run = runSeq;
      view = typeof options.onUpdate === 'function' ? options.onUpdate : () => {};
      state = {
        ...idleState(),
        running: true,
        source,
        destination,
        originalDestination: destination,
        items,
        clearSource: options.clearSource === true,
        delay: options.delay !== false,
        preflight: options.preflight || new PreflightSession(source),
        dates: options.dates || new Expiry.Session(destination),
        controller: new AbortController(),
        note: 'starting'
      };

      trace('LAZY_START', { units: metrics().total, unique: items.length });
      emit();

      if (!await preflightAll(run)) {
        state.running = false;
        emit();
        return snapshot();
      }

      try {
        state.note = 'validating source';
        emit();
        state.sourceMeta = await Api.scanSource(source, state.controller.signal);
      } catch (error) {
        if (!cancelled(run)) {
          state.running = false;
          state.error = 'Source error — ' + clean(error?.message || error);
          state.note = 'no moves sent';
          emit();
        }
        return snapshot();
      }

      for (let index = 0; index < state.items.length && !cancelled(run); index++) {
        state.index = index;
        const item = state.items[index];
        if (item.status !== 'READY') continue;
        state.note = 'processing ' + (index + 1) + '/' + state.items.length + ' · ' + item.code;
        emit();
        await moveItem(item, run);
      }

      if (cancelled(run)) return snapshot();

      state.running = false;
      state.paused = false;
      state.attention = '';

      const result = metrics();
      const cleanRun = result.failed === 0 && result.unknown === 0 && result.skipped === 0;

      if (cleanRun && state.clearSource) {
        state.note = 'clearing source';
        emit();
        try {
          await Api.closeContainer(state.source, true);
        } catch (error) {
          state.error = clean(error?.message || error);
          state.note = 'moves complete — source clear not confirmed';
          emit();
          return snapshot();
        }
      }

      state.note = cleanRun
        ? 'complete'
        : 'complete — source left open';
      trace('LAZY_DONE', {
        total: result.total,
        moved: result.moved,
        failed: result.failed,
        unknown: result.unknown,
        skipped: result.skipped
      });
      emit();
      return snapshot();
    }

    function pause() {
      if (!state.running || state.attention === 'rescan-destination') return;
      state.paused = true;
      state.note = 'paused';
      emit();
    }

    function resume(options = {}) {
      if (!state.running || !state.paused) return;

      if (state.attention === 'damaged-destination') {
        const nextDestination = clean(options.destination);
        if (!validContainer(nextDestination) || upper(nextDestination) === upper(state.source)) {
          state.error = 'Enter a valid NEW destination';
          emit();
          return;
        }
        if (upper(nextDestination) === upper(state.damagedDestination)) {
          state.error = 'Destination is damaged — choose another';
          emit();
          return;
        }
        state.destination = nextDestination;
        state.damagedDestination = '';
        state.attention = '';
      }

      if (options.items != null) {
        const wanted = new Map(parseItems(options.items, state.source, state.destination)
          .map(item => [upper(item.code), item.qty]));

        for (const item of state.items) {
          if (['MOVED', 'FAILED', 'INVALID', 'ASIDE', 'UNKNOWN', 'SKIPPED'].includes(item.status)) continue;
          const keep = Math.max(0, Number(wanted.get(upper(item.code))) || 0);
          if (keep >= item.qty) continue;
          if (keep === 0) {
            item.status = 'SKIPPED';
            item.failReason = 'REMOVED WHILE PAUSED — NOT MOVED';
          } else {
            item.skippedQty = item.qty - keep;
            item.qty = keep;
          }
        }
      }

      state.error = '';
      state.paused = false;
      state.note = 'resumed';
      pauseResolver?.();
      emit();
    }

    function confirmPredicant(code) {
      if (
        state.running &&
        state.attention === 'rescan-destination' &&
        upper(code) === upper(state.destination)
      ) {
        state.paused = false;
        predicantResolver?.();
        return true;
      }
      return false;
    }

    function stop() {
      runSeq++;
      state.controller?.abort();
      state.running = false;
      state.paused = false;
      state.attention = '';
      state.note = 'stopped';
      pauseResolver?.();
      predicantResolver?.();
      pauseResolver = null;
      predicantResolver = null;
      emit();
    }

    function reset() {
      stop();
      state.preflight?.cancel?.();
      state.dates?.clear?.();
      state = idleState();
      emit();
    }

    return {
      start,
      pause,
      resume,
      stop,
      reset,
      confirmPredicant,
      active: () => state.running,
      state: snapshot
    };
  })();

  const AftBridge = (() => {
    let frame = null;
    let ready = false;
    let version = '';
    let readyWaiters = [];
    let sequence = 0;
    const pending = new Map();
    let progress = () => {};

    function id() {
      sequence++;
      return 'r1-aft-' + Date.now().toString(36) + '-' + sequence.toString(36);
    }

    function resolveReady() {
      const waiters = readyWaiters;
      readyWaiters = [];
      for (const waiter of waiters) waiter(true);
    }

    function onMessage(event) {
      if (!frame || event.origin !== AFT_ORIGIN || event.source !== frame.contentWindow) return;
      const message = event.data;
      if (!message || message.worker !== 'aft') return;

      if (message.type === 'ISS_CONSOLE_WORKER_READY') {
        ready = true;
        version = clean(message.version);
        resolveReady();
        try { progress({ area: 'worker', message: 'AFT READY', version }); } catch {}
        return;
      }

      if (message.type === 'ISS_CONSOLE_PROGRESS') {
        try { progress(message); } catch {}
        return;
      }

      if (message.type !== 'ISS_CONSOLE_RPC_RESULT') return;
      const key = String(message.id || '');
      const job = pending.get(key);
      if (!job) return;
      pending.delete(key);
      clearTimeout(job.timer);

      if (message.ok) {
        job.resolve(message.data);
      } else {
        const error = new Error(message.error || job.command + ' failed');
        if (message.data && typeof message.data === 'object') error.data = message.data;
        job.reject(error);
      }
    }

    function mount(onProgress) {
      if (typeof onProgress === 'function') progress = onProgress;
      if (frame) return;
      window.addEventListener('message', onMessage);

      frame = document.createElement('iframe');
      frame.className = 'r1-aft-frame';
      frame.src = AFT_WORKER_URL;
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      markUi(frame);
      document.body.appendChild(frame);
    }

    async function waitReady(timeout = 20000) {
      if (ready) return true;
      return new Promise(resolve => {
        let done = false;
        const finish = value => {
          if (done) return;
          done = true;
          resolve(value);
        };
        readyWaiters.push(finish);
        setTimeout(() => finish(false), timeout);
      });
    }

    async function call(command, payload = {}, timeout = 600000) {
      if (!frame) mount();
      if (!await waitReady()) throw new Error('AFT worker not ready');

      const key = id();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(key);
          const error = new Error(command + ' timed out — VERIFY STATE BEFORE RETRY');
          error.timeout = true;
          reject(error);
        }, timeout);

        pending.set(key, { resolve, reject, timer, command });
        frame.contentWindow.postMessage({
          type: 'ISS_CONSOLE_RPC',
          worker: 'aft',
          id: key,
          command,
          payload
        }, AFT_ORIGIN);
      });
    }

    function stop() {
      return call('stop', {}, 10000);
    }

    return {
      mount,
      call,
      stop,
      ready: () => ready,
      version: () => version
    };
  })();

  const Css = (() => {
    const text = [
      '[data-r1-root]{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}',
      '[data-r1-root] *{box-sizing:border-box}',
      '.r1-hidden{display:none!important}',
      '.r1-btn{height:34px;border:1px solid #9faec0;border-radius:3px;background:#f7f8fa;color:#17324d;font-weight:900;cursor:pointer}',
      '.r1-btn:hover{background:#e8edf2}',
      '.r1-btn.on,.r1-btn.primary{background:#315f7f;color:#fff;border-color:#315f7f}',
      '.r1-btn.stop{background:#fff7ed;color:#9a3412;border-color:#fdba74}',
      '.r1-btn.danger{background:#fff1f2;color:#991b1b;border-color:#ef4444}',
      '.r1-input{width:100%;border:1px solid #aab7c6;border-radius:3px;background:#fff;color:#172033;font:800 13px Arial,sans-serif;padding:8px;outline:none}',
      '.r1-input:focus{border-color:#315f7f;box-shadow:0 0 0 2px rgba(49,95,127,.15)}',
      '.r1-input.good{border-color:#18794e}.r1-input.bad{border-color:#b00020}',
      '.r1-label{display:block;margin:5px 0 3px;color:#385674;font-size:10px;font-weight:900;letter-spacing:.35px}',
      '.r1-status{min-height:29px;margin-top:6px;padding:7px 9px;border:1px solid #c1ccd6;background:#f8fafc;color:#334155;font-weight:800}',
      '.r1-status[data-kind="ok"]{border-color:#18794e;background:#ecfdf5;color:#14532d}',
      '.r1-status[data-kind="error"]{border:3px solid #7a0000;background:#b00020;color:#fff;font-weight:1000}',
      '.r1-status[data-kind="attention"]{border:2px solid #b45309;background:#fff7ed;color:#7c2d12}',
      '#r1-dock{position:fixed;right:14px;bottom:12px;z-index:2147483647;display:grid;grid-template-columns:repeat(4,1fr);gap:5px;width:560px;padding:6px;background:#f2f4f6;border:1px solid #aab7c6;box-shadow:0 3px 9px #0002}',
      '#r1-dock button{height:34px}',
      '.r1-panel{position:fixed;right:14px;z-index:2147483646;width:720px;max-width:calc(100vw - 28px);padding:10px;background:#fff;border:1px solid #aab7c6;box-shadow:0 3px 9px #0002;color:#122b49}',
      '.r1-panel-head{display:flex;align-items:center;justify-content:space-between;margin:-10px -10px 9px;padding:9px 11px;background:#f1f3f5;border-left:4px solid #7894ad;border-bottom:1px solid #c4ced8}',
      '.r1-panel-head strong{font-size:19px;color:#0b2c4b}.r1-panel-head span{font-size:10px;font-weight:800;color:#60758c}',
      '.r1-two{display:grid;grid-template-columns:1fr 1fr;gap:8px}.r1-actions{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-top:7px}',
      '.r1-queue-actions{grid-template-columns:repeat(3,1fr)}',
      '.r1-textarea{min-height:72px;resize:vertical;font-family:Consolas,monospace}',
      '.r1-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:7px 0}',
      '.r1-metric{padding:6px;text-align:center;border:1px solid #b8c5d2;background:#f5f7f9;font-size:9px;font-weight:900;text-transform:uppercase}',
      '.r1-metric b{display:block;margin-top:2px;color:#0e2f4f;font-size:19px}',
      '.r1-preflight{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;margin:7px 0;padding:8px 9px;border:2px solid #94a3b8;border-left-width:7px;background:#f8fafc}',
      '.r1-preflight.green{border-color:#18794e;background:#ecfdf5;color:#14532d}',
      '.r1-preflight.yellow{border-color:#b7791f;background:#fffbeb;color:#78350f}',
      '.r1-preflight.red{border:4px solid #7a0000;border-left-width:12px;background:#b00020;color:#fff}',
      '.r1-preflight strong{display:block;font-size:12px;font-weight:1000}.r1-preflight span{font:800 11px Consolas,monospace}',
      '.r1-preflight-counts{display:flex;gap:5px}.r1-preflight-counts b{padding:4px 6px;border:1px solid currentColor;background:#fff;color:#334155;font-size:9px}',
      '.r1-items{max-height:190px;overflow:auto;margin-top:6px;border-top:1px solid #d5dbe3;padding-top:5px}',
      '.r1-item{padding:6px 7px;margin-bottom:3px;border:1px solid #d6dde5;background:#f8fafc;font:800 12px Consolas,monospace}',
      '.r1-item[data-state="MOVED"]{border-color:#18794e;background:#ecfdf5;color:#14532d}',
      '.r1-item[data-state="MOVING"],.r1-item[data-state="READY"]{border-color:#315f7f;background:#eef6fb;color:#173c5d}',
      '.r1-item[data-state="DATE"]{border-color:#b7791f;background:#fffbeb;color:#78350f}',
      '.r1-item[data-state="FAILED"],.r1-item[data-state="INVALID"],.r1-item[data-state="ASIDE"],.r1-item[data-state="UNKNOWN"]{border:2px solid #7a0000;border-left-width:7px;background:#fff1f2;color:#7a0000}',
      '.r1-item[data-state="DEST_RETRY"]{border:2px solid #b45309;background:#fff7ed;color:#7c2d12}',
      '#r1-aside{position:fixed;left:14px;bottom:60px;z-index:2147483646;width:360px;max-height:420px;overflow:auto;padding:9px;background:#fff;border:4px solid #7a0000;box-shadow:0 3px 10px #0003;color:#7a0000}',
      '#r1-aside h3{margin:0 0 7px;font-size:14px}.r1-aside-row{padding:7px;border-top:1px solid #fecaca;font-weight:900}',
      '#r1-qty{left:14px;right:auto;width:300px}.r1-qty-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}.r1-qty-grid button{height:40px;font-size:15px}',
      '#r1-expiry{position:fixed;inset:0;z-index:2147483647;background:rgba(31,41,55,.38);display:flex;align-items:flex-start;justify-content:center;padding:36px 12px}',
      '.r1-expiry-card{width:920px;max-width:100%;padding:8px;background:#4b5563;border-radius:12px;box-shadow:0 12px 30px #0006}',
      '.r1-expiry-head{padding:9px;background:#fff;text-align:center;font-size:16px;font-weight:1000}',
      '.r1-expiry-item{display:grid;grid-template-columns:150px 1fr;gap:16px;align-items:center;margin-top:8px;padding:10px;background:#fff}',
      '.r1-expiry-item img,.r1-expiry-item>div:first-child{width:150px;height:150px;object-fit:contain;background:#fff}',
      '.r1-expiry-item strong{display:block;font-size:24px}.r1-expiry-item span{display:block;margin-top:4px;font-weight:800;color:#475569}.r1-expiry-item code{display:inline-block;margin-top:7px;padding:5px 7px;border:2px solid #315f7f;background:#eef6fb;font-weight:900}',
      '.r1-date-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-top:7px}.r1-date-grid section{padding:8px;background:#fff;border:2px solid #f97316;border-radius:8px}.r1-date-grid section>b{display:block;margin-bottom:6px;color:#9a3412}',
      '.r1-date-grid section>div{display:grid;gap:4px}.r1-date-grid .months,.r1-date-grid .years{grid-template-columns:repeat(4,1fr)}.r1-date-grid .days{grid-template-columns:repeat(7,1fr)}',
      '.r1-date-grid button{height:33px;border:1px solid #c7d2fe;border-radius:5px;background:#f5f7ff;color:#1e3a8a;font-weight:850;cursor:pointer}.r1-date-grid button.selected{background:#2563eb;color:#fff}.r1-date-grid button:disabled{opacity:.32}',
      '.r1-expiry-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:7px}.r1-expiry-actions button{height:45px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;font-weight:900;cursor:pointer}.r1-expiry-actions .primary,.r1-expiry-actions [data-date="pao"]{background:#315f7f;color:#fff;border-color:#315f7f}',
      '#r1-iss{position:fixed;inset:0;z-index:2147483645;overflow:auto;background:#eaeded;color:#172033}',
      '.r1-iss-top{height:72px;padding:0 24px;display:flex;align-items:center;justify-content:space-between;background:#fff;border-bottom:1px solid #c8d0d8}',
      '.r1-iss-brand{display:flex;align-items:baseline;gap:10px}.r1-iss-brand .site{font-size:18px;font-weight:1000;color:#ff9900}.r1-iss-brand strong{font-size:24px;color:#17324d}',
      '.r1-worker{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:900;color:#5b6875}.r1-worker i{width:8px;height:8px;border-radius:50%;background:#b8c0c8}.r1-worker i.ready{background:#2f8a46}',
      '.r1-iss-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;padding:18px 20px}.r1-iss-card{min-width:0;background:#fff;border:1px solid #b8c2cc}.r1-iss-card.active{border-color:#4b789f;box-shadow:0 2px 8px rgba(29,68,102,.18)}',
      '.r1-iss-card h2{margin:0;padding:13px 14px;background:#f3f4f5;border-left:5px solid #8798a8;border-bottom:1px solid #cbd2d9;color:#17324d}.r1-iss-card.active h2{border-left-color:#146eb4;background:#eef4f8}',
      '.r1-iss-body{padding:12px}.r1-segment{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-bottom:8px}.r1-segment.two{grid-template-columns:repeat(2,1fr)}',
      '.r1-choice{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}.r1-choice.damage{grid-template-columns:repeat(2,1fr)}.r1-choice button{font-size:10px}',
      '.r1-iss-body textarea{min-height:150px}.r1-flow{text-align:center;color:#7894ad;font-size:18px;font-weight:900}',
      '.r1-iss-actions{display:grid;grid-template-columns:2fr 1fr 1fr;gap:5px;margin-top:8px}',
      '.r1-qty-table{display:grid;gap:4px;max-height:105px;overflow:auto;margin-bottom:7px}.r1-qty-row{display:grid;grid-template-columns:minmax(100px,1.2fr) repeat(3,1fr);gap:4px;padding:4px;border:1px solid #c5cfd6;background:#fff}.r1-qty-row b{text-align:center;padding:5px;border-top:3px solid #9fb0b7;background:#f8fafc}.r1-qty-row code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px}',
      '.r1-side-alert{display:none;margin:8px 0;padding:10px;border:3px solid #b45309;background:#fff7ed;color:#7c2d12;text-align:center;font-weight:1000}.r1-side-alert.show{display:block}',
      '.r1-aft-frame{position:fixed!important;left:-12000px!important;top:0!important;width:2px!important;height:2px!important;opacity:0!important;pointer-events:none!important;border:0!important}',
      '@media(max-width:1200px){.r1-iss-grid{grid-template-columns:1fr}.r1-panel{width:calc(100vw - 28px)}#r1-dock{width:calc(100vw - 28px)}}'
    ].join('\n');

    function install() {
      if ($('#r1-style')) return;
      const style = document.createElement('style');
      style.id = 'r1-style';
      style.textContent = text;
      (document.head || document.documentElement).appendChild(style);
    }

    return { install };
  })();

  const Standalone = (() => {
    let root = null;
    let panels = {};
    let panelState = Store.json('panels', { queue: false, lazy: false, qty: false });
    let preflight = null;
    let dates = null;
    let sourceKey = '';
    let preflightRenderTimer = 0;
    let qtyBusy = false;

    const refs = {};

    function panel(id, title, subtitle) {
      const node = markUi(document.createElement('section'));
      node.id = id;
      node.className = 'r1-panel';
      node.innerHTML =
        '<div class="r1-panel-head"><strong>' + esc(title) + '</strong><span>' + esc(subtitle || '') + '</span></div>';
      document.body.appendChild(node);
      return node;
    }

    function layout() {
      let bottom = 58;
      for (const key of ['lazy', 'queue']) {
        const node = panels[key];
        if (!node || !panelState[key]) {
          if (node) node.style.display = 'none';
          continue;
        }
        node.style.display = 'block';
        node.style.bottom = bottom + 'px';
        bottom += Math.max(85, node.offsetHeight) + 10;
      }
      if (panels.qty) panels.qty.style.display = panelState.qty ? 'block' : 'none';
      for (const button of $$('#r1-dock [data-panel-key]')) {
        button.classList.toggle('on', !!panelState[button.dataset.panelKey]);
      }
    }

    function scheduleLayout() {
      requestAnimationFrame(layout);
    }

    function setPanel(key) {
      panelState[key] = !panelState[key];
      Store.setJson('panels', panelState);
      layout();
    }

    function queueView(state) {
      refs.qStatus.textContent =
        (state.running ? (state.paused ? 'PAUSED' : 'RUNNING') : 'STOPPED') +
        ' · ' + Math.min(state.index, state.items.length) + '/' + state.items.length +
        (state.items[state.index] ? ' · ' + state.items[state.index] : '') +
        (state.note ? ' · ' + state.note : '');
      refs.qStatus.dataset.kind = state.failed.length ? 'error' : (state.note === 'done' ? 'ok' : '');
      refs.qErrors.textContent = state.failed.join('\n');
      refs.qPause.textContent = state.paused ? 'Resume' : 'Pause';
      scheduleLayout();
    }

    function renderLazy(state = LazyEngine.state()) {
      const metrics = state.metrics || { total: 0, unique: 0, moved: 0, failed: 0, remaining: 0 };
      refs.mTotal.textContent = metrics.total;
      refs.mUnique.textContent = metrics.unique;
      refs.mMoved.textContent = metrics.moved;
      refs.mRemaining.textContent = metrics.remaining;

      refs.lazyStatus.textContent =
        (state.running ? (state.paused ? 'PAUSED' : 'RUNNING') : 'IDLE') +
        (state.note ? ' · ' + state.note : '');
      refs.lazyStatus.dataset.kind = state.error
        ? 'error'
        : state.attention
          ? 'attention'
          : (!state.running && state.note === 'complete' ? 'ok' : '');

      if (state.error) refs.lazyStatus.textContent += ' · ' + state.error;
      refs.lazyPause.textContent = state.paused ? 'Resume' : 'Pause';

      refs.lazyAlert.classList.toggle('show', !!state.attention);
      if (state.attention === 'rescan-destination') {
        refs.lazyAlert.textContent = '⚠ RESCAN DESTINATION ' + state.destination + ' TO CONTINUE';
      } else if (state.attention === 'damaged-destination') {
        refs.lazyAlert.textContent = '⚠ DESTINATION DAMAGED — ENTER A NEW DESTINATION THEN RESUME';
      } else if (state.attention === 'predicant-recovery') {
        refs.lazyAlert.textContent = 'RECOVERY — EMPTYING DESTINATION';
      } else {
        refs.lazyAlert.textContent = '';
      }

      refs.lazyItems.innerHTML = (state.items || []).map(item =>
        '<div class="r1-item" data-state="' + esc(upper(item.status || '')) + '">' +
          '<b>' + esc(item.status || 'WAITING') + '</b> · ' +
          esc(item.code) + ' ×' + item.qty +
          (item.asin ? ' · ASIN ' + esc(item.asin) : '') +
          (item.fnsku ? ' · FNSKU ' + esc(item.fnsku) : '') +
          (item.issue ? '<br>' + esc(item.issue) : '') +
        '</div>'
      ).join('');
      scheduleLayout();
    }

    function renderAside(items, source) {
      const aside = refs.aside;
      if (!aside) return;
      const rows = [];

      for (const item of items) {
        const result = preflight?.get(item.code);
        const date = dates?.get(item.code);
        const isRed = result?.kind === 'red' || result?.kind === 'retry' || date?.conflict;
        if (!isRed) continue;
        rows.push({
          code: item.code,
          qty: item.qty,
          reason: date?.conflict
            ? 'MIXED EXPIRY — NEXT WORKFLOW'
            : result?.reason || 'LOOKUP FAILED — RETRY'
        });
      }

      if (!validContainer(source) || !rows.length) {
        aside.hidden = true;
        aside.innerHTML = '';
        return;
      }

      aside.hidden = false;
      aside.innerHTML =
        '<h3>ASIDE / NOT PROCESSING</h3>' +
        rows.map(row =>
          '<div class="r1-aside-row">' + esc(row.code) + ' ×' + row.qty +
          '<br>' + esc(row.reason) + '</div>'
        ).join('');
    }

    function renderPreflight() {
      clearTimeout(preflightRenderTimer);
      const source = clean(refs.lazySource.value);
      const items = parseItems(refs.lazyItemsInput.value, source, refs.lazyDest.value);
      let green = 0;
      let yellow = 0;
      let red = 0;
      let last = { kind: '', code: '', reason: 'Scan an item' };

      for (const item of items) {
        const result = preflight?.get(item.code);
        const date = dates?.get(item.code);
        if (!result) continue;

        if (result.kind === 'red' || result.kind === 'retry' || date?.conflict) {
          red += item.qty;
          last = {
            kind: 'red',
            code: item.code,
            reason: date?.conflict ? 'MIXED EXPIRY — NEXT WORKFLOW' : result.reason
          };
        } else if (result.kind === 'yellow') {
          yellow += item.qty;
          last = { kind: 'yellow', code: item.code, reason: date ? 'DATE READY' : result.reason };
        } else {
          green += item.qty;
          last = { kind: 'green', code: item.code, reason: result.reason };
        }
      }

      refs.preflight.className = 'r1-preflight ' + last.kind;
      refs.preflightMain.innerHTML =
        '<strong>' +
          (last.kind === 'red'
            ? '✕ PUT ASIDE — DO NOT PROCESS'
            : last.kind === 'yellow'
              ? '⚠ EXPIRY — KEEP'
              : last.kind === 'green'
                ? '✓ GOOD — KEEP'
                : 'PREFLIGHT READY') +
        '</strong><span>' +
          esc(last.code ? last.code + ' — ' + last.reason : last.reason) +
        '</span>';
      refs.pfGood.textContent = green + ' GOOD';
      refs.pfDate.textContent = yellow + ' EXPIRY';
      refs.pfRed.textContent = red + ' ASIDE';
      renderAside(items, source);
      scheduleLayout();
    }

    async function onPreflightResult(code, result) {
      if (result?.kind === 'yellow') {
        const item = parseItems(refs.lazyItemsInput.value, refs.lazySource.value, refs.lazyDest.value)
          .find(entry => upper(entry.code) === upper(code));
        if (item && !dates.get(code)) {
          const chosen = await dates.resolve(item, result.ctx);
          if (chosen?.conflict) trace('EXPIRY_MIXED_BLOCK', {});
        }
      }
      renderPreflight();
    }

    function ensurePreflight() {
      const source = clean(refs.lazySource.value);
      const key = upper(source);
      if (!validContainer(source)) {
        preflight?.cancel();
        preflight = null;
        dates?.clear();
        dates = null;
        sourceKey = '';
        renderPreflight();
        return;
      }

      if (sourceKey !== key || !preflight) {
        preflight?.cancel();
        dates?.clear();
        sourceKey = key;
        dates = new Expiry.Session(clean(refs.lazyDest.value));
        preflight = new PreflightSession(source, onPreflightResult);
      }

      const items = parseItems(refs.lazyItemsInput.value, source, refs.lazyDest.value);
      for (const item of items) void preflight.ensure(item.code);
      renderPreflight();
    }

    function debouncePreflight() {
      clearTimeout(preflightRenderTimer);
      preflightRenderTimer = setTimeout(ensurePreflight, 80);
    }

    function resetWorkflowUi() {
      preflight?.cancel();
      dates?.clear();
      preflight = null;
      dates = null;
      sourceKey = '';
      refs.lazySource.value = '';
      refs.lazyDest.value = '';
      refs.lazyItemsInput.value = '';
      renderPreflight();
      renderLazy();
    }

    async function runLazy() {
      ensurePreflight();
      try {
        const result = await LazyEngine.start({
          source: refs.lazySource.value,
          destination: refs.lazyDest.value,
          items: refs.lazyItemsInput.value,
          clearSource: refs.clearSource.checked,
          delay: refs.delay.checked,
          preflight,
          dates,
          onUpdate: renderLazy
        });

        if (
          result.metrics &&
          result.metrics.failed === 0 &&
          result.metrics.unknown === 0 &&
          result.metrics.skipped === 0 &&
          result.metrics.moved === result.metrics.total
        ) {
          const note = result.note;
          resetWorkflowUi();
          refs.lazyStatus.textContent = 'IDLE · ' + note;
          refs.lazyStatus.dataset.kind = 'ok';
        }
      } catch (error) {
        refs.lazyStatus.textContent = clean(error?.message || error);
        refs.lazyStatus.dataset.kind = 'error';
      }
    }

    function currentLine(textarea) {
      const value = textarea.value;
      const pos = textarea.selectionStart ?? value.length;
      const start = value.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
      const next = value.indexOf('\n', pos);
      const end = next < 0 ? value.length : next;
      return { value, start, end, code: clean(value.slice(start, end)) };
    }

    function removeLine(textarea, line) {
      let before = line.value.slice(0, line.start);
      let after = line.value.slice(line.end);
      if (before.endsWith('\n') && after.startsWith('\n')) after = after.slice(1);
      textarea.value = before + after;
      textarea.setSelectionRange?.(textarea.value.length, textarea.value.length);
    }

    function scannerTextarea(event) {
      if (event.key !== 'Enter' || event.shiftKey) return;
      const line = currentLine(refs.lazyItemsInput);
      const code = upper(line.code);
      const source = upper(refs.lazySource.value);
      const destination = upper(refs.lazyDest.value);
      const special = code && (code === source || code === destination || code === upper(START_TRIGGER));

      if (special) {
        event.preventDefault();
        event.stopPropagation();
        removeLine(refs.lazyItemsInput, line);

        if (LazyEngine.active() && LazyEngine.confirmPredicant(line.code)) {
          renderLazy();
          return;
        }

        if (!LazyEngine.active()) void runLazy();
        return;
      }

      event.preventDefault();
      const start = refs.lazyItemsInput.selectionStart ?? refs.lazyItemsInput.value.length;
      const end = refs.lazyItemsInput.selectionEnd ?? start;
      const before = refs.lazyItemsInput.value.slice(0, start).replace(/[\t ]+$/, '');
      const after = refs.lazyItemsInput.value.slice(end).replace(/^\r?\n+/, '');
      refs.lazyItemsInput.value = before + '\n' + after;
      const caret = before.length + 1;
      refs.lazyItemsInput.setSelectionRange?.(caret, caret);
      debouncePreflight();
    }

    function build() {
      Css.install();

      root = markUi(document.createElement('div'));
      root.id = 'r1-standalone-root';

      const dock = markUi(document.createElement('div'));
      dock.id = 'r1-dock';
      dock.innerHTML =
        '<button class="r1-btn" data-panel-key="queue">QUEUE</button>' +
        '<button class="r1-btn" data-panel-key="lazy">LAZY</button>' +
        '<button class="r1-btn" data-panel-key="qty">QTY</button>' +
        '<button class="r1-btn" data-open-iss>ISS</button>';
      document.body.appendChild(dock);

      panels.queue = panel('r1-queue', 'TOTE QUEUE', 'API');
      panels.queue.innerHTML +=
        '<textarea class="r1-input r1-textarea" data-q-list placeholder="Paste tsX/csX list"></textarea>' +
        '<div class="r1-actions r1-queue-actions">' +
          '<button class="r1-btn primary" data-q-start>Start</button>' +
          '<button class="r1-btn" data-q-pause>Pause</button>' +
          '<button class="r1-btn stop" data-q-stop>Stop</button>' +
        '</div>' +
        '<div class="r1-status" data-q-status></div>' +
        '<pre data-q-errors style="white-space:pre-wrap;margin:5px 0 0;color:#991b1b;font-weight:800"></pre>';

      panels.lazy = panel('r1-lazy', 'SIDELINE', 'LAZY');
      panels.lazy.innerHTML +=
        '<div class="r1-two">' +
          '<div><label class="r1-label">SOURCE</label><input class="r1-input" data-l-source placeholder="tsX / csX"></div>' +
          '<div><label class="r1-label">DESTINATION</label><input class="r1-input" data-l-dest placeholder="tsX / csX"></div>' +
        '</div>' +
        '<label class="r1-label">ITEM BARCODES</label>' +
        '<textarea class="r1-input r1-textarea" data-l-items placeholder="Scan or paste one per line"></textarea>' +
        '<div class="r1-preflight" data-preflight>' +
          '<div data-pf-main><strong>PREFLIGHT READY</strong><span>Scan an item</span></div>' +
          '<div class="r1-preflight-counts"><b data-pf-good>0 GOOD</b><b data-pf-date>0 EXPIRY</b><b data-pf-red>0 ASIDE</b></div>' +
        '</div>' +
        '<div class="r1-two">' +
          '<button class="r1-btn on" data-l-clear>CLEAR SOURCE: ON</button>' +
          '<button class="r1-btn on" data-l-delay>DELAY 2–8s: ON</button>' +
        '</div>' +
        '<input type="checkbox" data-l-clear-box hidden><input type="checkbox" data-l-delay-box hidden>' +
        '<div class="r1-actions">' +
          '<button class="r1-btn primary" data-l-run>RUN LAZY</button>' +
          '<button class="r1-btn" data-l-pause>Pause</button>' +
          '<button class="r1-btn stop" data-l-stop>Stop</button>' +
          '<button class="r1-btn" data-l-reset>Reset</button>' +
        '</div>' +
        '<div class="r1-metrics">' +
          '<div class="r1-metric">Total units<b data-m-total>0</b></div>' +
          '<div class="r1-metric">Unique items<b data-m-unique>0</b></div>' +
          '<div class="r1-metric">Moved<b data-m-moved>0</b></div>' +
          '<div class="r1-metric">Remaining<b data-m-remaining>0</b></div>' +
        '</div>' +
        '<div class="r1-side-alert" data-l-alert></div>' +
        '<div class="r1-status" data-l-status>IDLE</div>' +
        '<div class="r1-items" data-l-state></div>';

      panels.qty = panel('r1-qty', 'QTY QUICK SELECT', 'NATIVE');
      panels.qty.innerHTML +=
        '<div class="r1-qty-grid" data-qty-grid></div>' +
        '<button class="r1-btn danger" style="width:100%;margin-top:7px" data-clear-tote>double click = clear</button>' +
        '<div class="r1-status" data-qty-status>Ready</div>';

      refs.aside = markUi(document.createElement('aside'));
      refs.aside.id = 'r1-aside';
      refs.aside.hidden = true;
      document.body.appendChild(refs.aside);

      refs.qList = $('[data-q-list]', panels.queue);
      refs.qStart = $('[data-q-start]', panels.queue);
      refs.qPause = $('[data-q-pause]', panels.queue);
      refs.qStop = $('[data-q-stop]', panels.queue);
      refs.qStatus = $('[data-q-status]', panels.queue);
      refs.qErrors = $('[data-q-errors]', panels.queue);

      refs.lazySource = $('[data-l-source]', panels.lazy);
      refs.lazyDest = $('[data-l-dest]', panels.lazy);
      refs.lazyItemsInput = $('[data-l-items]', panels.lazy);
      refs.clearSource = $('[data-l-clear-box]', panels.lazy);
      refs.delay = $('[data-l-delay-box]', panels.lazy);
      refs.clearButton = $('[data-l-clear]', panels.lazy);
      refs.delayButton = $('[data-l-delay]', panels.lazy);
      refs.lazyRun = $('[data-l-run]', panels.lazy);
      refs.lazyPause = $('[data-l-pause]', panels.lazy);
      refs.lazyStop = $('[data-l-stop]', panels.lazy);
      refs.lazyReset = $('[data-l-reset]', panels.lazy);
      refs.lazyStatus = $('[data-l-status]', panels.lazy);
      refs.lazyAlert = $('[data-l-alert]', panels.lazy);
      refs.lazyItems = $('[data-l-state]', panels.lazy);
      refs.preflight = $('[data-preflight]', panels.lazy);
      refs.preflightMain = $('[data-pf-main]', panels.lazy);
      refs.pfGood = $('[data-pf-good]', panels.lazy);
      refs.pfDate = $('[data-pf-date]', panels.lazy);
      refs.pfRed = $('[data-pf-red]', panels.lazy);
      refs.mTotal = $('[data-m-total]', panels.lazy);
      refs.mUnique = $('[data-m-unique]', panels.lazy);
      refs.mMoved = $('[data-m-moved]', panels.lazy);
      refs.mRemaining = $('[data-m-remaining]', panels.lazy);

      refs.qtyStatus = $('[data-qty-status]', panels.qty);
      const grid = $('[data-qty-grid]', panels.qty);
      for (let value = 1; value <= 10; value++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'r1-btn';
        button.textContent = String(value);
        button.addEventListener('click', async () => {
          if (qtyBusy) return;
          qtyBusy = true;
          try {
            await Native.runQty(value, message => {
              refs.qtyStatus.textContent = message;
              refs.qtyStatus.dataset.kind = '';
            });
          } catch (error) {
            refs.qtyStatus.textContent = clean(error?.message || error);
            refs.qtyStatus.dataset.kind = 'error';
          } finally {
            qtyBusy = false;
          }
        });
        grid.appendChild(button);
      }

      $('[data-clear-tote]', panels.qty).addEventListener('dblclick', async event => {
        event.preventDefault();
        if (qtyBusy) return;
        qtyBusy = true;
        try {
          refs.qtyStatus.textContent = 'Clearing current tote…';
          await Native.clearCurrent();
          refs.qtyStatus.textContent = 'Current tote cleared';
          refs.qtyStatus.dataset.kind = 'ok';
        } catch (error) {
          refs.qtyStatus.textContent = clean(error?.message || error);
          refs.qtyStatus.dataset.kind = 'error';
        } finally {
          qtyBusy = false;
        }
      });

      for (const button of $$('[data-panel-key]', dock)) {
        button.addEventListener('click', () => setPanel(button.dataset.panelKey));
      }

      $('[data-open-iss]', dock).addEventListener('click', () => {
        if (QueueEngine.active() || LazyEngine.active() || qtyBusy) {
          const button = $('[data-open-iss]', dock);
          button.textContent = 'BUSY';
          setTimeout(() => { button.textContent = 'ISS'; }, 900);
          return;
        }
        location.hash = '#iss-console';
        location.reload();
      });

      refs.qStart.addEventListener('click', () => { void QueueEngine.start(refs.qList.value, queueView); });
      refs.qPause.addEventListener('click', QueueEngine.pause);
      refs.qStop.addEventListener('click', QueueEngine.stop);

      refs.clearSource.checked = Store.get('clearSource', '1') !== '0';
      refs.delay.checked = Store.get('delay', '1') !== '0';

      const paintToggles = () => {
        refs.clearButton.textContent = 'CLEAR SOURCE: ' + (refs.clearSource.checked ? 'ON' : 'OFF');
        refs.clearButton.classList.toggle('on', refs.clearSource.checked);
        refs.delayButton.textContent = 'DELAY 2–8s: ' + (refs.delay.checked ? 'ON' : 'OFF');
        refs.delayButton.classList.toggle('on', refs.delay.checked);
      };

      refs.clearButton.addEventListener('click', () => {
        refs.clearSource.checked = !refs.clearSource.checked;
        Store.set('clearSource', refs.clearSource.checked ? '1' : '0');
        paintToggles();
      });
      refs.delayButton.addEventListener('click', () => {
        refs.delay.checked = !refs.delay.checked;
        Store.set('delay', refs.delay.checked ? '1' : '0');
        paintToggles();
      });
      paintToggles();

      const advance = (field, next) => {
        field.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== 'Tab') return;
          event.preventDefault();
          if (!validContainer(field.value)) {
            field.classList.add('bad');
            return;
          }
          field.classList.remove('bad');
          field.classList.add('good');
          next.focus();
        });
      };
      advance(refs.lazySource, refs.lazyDest);
      advance(refs.lazyDest, refs.lazyItemsInput);

      refs.lazySource.addEventListener('input', debouncePreflight);
      refs.lazyDest.addEventListener('input', () => {
        if (dates && clean(refs.lazyDest.value) !== dates.destination) {
          dates.clear();
          dates = new Expiry.Session(clean(refs.lazyDest.value));
        }
        debouncePreflight();
      });
      refs.lazyItemsInput.addEventListener('input', debouncePreflight);
      refs.lazyItemsInput.addEventListener('keydown', scannerTextarea, true);

      refs.lazyRun.addEventListener('click', () => { void runLazy(); });
      refs.lazyPause.addEventListener('click', () => {
        const current = LazyEngine.state();
        if (!current.running) return;
        if (current.paused) {
          LazyEngine.resume({
            destination: refs.lazyDest.value,
            items: refs.lazyItemsInput.value
          });
        } else {
          LazyEngine.pause();
        }
      });
      refs.lazyStop.addEventListener('click', LazyEngine.stop);
      refs.lazyReset.addEventListener('click', () => {
        LazyEngine.reset();
        resetWorkflowUi();
      });

      layout();
      renderPreflight();
      renderLazy();
    }

    return { build };
  })();

  const ISS = (() => {
    let root = null;
    let active = Store.get('iss.active', 'sideline');
    let editMode = Store.get('iss.editMode', 'sku');
    let moveMode = Store.get('iss.moveMode', 'all');
    let sideMode = Store.get('iss.sideMode', 'lazy');
    let sideBusy = false;
    const refs = {};

    function status(area, message, kind = '') {
      const node = refs[area + 'Status'];
      if (!node) return;
      node.textContent = message;
      node.dataset.kind = kind;
    }

    function activate(area) {
      active = area;
      Store.set('iss.active', area);
      for (const card of $$('.r1-iss-card', root)) {
        card.classList.toggle('active', card.dataset.area === area);
      }
    }

    function choices(values, key) {
      return '<div class="r1-choice">' + values.map(value =>
        '<button type="button" class="r1-btn" data-choice="' + key + '" data-value="' + esc(value) + '">' +
        esc(value.toUpperCase()) + '</button>'
      ).join('') + '</div>';
    }

    function paintChoices() {
      const values = {
        editSource: Store.get('iss.editSource', 'Sellable'),
        editSourceDamage: Store.get('iss.editSourceDamage', 'Defective'),
        editDest: Store.get('iss.editDest', 'Pending Research'),
        editDestDamage: Store.get('iss.editDestDamage', 'Defective')
      };

      for (const button of $$('[data-choice]', root)) {
        button.classList.toggle('on', values[button.dataset.choice] === button.dataset.value);
      }

      refs.editSourceWrap.hidden = editMode === 'each';
      refs.editQtyTable.hidden = editMode === 'each';
      refs.editSourceDamage.hidden = editMode === 'each' || values.editSource !== 'Unsellable';
      refs.editDestDamage.hidden = values.editDest !== 'Unsellable';
      refs.editRun.textContent = editMode === 'each' ? 'RUN EACH' : 'RUN SKU';

      for (const button of $$('[data-edit-mode]', root)) {
        button.classList.toggle('on', button.dataset.editMode === editMode);
      }
      for (const button of $$('[data-move-mode]', root)) {
        button.classList.toggle('on', button.dataset.moveMode === moveMode);
      }
      refs.moveQtyWrap.hidden = moveMode !== 'qty';

      for (const button of $$('[data-side-mode]', root)) {
        button.classList.toggle('on', button.dataset.sideMode === sideMode);
      }
      refs.sideSource.disabled = sideMode === 'queue';
      refs.sideDest.disabled = sideMode === 'queue';
      refs.sideItemsLabel.textContent = sideMode === 'queue' ? 'CONTAINERS' : 'ITEM BARCODES';
      refs.sideOptions.hidden = sideMode !== 'lazy';
      refs.sideRun.textContent = sideMode === 'queue' ? 'RUN QUEUE' : 'RUN LAZY';
    }

    function initQtyTable(items) {
      const seen = new Set();
      const unique = [];
      for (const value of items) {
        const key = upper(value);
        if (!value || seen.has(key)) continue;
        seen.add(key);
        unique.push(value);
      }
      refs.editQtyTable.innerHTML = unique.map(value =>
        '<div class="r1-qty-row" data-sku="' + esc(upper(value)) + '">' +
          '<code title="' + esc(value) + '">' + esc(value) + '</code>' +
          '<b data-q="sellable">—</b><b data-q="pending">—</b><b data-q="unsellable">—</b>' +
        '</div>'
      ).join('');
    }

    function paintQty(sku, qty) {
      const key = upper(sku);
      if (!key) return;
      let row = $$('[data-sku]', refs.editQtyTable).find(node => node.dataset.sku === key);
      if (!row) {
        row = document.createElement('div');
        row.className = 'r1-qty-row';
        row.dataset.sku = key;
        row.innerHTML =
          '<code title="' + esc(sku) + '">' + esc(sku) + '</code>' +
          '<b data-q="sellable">—</b><b data-q="pending">—</b><b data-q="unsellable">—</b>';
        refs.editQtyTable.appendChild(row);
      }
      if (!qty) return;
      for (const name of ['sellable', 'pending', 'unsellable']) {
        const value = Number.isInteger(qty[name]) ? qty[name] : '—';
        $('[data-q="' + name + '"]', row).textContent = String(value);
      }
      row.scrollIntoView?.({ block: 'nearest' });
    }

    function aftProgress(message) {
      if (message.area === 'worker') {
        refs.workerDot.classList.add('ready');
        refs.workerLabel.textContent = 'AFT READY' + (message.version ? ' · v' + message.version : '');
        return;
      }
      if (message.area !== 'edit' && message.area !== 'move') return;
      status(message.area, clean(message.message || 'Working…'), message.error ? 'error' : '');
      if (message.area === 'edit' && clean(message.sku)) paintQty(message.sku, message.inventoryQty || null);
    }

    async function runEdit() {
      const items = clean(refs.editItems.value).split(/\r?\n/).map(clean).filter(Boolean);
      if (!items.length) return status('edit', 'Scan/paste at least one item', 'error');

      const sourceState = Store.get('iss.editSource', 'Sellable');
      const destState = Store.get('iss.editDest', 'Pending Research');
      if (editMode === 'sku' && norm(sourceState) === norm(destState) && norm(sourceState) !== 'unsellable') {
        return status('edit', 'Source and destination cannot match', 'error');
      }

      activate('edit');
      initQtyTable(items);
      refs.editRun.disabled = true;
      status('edit', 'Starting EditItems…');

      try {
        const result = await AftBridge.call('edit.run', {
          mode: editMode,
          items,
          sourceState,
          sourceDamage: Store.get('iss.editSourceDamage', 'Defective'),
          destState,
          destDamage: Store.get('iss.editDestDamage', 'Defective')
        });

        refs.editItems.value = '';
        status(
          'edit',
          'DONE ✓ ' + (result.done ?? 0) + '/' + (result.total ?? items.length) +
          (result.failed?.length ? ' · ' + result.failed.length + ' failed' : ''),
          result.failed?.length ? 'error' : 'ok'
        );
      } catch (error) {
        const remaining = Array.isArray(error?.data?.remaining) ? error.data.remaining : [];
        if (remaining.length) refs.editItems.value = remaining.join('\n');
        status('edit', clean(error?.message || error) + (remaining.length ? ' · remaining queue kept' : ''), 'error');
      } finally {
        refs.editRun.disabled = false;
      }
    }

    async function runMove() {
      const source = clean(refs.moveSource.value);
      const destination = clean(refs.moveDest.value);
      const items = clean(refs.moveItems.value).split(/\r?\n/).map(clean).filter(Boolean);
      const qty = Number(refs.moveQty.value);

      if (!validContainer(source)) return status('move', 'Invalid source container', 'error');
      if (!validContainer(destination)) return status('move', 'Invalid destination container', 'error');
      if (upper(source) === upper(destination)) return status('move', 'Source and destination cannot match', 'error');
      if (!items.length) return status('move', 'Scan/paste at least one item', 'error');
      if (moveMode === 'qty' && (!Number.isSafeInteger(qty) || qty < 1)) {
        return status('move', 'Enter QTY', 'error');
      }

      activate('move');
      refs.moveRun.disabled = true;
      status('move', 'Starting MoveItems…');

      try {
        const result = await AftBridge.call('move.run', {
          source,
          dest: destination,
          items,
          mode: moveMode === 'all' ? 'all' : 'qty',
          qty: moveMode === 'each' ? 1 : qty
        });

        refs.moveSource.value = '';
        refs.moveDest.value = '';
        refs.moveItems.value = '';
        if (moveMode === 'qty') refs.moveQty.value = '';
        status('move', 'SUCCESS ✓ → ' + destination + ' · ' + result.done + '/' + result.total + ' moved', 'ok');
      } catch (error) {
        const partial = error?.data?.kind === 'move' ? error.data : null;
        const remaining = Array.isArray(partial?.remaining) ? partial.remaining : [];
        const uncertain = Array.isArray(partial?.uncertain) ? partial.uncertain : [];
        if (partial) refs.moveItems.value = remaining.join('\n');
        status(
          'move',
          clean(error?.message || error) +
          (uncertain.length ? ' · UNKNOWN: ' + uncertain.join(', ') + ' — VERIFY' : ''),
          'error'
        );
      } finally {
        refs.moveRun.disabled = false;
      }
    }

    function sideView(state) {
      const metrics = state.metrics || { total: 0, unique: 0, moved: 0, remaining: 0 };
      refs.sideMetrics.innerHTML =
        '<div class="r1-metric">Total units<b>' + metrics.total + '</b></div>' +
        '<div class="r1-metric">Unique items<b>' + metrics.unique + '</b></div>' +
        '<div class="r1-metric">Moved<b>' + metrics.moved + '</b></div>' +
        '<div class="r1-metric">Remaining<b>' + metrics.remaining + '</b></div>';

      refs.sideState.innerHTML = (state.items || []).map(item =>
        '<div class="r1-item" data-state="' + esc(upper(item.status || '')) + '">' +
          '<b>' + esc(item.status || 'WAITING') + '</b> · ' + esc(item.code) + ' ×' + item.qty +
          (item.asin ? ' · ASIN ' + esc(item.asin) : '') +
          (item.fnsku ? ' · FNSKU ' + esc(item.fnsku) : '') +
          (item.issue ? '<br>' + esc(item.issue) : '') +
        '</div>'
      ).join('');

      refs.sideAlert.classList.toggle('show', !!state.attention);
      if (state.attention === 'rescan-destination') {
        refs.sideAlert.textContent = '⚠ SCAN ' + state.destination + ' AGAIN IN ITEM BARCODES TO CONTINUE';
      } else if (state.attention === 'damaged-destination') {
        refs.sideAlert.textContent = '⚠ DESTINATION DAMAGED — ENTER A NEW DESTINATION';
      } else if (state.attention === 'predicant-recovery') {
        refs.sideAlert.textContent = 'RECOVERY — EMPTYING DESTINATION';
      } else {
        refs.sideAlert.textContent = '';
      }

      status(
        'side',
        (state.running ? (state.paused ? 'PAUSED' : 'RUNNING') : 'IDLE') +
        (state.note ? ' · ' + state.note : '') +
        (state.error ? ' · ' + state.error : ''),
        state.error ? 'error' : state.attention ? 'attention' : (!state.running && state.note === 'complete' ? 'ok' : '')
      );
    }

    function queueSideView(state) {
      status(
        'side',
        (state.running ? (state.paused ? 'PAUSED' : 'RUNNING') : 'STOPPED') +
        ' · ' + Math.min(state.index, state.items.length) + '/' + state.items.length +
        (state.note ? ' · ' + state.note : ''),
        state.failed.length ? 'error' : (state.note === 'done' ? 'ok' : '')
      );
    }

    async function runSide() {
      if (sideMode === 'queue') {
        const text = refs.sideItems.value;
        if (!clean(text)) return status('side', 'Paste/scan containers', 'error');
        sideBusy = true;
        refs.sideRun.disabled = true;
        await QueueEngine.start(text, queueSideView);
        sideBusy = false;
        refs.sideRun.disabled = false;
        return;
      }

      const source = clean(refs.sideSource.value);
      const destination = clean(refs.sideDest.value);
      if (!validContainer(source)) return status('side', 'Invalid source container', 'error');
      if (!validContainer(destination)) return status('side', 'Invalid destination container', 'error');

      sideBusy = true;
      refs.sideRun.disabled = true;
      try {
        const result = await LazyEngine.start({
          source,
          destination,
          items: refs.sideItems.value,
          clearSource: refs.sideClear.checked,
          delay: refs.sideDelay.checked,
          onUpdate: sideView
        });

        if (
          result.metrics &&
          result.metrics.failed === 0 &&
          result.metrics.unknown === 0 &&
          result.metrics.skipped === 0 &&
          result.metrics.moved === result.metrics.total
        ) {
          refs.sideSource.value = '';
          refs.sideDest.value = '';
          refs.sideItems.value = '';
          sideView({ ...result, note: source + ' > ' + destination + ' = COMPLETE' });
        }
      } catch (error) {
        status('side', clean(error?.message || error), 'error');
      } finally {
        sideBusy = false;
        refs.sideRun.disabled = false;
      }
    }

    function textareaEnter(event, area) {
      if (event.key !== 'Enter' || event.shiftKey) return;
      const textarea = event.currentTarget;
      const value = textarea.value;
      const pos = textarea.selectionStart ?? value.length;
      const start = value.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
      const next = value.indexOf('\n', pos);
      const end = next < 0 ? value.length : next;
      const code = clean(value.slice(start, end));

      if (area === 'move' && validContainer(refs.moveDest.value) && upper(code) === upper(refs.moveDest.value)) {
        event.preventDefault();
        textarea.value = value.slice(0, start) + value.slice(end).replace(/^\r?\n/, '');
        void runMove();
        return;
      }

      if (area === 'side' && sideMode === 'lazy') {
        const special = upper(code) === upper(refs.sideSource.value) ||
          upper(code) === upper(refs.sideDest.value) ||
          upper(code) === upper(START_TRIGGER);

        if (special) {
          event.preventDefault();
          textarea.value = value.slice(0, start) + value.slice(end).replace(/^\r?\n/, '');
          if (LazyEngine.active() && LazyEngine.confirmPredicant(code)) return;
          if (!LazyEngine.active()) void runSide();
          return;
        }
      }

      event.preventDefault();
      const before = value.slice(0, start).replace(/[\t ]+$/, '');
      const after = value.slice(end).replace(/^\r?\n+/, '');
      textarea.value = before + '\n' + after;
      const caret = before.length + 1;
      textarea.setSelectionRange?.(caret, caret);
    }

    function build() {
      Css.install();

      root = markUi(document.createElement('div'));
      root.id = 'r1-iss';
      root.innerHTML =
        '<header class="r1-iss-top">' +
          '<div class="r1-iss-brand"><span class="site" data-site>BWU2</span><strong>ISS Console</strong></div>' +
          '<div style="display:flex;align-items:center;gap:12px">' +
            '<span class="r1-worker"><i data-worker-dot></i><span data-worker-label>AFT CONNECTING</span></span>' +
            '<button class="r1-btn" data-exit>SIDELINE</button>' +
          '</div>' +
        '</header>' +
        '<main class="r1-iss-grid">' +
          '<section class="r1-iss-card" data-area="edit">' +
            '<h2>EDIT</h2><div class="r1-iss-body">' +
              '<div class="r1-segment two"><button class="r1-btn" data-edit-mode="each">EACH</button><button class="r1-btn" data-edit-mode="sku">SKU</button></div>' +
              '<div class="r1-qty-table" data-edit-qty></div>' +
              '<div data-edit-source-wrap><label class="r1-label">SOURCE</label>' +
                choices(['Sellable', 'Pending Research', 'Unsellable'], 'editSource') + '</div>' +
              '<div data-edit-source-damage hidden><label class="r1-label">SOURCE DISPOSITION</label>' +
                choices(['Amazon Damage', 'Defective', 'Distributor Damage', 'Expired'], 'editSourceDamage').replace('r1-choice', 'r1-choice damage') + '</div>' +
              '<div class="r1-flow">↓</div>' +
              '<label class="r1-label">DESTINATION</label>' +
              choices(['Sellable', 'Pending Research', 'Unsellable'], 'editDest') +
              '<div data-edit-dest-damage hidden><label class="r1-label">DESTINATION DISPOSITION</label>' +
                choices(['Amazon Damage', 'Defective', 'Distributor Damage', 'Expired'], 'editDestDamage').replace('r1-choice', 'r1-choice damage') + '</div>' +
              '<div class="r1-flow">↓</div>' +
              '<label class="r1-label">ITEMS</label><textarea class="r1-input" data-edit-items placeholder="Scan or paste one per line"></textarea>' +
              '<div class="r1-iss-actions"><button class="r1-btn primary" data-edit-run>RUN SKU</button><button class="r1-btn stop" data-edit-stop>STOP</button><button class="r1-btn" data-edit-clear>CLEAR</button></div>' +
              '<div class="r1-status" data-edit-status>Ready</div>' +
            '</div>' +
          '</section>' +
          '<section class="r1-iss-card" data-area="move">' +
            '<h2>MOVE</h2><div class="r1-iss-body">' +
              '<div class="r1-segment"><button class="r1-btn" data-move-mode="all">ALL</button><button class="r1-btn" data-move-mode="each">EACH</button><button class="r1-btn" data-move-mode="qty">QTY</button></div>' +
              '<div data-move-qty-wrap hidden><label class="r1-label">QTY</label><input class="r1-input" type="number" min="1" max="999999" data-move-qty></div>' +
              '<label class="r1-label">SOURCE</label><input class="r1-input" data-move-source placeholder="tsX / csX">' +
              '<div class="r1-flow">↓</div>' +
              '<label class="r1-label">DESTINATION</label><input class="r1-input" data-move-dest placeholder="tsX / csX">' +
              '<div class="r1-flow">↓</div>' +
              '<label class="r1-label">ITEM BARCODES</label><textarea class="r1-input" data-move-items placeholder="Scan or paste one per line"></textarea>' +
              '<div class="r1-iss-actions"><button class="r1-btn primary" data-move-run>RUN MOVE</button><button class="r1-btn stop" data-move-stop>STOP</button><button class="r1-btn" data-move-clear>CLEAR</button></div>' +
              '<div class="r1-status" data-move-status>Ready</div>' +
            '</div>' +
          '</section>' +
          '<section class="r1-iss-card" data-area="side">' +
            '<h2>SIDELINE</h2><div class="r1-iss-body">' +
              '<div class="r1-segment two"><button class="r1-btn" data-side-mode="queue">QUEUE</button><button class="r1-btn" data-side-mode="lazy">LAZY</button></div>' +
              '<label class="r1-label">SOURCE</label><input class="r1-input" data-side-source placeholder="tsX / csX">' +
              '<div class="r1-flow">↓</div>' +
              '<label class="r1-label">DESTINATION</label><input class="r1-input" data-side-dest placeholder="tsX / csX">' +
              '<div class="r1-flow">↓</div>' +
              '<label class="r1-label" data-side-items-label>ITEM BARCODES</label><textarea class="r1-input" data-side-items placeholder="Scan or paste one per line"></textarea>' +
              '<div data-side-options class="r1-two"><button class="r1-btn" data-side-clear>CLEAR SOURCE: OFF</button><button class="r1-btn on" data-side-delay>DELAY 2–8s: ON</button></div>' +
              '<input type="checkbox" data-side-clear-box hidden><input type="checkbox" data-side-delay-box hidden>' +
              '<div class="r1-metrics" data-side-metrics></div>' +
              '<div class="r1-side-alert" data-side-alert></div>' +
              '<div class="r1-items" data-side-state></div>' +
              '<div class="r1-iss-actions"><button class="r1-btn primary" data-side-run>RUN LAZY</button><button class="r1-btn stop" data-side-stop>STOP</button><button class="r1-btn" data-side-clear-ui>CLEAR</button></div>' +
              '<div class="r1-status" data-side-status>Ready</div>' +
            '</div>' +
          '</section>' +
        '</main>';
      document.body.appendChild(root);

      refs.workerDot = $('[data-worker-dot]', root);
      refs.workerLabel = $('[data-worker-label]', root);
      refs.editItems = $('[data-edit-items]', root);
      refs.editRun = $('[data-edit-run]', root);
      refs.editStatus = $('[data-edit-status]', root);
      refs.editQtyTable = $('[data-edit-qty]', root);
      refs.editSourceWrap = $('[data-edit-source-wrap]', root);
      refs.editSourceDamage = $('[data-edit-source-damage]', root);
      refs.editDestDamage = $('[data-edit-dest-damage]', root);

      refs.moveQtyWrap = $('[data-move-qty-wrap]', root);
      refs.moveQty = $('[data-move-qty]', root);
      refs.moveSource = $('[data-move-source]', root);
      refs.moveDest = $('[data-move-dest]', root);
      refs.moveItems = $('[data-move-items]', root);
      refs.moveRun = $('[data-move-run]', root);
      refs.moveStatus = $('[data-move-status]', root);

      refs.sideSource = $('[data-side-source]', root);
      refs.sideDest = $('[data-side-dest]', root);
      refs.sideItems = $('[data-side-items]', root);
      refs.sideItemsLabel = $('[data-side-items-label]', root);
      refs.sideOptions = $('[data-side-options]', root);
      refs.sideClear = $('[data-side-clear-box]', root);
      refs.sideDelay = $('[data-side-delay-box]', root);
      refs.sideMetrics = $('[data-side-metrics]', root);
      refs.sideAlert = $('[data-side-alert]', root);
      refs.sideState = $('[data-side-state]', root);
      refs.sideRun = $('[data-side-run]', root);
      refs.sideStatus = $('[data-side-status]', root);

      Api.warehouse().then(site => {
        if (site) $('[data-site]', root).textContent = site;
      });

      refs.sideClear.checked = Store.get('iss.sideClear', '0') === '1';
      refs.sideDelay.checked = Store.get('iss.sideDelay', '1') !== '0';

      const paintSideOptions = () => {
        const clearButton = $('[data-side-clear]', root);
        const delayButton = $('[data-side-delay]', root);
        clearButton.textContent = 'CLEAR SOURCE: ' + (refs.sideClear.checked ? 'ON' : 'OFF');
        clearButton.classList.toggle('on', refs.sideClear.checked);
        delayButton.textContent = 'DELAY 2–8s: ' + (refs.sideDelay.checked ? 'ON' : 'OFF');
        delayButton.classList.toggle('on', refs.sideDelay.checked);
      };

      $('[data-side-clear]', root).addEventListener('click', () => {
        refs.sideClear.checked = !refs.sideClear.checked;
        Store.set('iss.sideClear', refs.sideClear.checked ? '1' : '0');
        paintSideOptions();
      });
      $('[data-side-delay]', root).addEventListener('click', () => {
        refs.sideDelay.checked = !refs.sideDelay.checked;
        Store.set('iss.sideDelay', refs.sideDelay.checked ? '1' : '0');
        paintSideOptions();
      });

      for (const card of $$('.r1-iss-card', root)) {
        card.addEventListener('pointerdown', () => activate(card.dataset.area), true);
      }

      $('[data-exit]', root).addEventListener('click', () => {
        location.hash = '';
        location.reload();
      });

      for (const button of $$('[data-edit-mode]', root)) {
        button.addEventListener('click', () => {
          editMode = button.dataset.editMode;
          Store.set('iss.editMode', editMode);
          paintChoices();
          activate('edit');
        });
      }

      for (const button of $$('[data-choice]', root)) {
        button.addEventListener('click', () => {
          Store.set('iss.' + button.dataset.choice, button.dataset.value);
          paintChoices();
          activate('edit');
        });
      }

      for (const button of $$('[data-move-mode]', root)) {
        button.addEventListener('click', () => {
          moveMode = button.dataset.moveMode;
          Store.set('iss.moveMode', moveMode);
          paintChoices();
          activate('move');
        });
      }

      for (const button of $$('[data-side-mode]', root)) {
        button.addEventListener('click', () => {
          sideMode = button.dataset.sideMode;
          Store.set('iss.sideMode', sideMode);
          paintChoices();
          activate('side');
        });
      }

      refs.editRun.addEventListener('click', () => { void runEdit(); });
      refs.editItems.addEventListener('keydown', event => textareaEnter(event, 'edit'));
      $('[data-edit-stop]', root).addEventListener('click', () => { void AftBridge.stop().catch(() => {}); });
      $('[data-edit-clear]', root).addEventListener('click', () => {
        refs.editItems.value = '';
        status('edit', 'Cleared');
      });

      refs.moveRun.addEventListener('click', () => { void runMove(); });
      refs.moveItems.addEventListener('keydown', event => textareaEnter(event, 'move'));
      refs.moveQty.addEventListener('input', () => Store.set('iss.moveQty', refs.moveQty.value));
      refs.moveQty.value = Store.get('iss.moveQty', '');
      refs.moveQty.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || moveMode !== 'qty') return;
        event.preventDefault();
        refs.moveSource.focus();
      });
      refs.moveSource.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (!validContainer(refs.moveSource.value)) return status('move', 'Invalid source container', 'error');
        refs.moveDest.focus();
      });
      refs.moveDest.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (!validContainer(refs.moveDest.value)) return status('move', 'Invalid destination container', 'error');
        refs.moveItems.focus();
      });
      $('[data-move-stop]', root).addEventListener('click', () => { void AftBridge.stop().catch(() => {}); });
      $('[data-move-clear]', root).addEventListener('click', () => {
        refs.moveSource.value = '';
        refs.moveDest.value = '';
        refs.moveItems.value = '';
        if (moveMode === 'qty') refs.moveQty.value = '';
        status('move', 'Cleared');
      });

      refs.sideRun.addEventListener('click', () => { void runSide(); });
      refs.sideItems.addEventListener('keydown', event => textareaEnter(event, 'side'));
      refs.sideSource.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (!validContainer(refs.sideSource.value)) return status('side', 'Invalid source container', 'error');
        refs.sideDest.focus();
      });
      refs.sideDest.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (!validContainer(refs.sideDest.value)) return status('side', 'Invalid destination container', 'error');
        refs.sideItems.focus();
      });
      $('[data-side-stop]', root).addEventListener('click', () => {
        if (sideMode === 'queue') QueueEngine.stop();
        else LazyEngine.stop();
        sideBusy = false;
        refs.sideRun.disabled = false;
      });
      $('[data-side-clear-ui]', root).addEventListener('click', () => {
        if (sideMode === 'queue') QueueEngine.stop();
        else LazyEngine.reset();
        refs.sideSource.value = '';
        refs.sideDest.value = '';
        refs.sideItems.value = '';
        refs.sideState.innerHTML = '';
        refs.sideAlert.classList.remove('show');
        sideBusy = false;
        refs.sideRun.disabled = false;
        status('side', 'Cleared');
      });

      paintSideOptions();
      paintChoices();
      activate(active);

      AftBridge.mount(aftProgress);
    }

    return { build };
  })();

  function bootPoirot() {
    Css.install();
    Native.start();
    NativeExpiry.start();

    if (location.hash === '#iss-console') {
      ISS.build();
    } else {
      Standalone.build();
    }

    trace('BOOT', { mode: location.hash === '#iss-console' ? 'iss' : 'standalone' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootPoirot, { once: true });
  } else {
    bootPoirot();
  }
})();