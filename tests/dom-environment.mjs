import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'navigator', 'location', 'history', 'localStorage', 'HTMLElement', 'HTMLDialogElement', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom does not implement the browser top layer; verify mounting and close
// semantics here, leaving appearance and native focus trapping to visual QA.
HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; };
