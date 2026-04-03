/**
 * Bash Hook 池：通过 onBashExec() 注册处理函数，命令执行前串行执行所有已注册的 handler。
 * handler 可修改 ctx.command（最终命令直接执行）。
 */

/** Bash Hook 收到的 payload */
export interface BashHookContext {
    sessionId: string;   // 业务会话 ID（桌面 UUID / 飞书 threadId 等）
    agentId: string;     // 当前智能体 ID
    command: string;     // 原始命令，handler 可修改
    cwd: string;         // 命令执行的工作目录
    env: NodeJS.ProcessEnv; // 环境变量，handler 可修改（如注入/移除变量）
    timestamp: number;   // 触发时间戳（Date.now()），供审计/监控使用
}

/** Bash Hook 处理函数：接收 ctx，返回修改后的 ctx（同步，以兼容 SDK 的 spawnHook） */
export type BashHookHandler = (ctx: BashHookContext) => BashHookContext;

const _handlers: BashHookHandler[] = [];

/** 注册 handler，返回取消注册函数 */
export function onBashExec(input: BashHookHandler | BashHookHandler[]): () => void {
    const list = Array.isArray(input) ? input : [input];
    for (const h of list) {
        if (typeof h === "function" && !_handlers.includes(h)) _handlers.push(h);
    }
    return () => {
        for (const h of list) {
            const idx = _handlers.indexOf(h);
            if (idx !== -1) _handlers.splice(idx, 1);
        }
    };
}

/** 串行触发所有 handler，每个 handler 接收上一个返回的 ctx */
export function emitBashHooks(ctx: BashHookContext): BashHookContext {
    const original = ctx.command;
    console.log(`[bash-hook] emit: handlers=${_handlers.length}, original="${original}"`);
    for (const handler of _handlers) {
        try {
            ctx = handler(ctx);
        } catch (err: any) {
            console.warn("[bash-hook] handler error:", err?.message ?? err);
        }
    }
    if (ctx.command !== original) {
        console.log(`[bash-hook] command rewritten: "${ctx.command}"`);
    }
    return ctx;
}

/** 当前已注册的 handler 数量（用于调试） */
export function getHandlerCount(): number {
    return _handlers.length;
}
