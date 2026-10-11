// jsdom has no layout engine. Supply native control boxes while retaining the
// browser rule that display:none/hidden ancestry has no rendered geometry.
export function renderNativeControls(window) {
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    let rendered = this.isConnected;
    for (let node = this; rendered && node; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (node.hidden || style.display === 'none' || style.contentVisibility === 'hidden') rendered = false;
    }
    const style = window.getComputedStyle(this);
    if (style.visibility === 'hidden' || style.visibility === 'collapse') rendered = false;
    return new window.DOMRect(0, 0, rendered ? 120 : 0, rendered ? 24 : 0);
  };
}
