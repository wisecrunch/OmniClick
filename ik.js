// Runs in the page's own JS world so it can read Gmail's session key. Gmail sets it after this
// script runs, so it is read on request; the isolated content script dispatches the event
// and reads the answer from a data attribute (listeners run synchronously).
document.addEventListener('omniclick-ik-request', () => {
  document.documentElement.dataset.gapIk = window.GM_ID_KEY || '';
});
