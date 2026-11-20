# RUKIK 侧重链接材料（适配层）

| 文件 | 归属 | 来源 |
|---|---|---|
| `LibimeBridge.h` | RUKIK 自有 | tree-libime 提交 `0ab718d`，`apps/mobile/keyboard/LibimeBridge.h`（sha256 见 `../MANIFEST.md`） |
| `LibimeBridge.cpp` | RUKIK 自有 | 同上（FIX10 后的现行版，含标点路由与拼音 preedit 语义） |

说明：

- 这是 RUKIK 代码中**唯一直接链接 libime 的 C++ 翻译单元**。键盘扩展其余部分（Swift/ObjC）只经 `RimeBridge.m` 调用本桥的固定 C ABI（15 个函数，见 `../link/LINKING.md` §三），不直接引用 LGPL 符号。
- 桌面重链接演示（`../relink/relink-demo.sh`）以本目录的这两个文件现场编译出 `LibimeBridge.o`，与重编后的 LGPL 静态库链接——该 `.o` 即桌面口径下「重链接所需的 RUKIK 目标文件」。
- iOS 正式交付时，对应材料是键盘扩展目标在 Xcode 构建中产生的目标文件集（含上述桥接对象与其余 RUKIK 目标文件）；其收集与打包方式列入报告待确认项，本包先以桥接源码＋桌面对象流程证明可重链接性，不冒充 iOS 材料已齐。
- 本桥加载的语言模型/词典数据（冻结 p0：sc.lm/sc.dict）是 RUKIK 数据资产、非 LGPL 组件，不在本包分发范围；其 md5 记录见 `../MANIFEST.md` 参考节。注意：p0 数据的训练语料含 news_2020/LCCC，按执行令 B 节仅作内部性能对照、无商业发行资格；商业版数据由 E 线 commercial-clean 管线另行产出，与本包无关。
