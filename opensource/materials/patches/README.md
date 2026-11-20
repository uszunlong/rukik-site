# 修改补丁清单（RUKIK 对 LGPL 组件的全部修改）

以下补丁与 iOS 构建脚本 `tools/build-libime-ios.sh`（tree-libime 提交 `0ab718d`）内嵌的补丁**逐字一致**（本线以脚本为源机械抽出，并已对 pristine 源码逐个 `git apply --check` 通过，2026-11-19）。补丁均为 iOS 交叉编译兼容性修改，不改变引擎解码行为；每个补丁都带 `rukik-ios-compat` 标记，构建脚本以该标记判重、幂等应用。

应用方式：在对应仓库根目录执行 `git apply <patch>`（或 `patch -t -p1`，与构建脚本同口径）。

## fcitx5（基线 98830ef7910eb0fe6bfda47466a17e273182486e，Fcitx5Utils 5.1.23）

背景：部署目标 iOS 13.0 下，libc++ 的任何 `std::format` 实例化都会牵连浮点版 `std::to_chars`（iOS 16.3 才可用），Fcitx5Utils 编译失败。四处调用点全部换等价实现，输出逐字不变；补丁后构建脚本另有全目录清零断言（fcitx-utils 内不得残留 `std::format` 家族调用点）。详见 `formal/libime-measure/IOS_SCRIPT_FIX3.md`。

| 文件 | 目标文件 | 内容 |
|---|---|---|
| `fcitx5/0001-semver-std-format-to-snprintf.patch` | `src/lib/fcitx-utils/semver.cpp` | `SemanticVersion::toString()` 的 `std::format("{0}.{1}.{2}")` 改 `snprintf("%u.%u.%u")`，补 `<cstdio>` |
| `fcitx5/0002-log-std-format-to-strftime.patch` | `src/lib/fcitx-utils/log.cpp` | 日志时间戳 `std::format("{:%F %T}", ...)` 改 `strftime`＋显式微秒后缀，补 `<cstdio>`/`<ctime>`；时区口径与上游一致（tzdb 可用时本地时间、否则 UTC） |
| `fcitx5/0003-eventloopinterface-std-format-to-concat.patch` | `src/lib/fcitx-utils/eventloopinterface.cpp` | `std::format("EventLoopException: {0}", strerror)` 改字符串拼接 |
| `fcitx5/0004-misc-std-format-to-snprintf.patch` | `src/lib/fcitx-utils/misc.cpp` | Linux 专用分支 `std::format("/proc/{}/exe", pid)` 改 `snprintf`（该分支 iOS 不可达，一并打掉是为清零断言无例外） |

## libime（基线 53df6a248793f9a00c1769e658630de313f3e419，libime 1.1.18）

| 文件 | 目标文件 | 内容 |
|---|---|---|
| `libime/0001-core-cmakelists-kenlm-export-set.patch` | `src/libime/core/CMakeLists.txt` | 静态构建（`BUILD_SHARED_LIBS=OFF`）下 kenlm（OBJECT 库、PRIVATE 链入 IMECore）以 LINK_ONLY 进入 IMECore 安装接口，CMake export 校验要求其同属一个 export 集，否则 generate 必失败。本补丁把 kenlm 一并放进 `LibIMECoreTargets` export 集（一行）。纯 CMake 目标图修正、平台无关。详见 `formal/libime-measure/IOS_SCRIPT_FIX7.md`。本线桌面重链接演示含该补丁的 load-bearing 实证（未打补丁时静态配置 generate 失败、打后通过，见 `../relink/relink-demo.log`） |

## KenLM（libime 子模块，基线 4cb443e60b7bf2c0ddf3c745378f76cb59e254e5）

| 文件 | 目标文件 | 内容 |
|---|---|---|
| `kenlm/0001-usage-libproc-has-include-guard.patch` | `src/libime/core/kenlm/util/usage.cc` | `<libproc.h>` 是 macOS 专属头、iOS SDK 不提供。改 `__has_include` 条件包含并定义 `KENLM_HAVE_LIBPROC`，其唯一调用点 `PrintUsage()` 中的 `proc_name()` 以同宏守卫；无 libproc 时进程名字段降级为空串，其余诊断输出不变。macOS 上行为与上游完全一致。详见 `formal/libime-measure/IOS_SCRIPT_FIX8.md` |

## 不属于「修改上游源码」的配套件（RUKIK 自有，见 `../generated/`）

- Boost::iostreams 子集工程（只编 `file_descriptor.cpp`/`mapped_file.cpp`/`zlib.cpp` 三个源文件）；
- libintl 恒等透传替身（iOS 无 GNU libintl；无上游代码，声明面对齐标准 gettext API）；
- 最小 BoostConfig 包与 libime preload.cmake（构建期生成，模板形态归档）；
- Boost 头文件闭包清单（663 文件，内嵌于构建脚本 `stage_boost_headers()`，属 Boost 1.85.0 原文件子集、非修改）。
