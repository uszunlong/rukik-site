# MANIFEST — RUKIK libime LGPL 源码与重链接材料包

- 组装日期：2026-11-19（D 线，依据 `~/workspace/rukik/LIBIME_COMMERCIAL_COMPLIANCE_DIRECTIVE_20261119.md` A 节与 C 节）
- 对应产品代码基线：tree-libime 提交 `0ab718d`（分支 `feature/libime-measurement-20261119`），即构建 226（TestFlight 内部测量版）的引擎集成形态。本包是该形态的合规材料包；商业版若变更组件版本，须同步更新本包。
- 验证报告：同目录 `LGPL_PACKAGE_REPORT.md`；重链接实证日志：`relink/relink-demo.log`。

## 一、组件清单（实际使用，逐项锁定）

| 组件 | 角色 | 锁定版本/提交 | 许可证 | 源码获取 |
|---|---|---|---|---|
| libime | 拼音解码引擎（IMECore/IMEPinyin/IMETable） | `53df6a248793f9a00c1769e658630de313f3e419`（1.1.18） | LGPL-2.1-or-later | github.com/fcitx/libime，按 SHA 克隆（`fetch-sources.sh`） |
| KenLM | 语言模型推理（libime 子模块，OBJECT 库） | `4cb443e60b7bf2c0ddf3c745378f76cb59e254e5` | LGPL-2.1 为主，个别文件各自许可（见 `licenses/kenlm-LICENSE-exceptions.txt`）；仓内另附 GPL-3.0／LGPL-3.0 文本（对应仓内其他部分，未链接部分以律师确认为准） | github.com/kpu/kenlm，随 libime submodule 锁定 |
| Fcitx5Utils | 基础工具库（fcitx5 子集，仅 utils） | `98830ef7910eb0fe6bfda47466a17e273182486e`（5.1.23） | LGPL-2.1-or-later（仓内另含 Unicode-DFS-2016 文本，对应个别数据文件） | github.com/fcitx/fcitx5，按 SHA 克隆 |
| Boost | iostreams 组件（3 个源文件）＋头文件闭包 663 个 | 1.85.0（官方 tarball） | Boost Software License 1.0 | archives.boost.io 官方 tarball |
| zstd | KenLM/libime 链接的压缩库 | v1.5.6（tag） | BSD-3-Clause／GPLv2 双许可（取 BSD 路径；其 LICENSE 为双许可声明文本） | github.com/facebook/zstd，按 tag 克隆 |
| extra-cmake-modules (ECM) | 仅构建期 CMake 模块，**不随产品分发** | v5.115.0（tag） | BSD | github.com/KDE/extra-cmake-modules |
| ios-cmake 工具链文件 | 仅构建期 | 4.5.0 | BSD（leetal/ios-cmake） | raw.githubusercontent.com/leetal/ios-cmake |
| libintl 替身 | iOS 构建期/链接期替身，RUKIK 自有恒等透传实现，**无上游代码** | 本包 `generated/libintl-stub/` | RUKIK 自有 | 不适用 |

传递依赖说明：libime 的 CMake 另要求系统 `libz`（iOS 由 SDK 提供、插件链接标志含 `-lz`）与 Pthread/DL（iOS 由系统提供；静态 Fcitx5Utils 的 Targets 接口引用三者导入目标，由 preload 在配置期定义，见 `generated/libime-preload.cmake.tmpl`）。fcitx5 构建期另需宿主 gettext 工具（msgfmt，仅构建机使用）。除上表外，构建脚本未引入其他第三方组件（脚本全文可复核，sha256 见第三节）。

## 二、边界清单（RUKIK 自有 vs LGPL）

- **LGPL 组件**：libime、KenLM、Fcitx5Utils（上表）；对其全部修改＝`patches/` 下 6 个补丁，无其他改动（构建脚本只对克隆树打这 6 个补丁，逐个可在脚本中定位）。
- **RUKIK 自有**：适配层 `LibimeBridge.h/.cpp`（`rukik-objects/`，固定 C ABI、15 个函数）；键盘扩展其余 Swift/ObjC 代码（在产品仓库，不属本包，但其与 libime 的唯一连接点就是本桥）；`generated/` 全部文件（脚本现场生成的工程/替身/模板）；语言模型与词典数据（见第四节）。
- **许可宽松组件**：Boost（BSL-1.0）、zstd（BSD 路径）、ECM（BSD，构建期）。

## 三、包内文件清单（sha256）

外部规范件（不复制进包、以出处＋哈希引用）：产品构建脚本 `tools/build-libime-ios.sh`（tree-libime `0ab718d`）sha256 `c7ecb21437e830021c96e7f7ba5f834e6fab662876db40ae3c420dfa00e09150`；工作流 `.github/workflows/build-libime-ios.yml` 与插件 `apps/mobile/plugins/withRukikKeyboard.js` 同在该提交内。

| 文件 | sha256 |
|---|---|
| `fetch-sources.sh` | `0553eaa9eff75282fa8485145938db92214aa1a92f6ce4aa76cae3e403260f05` |
| `NOTICES-libime-in-tree.md`（产品树内既有声明，原样存档） | `39c1354c6a7fa6ae4d0ec80f9d5d3e85eb78e3102b51479877a821f1d6965889` |
| `LICENSE_PAGE_CONTENT.md` | `14fbcc88f51075691a3ebc559a0b898c009ef356b3ddb8e7e1b263afaaef4cd9` |
| `patches/README.md` | `e9ff113cd40a8ae918eb6bd7dc54eaef1469260dd76cdf8fb72e995da34deb54` |
| `patches/fcitx5/0001-semver-std-format-to-snprintf.patch` | `62e8fa1936a204a500a30c2fa961a86927bf2764eb7e2f2d906714f87c44615a` |
| `patches/fcitx5/0002-log-std-format-to-strftime.patch` | `ad2384a2d932824242d7019fb3c166449426c957cb03868cc4ef55992dfe3006` |
| `patches/fcitx5/0003-eventloopinterface-std-format-to-concat.patch` | `46e8383155e97e8ee55870115ae9d02ac701076ce9f3586da1b59ad9c3bf8e54` |
| `patches/fcitx5/0004-misc-std-format-to-snprintf.patch` | `7336e6e3b78e5a03a07ab230079bd4e4cc18560785bdab5fe206b5fb67c887ad` |
| `patches/libime/0001-core-cmakelists-kenlm-export-set.patch` | `433d0dde9fd074fc0e26efa414a95b641db50d7e2e6e9f75832e67527cdd0c6d` |
| `patches/kenlm/0001-usage-libproc-has-include-guard.patch` | `40b74739e46af8f51583c5d1c1a4495b6b60bb161df3495b674d1f318e4fc616` |
| `generated/boost-ios-CMakeLists.txt` | `f7b072646fc7617775a0ceb0291d2dd25b20d1be8e42ceefe110aa9ed9d8ea27` |
| `generated/BoostConfig.cmake.tmpl` | `7e992c2c1ae641c76034dc1e569bdbd7e86983fc569301f0621dccb30a5d845a` |
| `generated/BoostConfigVersion.cmake` | `137c3967389435054301bfc3bfb1ae4794f19bbfa53dacdd1fab86b70a0470dc` |
| `generated/libime-preload.cmake.tmpl` | `00b3d85d07b3339c41b734814907233509dd735cddab09ca5b18b0d8ce49723b` |
| `generated/libintl-stub/libintl.h` | `d3dfae7c58b0d11b353cc7cbcf86263ce1cf198db62adb44c3122037c674a5ae` |
| `generated/libintl-stub/libintl.c` | `361cad834fe5f3fc776a273a3897bd87a019e4c76960807f7bc9de9a1fe441b7` |
| `generated/libintl-stub/CMakeLists.txt` | `e8b26eea6e2e893e9d9dea820071af86bd13aa0e1fe07d8d01231909084f0ec5` |
| `licenses/LGPL-2.1-or-later.txt`（libime 与 fcitx5 仓内文本 md5 相同，同一份） | `1ccf09bf2f598308df4bed9cd8e9657dc5cd0973d2800318f2e241486e2edf3f` |
| `licenses/kenlm-COPYING-LGPL-2.1.txt` | `dc626520dcd53a22f727af3ee42c770e56c97a64fe3adb063799d8ab032fe551` |
| `licenses/kenlm-LICENSE-exceptions.txt` | `6d9f8894586896ee3b383c962e141f527edeb54f561a6bd189d0eb08380c4cc2` |
| `licenses/kenlm-COPYING.3-GPL-3.0.txt` | `8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903` |
| `licenses/kenlm-COPYING.LESSER.3-LGPL-3.0.txt` | `9ccf26cfe845e0eb8bb58053e47366e7ab6b697ae010f7650978d4b71b7d1fc1` |
| `licenses/fcitx5-Unicode-DFS-2016.txt` | `a307313c2500d85dec8b3dd7e86b17e5dc08b6bda00daebe4d68f7d36beda42d` |
| `licenses/Boost-LICENSE_1_0.txt`（取自 boostorg/boost `boost-1.85.0` tag） | `c9bff75738922193e67fa726fa225535870d2aa1059f91452c411736284ad566` |
| `licenses/zstd-LICENSE.txt`（取自 facebook/zstd `v1.5.6` tag） | `7055266497633c9025b777c78eb7235af13922117480ed5c674677adc381c9d8` |
| `licenses/ecm-copyright-debian.txt`（ECM 的 Debian 版权文件，构建期组件参考） | `e96458212f81300fa30d2adb7f75a6b05acc865378ee2b929f81e4fb58c35e80` |
| `toolchain/TOOLCHAIN.md` | `a5dbfcba068600906c567c55a41f22b67e94fe6cc1d138349f87aa47cff8a040` |
| `link/LINKING.md` | `c8a897e2ed99f084482711dbfba51975686d5f9cb3c44e968f954d1676ca90a9` |
| `rukik-objects/LibimeBridge.h` | `6630db950d7dbf66a445793407a046833e07e95dfd07509e9b757fe0af6a9dcd` |
| `rukik-objects/LibimeBridge.cpp` | `34e095516d23462b4842128aa24f7dcf456b11a54048ee410b27ba43551fd28d` |
| `rukik-objects/README.md` | `ff6a58605337f418d38ea7dc5f845c1b322335bba8942777e6c583868997dac1` |
| `relink/relink-demo.sh` | `f06acf97566a59d676d73eb0485698fd52631d9976acdf5241284f9737121aad` |
| `relink/demo-modification.patch` | `d24dd072cee2c2ceee3c09d9c34560252e1d4fd07e35a5aa1012fd291308aa29` |
| `relink/relink-demo.log` | `5aa3fddce7346fb92dba430612e8d7d19b7b7444f41d7fcffb8973913d91a012` |
| `relink/logs/baseline-smoke.out` ＝ `relink/logs/relink-smoke.out`（两轮输出逐字节相同） | `df74867a4b60c190a983be6b8c4c742c9c44763c1e6d8390c4391641d16da667` |
| `relink/logs/probe-configure.log` | `af5ff1c44f0cabc2723377d0b405c4f92a82b3444ba2b7f71b8b9fc2bd29542a` |
| `relink/logs/fcitx5-configure.log` | `5e65cac97b3cd923352158f43b1a8f3d3ce9fc68080a558050db2bae24f22308` |
| `relink/logs/fcitx5-build.log` | `2ab6b55df6686268ca79f13ab37920d78765e8e3b6179d6b6875a0b3dca8ab5a` |
| `relink/logs/libime-configure.log` | `afb46eea6bc422066d32a64ac01dd994d687280766759f401054e5e48e105b51` |
| `relink/logs/libime-build.log` | `cb2b90e6e364e5ba666f958a0a63e5c1c3e04e24af63b2ec7c942e25c9ce59ff` |
| `relink/logs/preload-desktop.cmake` | `c38770a174e8516c407e4db23e404989980f5a73f489c9c1d954ca1797831d82` |

## 四、参考：数据资产（非本包分发物）

重链接演示与测量构建使用的语言模型/词典为 RUKIK 数据（冻结 p0）：`sc.lm` 30,655,434 B，md5 `7dd29b59c556e78d3ea7c3cd42baf0b7`；`sc.dict` 15,676,596 B，md5 `2f905cd689b38761df253ce30651433b`。按执行令 B 节，该数据仅作内部性能对照、无商业发行资格；商业版数据由 E 线管线另行产出，不在本包范围。
