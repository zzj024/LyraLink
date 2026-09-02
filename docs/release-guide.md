# 发布指南（覆盖安装与数据保留）

## 为什么覆盖安装不会丢数据

LyraLink 的全部用户数据（音频、封面、歌词、歌单、文件夹、设置、回收站）都保存在
Windows 的用户数据目录，**不在安装目录里**：

```text
%APPDATA%\LyraLink\library\
├─ library.json      音乐库索引
├─ settings.json     应用设置
├─ playlists.json / folders.json / trash.json
├─ media\            音频文件与封面
└─ trash\            回收站内容
```

NSIS 安装包（`npm run dist:win` 产出）覆盖安装时只替换安装目录里的程序文件；
`deleteAppDataOnUninstall` 已显式设为 `false`，卸载或覆盖都不会动 `%APPDATA%`。
所以用户下载新版安装包、一路下一步装完，音乐库原样保留。

`appId`（`local.linkaudio.app`）是安装器识别"同一个软件"的依据，**永远不要改**；
改了之后新版会被当成另一个软件，旧版也不会被替换。

## 旧版本改名迁移（LinkAudio → LyraLink）

v0.1.2 之前安装包的产品名是 `LinkAudio`，Electron 按产品名决定数据目录，
所以那批安装的数据在 `%APPDATA%\LinkAudio\library\`。直接装 LyraLink 会读不到。

应用启动时会自动处理（`src/main/legacy-migration.ts`）：

- 当前数据目录里 `library` 不存在或为空，且旧目录 `LinkAudio\library`（或 `link-audio\library`）存在时，
  自动把旧 `library` 整体移动过来，之后照常使用。
- 当前 `library` 已有数据时不做任何事，绝不覆盖。
- 迁移是"移动"而非复制（同盘瞬时完成），迁移后旧目录里的 `library` 不再保留。

这一逻辑有单元测试覆盖（`tests/legacy-migration.test.ts`）。

## 发布清单

1. 更新 `package.json` 的 `version`（例如 `0.1.2` → `0.1.3`）。版本号不变会导致安装器无法正确区分新旧版本。
2. 如涉及 AI 运行时或模型变更，先运行 `npm run prepare:offline`。
3. 构建：`npm run dist:win`。
4. 检查 `release/` 下的产物：
   - `LyraLink-Setup-<version>.exe` 安装包
   - `LyraLink-Setup-<version>.exe.blockmap`（保留，未来做差量更新用）
5. 在一台装有旧版本的机器上验证：直接运行新安装包 → 安装完成后音乐库、设置、歌词完整。
6. 验证通过后再分发。

## 后续可选：应用内自动更新

当前流程是"用户手动下载安装包覆盖"。如果以后想做应用内自动更新，
electron-builder 的 NSIS + blockmap 已支持差量更新，接入 `electron-updater`
并提供一个更新源（GitHub Releases 或自建静态服务器）即可，无需改数据层。
