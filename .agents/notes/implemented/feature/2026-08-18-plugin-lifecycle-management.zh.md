# Agent Note：Profile 插件生命周期管理

状态：已实现

[English](2026-08-18-plugin-lifecycle-management.md) | 中文

## 问题

Profile 插件命令原本可以通过 pnpm 安装和更新包，也可以检查包，但没有原生方式显示包来源，或在不手动编辑 `package.json` 的情况下切换 Cordis 组合包。

## 决策

`deepseek plugin --profile <name>` 继续让 pnpm 负责依赖解析，并增加无需启动 profile 的 `source`、`enable` 和 `disable` 操作。`install` 是 pnpm `add` 的明确别名。启用状态只修改 `dsh.profile.bundles`，不改依赖文件，也不接触用户真实工作区。来源输出会显示解析后的包目录，以及包 manifest 声明的 `repository` 或 `homepage`。

## Alternatives considered

**每次切换都直接编辑 `package.json`。** 否决：包依赖与 profile 激活是两个独立关注点，激活不应改写用户的依赖清单。

**让 `install` 自动激活包。** 否决：解析包与决定其 Cordis 组合包是否生效是两个独立选择，分开处理才能让已安装但停用的包可逆。

## 后果

插件安装、来源、验证和激活现在是相互独立的操作。停用的包仍保留在已安装依赖中，方便重新启用；下次 profile 组合时不会加载它的 patch 层。变更在重启 profile 后生效。

## 验证

`pnpm exec vitest run apps/cli/tests/plugin-inspection.spec.ts packages/ui/tui/tests/plugins-command.spec.ts`、`pnpm exec tsc -p apps/cli/tsconfig.json --noEmit` 和双语文档配对门禁均已通过。
