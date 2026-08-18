# Agent Note: Windows HMR 加载锚点保持文件系统路径

Status: implemented

[English](2026-08-18-hmr-windows-loader-anchor.md) | 中文

## 问题

打包后的 Windows 启动可能把 HMR 加载锚点以 `C:\\snapshot\\...` 路径提供，而不是 `file:` URL。传给 `new URL()` 后，`C:` 会被当成 URL 协议，`fileURLToPath()` 随即以 `ERR_INVALID_URL_SCHEME` 终止启动。

## 决策

对原生 POSIX、Windows 驱动器和 UNC 锚点直接使用 path 模块解析；只有 URL 锚点和相对 URL 基准继续使用 URL 解析。

## 曾考虑的替代方案

- 在打包边界统一转成 file URL：不采用，因为嵌入式运行时决定锚点表示，HMR 服务应同时接受两种形式。
- 捕获 `ERR_INVALID_URL_SCHEME` 后重试：不采用，因为路径形式在解析前已知，不应依赖异常控制流。

## 后果

无论加载器提供文件系统路径还是 file URL，HMR 都能在 Windows 打包和源码启动中初始化；URL 行为保持不变。

## 测试

`apps/cli/tests/hmr-windows-path.spec.ts` 覆盖驱动器、UNC、POSIX、file URL 和路径型锚点解析。
