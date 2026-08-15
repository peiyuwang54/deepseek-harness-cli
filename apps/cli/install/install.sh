#!/bin/sh
#
# deepseek-harness-cli installer — download and install the single-file deepseek-harness-cli executable from
# the deepseek-harness-cli-v* GitHub Releases of peiyuwang54/deepseek-harness-cli.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.sh | sh
#   # flags are passed after `--`:
#   curl -fsSL <install-url> | sh -s -- --to /usr/local --version 0.1.0-rc.5
#
# Overrides (environment or flag):
#   DEEPSEEK_HARNESS_CLI_VERSION / --version   release version (default: newest deepseek-harness-cli-v* release)
#   DEEPSEEK_HARNESS_CLI_INSTALL_DIR / --to    install directory (default: $HOME/.deepseek-harness-cli)
#   DEEPSEEK_HARNESS_CLI_BASE_URL              download base for tests or mirrors (default: GitHub)
#
# Integrity is sha256-verified against the sidecar published with the release;
# signature verification (minisign) is the planned upgrade path.
set -eu

REPO="peiyuwang54/deepseek-harness-cli"
BASE_URL="${DEEPSEEK_HARNESS_CLI_BASE_URL:-https://github.com/${REPO}/releases/download}"

usage() {
  cat <<'EOF'
deepseek-harness-cli installer

  --to <dir>       install directory (default: $HOME/.deepseek-harness-cli)
  --version <ver>  release version, e.g. 0.1.0-rc.5 (default: newest release)
  -h, --help       print this help
EOF
}

# --- argument parsing -------------------------------------------------------
INSTALL_DIR="${DEEPSEEK_HARNESS_CLI_INSTALL_DIR:-$HOME/.deepseek-harness-cli}"
VERSION="${DEEPSEEK_HARNESS_CLI_VERSION:-}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --to)
      [ "$#" -ge 2 ] || { echo "deepseek-harness-cli: --to requires a directory" >&2; exit 1; }
      INSTALL_DIR="$2"
      shift 2
      ;;
    --version)
      [ "$#" -ge 2 ] || { echo "deepseek-harness-cli: --version requires a version" >&2; exit 1; }
      VERSION="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "deepseek-harness-cli: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# --- platform detection ------------------------------------------------------
case "$(uname -s)" in
  Darwin) OS=macos ;;
  Linux) OS=linux ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    echo "deepseek-harness-cli: this installer is POSIX sh. On Windows run apps/cli/install/install.ps1." >&2
    exit 1
    ;;
  *)
    echo "deepseek-harness-cli: unsupported operating system $(uname -s); supported: macOS, Linux, Windows (install.ps1)." >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=x64 ;;
  *)
    echo "deepseek-harness-cli: unsupported architecture $(uname -m); supported: arm64, x64." >&2
    exit 1
    ;;
esac

# --- version resolution -----------------------------------------------------
# Normalize an optional leading `v` so the release tag is always deepseek-harness-cli-v<ver>.
VERSION="${VERSION#v}"

if [ -z "$VERSION" ]; then
  VERSION="$(
    curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=100" \
      | grep '"tag_name": *"deepseek-harness-cli-v' \
      | sed -E 's/.*"deepseek-harness-cli-v([^"]+)".*/\1/' \
      | head -1
  )" || true
  if [ -z "$VERSION" ]; then
    echo "deepseek-harness-cli: could not determine the newest release; set DEEPSEEK_HARNESS_CLI_VERSION or --version." >&2
    exit 1
  fi
fi

echo "deepseek-harness-cli: installing deepseek-harness-cli ${VERSION} for ${OS}-${ARCH}"
RELEASE_URL="${BASE_URL}/deepseek-harness-cli-v${VERSION}"
TARBALL_URL="${RELEASE_URL}/deepseek-harness-cli-${ARCH}-${OS}.tar.gz"
SHA_URL="${RELEASE_URL}/deepseek-harness-cli-${ARCH}-${OS}.sha256"

# --- download and verify ----------------------------------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

curl -fsSL "$TARBALL_URL" -o "$TMP/deepseek-harness-cli.tar.gz"
curl -fsSL "$SHA_URL" -o "$TMP/deepseek-harness-cli.tar.gz.sha256"

sha256_of() {
  case "$OS" in
    macos) shasum -a 256 "$1" | awk '{print $1}' ;;
    linux) sha256sum "$1" | awk '{print $1}' ;;
  esac
}

EXPECTED="$(sed 's/[[:space:]].*//' "$TMP/deepseek-harness-cli.tar.gz.sha256")"
ACTUAL="$(sha256_of "$TMP/deepseek-harness-cli.tar.gz")"
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "deepseek-harness-cli: checksum mismatch for ${TARBALL_URL}" >&2
  echo "deepseek-harness-cli: expected ${EXPECTED}, got ${ACTUAL}" >&2
  exit 1
fi

# --- install ----------------------------------------------------------------
mkdir -p "$INSTALL_DIR/bin"
tar -xzf "$TMP/deepseek-harness-cli.tar.gz" -C "$TMP"
if [ ! -x "$TMP/bin/deepseek-harness-cli" ]; then
  echo "deepseek-harness-cli: ${TARBALL_URL} did not contain an executable bin/deepseek-harness-cli" >&2
  exit 1
fi
if [ "$OS" = macos ]; then
  [ -f "$TMP/bin/deepseek-harness-cli-spawn-helper" ] || { echo "deepseek-harness-cli: macOS package is missing bin/deepseek-harness-cli-spawn-helper" >&2; exit 1; }
fi
install -m 0755 "$TMP/bin/deepseek-harness-cli" "$INSTALL_DIR/bin/deepseek-harness-cli"
ln -sf deepseek-harness-cli "$INSTALL_DIR/bin/deepseek"
ln -sf deepseek-harness-cli "$INSTALL_DIR/bin/dsh"
if [ "$OS" = macos ]; then
  install -m 0755 "$TMP/bin/deepseek-harness-cli-spawn-helper" "$INSTALL_DIR/bin/deepseek-harness-cli-spawn-helper"
fi

echo "deepseek-harness-cli: installed $INSTALL_DIR/bin/deepseek and $INSTALL_DIR/bin/dsh"

# --- PATH -------------------------------------------------------------------
add_to_rc() {
  rc="$1"
  [ -f "$rc" ] || touch "$rc"
  if ! grep -qF "$INSTALL_DIR/bin" "$rc" 2>/dev/null; then
    printf '\nexport PATH="%s/bin:$PATH"\n' "$INSTALL_DIR" >> "$rc"
    echo "deepseek-harness-cli: added $INSTALL_DIR/bin to PATH in $rc"
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

echo "deepseek-harness-cli: done. Restart your shell or run: export PATH=\"$INSTALL_DIR/bin:\$PATH\""
