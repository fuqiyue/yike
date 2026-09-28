const planWorkspace = document.querySelector('#plan-workspace');
const learnWorkspace = document.querySelector('#learn-workspace');
const links = [...document.querySelectorAll('[data-space]')];
const learningRoutes = new Set(['course', 'reader', 'practice', 'quiz']);
let learning, pendingLearning, generation = 0;
const styles = [];

const storageLocation = document.querySelector('#learning-storage-location');
if (window.yijingStorage && storageLocation) storageLocation.textContent = '知识库只读，学习进度保存在本机应用数据中。';
document.querySelector('#export-learning-progress')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  const status = document.querySelector('#learning-export-status');
  button.disabled = true;
  try {
    const { downloadLearningProgress } = await import('/learn/storage.js');
    downloadLearningProgress();
    status.textContent = '已生成学习进度文件，请查看下载位置。';
  } catch {
    status.textContent = '学习进度导出失败，请检查存储权限后重试。';
  } finally {
    button.disabled = false;
  }
});

// A skip link moves focus within the current view, never through the hash router.
document.querySelector('.skip-link')?.addEventListener('click', event => {
  event.preventDefault();
  const target = document.querySelector(planWorkspace.hidden ? '#app' : '#entry-heading');
  target?.focus();
});

function learningStyles(enabled) {
  if (enabled && !styles.length) {
    for (const name of ['styles', 'practice', 'quiz', 'reader']) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = '/learn/' + name + '.css';
      if (name === 'reader') link.dataset.readerStyles = '';
      document.head.append(link); styles.push(link);
    }
  }
  for (const link of styles) link.disabled = !enabled;
}

async function showWorkspace() {
  const token = ++generation;
  const route = location.hash.slice(1).split('/')[0];
  const showingPlan = !learningRoutes.has(route);
  planWorkspace.hidden = !showingPlan;
  learnWorkspace.hidden = showingPlan;
  links.forEach(link => {
    const current = showingPlan ? link.dataset.space === (['personal','analysis','settings'].includes(route) ? route : 'plan') : link.dataset.space === 'learn';
    if (current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.title = showingPlan ? '此刻 · 周易定位法' : '学习 · 周易定位法';
  window.dispatchEvent(new CustomEvent('workspacechange', { detail: { workspace: showingPlan ? 'plan' : 'learn' } }));
  learningStyles(!showingPlan);
  if (showingPlan) {
    learning?.dispose();
    document.querySelector('#entry')?.focus({ preventScroll: true });
    return;
  }
  try {
    pendingLearning ||= import('/learn/app.js').catch(error => { pendingLearning = undefined; throw error; });
    learning = await pendingLearning;
    if (token !== generation || learnWorkspace.hidden) return;
    await learning.start();
  } catch {
    if (token !== generation || learnWorkspace.hidden) return;
    document.querySelector('#app').textContent = '学习页暂未载入，请切回此刻后重试。';
  }
}

window.addEventListener('hashchange', showWorkspace);
showWorkspace();

