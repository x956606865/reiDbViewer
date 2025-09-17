export const QUERY_EXECUTING_EVENT = 'rdv:query-executing';

export type QueryExecutingEventDetail = {
  executing: boolean;
  source?: string;
};

export const emitQueryExecutingEvent = (
  executing: boolean,
  source?: string
) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<QueryExecutingEventDetail>(QUERY_EXECUTING_EVENT, {
      detail: { executing, source },
    })
  );
};
