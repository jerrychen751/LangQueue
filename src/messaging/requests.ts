import type { BackgroundRequests, RequestResponse, TabRequests } from './request_types';

export type RequestHandlers<Requests extends Record<string, { payload: unknown; result: unknown }>> = {
  [K in keyof Requests]: (payload: Requests[K]['payload']) => Promise<Requests[K]['result']>
};

export function listenForRequests<Requests extends Record<string, { payload: unknown; result: unknown }>>(handlers: RequestHandlers<Requests>) {
  return (message: { type?: string; payload?: unknown } | undefined, _sender: chrome.runtime.MessageSender, sendResponse: (response: RequestResponse<unknown>) => void) => {
    const type = message?.type;
    if (typeof type !== 'string' || !Object.hasOwn(handlers, type)) {
      return;
    }
    handlers[type](message?.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  };
}

function readResponse<Result>(response: RequestResponse<Result> | undefined): Result {
  if (typeof response?.ok !== 'boolean') {
    throw new Error('The response is missing. Reload the extension and try again.');
  }
  if (!response.ok) {
    throw new Error(response.error);
  }
  return response.result;
}

export async function callBackground<K extends keyof BackgroundRequests>(type: K, payload: BackgroundRequests[K]['payload']): Promise<BackgroundRequests[K]['result']> {
  return readResponse<BackgroundRequests[K]['result']>(await chrome.runtime.sendMessage({ type, payload }));
}

export async function sendToTab<K extends keyof TabRequests>(tabId: number, type: K, payload: TabRequests[K]['payload']): Promise<TabRequests[K]['result']> {
  return readResponse<TabRequests[K]['result']>(await chrome.tabs.sendMessage(tabId, { type, payload }));
}
