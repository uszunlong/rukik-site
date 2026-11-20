# LGPL 重链接材料包报告（D 线）

- 日期：2026-11-19（PST）
- 依据：用户 2026-11-19 07:41 执行令 `~/workspace/rukik/LIBIME_COMMERCIAL_COMPLIANCE_DIRECTIVE_20261119.md`（A 节 9 项、C 节交付清单）
- 交付物：本目录 `formal/commercial/lgpl-package/`（下称「本包」）
- 口径：本线只交工程材料与实证，**不下任何合规结论**；法律判断归 C 线备忘录（`formal/commercial/LGPL_S6_MEMO_DRAFT.md`，已按定版路径 A 重构）与外部律师。纪律：L1 零成本、真实付费 AI 调用 0 次；未改生产树与生产数据（全部施工在隔离实验区与本包目录内）。

## 一、组件清单与边界（结论版，明细在 MANIFEST）

实际使用的 LGPL 组件共 3 个，全部锁定提交哈希：

| 组件 | 锁定 | 许可证 | RUKIK 修改 |
|---|---|---|---|
| libime 1.1.18 | `53df6a248793f9a00c1769e658630de313f3e419` | LGPL-2.1-or-later | 1 个 CMake 补丁（export 集） |
| KenLM（libime 子模块） | `4cb443e60b7bf2c0ddf3c745378f76cb59e254e5` | LGPL-2.1 为主＋个别文件例外 | 1 个补丁（libproc 头守卫） |
| Fcitx5Utils 5.1.23（fcitx5 子集） | `98830ef7910eb0fe6bfda47466a17e273182486e` | LGPL-2.1-or-later | 4 个补丁（std::format 等价替换） |

传递/配套：Boost 1.85.0（BSL-1.0，仅 iostreams 3 源文件＋663 头文件闭包）、zstd v1.5.6（BSD 路径）、ECM v5.115.0 与 ios-cmake 4.5.0（仅构建期）、系统 libz/Pthread/DL。无其他第三方组件（构建脚本全文可复核）。

边界：RUKIK 自有代码与 LGPL 组件的唯一链接点是适配层 `LibimeBridge.h/.cpp`（固定 C ABI 15 函数，ObjC 侧唯一调用方 RimeBridge.m）；对 LGPL 组件的修改**只有** `patches/` 的 6 个补丁（与构建脚本内嵌补丁逐字一致、机械抽出）；脚本现场生成件（Boost 子集工程、libintl 恒等替身、BoostConfig、preload 模板）为 RUKIK 自有，已归档于 `generated/`。完整清单、来源与逐文件 sha256 见 `MANIFEST.md`；获取与打补丁的一键脚本为 `fetch-sources.sh`（拉取后以 rev-parse 断言锁定哈希）。

## 二、实际重链接验证（桌面级）——通过

脚本 `relink/relink-demo.sh`，全程日志 `relink/relink-demo.log`（2026-11-19 15:51 UTC 起跑，退出码 0）。只用本包材料＋公开工具链（g++ 13.3／CMake 3.28）＋哈希锁定的 pristine 源码，结果：

| 步 | 内容 | 结果 |
|---|---|---|
| 0 | pristine 源码三处 HEAD 与锁定哈希逐字一致、工作树干净；包内桥接源与 tree-libime `0ab718d` 逐字节相同 | ✓ |
| 1 | **基线**：未修改 libime（既有桌面构建）＋本包桥接源码 → 编译 → 桥接 smoke（fix10_smoke，冻结 p0 数据） | **14/14 PASS** |
| 3 | Fcitx5Utils：应用本包 4 补丁后静态构建并安装 | `libFcitx5Utils.a` ✓ |
| 4 | **探针 A/B**：同一静态配置下，不打 libime 补丁先 configure | 如期失败，错误原文：`install(EXPORT "LibIMECoreTargets")... requires target "kenlm" that is not in any export set`——证明 `patches/libime/0001` 是 load-bearing、非装饰 |
| 5–6 | 应用 libime＋KenLM 补丁＋演示修改（`userlanguagemodel.cpp` 尾加 marker 函数）→ 静态重编 libime 并安装 | `libIMECore.a` 2,853,508 B、`libIMEPinyin.a` 1,802,374 B、`libIMETable.a` 1,291,928 B ✓ |
| 7 | RUKIK 侧桥接源码编译为 `LibimeBridge.o`，与重编静态库重新链接 | ✓（见下方发现 2 的注记） |
| 8 | marker 验证：重编 `libIMECore.a` 与最终二进制中均检出字符串 `RUKIK-RELINK-DEMO libime-modified 2026-11-19`，二进制符号表含 `T rukik_relink_demo_marker` | ✓ 证明修改过的源码确实被编入并链入最终产物 |
| 9 | **重链接后 smoke**：与基线同一用例集 | **14/14 PASS，且输出与基线逐字节相同**（两份输出 sha256 相同：`df74867a…`） |

过程发现（如实记录，均已在脚本/日志中留痕）：

1. **FIX6 preload 在桌面同样必需**：静态 Fcitx5Utils 的 Targets 接口引用 `LibIntl::LibIntl` 等三个导入目标，libime 裸 configure 在 generate 期失败——首轮演示实测撞上（错误与 iOS FIX6 记录一致）。演示改用本包 `generated/libime-preload.cmake.tmpl` 的桌面实例化（差别仅 LibIntl 取系统 libc 而非 iOS 替身）后通过。这反过来证明 preload 是静态形态的必要组成、已正确归档在本包。
2. **KenLM 对象未自动并入 libIMECore.a（桌面 CMake 3.28 口径）**：安装后的 `libIMECore.a` 内 nm 检不出 KenLM 符号，演示以显式追加 39 个 kenlm 目标文件完成链接。iOS 侧的对照证据：构建 226 的 appex 二进制（`~/workspace/build226/rukik-226.ipa`）实测含 `kenlm` 字串 20 处、`kheafield` 2 处，证明 CI 工具链下 KenLM 代码确实进入了最终产物——两边行为差异属工具链版本差异。**待办**：律师包定版前，应在 Mac 上以当次 xcframework 实物做一次归档成员/nm 清单复核，把 iOS 侧的 KenLM 载体形态钉死（见 §三）。

## 三、iOS 侧差距分析（只分析，未改树）

桌面演示证明了「改 LGPL 源码 → 重编 → 与 RUKIK 目标文件重链接 → 功能正常」的完整流程。同一套材料搬到 iOS（xcframework＋appex 目标文件）还差：

| # | 差距 | 性质 | 建议动作 |
|---|---|---|---|
| 1 | 未在 Mac 上以本包 `fetch-sources.sh`＋产品构建脚本复现一次「改一行 libime → 重编 xcframework → 与 appex 目标文件重链接 → 装机运行」的端到端实证 | 工程 | 商业版出包前在 CI（macos-15）加一个 relink 演示作业，产物与日志归档回本包 |
| 2 | RUKIK 侧 iOS 目标文件集未归档：正式交付需要键盘扩展目标的全部.o（至少 LibimeBridge.o），当前 EAS 构建不保留中间产物 | 工程 | 出包流程加一步：从 Xcode 构建目录收集 appex 目标文件＋链接命令（-filelist／linker invocation）存入律师包 |
| 3 | `libintl.a` 未进入 libtool 合并清单，其符号在最终 appex 链接中的解析路径未在 iOS 侧复现核对（225/226 已成功链接并真机运行，属间接证据） | 工程 | 随 #1 在 Mac 上以实际链接日志复核后补记 `link/LINKING.md` |
| 4 | KenLM 在 iOS 合并库中的载体形态未以实物清单钉死（见 §二发现 2） | 工程 | 随 #1 对 xcframework 做 ar 成员表＋nm 清单归档 |
| 5 | Xcode／CMake 的 runner 实际版本未钉版记录（仓库未固定，`toolchain/TOOLCHAIN.md` 已标待核实） | 工程 | 以最近一次绿色 Run 的 Actions 日志回读补记 |
| 6 | 重链接产物无法由终端用户自行签名、重装并通过 App Store 分发——签名机制、重装路径与 App Store 条款是否使 §6 权利「实质可实现」 | **平台/法务** | 交 C 线备忘录与律师包，本线不判断（执行令 A.8：若无法实质实现，停止该发行形态、不得以声明代替合规） |
| 7 | RUKIK 用户协议是否含禁止修改/逆向工程的条款、与 LGPL 要求的冲突核查（执行令 A.7） | **法务** | 交 C 线/律师包（需取得现行用户协议文本比对，本线未持有该文本） |

## 四、许可证页面内容稿

`LICENSE_PAGE_CONTENT.md`（中英文双份，中英文同步规则）：含 5 个组件的名称/版本/许可证/版权声明/源码地址，以及 LGPL 重链接材料获取方式段落。获取地址、合规邮箱、提供期限三处为 `` 占位，须待法务选定 §6 履行形态（备忘录路径 A 随包提供／路径 C 书面要约）后回填；页面实际上线属客户端改动，须另行立线并随商业版构建走（本线只交文案稿，未改 App）。

## 五、法务需确认的具体剩余问题（汇总交律师包）

1. §6 履行形态选定：随包提供材料（6a）vs 书面要约（6c），及要约有效期与获取方式表述（与许可证页面占位回填联动）。
2. iOS 签名/重装/App Store 条款下重链接权利的实质可实现性（§三 #6）——若不成立，按执行令 A.8 停用该发行形态或转备选（向全部必要权利人协商单独商业许可，不假设可得）。
3. RUKIK 用户协议与 LGPL 反禁止条款的比对（A.7）。
4. KenLM 仓内 GPL-3.0／LGPL-3.0 文本对应的代码部分是否进入最终二进制（本包已全量归档其许可证文件与例外说明，最终形态以 §三 #4 的实物清单复核后请律师确认）。
5. zstd 双许可（BSD／GPLv2）取 BSD 路径的成立条件确认；Boost 头闭包以原文件子集形态随 vendor 分发的声明充分性。
6. 本包对应的发行形态目前仅为 TestFlight 内部测量构建；转为正式商用发行时，本包须按当次组件版本与链接形态重新复核一遍（版本漂移即材料失效）。

## 六、本线未做（如实）

- 未在 iOS/Mac 侧执行重链接（无 Mac 工具链，差距已逐项列明，未冒充）。
- 未改 App 设置页（只交文案稿）；未改产品树任何文件；未触 E 线语料/模型事项。
- 训练数据授权清单、clean 模型与新旧对照属 E 线交付，不在本报告范围。
