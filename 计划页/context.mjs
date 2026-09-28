import { randomUUID, createHash } from 'node:crypto';
import { validRoleName } from './log.mjs';
import { validPeriodicDate } from './public/periodic.js';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const roles = ['家庭', '个人', '工作', '感情'];
const quadrants = ['internal_resource', 'internal_limit', 'external_support', 'external_risk'];
const fields = ['background', 'goal', 'selfSituation', 'otherFacts', 'otherAssumptions', 'progress', 'constraints', 'questions'];
const idOK = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
function validate(kind, raw, registeredRoles = roles) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail('资料格式不正确');
  if (kind === 'opportunity') {
    const allowed = ['id', 'title', 'body', 'nextStep', 'roles', 'status', 'source', 'analysisId', 'updatedAt'];
    if (Object.keys(raw).some(key => !allowed.includes(key)) || (raw.id !== undefined && !idOK(raw.id))) throw fail('机会信息字段不正确');
    if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 200 || /[\r\n\0]/u.test(raw.title)) throw fail('请填写 1 至 200 字的机会标题');
    if (!Array.isArray(raw.roles) || !raw.roles.length || raw.roles.length > 32 || new Set(raw.roles).size !== raw.roles.length || raw.roles.some(role => !registeredRoles.includes(role))) throw fail('请选择已创建的角色');
    const result = { id: raw.id || randomUUID(), title: raw.title.trim(), roles: [...raw.roles], status: raw.status === undefined ? 'candidate' : raw.status, analysisId: raw.analysisId ?? '' };
    if (!['candidate', 'researching', 'archived'].includes(result.status) || (result.analysisId !== '' && !idOK(result.analysisId))) throw fail('机会状态或关联分析不正确');
    for (const [key, limit] of [['body', 16000], ['nextStep', 4000], ['source', 2000]]) {
      const value = raw[key] === undefined ? '' : raw[key];
      if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw fail('机会正文、验证行动或来源说明过长或格式不正确');
      result[key] = value.trim();
    }
    return result;
  }
  if (kind === 'periodic') {
    const allowed = ['id', 'title', 'startDate', 'frequency', 'amount', 'currency', 'notes', 'deleted', 'updatedAt'];
    if (Object.keys(raw).some(key => !allowed.includes(key)) || (raw.id !== undefined && !idOK(raw.id))) throw fail('周期信息字段不正确');
    if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 200 || /[\r\n\0]/u.test(raw.title)) throw fail('请填写 1 至 200 字的周期标题');
    if (!validPeriodicDate(raw.startDate) || !['weekly', 'monthly', 'quarterly', 'yearly'].includes(raw.frequency)) throw fail('开始日期或重复周期不正确');
    const amount = raw.amount ?? null, currency = raw.currency === undefined ? 'CNY' : raw.currency, notes = raw.notes === undefined ? '' : raw.notes;
    if (!(amount === null || (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && amount <= 1e9 && /^\d+(?:\.\d{1,2})?$/.test(String(amount)))) || !['CNY', 'USD', 'EUR'].includes(currency)) throw fail('金额或币种不正确');
    if (typeof notes !== 'string' || notes.length > 4000 || notes.includes('\0') || (raw.deleted !== undefined && typeof raw.deleted !== 'boolean')) throw fail('备注或删除状态不正确');
    return { id: raw.id || randomUUID(), title: raw.title.trim(), startDate: raw.startDate, frequency: raw.frequency, amount, currency, notes: notes.trim(), deleted: raw.deleted ?? false };
  }
  const allowed = ['id', 'roles', 'archived', 'updatedAt', ...(kind === 'condition' ? ['quadrant', 'text', 'source'] : ['title', 'body', 'taskIds', ...fields])];
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw fail('资料包含未知字段');
  if (raw.id !== undefined && !idOK(raw.id)) throw fail('资料编号不正确');
  if (!Array.isArray(raw.roles) || !raw.roles.length || raw.roles.length > 32 || raw.roles.some(role => !registeredRoles.includes(role)) || new Set(raw.roles).size !== raw.roles.length) throw fail('请选择有效角色');
  if (raw.archived !== undefined && typeof raw.archived !== 'boolean') throw fail('归档状态不正确');
  const result = { id: raw.id || randomUUID(), roles: raw.roles, archived: raw.archived || false };
  const text = (key, required, limit) => {
    const value = raw[key] ?? '';
    if (typeof value !== 'string' || value.includes('\0') || value.length > limit || (required && !value.trim())) throw fail(`${key} 内容为空或过长`);
    result[key] = value.trim();
  };
  if (kind === 'condition') {
    if (raw.source !== undefined) {
      if (!raw.source || raw.source.type !== 'ai' || !idOK(raw.source.importId) || Object.keys(raw.source).some(key => !['type', 'importId'].includes(key))) throw fail('条件来源格式不正确');
      result.source = { ...raw.source };
    }
    if (!quadrants.includes(raw.quadrant)) throw fail('条件象限不正确');
    result.quadrant = raw.quadrant; text('text', true, 4000);
  } else {
    text('title', true, 200);
    text('body', false, 16000);
    if (!Array.isArray(raw.taskIds) || raw.taskIds.length > 100 || raw.taskIds.some(id => !idOK(id))) throw fail('关联任务不正确');
    result.taskIds = [...new Set(raw.taskIds)];
    for (const field of fields) text(field, false, 8000);
  }
  return result;
}
export function createContextStore(guard, taskStore) {
  let pending = Promise.resolve();
  const log = '计划/资料/变更.md';
  async function snapshot(includeDeleted = false) {
    let source = '';
    try { source = await guard.readText(log); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const collections = { condition: new Map(), dossier: new Map(), periodic: new Map(), opportunity: new Map() };
    const registeredRoles = [...roles];
    const conditionImports = [];
    let malformed = source && !source.endsWith('\n') ? 1 : 0;
    const lines = source.split('\n'); lines.pop();
    for (const line of lines.filter(Boolean)) {
      try {
        if (!line.startsWith('- ') || line.includes('<!-- interrupted-tail -->')) throw fail('无效资料行');
        const item = JSON.parse(line.slice(2));
        if (item.kind === 'role') {
          if (!validRoleName(item.record?.name) || registeredRoles.includes(item.record.name) || registeredRoles.length >= 32) throw fail('无效角色');
          registeredRoles.push(item.record.name); continue;
        }
        if (item.kind === 'conditions') {
          if (!Array.isArray(item.records) || !item.records.length || item.records.length > 30) throw fail('无效条件批次');
          const records = item.records.map(raw => ({ ...validate('condition', raw, registeredRoles), updatedAt: raw.updatedAt }));
          for (const record of records) collections.condition.set(record.id, record);
          if (item.source) conditionImports.push(item.source);
          continue;
        }
        if (!collections[item.kind]) throw fail('无效资料');
        const record = validate(item.kind, item.record, registeredRoles);
        if (item.kind === 'periodic' && collections.periodic.get(record.id)?.deleted) throw fail('已删除的周期信息不能修改');
        collections[item.kind].set(record.id, { ...record, updatedAt: item.record.updatedAt });
      } catch { malformed++; }
    }
    const analyses = [];
    for (const filename of (await guard.listNames('计划/分析')).filter(name => /^\d{13}-[a-f0-9-]+\.md$/.test(name)).sort().reverse().slice(0, 30)) {
      try {
        const source = await guard.readText(`计划/分析/${filename}`);
        const match = source.match(/^# 分析档案\n\n<!-- yike-analysis-v1 -->\n```json\n([\s\S]+)\n```\n$/);
        if (!match) throw fail('无效分析档案');
        analyses.push(JSON.parse(match[1]));
      } catch { malformed++; }
    }
    return { roles: registeredRoles, conditions: [...collections.condition.values()], dossiers: [...collections.dossier.values()], periodicItems: [...collections.periodic.values()].filter(item => includeDeleted || !item.deleted), opportunities: [...collections.opportunity.values()], conditionImports, analyses, revision: createHash('sha256').update(source).digest('hex'), malformed };
  }
  return { snapshot, save(payload) {
    const run = pending.then(async () => {
      if (!payload || Object.keys(payload).some(key => !['kind', 'expectedRevision', 'record'].includes(key)) || !['condition', 'dossier', 'role', 'periodic', 'opportunity'].includes(payload.kind)) throw fail('资料请求不正确');
      const state = await snapshot(true);
      if (state.malformed) throw fail('资料文件存在损坏记录，请恢复备份后继续', 409);
      if (payload.expectedRevision !== state.revision) throw fail('资料已变化，请刷新后再保存', 409);
      if (payload.kind === 'role') {
        const record = payload.record;
        if (!record || Object.keys(record).some(key => key !== 'name') || !validRoleName(record.name)) throw fail('角色名称需为 1 至 30 字');
        if (state.roles.includes(record.name)) throw fail('角色已存在', 409);
        if (state.roles.length >= 32) throw fail('最多可保存 32 个角色');
        await guard.appendLine(log, '- ' + JSON.stringify({ kind: 'role', record }));
        return snapshot();
      }
      const existing = payload.kind === 'condition' ? state.conditions : payload.kind === 'periodic' ? state.periodicItems : payload.kind === 'opportunity' ? state.opportunities : state.dossiers;
      const previous = existing.find(item => item.id === payload.record?.id);
      if (payload.kind === 'periodic' && previous?.deleted) throw fail('这条周期信息已删除，不能修改', 410);
      const record = validate(payload.kind, ['dossier', 'periodic', 'opportunity'].includes(payload.kind) && previous ? { ...previous, ...payload.record } : payload.record, state.roles);
      if (payload.kind === 'periodic' && !previous && record.deleted) throw fail('不能新建已删除的周期信息');
      if (payload.record.id && !existing.some(item => item.id === record.id)) throw fail('资料不存在', 404);
      if (payload.kind === 'condition') {
        const previous = existing.find(item => item.id === record.id);
        if (previous?.source) record.source = previous.source;
        else delete record.source;
      }
      if (payload.kind === 'dossier') {
        const { tasks } = await taskStore.snapshot();
        if (record.taskIds.some(id => !tasks.some(task => task.id === id))) throw fail('关联任务不存在');
      }
      if (payload.kind === 'opportunity' && record.analysisId) {
        let found = state.analyses.some(item => item.id === record.analysisId);
        // The visible history is capped at 30; older source analyses remain valid.
        if (!found) for (const filename of (await guard.listNames('计划/分析')).filter(name => /^\d{13}-[a-f0-9-]+\.md$/.test(name))) {
          const source = await guard.readText(`计划/分析/${filename}`);
          const match = source.match(/^# 分析档案\n\n<!-- yike-analysis-v1 -->\n```json\n([\s\S]+)\n```\n$/);
          if (!match) continue;
          try { if (JSON.parse(match[1]).id === record.analysisId) { found = true; break; } } catch { /* damaged files cannot establish provenance */ }
        }
        if (!found) throw fail('关联分析不存在，请选择已有分析或清空关联', 400);
      }
      record.updatedAt = new Date().toISOString();
      await guard.appendLine(log, '- ' + JSON.stringify({ kind: payload.kind, record }));
      return snapshot();
    });
    pending = run.catch(() => {}); return run;
  }, saveConditions(records, expectedRevision, provenance) {
    const run = pending.then(async () => {
      const state = await snapshot();
      if (state.malformed || state.revision !== expectedRevision) throw fail('资料已变化或存在损坏，请重新准备 AI 写入', 409);
      if (!Array.isArray(records) || !records.length || records.length > 30) throw fail('AI 条件需为 1 至 30 条');
      const source = { ...provenance, id: randomUUID(), type: 'ai', createdAt: new Date().toISOString() };
      const validated = records.map(raw => {
        if (!raw || Object.keys(raw).some(key => !['roles', 'quadrant', 'text'].includes(key))) throw fail('AI 条件格式不正确');
        return { ...validate('condition', raw, state.roles), source: { type: 'ai', importId: source.id }, updatedAt: new Date().toISOString() };
      });
      const line = '- ' + JSON.stringify({ kind: 'conditions', records: validated, source });
      if (Buffer.byteLength(line) > 250000) throw fail('AI 条件过多，请分批写入', 413);
      await guard.appendLine(log, line);
      return { conditionsWritten: validated.length, context: await snapshot() };
    });
    pending = run.catch(() => {}); return run;
  }, async saveAnalysis(analysis) {
    await guard.writeNew(`计划/分析/${Date.now()}-${randomUUID()}.md`, '# 分析档案\n\n<!-- yike-analysis-v1 -->\n```json\n' + JSON.stringify(analysis, null, 2) + '\n```\n');
  } };
}
