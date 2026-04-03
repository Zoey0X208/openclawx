/**
 * Bash Hook 池：通过 onBashExec() 注册处理函数，命令执行前串行执行所有已注册的 handler。
 * handler 可修改 ctx.command（最终命令直接执行）。
 */

/** Bash Hook 收到的 payload */
export interface BashHookContext {
    sessionId: string;
    agentId: string;
    command: string;   // handler 可直接修改
    cwd: string;
    timestamp: number;
}

/** Bash Hook 处理函数（同步，以兼容 SDK 的 spawnHook） */
export type BashHookHandler = (ctx: BashHookContext) => void;

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

/** 串行触发所有 handler，失败仅打日志 */
export function emitBashHooks(ctx: BashHookContext): void {
    const original = ctx.command;
    console.log(`[bash-hook] emit: handlers=${_handlers.length}, original="${original}"`);
    for (const handler of _handlers) {
        try {
            handler(ctx);
        } catch (err: any) {
            console.warn("[bash-hook] handler error:", err?.message ?? err);
        }
    }
    if (ctx.command !== original) {
        console.log(`[bash-hook] command rewritten: "${ctx.command}"`);
    }
}

/** 当前已注册的 handler 数量（用于调试） */
export function getHandlerCount(): number {
    return _handlers.length;
}
