# Agent Note：Doctor 运行时与终端诊断

状态：已实现

[English](2026-08-18-cli-doctor-runtime-assets.md) | 中文

## 问题

`deepseek doctor` 之前只检查基础目录和 API 凭据。因此发布可执行文件即使缺少 profile overlay 也可能显示健康，启动时才失败；终端能力问题也被合并在一个普通状态行中。

## 决策

无启动的 doctor 会验证所有随附 profile overlay、预置目录和可选 Web 前端资产。overlay 与前端查找会从 CLI 包 manifest 锚点解析公开包 exports，因此源码安装、hoist 后的部署闭包与 pkg snapshot 使用和 profile 启动相同的位置。它还会单独报告安装渠道、主机沙箱执行器、真彩色、交互式鼠标输入和剪贴板命令。Windows 系统命令通过 `where.exe` 定位，因为 `icacls` 与 `clip` 没有版本 flag。资产和 Node 失败仍是阻断项；主机能力探测是警告，除非启动器明确报告沙箱已启用。

## Alternatives considered

**只依赖发布冒烟测试。** 否决：用户需要一个无需进入 profile 启动即可检查已安装目录的本地诊断，发布检查也无法描述当前主机的终端能力。

**把所有主机能力探测都视为硬失败。** 否决：Terminal.app 和精简 CI 镜像可能缺少可选的鼠标、剪贴板或真彩色支持，但 TUI 与 headless profile 仍然可以使用。

**在 CLI 包目录下拼接依赖路径。** 否决：生产依赖可能被 hoist 到该目录之外，而且 pkg 不保留包管理器的符号链接拓扑。包 exports 才是 profile 启动使用的同一权威来源。

**对每个主机命令运行 `--version`。** 否决：即使 Windows 系统命令 `icacls` 与 `clip` 可用，也会拒绝该 flag。

## 后果

发布冒烟和用户可以在 profile 启动前发现缺失的 `cordis.patch.yml`，不会再因 hoist 或嵌入式安装产生误报。doctor 不会把执行器探测冒充为每次调用都已隔离；只有运行中的 profile 才能给出该证据。

## 验证

聚焦测试覆盖 hoist 后的包资产、缺失 overlay 与 Windows 命令发现。构建后的 Windows 可执行程序会返回成功的 JSON 报告，其中嵌入的 overlay、预置与 Web 资产均存在。
