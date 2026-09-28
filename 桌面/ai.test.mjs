import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAIService, endpoint } from './ai.mjs';

const crypto = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from([...value].reverse().join('')), decryptString: value => [...value.toString()].reverse().join('') };
function fixture(t, options) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yike-ai-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, ai: createAIService(root, crypto, options) };
}
test('API endpoint requires TLS except loopback and rejects embedded secrets', () => {
  assert.equal(endpoint('https://example.com/v1/chat/completions'), 'https://example.com/v1');
  assert.equal(endpoint('http://127.0.0.1:3000/v1/'), 'http://127.0.0.1:3000/v1');
  for (const value of ['http://example.com/v1', 'file:///tmp/x', 'https://user:pass@example.com', 'https://example.com?key=x']) assert.throws(() => endpoint(value));
});
test('settings persist encrypted key, never expose it and require new key for new endpoint', t => {
  const { ai, root } = fixture(t);
  const input = { baseUrl: 'https://example.com/v1', model: 'mock', apiKey: 'synthetic-test-secret' };
  const saved = ai.save(input);
  assert.equal(saved.hasKey, true); assert.ok(!JSON.stringify(saved).includes(input.apiKey));
  assert.ok(!fs.readFileSync(path.join(root, 'ai-settings.json'), 'utf8').includes(input.apiKey));
  assert.equal(ai.save({ ...input, apiKey: '' }).hasKey, true);
  assert.throws(() => ai.save({ ...input, baseUrl: 'https://other.example/v1', apiKey: '' }));
  fs.writeFileSync(path.join(root, 'ai-settings.json'), 'broken');
  assert.throws(() => ai.save(input)); assert.equal(fs.readFileSync(path.join(root, 'ai-settings.json'), 'utf8'), 'broken');
});
test('Chat Completions request uses configured model and prevents redirects', async t => {
  const { ai } = fixture(t, { fetchImpl: async (url, options) => {
    assert.equal(url, 'https://example.com/v1/chat/completions');
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer synthetic-key');
    assert.equal(JSON.parse(options.body).model, 'mock');
    return new Response(JSON.stringify({ choices: [{ message: { content: '分析结果' }, finish_reason: 'stop' }] }));
  } });
  ai.save({ baseUrl: 'https://example.com/v1', model: 'mock', apiKey: 'synthetic-key' });
  assert.equal(await ai.generate([{ role: 'user', content: '合成资料' }]), '分析结果');
});
test('provider errors omit returned body and credentials', async t => {
  const { ai } = fixture(t, { fetchImpl: async () => new Response('do not leak synthetic-key', { status: 401 }) });
  ai.save({ baseUrl: 'https://example.com/v1', model: 'mock', apiKey: 'synthetic-key' });
  await assert.rejects(ai.generate([]), error => error.message.includes('401') && !error.message.includes('synthetic-key'));
});
test('unavailable encryption never stores plaintext', t => {
  const { root } = fixture(t);
  const ai = createAIService(root, { isEncryptionAvailable: () => false });
  assert.throws(() => ai.save({ baseUrl: 'https://example.com/v1', model: 'mock', apiKey: 'synthetic-key' }));
  assert.equal(fs.existsSync(path.join(root, 'ai-settings.json')), false);
});
