import { mkdir, readFile, rename, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('.');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const release = path.join(root, 'dist/交付', version);
const names = ['setup', 'portable'].map(kind => `Yike-${version}-x64-${kind}.exe`);
// Check both build outputs before changing the delivery directory.
for (const name of names) await access(path.join(root, 'dist/build', name));
try {
  await access(release);
  const archive = path.join(root, 'dist/历史版本', `${version}-rebuild-${Date.now()}`);
  await mkdir(path.dirname(archive), { recursive: true });
  await rename(release, archive);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(release, { recursive: true });
for (const name of names) await rename(path.join(root, 'dist/build', name), path.join(release, name));
await writeFile(path.join(release, '使用说明.txt'), `一刻 ${version} · Windows x64\n\n推荐：双击 ${names[0]}，按向导安装，再用桌面快捷方式打开。\n免安装：双击 ${names[1]}。首次启动会临时解压，请稍候。\n两个 EXE 任选一个，不需要同时使用。无需另装 Node.js。\n\n数据保存在 %APPDATA%\\Yike\\data，安装版与免安装版共用。\n仅复制 EXE 不会携带你的记录。更新前退出应用；可在设置中备份数据。\n本版提供四象限任务筛选、个人情况中的笔记档案、自定义角色、按角色分析和 AI 条件写入。学习与查阅在顶部导航。\nAI 写入须提供实际情况原文并显式发送，配置模型地址、模型名及密钥后使用。\n保留旧版记录；新增角色与条件批次应使用新版读取，回退请恢复旧版对应备份。\n保留简体中文、繁体中文、英文运行时资源，使用最大压缩。\nSHA256SUMS.txt 用于核对两个 EXE 的完整性。\n`, 'utf8');
console.log(`交付目录：${release}`);
await writeFile(path.join(release, '机会使用说明.txt'), `分析 → 机会\n\n机会用于记录未来候选方向、依据、下一步和来源，可按角色查询，并标为候选、研究中或归档。\n分析结果点击“存为机会”后先整理草稿，确认保存后才进入机会列表。\n“加入任务”只预填任务标题，请选择四象限并点击添加。\n分析单个机会或未来方向前，会列出实际发送给模型的材料；机会是待验证假设，不是已证实的个人事实。\n个人资料存于用户数据目录，不随安装包交付。外部文件的日期和原文判断不代表已经核实当前有效性。\n`, 'utf8');
await writeFile(path.join(release, '周期信息说明.txt'), `个人情况 → 周期信息\n\n点击“新增周期信息”，填写名称、开始日期和周期；金额与备注可选。\n支持每周、每月、每季度、每年。金额为每期金额，支持人民币、美元、欧元。\n开始日期是本期起点，首次到期为一个周期后；下次到期显示今天或未来最近的周期边界，不代表已经付款或续费。\n短月取月末，后续仍以原始开始日计算。\n可修改或删除；删除后从列表移除，追加历史保留在本地资料日志。\n周期信息独立于任务，不自动扣款、不发系统通知，也不会自动发送给模型。\n`, 'utf8');
