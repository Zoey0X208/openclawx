/**
 * 模拟的安全模块 hook。
 *
 * 基于命令名称做静态规则分类，返回对应的 SELinux type。
 * 安全模块团队交付真实实现后，直接替换此文件中的分类逻辑即可，
 * 或通过 registerBashHook 注册新 hook 覆盖此处返回值。
 *
 * 框架预定义的 SELinux type（来自 fusionclaw.te）：
 *   fusionclaw_agent_main_session_git_write_t  - git commit/push 等写操作
 *   fusionclaw_agent_main_session_git_read_t   - git log/diff 等只读操作
 *   fusionclaw_agent_main_session_pkg_t        - apt/pip/npm install 等包管理
 *   fusionclaw_agent_main_session_build_t      - make/gcc/cargo build 等构建
 *   fusionclaw_agent_main_session_python_t     - python/python3 执行
 *   fusionclaw_agent_main_session_network_t    - curl/wget/ssh 等网络
 *   fusionclaw_agent_main_session_delete_t     - rm/rmdir/unlink
 *   fusionclaw_agent_main_session_write_t      - cp/mv/touch 等写入
 *   fusionclaw_agent_main_session_readonly_t   - cat/ls/grep 等只读
 *   fusionclaw_agent_main_session_main_t       - 其他（默认）
 */
import { onBashExec } from "./bash-hook.js";

const DOMAINS: Record<string, string> = {
    main:      "fusionclaw_agent_main_session_main_t",
    readonly:  "fusionclaw_agent_main_session_readonly_t",
    write:     "fusionclaw_agent_main_session_write_t",
    delete:    "fusionclaw_agent_main_session_delete_t",
    build:     "fusionclaw_agent_main_session_build_t",
    pkg:       "fusionclaw_agent_main_session_pkg_t",
    python:    "fusionclaw_agent_main_session_python_t",
    git_read:  "fusionclaw_agent_main_session_git_read_t",
    git_write: "fusionclaw_agent_main_session_git_write_t",
    network:   "fusionclaw_agent_main_session_network_t",
};

const GIT_WRITE = new Set([
    "commit", "push", "add", "merge", "rebase", "reset", "tag", "stash",
    "checkout", "switch", "restore", "branch", "init", "clone", "pull",
    "am", "apply", "cherry-pick", "revert", "rm", "mv",
]);

const GIT_READ = new Set([
    "log", "diff", "status", "show", "blame", "describe", "ls-files",
    "ls-tree", "fetch", "shortlog", "reflog", "cat-file", "rev-parse",
    "rev-list", "for-each-ref",
]);

function leadingCmd(command: string): [string, string] {
    const tokens = command.trim().split(/\s+/);
    const result: string[] = [];
    for (const tok of tokens) {
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) continue;
        result.push(tok);
    }
    const cmd = result[0] ?? "";
    const base = cmd.slice(cmd.lastIndexOf("/") + 1);
    return [base, result[1] ?? ""];
}

function classifyCommand(command: string): string {
    const [cmd, sub] = leadingCmd(command);

    if (cmd === "git") {
        if (GIT_WRITE.has(sub)) return DOMAINS.git_write;
        if (GIT_READ.has(sub)) return DOMAINS.git_read;
        return DOMAINS.git_write;
    }

    if (["apt", "apt-get", "dpkg", "pip", "pip3"].includes(cmd)) return DOMAINS.pkg;
    if (cmd === "npm" && ["install", "i", "ci", "update", "uninstall"].includes(sub)) return DOMAINS.pkg;
    if (cmd === "yarn" && ["add", "remove", "install", "upgrade"].includes(sub)) return DOMAINS.pkg;
    if (cmd === "pnpm" && ["add", "remove", "install", "update"].includes(sub)) return DOMAINS.pkg;
    if (cmd === "cargo" && ["add", "install", "update"].includes(sub)) return DOMAINS.pkg;
    if (cmd === "go" && sub === "get") return DOMAINS.pkg;
    if (["brew", "snap", "gem", "composer"].includes(cmd)) return DOMAINS.pkg;

    if (["make", "cmake", "ninja", "gcc", "g++", "clang", "clang++"].includes(cmd)) return DOMAINS.build;
    if (cmd === "cargo" && ["build", "test", "run", "check", "bench"].includes(sub)) return DOMAINS.build;
    if (cmd === "go" && ["build", "test", "run", "vet", "generate"].includes(sub)) return DOMAINS.build;
    if (cmd === "npm" && ["run", "test", "build", "start"].includes(sub)) return DOMAINS.build;
    if (cmd === "yarn" && ["run", "test", "build", "start"].includes(sub)) return DOMAINS.build;
    if (["tsc", "webpack", "vite", "rollup", "esbuild", "mvn", "gradle"].includes(cmd)) return DOMAINS.build;

    if (cmd === "python" || cmd === "python3" || /^python3?\.\d+$/.test(cmd)) return DOMAINS.python;
    if (["pytest", "mypy", "pylint", "black", "flake8", "uv", "poetry"].includes(cmd)) return DOMAINS.python;

    if (["curl", "wget", "ssh", "scp", "sftp", "rsync"].includes(cmd)) return DOMAINS.network;
    if (["ping", "traceroute", "nc", "ncat", "telnet", "dig", "nslookup"].includes(cmd)) return DOMAINS.network;
    if (cmd === "gh") return DOMAINS.network;

    if (["rm", "rmdir", "unlink"].includes(cmd)) return DOMAINS.delete;

    if (["cp", "mv", "touch", "tee", "dd", "ln", "install", "truncate"].includes(cmd)) return DOMAINS.write;
    if (cmd === "sed" && ["-i", "--in-place"].some(f => command.includes(f))) return DOMAINS.write;
    if (/(?<![<>])>{1,2}(?!>)/.test(command)) return DOMAINS.write;

    if (["cat", "less", "head", "tail", "bat", "ls", "ll", "la", "find", "locate", "which"].includes(cmd)) return DOMAINS.readonly;
    if (["grep", "rg", "ag", "ack", "wc", "stat", "file", "du", "df", "diff", "sort", "uniq", "awk", "sed", "cut"].includes(cmd)) return DOMAINS.readonly;
    if (["echo", "printf", "date", "pwd", "env", "printenv", "uname", "ps", "id", "whoami", "jq", "yq"].includes(cmd)) return DOMAINS.readonly;

    return DOMAINS.main;
}

// 注册内置安全 hook：将 ctx.command 替换为 runcon 包装后的完整命令
onBashExec((ctx) => {
    const selinuxType = classifyCommand(ctx.command);
    const escaped = ctx.command.replace(/'/g, "'\\''");
    return { ...ctx, command: `runcon -t ${selinuxType} bash -c '${escaped}'` };
});
