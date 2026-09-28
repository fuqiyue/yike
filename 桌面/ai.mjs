import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function endpoint(value) {
  if (typeof value !== 'string' || value.length > 1000) throw new Error('请填写模型接口地址');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('模型接口地址无效'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) throw new Error('请使用 HTTPS 接口地址；本机服务可使用 HTTP，地址不含密钥或查询参数');
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return url.toString().replace(/\/$/, '');
}
function safeFile(filename) {
  for (let current = path.resolve(filename); ; current = path.dirname(current)) {
    try { const stat = fs.lstatSync(current); if (stat.isSymbolicLink() || stat.isFile() && stat.nlink > 1) throw new Error('模型设置路径不能为链接'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) break;
  }
}
export function createAIService(profileRoot, safeStorage, { fetchImpl = fetch, timeout = 120000 } = {}) {
  const filename = path.join(profileRoot, 'ai-settings.json');
  const load = () => {
    safeFile(filename);
    try {
      if (fs.statSync(filename).size > 32768) throw new Error('模型设置文件过大');
      const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (value.version !== 1 || typeof value.model !== 'string' || value.model.length > 200 || typeof value.encryptedKey !== 'string') throw new Error('模型设置格式无效');
      return { ...value, baseUrl: endpoint(value.baseUrl) };
    } catch (error) { if (error.code === 'ENOENT') return null; throw new Error('模型设置读取失败，原文件已保留'); }
  };
  let pending = false, activeController;
  const info = () => {
    const data = load();
    return { available: safeStorage.isEncryptionAvailable(), configured: Boolean(data?.model && data?.encryptedKey), hasKey: Boolean(data?.encryptedKey), baseUrl: data?.baseUrl || '', model: data?.model || '' };
  };
  return {
    info,
    cancel() { activeController?.abort(); },
    save(value) {
      if (pending) throw new Error('分析进行中，请结束后修改模型设置');
      if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['baseUrl', 'model', 'apiKey'].includes(key))) throw new Error('模型设置格式无效');
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥保护不可用，未保存');
      const baseUrl = endpoint(value.baseUrl), model = typeof value.model === 'string' ? value.model.trim() : '';
      if (!model || model.length > 200 || /[\r\n\0]/.test(model)) throw new Error('请填写正确的模型名称');
      if (typeof value.apiKey !== 'string' || value.apiKey.length > 8192 || /[\r\n\0]/.test(value.apiKey)) throw new Error('API Key 格式无效');
      const previous = load();
      if (!value.apiKey.trim() && previous?.baseUrl !== baseUrl) throw new Error('更换接口地址时请重新填写 API Key');
      const encryptedKey = value.apiKey.trim() ? safeStorage.encryptString(value.apiKey.trim()).toString('base64') : previous?.encryptedKey;
      if (!encryptedKey) throw new Error('请填写 API Key');
      fs.mkdirSync(profileRoot, { recursive: true }); safeFile(filename);
      const temporary = path.join(profileRoot, `.ai-${randomUUID()}.tmp`);
      try {
        fs.writeFileSync(temporary, JSON.stringify({ version: 1, baseUrl, model, encryptedKey }, null, 2), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, filename);
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      return info();
    },
    async generate(messages) {
      if (pending) throw new Error('已有分析正在进行，请稍候');
      const config = load();
      if (!config?.encryptedKey) throw new Error('请先在设置中配置模型');
      if (!Array.isArray(messages) || Buffer.byteLength(JSON.stringify(messages)) > 600000) throw new Error('分析材料过大，请缩小范围');
      let key;
      try { key = safeStorage.decryptString(Buffer.from(config.encryptedKey, 'base64')); } catch { throw new Error('密钥无法读取，请重新保存 API Key'); }
      const controller = new AbortController();
      activeController = controller;
      const timer = setTimeout(() => controller.abort(), timeout);
      pending = true;
      try {
        const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model: config.model, messages, stream: false }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`模型服务返回 HTTP ${response.status}，请检查地址、模型、密钥和额度`);
        }
        const reader = response.body.getReader(), chunks = []; let bytes = 0;
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          bytes += value.length;
          if (bytes > 1024 * 1024) { await reader.cancel(); throw new Error('模型回复过长，请缩小分析范围'); }
          chunks.push(Buffer.from(value));
        }
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('模型返回的内容格式不正确'); }
        const output = data.choices?.[0]?.message?.content;
        if (typeof output !== 'string' || !output.trim()) throw new Error('模型未返回分析正文，请检查模型是否支持 Chat Completions');
        if (data.choices[0].finish_reason === 'length') throw new Error('模型回复被截断，请缩小分析范围后重试');
        if (output.length > 60000) throw new Error('模型回复过长，请缩小分析范围');
        return output.replaceAll(key, '[密钥已隐藏]');
      } catch (error) {
        if (controller.signal.aborted) throw new Error('分析超过两分钟，请稍后重试或缩小范围');
        if (error instanceof TypeError) throw new Error('无法连接模型服务，请检查地址与网络');
        throw error;
      } finally { clearTimeout(timer); pending = false; activeController = undefined; key = undefined; }
    },
  };
}
