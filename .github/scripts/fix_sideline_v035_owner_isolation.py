from pathlib import Path

p = Path('Sideline_API_Move.user.js')
s = p.read_text(encoding='utf-8')
old = """      if (shared.owner === 'return-source') {
        const unrelatedOwner = previousOwner && ![
          mode,
          mode === 'queue' ? 'queue' : '',
          mode === 'scrub' ? 'scrub' : '',
          mode === 'qty' ? 'qty-clear' : ''
        ].includes(previousOwner) ? previousOwner : '';
        shared.owner = unrelatedOwner;
      }
"""
new = """      if (shared.owner === 'return-source') {
        const ownerWasTarget =
          previousOwner === mode ||
          (mode === 'lazy' && /^lazy(?:-|$)/.test(previousOwner)) ||
          (mode === 'qty' && (previousOwner === 'qty' || previousOwner === 'qty-clear'));
        shared.owner = previousOwner && !ownerWasTarget ? previousOwner : '';
      }
"""
if s.count(old) != 1:
    raise SystemExit(f'owner isolation patch expected once, found {s.count(old)}')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
