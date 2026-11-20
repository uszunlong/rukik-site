#!/usr/bin/env bash
# fetch-sources.sh — RUKIK libime LGPL 材料包：对应源码获取＋哈希校验＋补丁应用。
#
# 与产品构建脚本（tree-libime tools/build-libime-ios.sh，提交 0ab718d）
# 的拉源逻辑同口径（clone_at / clone_tag 逐字沿用），并在拉取后以
# rev-parse 断言每个 git 源码的 HEAD 与锁定值逐字一致，再应用
# patches/ 下的全部 RUKIK 修改补丁（以 rukik-ios-compat 标记判重、
# 幂等）。本脚本只负责「源码＋补丁」层；完整 iOS 构建仍由产品仓库的
# tools/build-libime-ios.sh 执行，桌面重链接演示见 relink/relink-demo.sh。
#
# 用法：bash fetch-sources.sh [目标目录]   （默认 ./src）
set -euo pipefail

PKG="$(cd "$(dirname "$0")" && pwd)"
SRC="${1:-$PKG/src}"
mkdir -p "$SRC"

LIBIME_SHA="53df6a248793f9a00c1769e658630de313f3e419"
KENLM_SHA="4cb443e60b7bf2c0ddf3c745378f76cb59e254e5"
FCITX5_SHA="98830ef7910eb0fe6bfda47466a17e273182486e"
ECM_TAG="v5.115.0"
BOOST_VER="1.85.0"
ZSTD_TAG="v1.5.6"
IOS_CMAKE_VER="4.5.0"

clone_at() { # name url ref(sha-or-tag) —— 沿用产品构建脚本
  local name="$1" url="$2" ref="$3"
  if [ ! -d "$SRC/$name" ]; then
    git clone --depth 1 "$url" "$SRC/$name" 2>/dev/null || git clone "$url" "$SRC/$name"
  fi
  if ! git -C "$SRC/$name" checkout -q "$ref" 2>/dev/null; then
    git -C "$SRC/$name" fetch -q --depth 1 origin "$ref" || git -C "$SRC/$name" fetch -q origin
    git -C "$SRC/$name" checkout -q "$ref"
  fi
}

clone_tag() { # name url tag —— 按 tag 克隆（浅克隆不带 tag，须 --branch 解析）
  local name="$1" url="$2" tag="$3"
  if [ ! -d "$SRC/$name" ]; then
    git clone --depth 1 --branch "$tag" "$url" "$SRC/$name"
  fi
  git -C "$SRC/$name" checkout -q "$tag"
}

assert_head() { # dir expected
  local got
  got="$(git -C "$1" rev-parse HEAD)"
  if [ "$got" != "$2" ]; then
    echo "ERROR: $1 HEAD=$got, expected $2" >&2
    exit 1
  fi
  echo "verified: $1 @ $got"
}

echo "== fetch LGPL components =="
clone_at libime https://github.com/fcitx/libime "$LIBIME_SHA"
git -C "$SRC/libime" submodule update --init --depth 1
clone_at fcitx5 https://github.com/fcitx/fcitx5 "$FCITX5_SHA"

echo "== fetch permissive build/runtime deps =="
clone_tag ecm https://github.com/KDE/extra-cmake-modules "$ECM_TAG"
clone_tag zstd https://github.com/facebook/zstd "$ZSTD_TAG"
if [ ! -d "$SRC/boost" ]; then
  curl -sL "https://archives.boost.io/release/${BOOST_VER}/source/boost_${BOOST_VER//./_}.tar.gz" \
    | tar -xz -C "$SRC"
  mv "$SRC/boost_${BOOST_VER//./_}" "$SRC/boost"
fi
if [ ! -f "$SRC/ios.toolchain.cmake" ]; then
  curl -sL -o "$SRC/ios.toolchain.cmake" \
    "https://raw.githubusercontent.com/leetal/ios-cmake/${IOS_CMAKE_VER}/ios.toolchain.cmake"
fi

echo "== verify locked revisions =="
assert_head "$SRC/libime" "$LIBIME_SHA"
assert_head "$SRC/libime/src/libime/core/kenlm" "$KENLM_SHA"
assert_head "$SRC/fcitx5" "$FCITX5_SHA"
echo "ecm: $(git -C "$SRC/ecm" describe --tags 2>/dev/null || echo "$ECM_TAG (tag checkout)")"
echo "zstd: $(git -C "$SRC/zstd" describe --tags 2>/dev/null || echo "$ZSTD_TAG (tag checkout)")"
test -f "$SRC/boost/boost/version.hpp" && echo "boost: ${BOOST_VER} tarball present"

echo "== apply RUKIK patches (idempotent, rukik-ios-compat marker) =="
if grep -q 'rukik-ios-compat' "$SRC/libime/src/libime/core/CMakeLists.txt"; then
  echo "libime patches already applied, skipping"
else
  git -C "$SRC/libime" apply "$PKG/patches/libime/0001-core-cmakelists-kenlm-export-set.patch"
  git -C "$SRC/libime" apply "$PKG/patches/kenlm/0001-usage-libproc-has-include-guard.patch"
  echo "libime+kenlm patches applied"
fi
if grep -q 'rukik-ios-compat' "$SRC/fcitx5/src/lib/fcitx-utils/semver.cpp"; then
  echo "fcitx5 patches already applied, skipping"
else
  for p in "$PKG"/patches/fcitx5/*.patch; do git -C "$SRC/fcitx5" apply "$p"; done
  echo "fcitx5 patches applied"
fi

echo "DONE: sources + patches ready under $SRC"
