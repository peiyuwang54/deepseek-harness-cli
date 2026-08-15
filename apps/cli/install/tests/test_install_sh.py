#!/usr/bin/env python3
"""Keyless tests for apps/cli/install/install.sh.

Serves a fake GitHub Releases tree over localhost (tar.gz + .sha256) and runs
the real installer as a subprocess. Platform coverage fakes `uname` through a
PATH shim so all four targets can be exercised from any host; `shasum`/
`sha256sum` are faked through the same shim so the Linux hash path works even
on macOS, and the host path is exercised with the real tools.

Run directly:  python3 apps/cli/install/tests/test_install_sh.py
or via pytest:  pnpm exec pytest apps/cli/install/tests
"""

from __future__ import annotations

import hashlib
import io
import os
import platform
import shutil
import subprocess
import tarfile
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
INSTALL_SH = REPO_ROOT / "apps" / "cli" / "install" / "install.sh"
VERSION = "0.1.0-rc.5"

# Real host target, used by the host-install test.
_HOST_OS = "macos" if platform.system() == "Darwin" else "linux"
_HOST_ARCH = {
    "arm64": "arm64",
    "aarch64": "arm64",
    "x86_64": "x64",
    "AMD64": "x64",
}[platform.machine()]

# Fake tools injected ahead of the real PATH so cross-platform tests work from
# any host: uname answers from env; shasum/sha256sum delegate to python hashlib
# (the real `shasum` may be absent on Linux and `sha256sum` on macOS).
FAKE_UNAME = """#!/bin/sh
case "$1" in
  -s) printf '%s\\n' "${DSH_FAKE_OS:-Darwin}" ;;
  -m) printf '%s\\n' "${DSH_FAKE_ARCH:-arm64}" ;;
  *)  printf '%s\\n' "${DSH_FAKE_UNAME_DEFAULT:-Darwin}" ;;
esac
"""

FAKE_HASH = """#!/bin/sh
# Stand-in for `shasum -a 256` / `sha256sum` using python3 hashlib.
case "$1" in
  -a) shift ;;
esac
case "$1" in
  256) shift ;;
esac
python3 -c '
import hashlib, sys
for path in sys.argv[1:]:
    with open(path, "rb") as f:
        print(hashlib.sha256(f.read()).hexdigest(), " ", path)
' "$@"
"""


class MockReleaseServer:
    """Serves a fake deepseek-harness-cli-v<version> release directory over HTTP."""

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        self.requests: list[str] = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802 (http.server API)
                self.server.requests.append(self.path)  # type: ignore[attr-defined]
                data = self.server.files.get(self.path)  # type: ignore[attr-defined]
                if data is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args: object) -> None:
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.files = self.files  # type: ignore[attr-defined]
        self.httpd.requests = self.requests  # type: ignore[attr-defined]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def register(self, version: str, os_name: str, arch: str, tarball: bytes, digest: str) -> None:
        stem = f"/deepseek-harness-cli-v{version}/deepseek-harness-cli-{arch}-{os_name}"
        self.files[f"{stem}.tar.gz"] = tarball
        self.files[f"{stem}.sha256"] = f"{digest}  deepseek-harness-cli-{arch}-{os_name}.tar.gz\n".encode()

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


class InstallerTestCase(unittest.TestCase):
    """Base: temp HOME, a fake-bin PATH shim, and a release server."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="dsh-install-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        (self.tmp / "home").mkdir(exist_ok=True)

        self.fake_bin = self.tmp / "fake-bin"
        self.fake_bin.mkdir()
        self._write_exec(self.fake_bin / "uname", FAKE_UNAME)
        for tool in ("shasum", "sha256sum"):
            self._write_exec(self.fake_bin / tool, FAKE_HASH)

        self.server = MockReleaseServer()
        self.server.start()
        self.addCleanup(self.server.stop)

        self.tarballs: dict[tuple[str, str], bytes] = {}

    def _write_exec(self, path: Path, content: str) -> None:
        path.write_text(content)
        path.chmod(0o755)

    def make_tarball(self, os_name: str, version: str = VERSION) -> bytes:
        """Real tar.gz with bin/deepseek-harness-cli (+ bin/deepseek-harness-cli-spawn-helper on macOS)."""
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            dsh = f"#!/bin/sh\necho fake-dsh {version}\n"
            self._add_to_tar(tar, "bin/deepseek-harness-cli", dsh)
            if os_name == "macos":
                self._add_to_tar(tar, "bin/deepseek-harness-cli-spawn-helper", "#!/bin/sh\necho helper\n")
        return buf.getvalue()

    @staticmethod
    def _add_to_tar(tar: tarfile.TarFile, name: str, content: str) -> None:
        info = tarfile.TarInfo(name)
        info.size = len(content)
        info.mode = 0o755
        info.mtime = 0
        tar.addfile(info, fileobj=io.BytesIO(content.encode()))

    def register_platform(self, os_name: str, arch: str, version: str = VERSION) -> None:
        tarball = self.make_tarball(os_name, version)
        digest = hashlib.sha256(tarball).hexdigest()
        self.tarballs[(os_name, arch)] = tarball
        self.server.register(version, os_name, arch, tarball, digest)

    def run_installer(self, *, os_name: str, arch: str, args: tuple[str, ...] = (),
                      extra_env: dict[str, str] | None = None,
                      use_fake_uname: bool = True, register: bool = True) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["DEEPSEEK_HARNESS_CLI_BASE_URL"] = self.server.base_url
        env["DEEPSEEK_HARNESS_CLI_VERSION"] = VERSION
        env["HOME"] = str(self.tmp / "home")
        env["DEEPSEEK_HARNESS_CLI_INSTALL_DIR"] = str(self.tmp / "install")
        env["SHELL"] = "/bin/zsh"
        if use_fake_uname:
            env["PATH"] = str(self.fake_bin) + os.pathsep + env["PATH"]
            env["DSH_FAKE_OS"] = {"macos": "Darwin", "linux": "Linux"}[os_name]
            env["DSH_FAKE_ARCH"] = {"arm64": "arm64", "x64": "x86_64"}[arch]
        if extra_env:
            env.update(extra_env)
        if register:
            self.register_platform(os_name, arch)
        return subprocess.run(
            ["sh", str(INSTALL_SH), *args],
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )

    # --- shared assertions --------------------------------------------------
    def assert_installed(self, os_name: str, install_dir: Path) -> None:
        binary = install_dir / "bin" / "deepseek-harness-cli"
        branded_binary = install_dir / "bin" / "deepseek"
        short_binary = install_dir / "bin" / "dsh"
        self.assertTrue(binary.exists(), f"{binary} not installed")
        self.assertTrue(os.access(binary, os.X_OK), f"{binary} not executable")
        self.assertTrue(branded_binary.exists(), f"{branded_binary} not installed")
        self.assertTrue(os.access(branded_binary, os.X_OK), f"{branded_binary} not executable")
        self.assertTrue(short_binary.exists(), f"{short_binary} not installed")
        self.assertTrue(os.access(short_binary, os.X_OK), f"{short_binary} not executable")
        self.assertEqual(
            subprocess.run([str(branded_binary), "--version"], capture_output=True, text=True).stdout.strip(),
            f"fake-dsh {VERSION}",
        )
        self.assertEqual(
            subprocess.run([str(short_binary), "--version"], capture_output=True, text=True).stdout.strip(),
            f"fake-dsh {VERSION}",
        )
        if os_name == "macos":
            helper = install_dir / "bin" / "deepseek-harness-cli-spawn-helper"
            self.assertTrue(helper.exists(), "macOS spawn-helper not installed")
        else:
            self.assertFalse((install_dir / "bin" / "deepseek-harness-cli-spawn-helper").exists())

    # --- target detection ---------------------------------------------------
    def test_host_target(self) -> None:
        """Real uname resolves to the host target and installs."""
        result = self.run_installer(os_name=_HOST_OS, arch=_HOST_ARCH, use_fake_uname=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_installed(_HOST_OS, self.tmp / "install")
        requested = self.server.requests[0]
        self.assertIn(f"/deepseek-harness-cli-v{VERSION}/deepseek-harness-cli-{_HOST_ARCH}-{_HOST_OS}.tar.gz", requested)

    def test_target_macos_arm64(self) -> None:
        result = self.run_installer(os_name="macos", arch="arm64")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_installed("macos", self.tmp / "install")

    def test_target_macos_x64(self) -> None:
        result = self.run_installer(os_name="macos", arch="x64")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_installed("macos", self.tmp / "install")

    def test_target_linux_x64(self) -> None:
        result = self.run_installer(os_name="linux", arch="x64")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_installed("linux", self.tmp / "install")

    def test_target_linux_arm64(self) -> None:
        result = self.run_installer(os_name="linux", arch="arm64")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_installed("linux", self.tmp / "install")

    def test_unsupported_os(self) -> None:
        env = self._env_with(os_name="macos", arch="arm64")
        env["DSH_FAKE_OS"] = "Windows"
        result = subprocess.run(
            ["sh", str(INSTALL_SH)], env=env, capture_output=True, text=True, timeout=60
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsupported operating system", result.stderr)

    def test_unsupported_arch(self) -> None:
        env = self._env_with(os_name="linux", arch="arm64")
        env["DSH_FAKE_ARCH"] = "ppc64le"
        result = subprocess.run(
            ["sh", str(INSTALL_SH)], env=env, capture_output=True, text=True, timeout=60
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsupported architecture", result.stderr)

    def _env_with(self, os_name: str, arch: str) -> dict[str, str]:
        env = os.environ.copy()
        env["DEEPSEEK_HARNESS_CLI_BASE_URL"] = self.server.base_url
        env["DEEPSEEK_HARNESS_CLI_VERSION"] = VERSION
        env["HOME"] = str(self.tmp / "home")
        env["DEEPSEEK_HARNESS_CLI_INSTALL_DIR"] = str(self.tmp / "install")
        env["SHELL"] = "/bin/zsh"
        env["PATH"] = str(self.fake_bin) + os.pathsep + env["PATH"]
        env["DSH_FAKE_OS"] = {"macos": "Darwin", "linux": "Linux"}[os_name]
        env["DSH_FAKE_ARCH"] = {"arm64": "arm64", "x64": "x86_64"}[arch]
        return env

    # --- integrity and failure handling ------------------------------------
    def test_checksum_mismatch_aborts(self) -> None:
        tarball = self.make_tarball("macos", VERSION)
        stem = f"/deepseek-harness-cli-v{VERSION}/deepseek-harness-cli-arm64-macos"
        self.server.files[f"{stem}.tar.gz"] = tarball
        self.server.files[f"{stem}.sha256"] = f"{'0' * 64}  deepseek-harness-cli-arm64-macos.tar.gz\n".encode()
        result = self.run_installer(os_name="macos", arch="arm64", register=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksum mismatch", result.stderr)
        self.assertFalse((self.tmp / "install" / "bin" / "deepseek-harness-cli").exists())

    def test_missing_release_404(self) -> None:
        result = self.run_installer(os_name="macos", arch="arm64", register=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.tmp / "install" / "bin" / "deepseek-harness-cli").exists())

    def test_failure_preserves_existing_binary(self) -> None:
        install_dir = self.tmp / "install"
        (install_dir / "bin").mkdir(parents=True)
        old = install_dir / "bin" / "deepseek-harness-cli"
        old.write_text("#!/bin/sh\necho old-binary\n")
        old.chmod(0o755)
        env = self._env_with(os_name="macos", arch="arm64")
        result = subprocess.run(
            ["sh", str(INSTALL_SH)], env=env, capture_output=True, text=True, timeout=60
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(old.read_text(), "#!/bin/sh\necho old-binary\n", "failed install overwrote existing binary")

    # --- version and argument handling --------------------------------------
    def test_version_flag_with_v_prefix(self) -> None:
        result = self.run_installer(os_name="macos", arch="arm64", args=("--version", f"v{VERSION}"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(
            any(f"/deepseek-harness-cli-v{VERSION}/" in req for req in self.server.requests),
            "installer requested the wrong version tag",
        )

    def test_to_flag_overrides_dir(self) -> None:
        custom = self.tmp / "custom"
        result = self.run_installer(os_name="linux", arch="x64", args=("--to", str(custom)))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_installed("linux", custom)

    def test_help(self) -> None:
        result = self.run_installer(os_name="macos", arch="arm64", args=("--help",), register=False)
        self.assertEqual(result.returncode, 0)
        self.assertIn("deepseek-harness-cli installer", result.stdout)
        self.assertIn("--to <dir>", result.stdout)

    def test_unknown_argument(self) -> None:
        result = self.run_installer(os_name="macos", arch="arm64", args=("--bogus",), register=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unknown argument", result.stderr)

    # --- PATH insertion -----------------------------------------------------
    def test_path_insertion_idempotent(self) -> None:
        home = self.tmp / "home"
        zshrc = home / ".zshrc"
        result = self.run_installer(os_name="macos", arch="arm64")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(zshrc.exists())
        text = zshrc.read_text()
        self.assertIn("export PATH=", text)
        self.assertIn("install/bin:$PATH", text)
        # Second run must not append a duplicate line.
        result2 = self.run_installer(os_name="macos", arch="arm64")
        self.assertEqual(result2.returncode, 0, result2.stderr)
        self.assertEqual(zshrc.read_text().count("install/bin:$PATH"), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
