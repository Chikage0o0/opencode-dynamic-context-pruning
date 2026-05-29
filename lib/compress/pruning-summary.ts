import type { SessionState, WithParts } from "../state"
import { withPruningGenerationSession } from "../pruning-guard"
import { parsePruningModelString } from "../pruning-model"
import type { SearchContext, SelectionResolution } from "./types"

export interface PruningSummaryMessage {
    ref: string
    rawId: string
    role: string
    text: string
}

export interface PruningSummaryRequest {
    model: string
    mode: "range" | "message"
    sessionID: string
    batchTopic: string
    topic: string
    messages: PruningSummaryMessage[]
}

export interface PruningSummaryGenerator {
    generateSummary(request: PruningSummaryRequest): Promise<string>
}

export function buildPruningSummaryRequest(input: {
    model: string
    mode: "range" | "message"
    sessionID: string
    batchTopic: string
    topic: string
    selection: SelectionResolution
    searchContext: SearchContext
    state: SessionState
}): PruningSummaryRequest {
    return {
        model: input.model,
        mode: input.mode,
        sessionID: input.sessionID,
        batchTopic: input.batchTopic,
        topic: input.topic,
        messages: input.selection.messageIds.map((messageId) => {
            const message = input.searchContext.rawMessagesById.get(messageId)
            return {
                ref: input.state.messageIds.byRawId.get(messageId) ?? messageId,
                rawId: messageId,
                role: typeof message?.info?.role === "string" ? message.info.role : "unknown",
                text: message ? formatMessageForSummary(message) : "",
            }
        }),
    }
}

export async function generatePruningSummary(
    generator: PruningSummaryGenerator,
    request: PruningSummaryRequest,
): Promise<string> {
    const summary = (await generator.generateSummary(request)).trim()
    if (!summary) {
        throw new Error("Pruning model returned an empty summary")
    }
    return summary
}

export function createSessionPruningSummaryGenerator(client: any): PruningSummaryGenerator {
    return {
        async generateSummary(request) {
            const model = parsePruningModelString(request.model)
            const workerSessionID = await createWorkerSession(client, request.sessionID)
            return withPruningGenerationSession(workerSessionID, async () => {
                const response = await client.session.prompt({
                    path: {
                        id: workerSessionID,
                        sessionID: workerSessionID,
                    },
                    body: {
                        model,
                        tools: {
                            compress: false,
                        },
                        system: PRUNING_SUMMARY_SYSTEM_PROMPT,
                        parts: [
                            {
                                type: "text",
                                text: buildPrompt(request),
                            },
                        ],
                    },
                })

                const text = extractAssistantText(response)
                if (!text) {
                    throw new Error("Pruning model did not return text")
                }
                return text
            })
        },
    }
}

async function createWorkerSession(client: any, parentSessionID: string): Promise<string> {
    if (typeof client?.session?.create !== "function") {
        throw new Error(
            "Unable to create pruning summary worker session: client.session.create is not available",
        )
    }

    try {
        const response = await client.session.create({
            body: {
                parentID: parentSessionID,
                title: "DCP pruning summary",
            },
        })
        const workerSessionID = response?.data?.id ?? response?.id
        if (typeof workerSessionID !== "string" || workerSessionID.length === 0) {
            throw new Error("missing session id")
        }
        return workerSessionID
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Unable to create pruning summary worker session: ${message}`)
    }
}

const PRUNING_SUMMARY_SYSTEM_PROMPT =
    "You are a helpful AI assistant tasked with summarizing conversations for DCP pruning. Return only the replacement summary text."

function buildPrompt(request: PruningSummaryRequest): string {
    const messages = request.messages
        .map((message) => {
            const header = `[${message.ref}] ${message.role}`
            const body = message.text.trim() || "(no textual content)"
            return `${header}\n${body}`
        })
        .join("\n\n---\n\n")

    return `Create a concise but complete technical summary for this ${request.mode} compression.\n\nBatch topic: ${request.batchTopic}\nEntry topic: ${request.topic}\n\nPreserve decisions, file paths, constraints, errors, tool results, and user intent. Do not invent facts. Return only the summary text.\n\nConversation content:\n\n${messages}`
}

function formatMessageForSummary(message: WithParts): string {
    const parts = Array.isArray(message.parts) ? message.parts : []
    return parts
        .map((part: any) => {
            if (part?.type === "text" && typeof part.text === "string") {
                return part.text
            }

            if (part?.type === "tool") {
                const status = part.state?.status || "unknown"
                const output = typeof part.state?.output === "string" ? part.state.output : ""
                return `[tool:${part.tool || "unknown"} status:${status}]${output ? `\n${output}` : ""}`
            }

            return ""
        })
        .filter((text: string) => text.trim().length > 0)
        .join("\n\n")
}

function extractAssistantText(response: any): string {
    const parts = response?.data?.parts ?? response?.parts ?? []
    if (!Array.isArray(parts)) {
        return ""
    }

    return parts
        .map((part: any) =>
            part?.type === "text" && typeof part.text === "string" ? part.text : "",
        )
        .filter((text: string) => text.trim().length > 0)
        .join("\n\n")
        .trim()
}
