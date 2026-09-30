// ==UserScript==
// @name         TEST Page Location Mapper
// @name:en      TEST Page Location Mapper
// @namespace    https://github.com/1Sirkkris
// @version      0.1.0
// @description  Temporary viewport coordinate/grid mapper for screenshot-guided UI placement.
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Page_Location_Mapper_TEST.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Page_Location_Mapper_TEST.user.js
// ==/UserScript==

(() => {
  'use strict';

  if (window.__bwu2PageLocationMapper) return;
  window.__bwu2PageLocationMapper = true;

  const VERSION = '0.1.0';
  const GRID = 100;
  const ROOT_ID = 'bwu2-page-location-mapper';
  const STYLE_ID = 'bwu2-page-location-mapper-style';
  const TOGGLE_KEY = 'Alt+Shift+L';

  let enabled = true;
  let root = null;
  let legend = null;
  let raf = 0;

  function columnName(index) {
    let value = index + 1;
    let out = '';
    while (value > 0) {
      value--;
      out = String.fromCharCode(65 + (value % 26)) + out;
      value = Math.floor(value / 26);
    }
    return out;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position:fixed;
        inset:0;
        z-index:2147483646;
        pointer-events:none;
        overflow:hidden;
        font-family:Consolas,Monaco,monospace;
      }
      #${ROOT_ID} .mapper-cell {
        position:absolute;
        border-left:1px solid rgba(255,0,0,.72);
        border-top:1px solid rgba(255,0,0,.72);
        background:rgba(255,255,0,.035);
        box-sizing:border-box;
      }
      #${ROOT_ID} .mapper-cell:nth-child(even) {
        background:rgba(0,170,255,.035);
      }
      #${ROOT_ID} .mapper-label {
        position:absolute;
        top:2px;
        left:3px;
        padding:1px 3px;
        background:rgba(0,0,0,.82);
        color:#fff;
        border:1px solid #fff;
        border-radius:2px;
        font:700 11px/1.15 Consolas,Monaco,monospace;
        white-space:nowrap;
      }
      #${ROOT_ID} .mapper-axis-x,
      #${ROOT_ID} .mapper-axis-y {
        position:absolute;
        z-index:3;
        background:#ffea00;
        color:#000;
        border:1px solid #000;
        font:900 10px/1 Consolas,Monaco,monospace;
        padding:2px 3px;
      }
      #${ROOT_ID} .mapper-axis-x { top:0; transform:translateX(2px); }
      #${ROOT_ID} .mapper-axis-y { left:0; transform:translateY(18px); }
      #${ROOT_ID} .mapper-legend {
        position:fixed;
        right:8px;
        bottom:8px;
        z-index:5;
        padding:6px 8px;
        background:#111;
        color:#fff;
        border:2px solid #ffea00;
        border-radius:4px;
        font:900 12px/1.35 Consolas,Monaco,monospace;
        box-shadow:0 2px 8px rgba(0,0,0,.5);
      }
      #${ROOT_ID} .mapper-crosshair-x,
      #${ROOT_ID} .mapper-crosshair-y {
        position:absolute;
        z-index:4;
        background:#ff00ff;
        opacity:.8;
      }
      #${ROOT_ID} .mapper-crosshair-x { height:1px; left:0; right:0; }
      #${ROOT_ID} .mapper-crosshair-y { width:1px; top:0; bottom:0; }
      #${ROOT_ID} .mapper-pointer {
        position:absolute;
        z-index:5;
        padding:2px 4px;
        background:#ff00ff;
        color:#000;
        border:1px solid #000;
        font:900 10px/1 Consolas,Monaco,monospace;
        white-space:nowrap;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function render() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!enabled) {
        root?.remove();
        root = null;
        return;
      }

      injectStyle();
      root?.remove();

      root = document.createElement('div');
      root.id = ROOT_ID;
      root.dataset.fcrToolUi = '1';

      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      const cols = Math.ceil(width / GRID);
      const rows = Math.ceil(height / GRID);

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = col * GRID;
          const y = row * GRID;
          const cell = document.createElement('div');
          cell.className = 'mapper-cell';
          cell.style.left = x + 'px';
          cell.style.top = y + 'px';
          cell.style.width = Math.min(GRID, width - x) + 'px';
          cell.style.height = Math.min(GRID, height - y) + 'px';

          const label = document.createElement('span');
          label.className = 'mapper-label';
          label.textContent = `${columnName(col)}${row + 1}  x${x} y${y}`;
          cell.appendChild(label);
          root.appendChild(cell);
        }
      }

      for (let x = 0; x < width; x += GRID) {
        const axis = document.createElement('span');
        axis.className = 'mapper-axis-x';
        axis.style.left = x + 'px';
        axis.textContent = 'X' + x;
        root.appendChild(axis);
      }

      for (let y = 0; y < height; y += GRID) {
        const axis = document.createElement('span');
        axis.className = 'mapper-axis-y';
        axis.style.top = y + 'px';
        axis.textContent = 'Y' + y;
        root.appendChild(axis);
      }

      legend = document.createElement('div');
      legend.className = 'mapper-legend';
      legend.textContent = `LOCATION MAP v${VERSION} | ${width}×${height} | scroll ${Math.round(scrollX)},${Math.round(scrollY)} | ${TOGGLE_KEY} toggle`;
      root.appendChild(legend);

      const crossX = document.createElement('div');
      crossX.className = 'mapper-crosshair-x';
      crossX.style.display = 'none';
      root.appendChild(crossX);

      const crossY = document.createElement('div');
      crossY.className = 'mapper-crosshair-y';
      crossY.style.display = 'none';
      root.appendChild(crossY);

      const pointer = document.createElement('div');
      pointer.className = 'mapper-pointer';
      pointer.style.display = 'none';
      root.appendChild(pointer);

      document.documentElement.appendChild(root);

      document.addEventListener('mousemove', event => {
        if (!root?.isConnected || !enabled) return;
        crossX.style.display = '';
        crossY.style.display = '';
        pointer.style.display = '';
        crossX.style.top = event.clientY + 'px';
        crossY.style.left = event.clientX + 'px';
        pointer.style.left = Math.min(event.clientX + 8, width - 125) + 'px';
        pointer.style.top = Math.min(event.clientY + 8, height - 30) + 'px';
        pointer.textContent = `x${event.clientX} y${event.clientY}`;
      }, { passive:true, once:true });
    });
  }

  window.addEventListener('resize', render, { passive:true });
  window.addEventListener('scroll', () => {
    if (legend) {
      legend.textContent = `LOCATION MAP v${VERSION} | ${innerWidth}×${innerHeight} | scroll ${Math.round(scrollX)},${Math.round(scrollY)} | ${TOGGLE_KEY} toggle`;
    }
  }, { passive:true });

  document.addEventListener('keydown', event => {
    if (!(event.altKey && event.shiftKey && event.code === 'KeyL')) return;
    event.preventDefault();
    event.stopPropagation();
    enabled = !enabled;
    render();
  }, true);

  render();
})();