export const LEARNING_KEYS = Object.freeze([
  'yijing-course-progress-v1',
  'yijing-course-domain-cards-v1',
  'yijing-learning:quiz75:self-assessment:v1',
]);

export function resolveLearningStorage(environment = globalThis) {
  const bridge = environment.window?.yijingStorage ?? environment.yijingStorage;
  if (bridge && typeof bridge.getItem === 'function' && typeof bridge.setItem === 'function') return bridge;
  return environment.localStorage;
}

// Resolve lazily: blocked browser storage must reach the caller's save-error UI.
export const learningStorage = {
  getItem(key) { return resolveLearningStorage().getItem(key); },
  setItem(key, value) { return resolveLearningStorage().setItem(key, value); },
};

export function exportLearningProgress(storage = learningStorage) {
  const values = {};
  for (const key of LEARNING_KEYS) {
    const value = storage.getItem(key);
    if (value !== null && value !== undefined) {
      if (typeof value !== 'string') throw new Error('学习进度格式异常，未导出。');
      JSON.parse(value);
      values[key] = value;
    }
  }
  return { format: 'yijing-learning', version: 1, values };
}

export function downloadLearningProgress() {
  const content = JSON.stringify(exportLearningProgress(), null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `学习进度-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
