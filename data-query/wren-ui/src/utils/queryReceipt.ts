// Consume the existing contracts/enums/{task_status,action_gate_state,
// action_dispatch_state}.schema.json values. This is presentation/receipt
// validation, not a native task state machine or an execution authority.
export function queryReceiptState(receipt: any) {
  const gate = receipt?.submission?.gateState;
  const dispatch = receipt?.submission?.dispatchState;
  const status = receipt?.terminalStatus;
  const valid =
    !!receipt &&
    [
      'EVALUATING',
      'WAITING',
      'ALLOWED',
      'DENIED',
      'REVOKED',
      'EXPIRED',
    ].includes(gate) &&
    ['NOT_DISPATCHED', 'DISPATCHED', 'ABORTED', 'UNKNOWN'].includes(dispatch) &&
    (status === undefined ||
      [
        'RUNNING',
        'COMPLETED',
        'FAILED',
        'CANCELED',
        'TERMINATED',
        'TIMED_OUT',
      ].includes(status)) &&
    // A task close cannot settle an external side effect still marked UNKNOWN.
    (status === undefined || status === 'RUNNING' || dispatch !== 'UNKNOWN') &&
    (status !== 'COMPLETED' ||
      (gate === 'ALLOWED' && dispatch === 'DISPATCHED'));
  const terminal = valid && status !== undefined && status !== 'RUNNING';
  const denied = valid && gate === 'DENIED' && dispatch === 'NOT_DISPATCHED';
  return {
    valid,
    terminal,
    completed: terminal && status === 'COMPLETED',
    ended: terminal && status !== 'COMPLETED',
    denied,
    // Unknown/malformed receipt evidence must not render as a success or a
    // business failure, and must not grant permission to execute another key.
    pending: !!receipt && (!valid || (!terminal && !denied)),
  };
}
