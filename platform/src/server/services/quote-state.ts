/** Pure Phase 4 transition rules. The database must enforce these atomically as well. */
export type QuoteStatus = 'draft' | 'sent' | 'revision_requested' | 'accepted' | 'declined' | 'withdrawn' | 'expired';
export type QuoteActor = 'buyer' | 'seller';
export type QuoteAction = 'send' | 'request_revision' | 'accept' | 'decline' | 'withdraw' | 'expire';

export type QuoteState = {
  status: QuoteStatus;
  version: number;
  currentVersionId: string | null;
  acceptedVersionId: string | null;
  validUntil: Date | null;
};

export type QuoteCommand = {
  action: QuoteAction;
  actor: QuoteActor;
  expectedVersion: number;
  versionId?: string;
  validUntil?: Date;
  now: Date;
};

export function transitionQuote(state: QuoteState, command: QuoteCommand): QuoteState {
  if (!Number.isSafeInteger(state.version) || state.version < 0 || state.version !== command.expectedVersion) {
    throw new Error('quote_conflict');
  }
  if (Number.isNaN(command.now.getTime())) throw new Error('invalid_time');
  const next = (status: QuoteStatus, acceptedVersionId = state.acceptedVersionId): QuoteState => ({
    ...state, status, acceptedVersionId, version: state.version + 1,
  });

  switch (command.action) {
    case 'send':
      if (command.actor !== 'seller' || !['draft', 'revision_requested'].includes(state.status) ||
          !command.versionId || !command.validUntil || Number.isNaN(command.validUntil.getTime()) ||
          command.validUntil <= command.now || command.versionId === state.currentVersionId) {
        throw new Error('invalid_quote_transition');
      }
      return { ...next('sent'), currentVersionId: command.versionId, validUntil: command.validUntil };
    case 'request_revision':
      if (command.actor !== 'buyer' || state.status !== 'sent' || !isCurrentOffer(state, command)) throw new Error('invalid_quote_transition');
      return next('revision_requested');
    case 'accept':
      if (command.actor !== 'buyer' || state.status !== 'sent' || !isCurrentOffer(state, command)) throw new Error('invalid_quote_transition');
      return next('accepted', state.currentVersionId);
    case 'decline':
      if (command.actor !== 'buyer' || state.status !== 'sent' || !isCurrentOffer(state, command)) throw new Error('invalid_quote_transition');
      return next('declined');
    case 'withdraw':
      if (command.actor !== 'seller' || state.status !== 'sent') throw new Error('invalid_quote_transition');
      return next('withdrawn');
    case 'expire':
      if (state.status !== 'sent' || !state.validUntil || state.validUntil > command.now) throw new Error('invalid_quote_transition');
      return next('expired');
  }
}

function isCurrentOffer(state: QuoteState, command: QuoteCommand): boolean {
  return !!state.currentVersionId && command.versionId === state.currentVersionId &&
    !!state.validUntil && state.validUntil > command.now;
}
