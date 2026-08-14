#!/bin/sh
#
# dsh CLI installer — download and install the single-file dsh executable from
# the dsh-cli-v* GitHub Releases of peiyuwang54/deepseek-harness-web-to-cli.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-web-to-cli/master/apps/cli/install/install.sh | sh
#   # flags are passed after `--`:
#   curl -fsSL <install-url> | sh -s -- --to /usr/local --version 0.1.0-rc.5
#
# Overrides (environment or flag):
#   DSH_VERSION / --version   release version (default: newest dsh-cli-v* release)
#   DSH_INSTALL_DIR / --to    install directory (default: $HOME/.dsh)
#   DSH_BASE_URL              download base for tests or mirrors (default: GitHub)
#
# Integrity is sha256-verified against the sidecar published with the release;
# signature verification (minisign) is the planned upgrade path.
set -eu

REPO="peiyuwang54/deepseek-harness-web-to-cli"
BASE_URL="${DSH_BASE_URL:-https://github.com/${REPO}/releases/download}"

usage() {
  cat <<'EOF'
dsh installer

  --to <dir>       install directory (default: $HOME/.dsh)
  --version <ver>  release version, e.g. 0.1.0-rc.5 (default: newest release)
  -h, --help       print this help
EOF
}

# --- argument parsing -------------------------------------------------------
INSTALL_DIR="${DSH_INSTALL_DIR:-$HOME/.dsh}"
VERSION="${DSH_VERSION:-}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --to)
      [ "$#" -ge 2 ] || { echo "dsh: --to requires a directory" >&2; exit 1; }
      INSTALL_DIR="$2"
      shift 2
      ;;
    --version)
      [ "$#" -ge 2 ] || { echo "dsh: --version requires a version" >&2; exit 1; }
      VERSION="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "dsh: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# --- platform detection ------------------------------------------------------
case "$(uname -s)" in
  Darwin) OS=macos ;;
  Linux) OS=linux ;;
  *)
    echo "dsh: unsupported operating system $(uname -s); supported: macOS, Linux." >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=x64 ;;
  *)
    echo "dsh: unsupported architecture $(uname -m); supported: arm64, x64." >&2
    exit 1
    ;;
esac

# --- version resolution -----------------------------------------------------
# Normalize an optional leading `v` so the release tag is always dsh-cli-v<ver>.
VERSION="${VERSION#v}"

if [ -z "$VERSION" ]; then
  VERSION="$(
    curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=100" \
      | grep '"tag_name": *"dsh-cli-v' \
      | sed -E 's/.*"dsh-cli-v([^"]+)".*/\1/' \
      | head -1
  )" || true
  if [ -z "$VERSION" ]; then
    echo "dsh: could not determine the newest release; set DSH_VERSION or --version." >&2
    exit 1
  fi
fi

echo "dsh: installing dsh ${VERSION} for ${OS}-${ARCH}"
RELEASE_URL="${BASE_URL}/dsh-cli-v${VERSION}"
TARBALL_URL="${RELEASE_URL}/dsh-${ARCH}-${OS}.tar.gz"
SHA_URL="${RELEASE_URL}/dsh-${ARCH}-${OS}.sha256"

# --- download and verify ----------------------------------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

curl -fsSL "$TARBALL_URL" -o "$TMP/dsh.tar.gz"
curl -fsSL "$SHA_URL" -o "$TMP/dsh.tar.gz.sha256"

sha256_of() {
  case "$OS" in
    macos) shasum -a 256 "$1" | awk '{print $1}' ;;
    linux) sha256sum "$1" | awk '{print $1}' ;;
  esac
}

EXPECTED="$(sed 's/[[:space:]].*//' "$TMP/dsh.tar.gz.sha256")"
ACTUAL="$(sha256_of "$TMP/dsh.tar.gz")"
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "dsh: checksum mismatch for ${TARBALL_URL}" >&2
  echo "dsh: expected ${EXPECTED}, got ${ACTUAL}" >&2
  exit 1
fi

# --- install ----------------------------------------------------------------
mkdir -p "$INSTALL_DIR/bin"
tar -xzf "$TMP/dsh.tar.gz" -C "$TMP"
if [ ! -x "$TMP/bin/dsh" ]; then
  echo "dsh: ${TARBALL_URL} did not contain an executable bin/dsh" >&2
  exit 1
fi
install -m 0755 "$TMP/bin/dsh" "$INSTALL_DIR/bin/dsh"
if [ "$OS" = macos ]; then
  [ -f "$TMP/bin/dsh-spawn-helper" ] || { echo "dsh: macOS package is missing bin/dsh-spawn-helper" >&2; exit 1; }
  install -m 0755 "$TMP/bin/dsh-spawn-helper" "$INSTALL_DIR/bin/dsh-spawn-helper"
fi

echo "dsh: installed to $INSTALL_DIR/bin/dsh"

# --- PATH -------------------------------------------------------------------
add_to_rc() {
  rc="$1"
  [ -f "$rc" ] || touch "$rc"
  if ! grep -qF "$INSTALL_DIR/bin" "$rc" 2>/dev/null; then
    printf '\nexport PATH="%s/bin:$PATH"\n' "$INSTALL_DIR" >> "$rc"
    echo "dsh: added $INSTALL_DIR/bin to PATH in $rc"
  fi
}

case "${SHELL:-}" in
  *zsh)
    add_to_rc "$HOME/.zshrc"
    ;;
  *bash)
    add_to_rc "$HOME/.bashrc"
    ;;
  *)
    [ -f "$HOME/.zshrc" ] && add_to_rc "$HOME/.zshrc"
    [ -f "$HOME/.bashrc" ] && add_to_rc "$HOME/.bashrc"
    if [ ! -f "$HOME/.zshrc" ] && [ ! -f "$HOME/.bashrc" ]; then
      add_to_rc "$HOME/.zshrc"
    fi
    ;;
esac

echo "dsh: done. Restart your shell or run: export PATH=\"$INSTALL_DIR/bin:\$PATH\""
