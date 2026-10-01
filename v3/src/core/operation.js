V3.operation = (() => {
  class OutcomeUnknownError extends Error {
    constructor(message = 'Outcome unknown', meta = {}) {
      super(message);
      this.name = 'OutcomeUnknownError';
      this.outcome = 'unknown';
      Object.assign(this, meta);
    }
  }
  class RejectedError extends Error {
    constructor(message = 'Rejected', meta = {}) {
      super(message);
      this.name = 'RejectedError';
      this.outcome = 'rejected';
      Object.assign(this, meta);
    }
  }

  function create(options = {}) {
    const telemetry = options.telemetry;
    const operation = {
      id:V3.base.id(options.kind || 'op'),
      kind:options.kind || 'operation',
      ref:V3.telemetry.mask(options.ref || ''),
      phase:'prepared',
      outcome:'pending',
      startedAt:performance.now()
    };
    const transition = (phase, data = {}) => {
      operation.phase = phase;
      telemetry?.op(operation, phase, data);
      return operation;
    };
    transition('prepared');

    return Object.freeze({
      data:operation,
      submitted:data => transition('submitted', data),
      confirmed:data => {
        operation.outcome = 'confirmed';
        return transition('confirmed', Object.assign({ms:Math.round(performance.now()-operation.startedAt)}, data));
      },
      rejected:data => {
        operation.outcome = 'rejected';
        return transition('rejected', Object.assign({ms:Math.round(performance.now()-operation.startedAt)}, data));
      },
      unknown:data => {
        operation.outcome = 'unknown';
        return transition('unknown', Object.assign({ms:Math.round(performance.now()-operation.startedAt)}, data));
      }
    });
  }

  return Object.freeze({ create, OutcomeUnknownError, RejectedError });
})();