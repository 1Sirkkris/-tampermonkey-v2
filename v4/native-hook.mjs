// Cooperating V4 observers advertise the function they actually forward to.
const FORWARD = Symbol.for('tampermonkey.v4.native.forward');
export function forwardHook(wrapper, original) {
  Object.defineProperty(wrapper, FORWARD, { value: original });
  return wrapper;
}
export function containsHook(current, expected) {
  const seen = new Set();
  while (typeof current === 'function' && !seen.has(current)) {
    if (current === expected) return true;
    seen.add(current); current = current[FORWARD];
  }
  return false;
}
