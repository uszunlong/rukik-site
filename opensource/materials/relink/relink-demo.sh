#!/usr/bin/env bash
# relink-demo.sh — RUKIK libime LGPL 材料包：桌面级实际重链接验证。
#
# 证明链（全部只用本材料包内容＋公开工具链＋哈希锁定的 pristine 源码）：
#   0) 校验本地 pristine 源码 HEAD 与锁定哈希逐字一致、工作树干净；
#   1) 基线：未修改的 libime（既有桌面构建）＋本包 RUKIK 桥接源码，
#      编译并跑桥接 smoke（fix10_smoke，14 项）——修改前基线；
#   2) 探针：静态配置下不打 libime 补丁先 configure——预期死于 kenlm
#      export 集校验（证明 patches/libime/0001 是 load-bearing）；
#   3) 对源码副本应用本包全部补丁＋一处无害演示修改（marker 函数）；
#   4) 以静态形态重编 Fcitx5Utils 与 libime（含 KenLM）并安装；
#   5) 把 RUKIK 侧桥接源码编译为目标文件 LibimeBridge.o，与重编后的
#      LGPL 静态库重新链接出 smoke 二进制；
#   6) 验证 marker 字符串/符号确实进入重编库与最终二进制；
#   7) 跑同一 smoke：必须与基线同为 14/14。
#
# 源码来源：默认复用本机已有的 pristine 校验克隆（decoder-research
# 隔离实验区，HEAD 经第 0 步断言与锁定值一致）；从零获取的规范路径
# 是 ../fetch-sources.sh（GitHub 官方仓库＋同一锁定哈希）。
# 桌面依赖（ECM/Boost/gettext/zstd）来自 Ubuntu noble 官方 .deb 解包
# 的隔离 sysroot（不装系统），版本差异见 ../toolchain/TOOLCHAIN.md。
#
# 用法：bash relink-demo.sh
# 工作区：${RELINK_WORK:-$HOME/workspace/.relink-work}（须在大磁盘上；
# 本机 /tmp 为 512MB tmpfs，放不下构建树）。日志同时落工作区与本包
# relink/relink-demo.log。
set -uo pipefail

PKG="$(cd "$(dirname "$0")/.." && pwd)"
FORMAL="$HOME/workspace/rukik-ai-keyboard-20261117/formal"
DRIVERS="$FORMAL/lexicon/decoder-research/drivers/libime"
P0="$FORMAL/lexicon/decoder-pathA-lightweight/ios-proto/lmdata"
SMOKE_SRC="$FORMAL/libime-measure/fix10_smoke.cpp"
WORK="${RELINK_WORK:-$HOME/workspace/.relink-work}"
SR="$DRIVERS/vendor/sysroot/usr"
LIBDIR="$SR/lib/x86_64-linux-gnu"
FP0="$DRIVERS/vendor/fcitx-prefix"
PREFIX="$WORK/prefix"
MARKER="RUKIK-RELINK-DEMO libime-modified 2026-11-19"

LIBIME_SHA="53df6a248793f9a00c1769e658630de313f3e419"
KENLM_SHA="4cb443e60b7bf2c0ddf3c745378f76cb59e254e5"
FCITX5_SHA="98830ef7910eb0fe6bfda47466a17e273182486e"

mkdir -p "$WORK"
LOG="$WORK/relink-demo.log"
exec > >(tee "$LOG") 2>&1
trap 'cp "$LOG" "$PKG/relink/relink-demo.log" 2>/dev/null || true' EXIT

echo "=== RUKIK libime LGPL relink demonstration (desktop) ==="
echo "date: $(date -Is)"
echo "toolchain: $(g++ --version | head -1); $(cmake --version | head -1); git $(git --version | awk '{print $3}')"
FAIL=0
note_fail() { echo "!! STEP FAILED: $1"; FAIL=1; }

echo "--- step 0: pristine source verification ---"
for spec in "$DRIVERS/src|$LIBIME_SHA" "$DRIVERS/src/src/libime/core/kenlm|$KENLM_SHA" "$DRIVERS/vendor/fcitx5-src|$FCITX5_SHA"; do
  d="${spec%%|*}"; want="${spec#*|}"
  got="$(git -C "$d" rev-parse HEAD)"
  echo "$d HEAD=$got (want $want)"
  [ "$got" = "$want" ] || note_fail "HEAD mismatch at $d"
done
if [ -n "$(git -C "$DRIVERS/src" status --porcelain)" ] || [ -n "$(git -C "$DRIVERS/vendor/fcitx5-src" status --porcelain)" ]; then
  note_fail "pristine checkout not clean"
else
  echo "working trees clean"
fi
cmp "$PKG/rukik-objects/LibimeBridge.cpp" "$FORMAL/tree-libime/apps/mobile/keyboard/LibimeBridge.cpp" \
  && echo "package LibimeBridge.cpp == tree-libime 0ab718d copy" || note_fail "bridge source differs from tree"

echo "--- step 1: baseline smoke (unmodified libime, existing desktop build) ---"
g++ -std=c++20 -O2 -o "$WORK/baseline-smoke" "$SMOKE_SRC" "$PKG/rukik-objects/LibimeBridge.cpp" \
  -I"$PKG/rukik-objects" -I"$DRIVERS/src/src" -I"$DRIVERS/build/src" \
  -I"$FP0/include/Fcitx5/Utils" -I"$SR/include" \
  -L"$DRIVERS/build/bin" -lIMEPinyin -lIMECore \
  -L"$FP0/lib" -lFcitx5Utils \
  -Wl,-rpath,"$DRIVERS/build/bin" -Wl,-rpath,"$FP0/lib" \
  || note_fail "baseline compile"
LD_LIBRARY_PATH="$LIBDIR" "$WORK/baseline-smoke" "$P0/sc.lm" "$P0/sc.dict" > "$WORK/baseline-smoke.out" 2>&1
cat "$WORK/baseline-smoke.out"
grep -q "SMOKE_DONE failures=0" "$WORK/baseline-smoke.out" && echo "BASELINE: 14/14 PASS" || note_fail "baseline smoke"

echo "--- step 2: copy pristine sources ---"
rm -rf "$WORK/libime-src" "$WORK/fcitx5-src"
cp -a "$DRIVERS/src" "$WORK/libime-src"
cp -a "$DRIVERS/vendor/fcitx5-src" "$WORK/fcitx5-src"

echo "--- step 3: build Fcitx5Utils (static, package patches applied) ---"
for p in "$PKG"/patches/fcitx5/*.patch; do git -C "$WORK/fcitx5-src" apply "$p" || note_fail "apply $p"; done
git -C "$WORK/fcitx5-src" diff --stat
export PATH="$SR/bin:$PATH"
cmake -S "$WORK/fcitx5-src" -B "$WORK/fcitx5-build" \
  -DCMAKE_PREFIX_PATH="$SR" -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DENABLE_SERVER=Off -DENABLE_X11=Off -DENABLE_WAYLAND=Off \
  -DENABLE_DBUS=Off -DENABLE_KEYBOARD=Off -DENABLE_TEST=Off \
  -DENABLE_TESTING_ADDONS=Off -DENABLE_ENCHANT=Off -DENABLE_EMOJI=Off \
  -DBUILD_SPELL_DICT=Off -DENABLE_XDGAUTOSTART=Off \
  -DENABLE_LIBUUID=Off -DEVENT_LOOP_BACKEND=none > "$WORK/fcitx5-configure.log" 2>&1 \
  || { tail -20 "$WORK/fcitx5-configure.log"; note_fail "fcitx5 configure"; }
cmake --build "$WORK/fcitx5-build" -j2 --target Fcitx5Utils > "$WORK/fcitx5-build.log" 2>&1 \
  || { tail -20 "$WORK/fcitx5-build.log"; note_fail "fcitx5 build"; }
cmake -DCMAKE_INSTALL_PREFIX="$PREFIX" -P "$WORK/fcitx5-build/src/lib/fcitx-utils/cmake_install.cmake" \
  > "$WORK/fcitx5-install.log" 2>&1 || note_fail "fcitx5 install"
test -f "$PREFIX/lib/libFcitx5Utils.a" && echo "libFcitx5Utils.a installed" || note_fail "libFcitx5Utils.a missing"

echo "--- step 3.5: desktop instantiation of the FIX6 preload ---"
# Static Fcitx5Utils' Targets file references LibIntl::LibIntl /
# Pthread::Pthread / DL::DL in its INTERFACE_LINK_LIBRARIES; libime's
# bare find_package(Fcitx5Utils) then fails at generate time unless the
# three imported targets already exist. The iOS build solves this with
# the CMAKE_PROJECT_INCLUDE preload shipped in this package as
# generated/libime-preload.cmake.tmpl. The desktop instantiation below
# is identical except that LibIntl resolves to the system libc instead
# of the iOS stub (no cache-variable seeding).
cat > "$WORK/preload-desktop.cmake" <<EOF
# desktop instantiation of generated/libime-preload.cmake.tmpl (FIX6)
if(NOT DEFINED RUKIK_LIBIME_PRELOAD_DONE)
  set(RUKIK_LIBIME_PRELOAD_DONE TRUE)
  list(APPEND CMAKE_MODULE_PATH "$WORK/fcitx5-src/cmake")
  find_package(LibIntl REQUIRED)
  find_package(Pthread REQUIRED)
  find_package(DL REQUIRED)
endif()
EOF
echo "preload written: $WORK/preload-desktop.cmake"

echo "--- step 4: probe — static libime configure WITHOUT the core patch (expect export-set failure) ---"
PKG_CONFIG_PATH="$LIBDIR/pkgconfig" PKG_CONFIG_SYSROOT_DIR="$DRIVERS/vendor/sysroot" \
cmake -S "$WORK/libime-src" -B "$WORK/probe-build" \
  -DCMAKE_PREFIX_PATH="$PREFIX;$SR" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PROJECT_INCLUDE="$WORK/preload-desktop.cmake" \
  -DBUILD_SHARED_LIBS=OFF -DENABLE_TEST=Off -DENABLE_DOC=Off \
  -DENABLE_DATA=Off -DENABLE_TOOLS=Off > "$WORK/probe-configure.log" 2>&1
probe_rc=$?
if [ $probe_rc -ne 0 ] && grep -q "not in any export set" "$WORK/probe-configure.log"; then
  echo "PROBE: failed as expected — kenlm export-set error present:"
  grep -m2 -A1 "not in any export set" "$WORK/probe-configure.log" | head -4
else
  echo "PROBE: unexpected result (rc=$probe_rc); see probe-configure.log"
  note_fail "probe did not reproduce the export-set failure"
fi
rm -rf "$WORK/probe-build"

echo "--- step 5: apply libime+kenlm patches and the demo modification ---"
git -C "$WORK/libime-src" apply "$PKG/patches/libime/0001-core-cmakelists-kenlm-export-set.patch" || note_fail "apply libime patch"
git -C "$WORK/libime-src" apply "$PKG/patches/kenlm/0001-usage-libproc-has-include-guard.patch" || note_fail "apply kenlm patch"
git -C "$WORK/libime-src" apply "$PKG/relink/demo-modification.patch" || note_fail "apply demo modification"
git -C "$WORK/libime-src" diff --stat

echo "--- step 6: build libime (static) and install ---"
PKG_CONFIG_PATH="$LIBDIR/pkgconfig" PKG_CONFIG_SYSROOT_DIR="$DRIVERS/vendor/sysroot" \
cmake -S "$WORK/libime-src" -B "$WORK/libime-build" \
  -DCMAKE_PREFIX_PATH="$PREFIX;$SR" -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DCMAKE_PROJECT_INCLUDE="$WORK/preload-desktop.cmake" \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DENABLE_TEST=Off -DENABLE_DOC=Off -DENABLE_DATA=Off -DENABLE_TOOLS=Off \
  > "$WORK/libime-configure.log" 2>&1 || { tail -20 "$WORK/libime-configure.log"; note_fail "libime configure"; }
cmake --build "$WORK/libime-build" -j2 > "$WORK/libime-build.log" 2>&1 \
  || { tail -20 "$WORK/libime-build.log"; note_fail "libime build"; }
cmake --install "$WORK/libime-build" > "$WORK/libime-install.log" 2>&1 || note_fail "libime install"
ls -la "$PREFIX/lib/" | grep -E "IMECore|IMEPinyin|IMETable" || note_fail "libime libs missing"

echo "--- step 7: compile RUKIK-side object and relink ---"
g++ -std=c++20 -O2 -c "$PKG/rukik-objects/LibimeBridge.cpp" -o "$WORK/LibimeBridge.o" \
  -I"$PKG/rukik-objects" -I"$PREFIX/include/LibIME" -I"$PREFIX/include/Fcitx5/Utils" -I"$SR/include" \
  || note_fail "bridge compile"
EXTRA_LIBS=""
if [ -f "$PREFIX/lib/libIMETable.a" ]; then EXTRA_LIBS="-lIMETable"; fi
KENLM_OBJS=""
if ! nm "$PREFIX/lib/libIMECore.a" 2>/dev/null | grep -q "ProbingModel"; then
  KENLM_OBJS="$(find "$WORK/libime-build" -path "*kenlm.dir*" -name "*.o" | tr '\n' ' ')"
  echo "kenlm objects not inside libIMECore.a; linking them explicitly: $(echo $KENLM_OBJS | wc -w) objects"
fi
g++ -std=c++20 -O2 -o "$WORK/relink-smoke" "$SMOKE_SRC" "$WORK/LibimeBridge.o" $KENLM_OBJS \
  -I"$PKG/rukik-objects" \
  -L"$PREFIX/lib" -Wl,--start-group -lIMEPinyin -lIMECore $EXTRA_LIBS -lFcitx5Utils -Wl,--end-group \
  "$LIBDIR/libboost_iostreams.a" "$LIBDIR/libzstd.a" -lz -lpthread -ldl \
  || note_fail "relink"

echo "--- step 8: marker verification ---"
strings "$PREFIX/lib/libIMECore.a" | grep -F "$MARKER" && echo "marker present in rebuilt libIMECore.a" || note_fail "marker missing in lib"
strings "$WORK/relink-smoke" | grep -F "$MARKER" && echo "marker present in relinked binary" || note_fail "marker missing in binary"
nm "$WORK/relink-smoke" | grep rukik_relink_demo_marker || note_fail "marker symbol missing in binary"

echo "--- step 9: relinked smoke run ---"
"$WORK/relink-smoke" "$P0/sc.lm" "$P0/sc.dict" > "$WORK/relink-smoke.out" 2>&1
cat "$WORK/relink-smoke.out"
grep -q "SMOKE_DONE failures=0" "$WORK/relink-smoke.out" && echo "RELINK: 14/14 PASS" || note_fail "relink smoke"

echo "=== SUMMARY ==="
if [ $FAIL -eq 0 ]; then echo "RELINK DEMO RESULT: PASS (baseline 14/14, probe reproduced, modified libime relinked, smoke 14/14)"; else echo "RELINK DEMO RESULT: FAIL — see steps marked above"; fi
exit $FAIL
