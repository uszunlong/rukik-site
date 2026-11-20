# 「第三方开源许可证」页面文案·最终版（中英文）

用途：RUKIK App「设置 → 第三方开源许可证」页面文案最终版（执行令 A.6，2026-11-19 定版）。中英文同步，任一语言修改必须同步另一语言。文中 `` 为上线前必须替换的占位项，已逐项标注。本稿只含页面文案；获取方式已经用户授权由主会话定版（2026-11-19，见文末「定版决定记录」），Q1/Q2 等法律定性问题仍以律师审查为准。

---

## 中文版

### 页面标题

第三方开源许可证

### 导言

RUKIK 的智能键盘输入引擎使用了以下开源组件。我们感谢这些项目的作者与贡献者。每个组件的名称、版本、许可证与版权声明如下；许可证全文、对应源代码以及重新链接材料（见下方说明）的获取方式见本页末尾。

### 组件清单

**libime 1.1.18**（含 KenLM 子模块）
拼音解码引擎。
许可证：GNU 宽通用公共许可证 2.1 或更高版本（LGPL-2.1-or-later）
版权：© CSSlayer 及 Fcitx 项目其他贡献者（逐文件的版权声明见源代码中的 SPDX-FileCopyrightText 标记）
源码：https://github.com/fcitx/libime

**KenLM**（libime 子模块，提交 4cb443e6）
语言模型推理库。
许可证：GNU 宽通用公共许可证 2.1（LGPL-2.1；个别文件适用其各自许可证，见源码内 LICENSE 说明）
版权：© Kenneth Heafield 及贡献者
源码：https://github.com/kpu/kenlm

**Fcitx5Utils 5.1.23**（fcitx5）
基础工具库。
许可证：GNU 宽通用公共许可证 2.1 或更高版本（LGPL-2.1-or-later）
版权：© CSSlayer 及 Fcitx 项目其他贡献者（逐文件的版权声明见源代码中的 SPDX-FileCopyrightText 标记）
源码：https://github.com/fcitx/fcitx5

**Boost 1.85.0**（仅 iostreams 组件与部分头文件）
许可证：Boost Software License 1.0
版权：© 各 Boost 库的原作者（见各源文件版权声明）
源码：https://www.boost.org

**Zstandard (zstd) 1.5.6**
许可证：BSD 3-Clause License
版权：© Meta Platforms, Inc. and affiliates
源码：https://github.com/facebook/zstd

### 关于 LGPL 组件与重新链接

上述 LGPL 组件以静态库形式链接进本应用。我们对这些组件所做的全部修改（iOS 兼容性补丁）均随对应源代码一并提供。根据 LGPL 2.1 第 6 条，您可以获取上述组件的完整对应源代码、我们的修改补丁、构建与链接说明，以及为将修改后的组件与本应用重新链接所需的材料。

获取方式：请访问 https://rukik.com/opensource 下载，或发送邮件至 hello@rukik.com 索取，我们在收到请求后 30 日内提供。许可证全文亦包含在上述材料中，并可在 https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html 查阅。

---

## English Version

### Page Title

Third-Party Open Source Licenses

### Introduction

The input engine of the RUKIK smart keyboard uses the open source components listed below. We thank their authors and contributors. Each component's name, version, license, and copyright notice are given below; the full license texts, the corresponding source code, and the relinking materials (see below) are available as described at the end of this page.

### Components

**libime 1.1.18** (including the KenLM submodule)
Pinyin decoding engine.
License: GNU Lesser General Public License, version 2.1 or later (LGPL-2.1-or-later)
Copyright: © CSSlayer and other Fcitx project contributors (per-file notices appear as SPDX-FileCopyrightText headers in the source code)
Source: https://github.com/fcitx/libime

**KenLM** (submodule of libime, commit 4cb443e6)
Language model inference library.
License: GNU Lesser General Public License, version 2.1 (LGPL-2.1; individual files may be under their own licenses — see the LICENSE notes in the source)
Copyright: © Kenneth Heafield and contributors
Source: https://github.com/kpu/kenlm

**Fcitx5Utils 5.1.23** (fcitx5)
Utility library.
License: GNU Lesser General Public License, version 2.1 or later (LGPL-2.1-or-later)
Copyright: © CSSlayer and other Fcitx project contributors (per-file notices appear as SPDX-FileCopyrightText headers in the source code)
Source: https://github.com/fcitx/fcitx5

**Boost 1.85.0** (iostreams component and selected headers only)
License: Boost Software License 1.0
Copyright: © the respective Boost library authors (see the copyright notices in each source file)
Source: https://www.boost.org

**Zstandard (zstd) 1.5.6**
License: BSD 3-Clause License
Copyright: © Meta Platforms, Inc. and affiliates
Source: https://github.com/facebook/zstd

### About the LGPL Components and Relinking

The LGPL components above are linked into this app as static libraries. All modifications we made to them (iOS compatibility patches) are provided together with the corresponding source code. Under section 6 of the LGPL 2.1, you may obtain the complete corresponding source code of these components, our modification patches, the build and linking instructions, and the materials needed to relink a modified version of these components with this application.

How to obtain them: download from https://rukik.com/opensource, or email hello@rukik.com and we will provide them within 30 days of your request. The full license texts are also included in those materials and are available at https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html.

---

## 上线核对项（非页面文案）

1. 材料包获取地址与合规联系邮箱已定版回填（2026-11-19 主会话按用户授权决定：官网下载＋hello@rukik.com＋30 日内提供，中英文同步）。
2. 履行形态定版为「页面下载即时获取＋邮件索取 30 日内提供」；若律师审查对 Q1/Q2 给出不同结论，须同步修订本页表述。
3. 页面上线时须与实际发行版本内的组件版本逐项复核（当前文案对应 libime 测量线锁定的版本集；商业版若更换组件版本须同步改稿）。
4. ECM（extra-cmake-modules）仅构建期使用、不随 App 分发，未列入页面；如法务要求列示构建工具，再补。

## 定版决定记录（2026-11-19，用户授权主会话决定）

- **EULA 形态**：采用 Apple 标准 EULA（自带开源豁免条款），不另行自定义 EULA（C 线备忘录 T1 待决项关闭）。
- **材料获取**：官网 https://rukik.com/opensource 下载为主渠道，hello@rukik.com 为邮件渠道，邮件请求 30 日内提供；材料持续提供期不少于最后一次分发后 3 年。
- **Q1/Q2 工作口径**：按路径 A（静态链接＋材料交付＋商店外自签名重链接）推进，最终以 iOS 真机八步重链接演示实测裁决；演示不过则按执行令 A.8 停用该发行形态。
- **词典 mc 决策项**（F 线剩余问题 1）：词形全量保留、仅清洁计数（清洁版词典候选口径定版）；词形入选依据的法律定性保留在律师包问题清单。
