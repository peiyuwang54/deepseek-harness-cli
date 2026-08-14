# deepseek-harness-cli — curl 安装器

[English](README.md) | 中文

`install.sh` 脚本从本 fork 的 `deepseek-harness-cli-v*` GitHub Releases 下载单文件 `deepseek-harness-cli` 可执行程序，安装到 `$HOME/.deepseek-harness-cli/bin`，并把该目录追加进 shell 的 `PATH`。

支持目标：macOS（`arm64`、`x64`）与 Linux（`arm64`、`x64`）。脚本运行在普通 POSIX `sh` 上；只需要 `curl`、`tar` 与一个 sha256 工具（macOS 用 `shasum`，Linux 用 `sha256sum`）。

## 安装

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-web-to-cli/master/apps/cli/install/install.sh | sh
```

完成后请重启 shell（或运行它打印的 `export PATH=…` 那一行），让 `deepseek-harness-cli` 二进制进入 `PATH`。

### 选项

flag 通过 `--` 传入：

```sh
# Install to a custom directory instead of $HOME/.deepseek-harness-cli
curl -fsSL <install-url> | sh -s -- --to /usr/local

# Pin a specific release (default: newest deepseek-harness-cli-v* release)
curl -fsSL <install-url> | sh -s -- --version 0.1.0-rc.5
```

相同的值也可通过环境变量用于脚本化：`DEEPSEEK_HARNESS_CLI_VERSION`、`DEEPSEEK_HARNESS_CLI_INSTALL_DIR` 与 `DEEPSEEK_HARNESS_CLI_BASE_URL`（后者可让镜像或测试把安装器指向不同的下载基地址）。

## 完整性

安装器用同一发布提供的 `deepseek-harness-cli-<arch>-<os>.sha256` 伴随文件校验 tarball，不匹配即中止，且不触碰已安装的二进制。基于 minisign 的签名校验是计划中的升级路径：一旦公开密钥发布，下载步骤会在安装前额外校验 `deepseek-harness-cli-<arch>-<os>.tar.gz.minisig`。

## 开发

测试无 key，通过 localhost 上的 mock 发布服务器运行：

```sh
python3 apps/cli/install/tests/test_install_sh.py
```
