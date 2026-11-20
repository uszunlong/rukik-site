# 工具链版本记录

## 一、iOS 产品构建（权威口径，Libime.xcframework 的实际产线）

| 项 | 版本/取值 | 依据 |
|---|---|---|
| 构建入口 | `tools/build-libime-ios.sh`（tree-libime 提交 `0ab718d`；脚本 sha256 见 `../MANIFEST.md`） | tree-libime |
| CI | GitHub Actions 工作流 `build-libime-ios`，分支 `feature/libime-measurement-20261119` | Run #8（44493551253）/ Run #11（44503243577）全绿 |
| Runner | **macos-15**（分支版工作流）。注意：tree-libime 本地副本的 yml 为 macos-14＋workflow_dispatch，与分支版分叉——以分支版为准（本地副本未同步） | 分支 yml vs 本地 yml 对照 |
| Xcode / Apple clang | runner 镜像默认版本，仓库内未钉版——**待核实项**：律师包定版前应以 Run #11 的 Actions 日志回读实际 Xcode 版本并补记于此 | 待补 |
| CMake | runner 镜像自带（未钉版，同上待核实） | 待补 |
| iOS 工具链文件 | leetal/ios-cmake **4.5.0**（脚本运行时下载 `ios.toolchain.cmake`） | 脚本原文 |
| 平台/部署目标 | PLATFORM=`OS64` 与 `SIMULATORARM64`（arm64），部署目标 **iOS 13.0** | 脚本＋FIX3 报告 |
| 宿主工具 | Homebrew gettext（msgfmt 等）＋pkg-config（runner 上由脚本自动安装） | 脚本原文 |
| C++ 标准 | libime/Fcitx5Utils 按上游 CMake 默认（C++17）；EAS 构建中 `LibimeBridge.cpp` 以 **gnu++20** 编译（插件 `withRukikKeyboard.js` 的 `CLANG_CXX_LANGUAGE_STANDARD`） | 插件原文＋FIX9 |
| ECM | 5.115.0 在宿主机构建（arch-independent，只提供 CMake 模块） | 脚本原文 |

## 二、锁定的源码输入（详见 `../MANIFEST.md` 组件表）

libime `53df6a248793f9a00c1769e658630de313f3e419`（1.1.18）、KenLM 子模块 `4cb443e60b7bf2c0ddf3c745378f76cb59e254e5`、fcitx5 `98830ef7910eb0fe6bfda47466a17e273182486e`（5.1.23）、ECM `v5.115.0`、Boost `1.85.0`（官方 tarball）、zstd `v1.5.6`。

## 三、桌面重链接演示工具链（本线验证环境，非产品工具链）

| 项 | 版本 |
|---|---|
| OS | Ubuntu 24.04（Linux VM） |
| 编译器 | g++ (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0 |
| CMake | 3.28.3 |
| git / GNU patch | 2.43.0 / 2.7.6 |
| 依赖来源 | Ubuntu noble 官方 .deb 解包至隔离 sysroot（`decoder-research/drivers/libime/vendor/sysroot`，不装系统）：ECM 5.115.0、gettext 0.21、zstd 1.5.5、**Boost 1.83.0** |

**口径声明**：桌面演示的 Boost（1.83）与 zstd（1.5.5）版本与 iOS 产品锁定版（1.85.0 / 1.5.6）不同——演示验证的是「LGPL 组件可修改、可重编、可与 RUKIK 侧目标文件重链接并正常运行」这一流程本身，不声称与 iOS 产物逐字一致。产品口径的重链接复现必须在 macOS 上以第一节工具链＋`../fetch-sources.sh` 拉取的锁定源码执行（见报告 iOS 差距节）。
