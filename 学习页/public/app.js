const routeModules = {
  course: () => import('./course.js'), reader: () => import('./reader.js'),
  quiz: () => import('./quiz.js'), practice: () => import('./practice.js')
};

export function createLearningApp({ app, document, window, location, fetch, loadRoute = name => routeModules[name](), requestAnimationFrame = globalThis.requestAnimationFrame, cancelAnimationFrame = globalThis.cancelAnimationFrame }) {
  let cards = [], active = false, cleanup, controller, frame;
  let routeToken = 0;
  const unified = Boolean(document.querySelector('#plan-workspace'));
  const escapeHtml = value => { const node = document.createElement('div'); node.textContent = value; return node.innerHTML; };
  function clearView() {
    controller?.abort(); controller = undefined;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    if (typeof cleanup === 'function') cleanup();
    cleanup = undefined;
    app.replaceChildren(); app.removeAttribute('aria-busy');
  }
  async function route() {
    if (!active) return;
    if (location.hash === '#app' && !unified) { app.focus({ preventScroll: true }); return; }
    let [name, section] = (location.hash.slice(1) || (unified ? '' : 'course')).split('/');
    if (!unified && !Object.hasOwn(routeModules, name)) { name = 'course'; section = undefined; }
    if (!Object.hasOwn(routeModules, name)) { ++routeToken; clearView(); cards = []; return; }
    const token = ++routeToken;
    clearView();
    const signal = (controller = new AbortController()).signal;
    const current = () => active && token === routeToken && !signal.aborted;
    const read = async (url, label) => {
      const response = await fetch(url, { cache: 'no-store', signal });
      if (!response.ok) throw new Error(label + '读取失败（' + response.status + '）');
      const result = await response.json();
      if (!current()) throw new DOMException('页面已关闭', 'AbortError');
      return result;
    };
    document.querySelectorAll('[data-route]').forEach(link => {
      if (link.dataset.route === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    app.setAttribute('aria-busy', 'true');
    const view = document.createElement('div'); view.className = 'route-view';
    let nextCleanup;
    try {
      const [module, catalog] = await Promise.all([
        loadRoute(name), cards.length ? Promise.resolve({ cards }) : read('/api/cards', '知识卡目录')
      ]);
      if (!current()) return;
      cards = catalog.cards || [];
      const context = { cards, getCard: id => read('/api/cards/' + encodeURIComponent(id), '知识卡 ' + id + ' '), navigate: hash => {
        if (!current()) return;
        if (location.hash === hash) route(); else location.hash = hash;
      } };
      nextCleanup = await module['mount' + name[0].toUpperCase() + name.slice(1)](view, context);
    } catch (error) {
      if (!current()) return;
      if (!error.rendered) view.innerHTML = '<section class="error-card"><p class="eyebrow">暂未展开</p><h1>这一页没能载入</h1><p>' + escapeHtml(error.message) + '</p><button type="button" data-retry>再试一次</button></section>';
    }
    if (!current()) { if (typeof nextCleanup === 'function') nextCleanup(); return; }
    cleanup = nextCleanup;
    app.replaceChildren(view); app.removeAttribute('aria-busy');
    app.querySelector('[data-retry]')?.addEventListener('click', route, { once: true });
    app.focus({ preventScroll: true });
    if (name === 'course' && /^(stage-\d|foundation-[1-7])$/.test(section || '')) frame = requestAnimationFrame(() => {
      frame = undefined;
      if (!current()) return;
      const target = document.getElementById(section);
      if (target?.tagName === 'DETAILS') target.open = true;
      target?.scrollIntoView();
    });
  }
  function start() {
    if (active) return;
    active = true;
    window.addEventListener('hashchange', route);
    return route();
  }
  function dispose() {
    active = false; ++routeToken;
    window.removeEventListener('hashchange', route);
    clearView(); cards = [];
  }
  return { start, dispose };
}

let instance;
export function start() {
  instance ||= createLearningApp({ app: document.querySelector('#app'), document, window, location, fetch: (...args) => fetch(...args) });
  return instance.start();
}
export function dispose() { instance?.dispose(); }
if (typeof document !== 'undefined' && !document.querySelector('#plan-workspace')) start();
