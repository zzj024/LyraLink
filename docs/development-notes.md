# LyraLink 开发踩坑记录

> 给下一次维护/续写这个项目的人（包括未来的 AI 助手）。
> 每条都是实际踩过的坑，动相关代码前先看对应条目。

## 一、打包 / 构建

### 1. 新生成的 `.asar` 大文件会被长时间锁定（EBUSY）
**现象**：`electron-builder` 报 `EBUSY: resource busy or locked, unlink 'release\win-unpacked\resources\app.asar'`，且 `rm -rf` 也删不掉；进程列表里根本没有 LyraLink/electron 进程。
**原因**：本机后台服务（疑似 XxYun 云盘同步桌面目录，或杀毒/索引服务）会锁定新写入的大文件很久。
**解决**：不要死磕删除，直接换一个全新的输出目录打包：
```bash
npx electron-builder --win nsis -c.directories.output=release2
```
打包输出目录在 `package.json → build.directories.output`（当前为 `release2`）。旧的锁定目录**重启电脑后**再手动删除即可。
**注意**：打包前先 `taskkill /F /IM LyraLink.exe`——用 `win-unpacked\LyraLink.exe` 冒烟测试后如果忘了关，目录同样会被锁。

### 2. electron-builder 下载 NSIS/签名工具超时
**现象**：打包在 "downloaded electron progress=100%" 之后报 `Timeout awaiting 'request' for 600000ms`（`got` 库超时栈）。
**原因**：electron-builder 要从 GitHub Releases 下载 winCodeSign/NSIS 工具，本机访问 GitHub 不稳定。
**解决**：已把国内镜像写进 `package.json` 的 `dist:win` 脚本（cross-env 设置 `ELECTRON_MIRROR` 和 `ELECTRON_BUILDER_BINARIES_MIRROR` 指向 npmmirror）。手动调用 electron-builder 时记得带同样的环境变量。

### 3. 打包版托盘图标创建失败
**现象**：安装包运行正常，但日志出现 `UnhandledPromiseRejectionWarning: Failed to load image from path '...\LyraLink.exe'`，托盘图标缺失。
**原因**：旧代码用 `process.execPath`（exe 自身）当托盘图标；electron-builder 只把图标嵌进 exe，不会自动放一份 `icon.ico` 到 resources。
**解决**：`icon.ico` 已加入 `package.json → build.extraResources`（复制到 `resources/icon.ico`），`createTray()` 打包态用 `process.resourcesPath` 取。新增打包资源时同样走 `extraResources`。

### 4. 启动日志刷 `Unable to move the cache: 拒绝访问`（GPU 缓存）
**解决**：已在 `main/index.ts` 顶部 `app.commandLine.appendSwitch("disable-gpu-shader-disk-cache")`，勿删。该缓存只加速着色器编译，禁用无副作用。

## 二、在线音源（main/media-service.ts）

### 5. B站搜索接口需要 wbi 签名
`api.bilibili.com/x/web-interface/wbi/search/type` 不带 wbi 签名（w_rid）和 buvid cookie 时，返回 `code:0` 但 `data` 里只有 `v_voucher`、没有 `result` 数组——表现为"永远搜不到"且不报错。当前版本未做签名（用户确认可用性优先级低）；若要修，参考社区的 wbi 签名实现（wbi key 从 nav 接口拿，md5 混淆表重排）。

### 6. 网易云 VIP 歌曲必须预先过滤
`enhance/player/url` 接口对 VIP/无版权歌曲返回 `code:0` 但 `url:null`。搜索结果必须用 `neteasePlayableIds()` 批量校验（一次请求传整页 id 数组）并过滤，否则用户点击后才报"需要版权"。校验失败时不要拦截结果（保持搜索可用），走兜底报错即可。

### 7. 音源接口实测结论（2026-09，换机器/时间后需重新验证）
- ✅ 网易云 web 接口（搜索/直链/歌词，匿名可用）
- ✅ Joox（经 GDStudio 聚合接口 `music-api.gdstudio.xyz`，320k 完整曲目 + 封面 + 歌词，keyless）
- ✅ Audius（已按用户要求移除，但接口本身 keyless 可用，代码在 git 历史）
- ❌ 咪咕（旧接口 301，新 jadeite 接口 403 要签名）
- ❌ 酷我（`api/www` 和旧 `r.s` 搜索能通，但取直链全部 "The request is illegal"）
- ❌ iTunes 搜索可用但只有 30~90 秒试听，用户认为没意义已移除
- ❌ Deezer / SoundCloud / YouTube / Archive.org：本机网络直连不可达；若用户配了代理，YouTube 走现有 yt-dlp 链路即可接入
- Jamendo：需要 client_id（key 类，跳过）

### 8. 预览服务器流转发必须挂 error 处理器
`ensurePreviewServer()` 里所有 `fetch` 上游流转 `Readable.fromWeb().pipe(response)` 的地方，必须双向挂 `error`/`close` 处理器并在断开时互相 destroy——否则播放器暂停/切歌会触发 undici 的 `TypeError: terminated` 未捕获异常，主进程弹崩溃框。另有 `process.on("uncaughtException")` 兜底（只记日志勿删）。转发时要透传 `Range` 请求头并回传 206/Content-Range，否则进度条拖动失效。

### 9. 导入元数据走 `ImportRequest.meta`
Joox 等聚合源的标题/歌手/封面在搜索结果里已有，下载时必须通过 `ImportRequest.meta` 传给主进程，否则入库的名字会变成兜底的 "Joox 曲目"。Joox 的自定义 URL 协议是 `gdstudio-joox:<id>|<picId>|<lyricId>`，解析在 `parseJooxId()`。

## 三、渲染端交互

### 10. 空格播放/暂停被"双触发"抵消
`App.vue` 里 `onKeydown`（document）和 `onWindowKeydown`（window）会先后收到同一个按键事件。空格的播放/暂停**只允许在 `onKeydown` 里处理一次**；`onWindowKeydown` 只保留左右方向键快进快退。谁再往 `onWindowKeydown` 里加 Space 分支，空格就会"按了没反应"（两次 toggle 互相抵消）。

### 11. 桌面歌词窗口
- 打开必须用 `showInactive()`，用 `show()+focus()` 会抢焦点并导致主窗口交互异常；
- 可见性以主进程为唯一事实来源：歌词窗 `show`/`hide` 事件广播 `desktop-lyrics:visibility`，PlayerBar 的「词」按钮只订阅这个事件，不要在渲染端自行维护开/关状态；
- 默认停靠位置逻辑在 `placeDesktopLyricsDefault()`：优先主窗口上/下留白区，避免盖住底部播放栏。

### 12. 歌词页小唱臂必须相对唱片容器定位
`DetailView.vue` 的 `tonearm-mini` 曾因相对整个左栏定位而"悬空"。唱臂 SVG 的旋转基准必须设 `transform-origin: 30px 30px`（唱臂底座），且要包在与小唱片同尺寸的 `.mini-wrap` 里。无封面时用 `.mini-disc-label`（62% 直径的主题色 Label），不要只放一个居中小字符。

## 四、工程约定

- **改完必跑**：`npx tsc --noEmit && npx vue-tsc --noEmit -p tsconfig.renderer.json && npm run build && node --test dist/tests/*.test.js`（19 个测试应全过）。
- **批量脚本改代码有风险**：曾用 python 脚本做"删除某注释到另一注释之间的代码"，结果结束标记没匹配上、静默删掉文件后半段。对大段删除优先用精确的 Edit 工具；真要用脚本，删完立刻 `npx tsc --noEmit` 验证。
- **新版只打包不安装验证是不够的**：至少要启动 `win-unpacked\LyraLink.exe` 并检查日志无 error（托盘 bug 就是这么发现的）。
- `测试素材/` 里有用户的曲库备份数据，不是垃圾文件，勿删。
- 恢复历史：`release/win-unpacked/resources/app.asar` 的旧安装包 + sourcemap 可以找回历史源码（esbuild `sourcemap: true` 已开启）。
