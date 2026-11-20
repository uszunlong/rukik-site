# 链接配置与组件边界说明

## 一、组件边界（谁是谁的）

```
Rukik 键盘扩展（appex，RUKIK 自有、闭源）
├─ Swift/ObjC 层：KeyboardViewController.swift、RimeBridge.m 等（RUKIK）
├─ 适配层 LibimeBridge.h/.cpp（RUKIK 自有，固定 C ABI，见 §三）
└─ Libime.xcframework（单一合并静态库，第三方）
   ├─ libIMEPinyin.a    ← libime（LGPL-2.1-or-later）
   ├─ libIMECore.a      ← libime＋KenLM（LGPL-2.1 系，KenLM 为 OBJECT 库并入）
   ├─ libFcitx5Utils.a  ← fcitx5（LGPL-2.1-or-later）
   ├─ libboost_iostreams.a ← Boost 子集（BSL-1.0，RUKIK 生成的构建工程，源文件为 Boost 原文件）
   └─ libzstd.a         ← zstd（BSD-3-Clause／GPLv2 双许可，取 BSD 路径）
构建期专用、不随产品分发：ECM 5.115.0（BSD，仅 CMake 模块）、libintl 替身
（RUKIK 自有恒等透传实现，见 ../generated/libintl-stub/）、Boost 头闭包
（Boost 1.85.0 原文件子集 663 个，随 vendor 分发供编译桥接层）。
```

适配层是工程隔离措施，不免除 LGPL 义务（执行令 §二原话）；§6 的履行靠本材料包＋重链接可行性，不靠接口形态。

## 二、iOS 链接配置（产品构建脚本原文口径）

每平台（OS64／SIMULATORARM64）以 `BUILD_SHARED_LIBS=OFF` 静态构建，安装至同一 prefix 后合并：

```sh
libtool -static -o libime-merged-<PLATFORM>.a \
  $prefix/lib/libIMEPinyin.a $prefix/lib/libIMECore.a \
  $prefix/lib/libFcitx5Utils.a $prefix/lib/libboost_iostreams.a \
  $prefix/lib/libzstd.a
xcodebuild -create-xcframework \
  -library libime-merged-OS64.a -headers $HDR \
  -library libime-merged-SIMULATORARM64.a -headers $HDR \
  -output Libime.xcframework
```

- 头文件 staging：`include/LibIME/libime/` → xcframework Headers 的 `libime/`；`include/Fcitx5/Utils/fcitx-utils/*.h` → `fcitx-utils/`；无 modulemap（与 Rime 的 library 型 xcframework 同形态，桥接层以路径包含）。
- EAS/插件侧（`apps/mobile/plugins/withRukikKeyboard.js`，tree-libime `0ab718d`）：xcframework 与 BoostHeaders 拷入生成工程；键盘目标 `OTHER_LDFLAGS = "$(inherited) -lc++ -lz -all_load"`；`HEADER_SEARCH_PATHS` 含 BoostHeaders；`CLANG_CXX_LANGUAGE_STANDARD = gnu++20`（目标内唯一的 C++ 翻译单元就是 LibimeBridge.cpp）。
- **已知待复核点**：`libintl.a`（替身）未进入上面的 libtool 合并清单——它在 Fcitx5Utils 构建/配置期以导入目标形态被消费。最终 appex 链接中其符号的实际解析路径，本线未在 iOS 侧复现验证（测量构建 225/226 已成功链接并真机运行，但原理路径须在 Mac 上以实际链接日志复核后补记，列为律师包待确认项，见报告 §四）。

## 三、适配层 C ABI（RUKIK 自有，`../rukik-objects/LibimeBridge.h`）

固定 C 接口共 15 个函数：`libime_engine_create / destroy / reset / type / backspace / select / commit_raw / punct / preedit / sel_start / take_commit / candidate_count / candidate`、`libime_free`。ObjC 侧唯一调用方是 `RimeBridge.m` 的 libime 分发分支；Swift 层不直接触达 libime。桥接语义与桌面 harness driver 同口径：冷态不学习（永不调用 learn()）、Inner 模糊、wordCandidateLimit=0、nBest=1、候选上限 270。

## 四、§6(a) 重链接在 iOS 上的对应物（本线只做映射，不下合规结论）

第三方要重链接一个修改过的 libime，需要四件：①修改后按 `../fetch-sources.sh`＋产品构建脚本重编出的合并静态库（或其分立 .a）；②键盘扩展目标的 RUKIK 侧目标文件（至少含 LibimeBridge.o，其余 Swift/ObjC 目标文件由 Xcode 构建产生）；③本节的链接标志与工程配置；④可安装/可运行的载体（签名与分发问题属平台/法务层，见报告 §四待确认清单）。桌面等价流程已实证（`../relink/`）：改 LGPL 源码 → 重编静态库 → 与 RUKIK 侧目标文件（LibimeBridge.o）重链接 → 功能验证通过。
