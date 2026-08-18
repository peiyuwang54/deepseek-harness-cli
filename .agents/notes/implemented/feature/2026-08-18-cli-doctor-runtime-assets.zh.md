# Agent Note：Doctor 运行时与终端诊断

状态：已实现

[English](2026-08-18-cli-doctor-runtime-assets.md) | 中文

## 问题

`deepseek doctor` 之前只检查基础目录和 API 凭据。因此发布可执行文件即使缺少 profile overlay 也可能显示健康，启动时才失败；终端能力问题也被合并在一个普通状态行中。

## 决策

无启动的 doctor 现在会验证所有随附 profile overlay、预置目录和可选 Web 前端资产，并单独报告安装渠道、主机沙箱执行器、真彩色、交互式鼠标输入和剪贴板命令。资产和 Node 失败仍是阻断项；主机能力探测是警告，除非启动器明确报告沙箱已启用。

## Alternatives considered

**只依赖发布冒烟测试。** 否决：用户需要一个无需进入 profile 启动即可检查已安装目录的本地诊断，发布检查也无法描述当前主机的终端能力。

**把所有主机能力探测都视为硬失败。** 否决：Terminal.app 和精简 CI 镜像可能缺少可选的鼠标、剪贴板或真彩色支持，但 TUI 与 headless profile 仍然可以使用。

## 后果

发布冒烟和用户可以在 profile 启动前发现缺失的 `cordis.patch.yml`。doctor 不会把执行器探测冒充为每次调用都已隔离；只有运行中的 profile 才能给出该证据。

## 验证

`pnpm exec vitest run apps/cli/tests/doctor-completion.spec.ts` 与 `pnpm exec tsc -p apps/cli/tsconfig.json --noEmit` 已通过。
