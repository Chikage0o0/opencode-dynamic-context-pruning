const activePruningSessions = new Map<string, number>()

export function isPruningGenerationSession(sessionID: string | null | undefined): boolean {
    return typeof sessionID === "string" && (activePruningSessions.get(sessionID) ?? 0) > 0
}

export async function withPruningGenerationSession<T>(
    sessionID: string,
    operation: () => Promise<T>,
): Promise<T> {
    if (typeof sessionID !== "string" || sessionID.trim().length === 0) {
        throw new Error("pruning generation requires a worker session id")
    }

    const current = activePruningSessions.get(sessionID) ?? 0
    activePruningSessions.set(sessionID, current + 1)
    try {
        return await operation()
    } finally {
        const next = (activePruningSessions.get(sessionID) ?? 1) - 1
        if (next <= 0) {
            activePruningSessions.delete(sessionID)
        } else {
            activePruningSessions.set(sessionID, next)
        }
    }
}
