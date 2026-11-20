# NOTICES — 甲路线测量构建（libime）

本构建（TestFlight 内部真机测量专用，不上架、不销售）包含以下第三方
开源组件：

- **libime 1.1.18**（含 KenLM 子模块）— LGPL-2.1-or-later
  https://github.com/fcitx/libime
- **Fcitx5Utils 5.1.23**（fcitx5）— LGPL-2.1-or-later
  https://github.com/fcitx/fcitx5
- **Boost 1.85.0**（仅 iostreams 子集）— Boost Software License 1.0
  https://www.boost.org
- **zstd 1.5.6** — BSD 3-Clause
  https://github.com/facebook/zstd
- **extra-cmake-modules 5.115.0** — BSD（仅构建期使用，不随包分发）

说明：libime 以静态库形态链入键盘扩展，仅用于内部测量。LGPL §6
（可重链接）书面确认仍为外部待办事项；本构建不构成公开发行。
随包语言模型与词库为 RUKIK 自有数据（冻结 p0 包，见 lmdata/MD5.txt）。
