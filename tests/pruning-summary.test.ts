import assert from "node:assert/strict"
import test from "node:test"
import {
    createSessionPruningSummaryGenerator,
    type PruningSummaryRequest,
} from "../lib/compress/pruning-summary"
import { isPruningGenerationSession } from "../lib/pruning-guard"

function buildRequest(): PruningSummaryRequest {
    return {
        model: "openai/gpt-4o-mini",
        mode: "range",
        sessionID: "parent-session",
        batchTopic: "Worker Summary",
        topic: "Worker Summary",
        messages: [
            {
                ref: "m0001",
                rawId: "msg-user-1",
                role: "user",
                text: "Please keep this decision.",
            },
        ],
    }
}

test("session pruning summary generator uses a created worker session", async () => {
    let createParams: any
    let promptParams: any
    let guardActiveDuringPrompt = false
    const generator = createSessionPruningSummaryGenerator({
        session: {
            create: async (params: any) => {
                createParams = params
                return { data: { id: "worker-session" } }
            },
            prompt: async (params: any) => {
                promptParams = params
                guardActiveDuringPrompt = isPruningGenerationSession("worker-session")
                return {
                    data: {
                        parts: [{ type: "text", text: "Generated worker summary." }],
                    },
                }
            },
        },
    } as any)

    const summary = await generator.generateSummary(buildRequest())

    assert.equal(summary, "Generated worker summary.")
    assert.equal(createParams.body.parentID, "parent-session")
    assert.equal(createParams.body.title, "DCP pruning summary")
    assert.equal(promptParams.path.id, "worker-session")
    assert.equal(promptParams.path.sessionID, "worker-session")
    assert.deepEqual(promptParams.body.model, {
        providerID: "openai",
        modelID: "gpt-4o-mini",
    })
    assert.equal(promptParams.body.tools.compress, false)
    assert.match(promptParams.body.system, /summarizing conversations for DCP pruning/)
    assert.match(promptParams.body.parts[0].text, /\[m0001\] user/)
    assert.equal(guardActiveDuringPrompt, true)
    assert.equal(isPruningGenerationSession("worker-session"), false)
})

test("session pruning summary generator fails instead of falling back to parent session", async () => {
    let promptCalls = 0
    const generator = createSessionPruningSummaryGenerator({
        session: {
            create: async () => {
                throw new Error("create failed")
            },
            prompt: async () => {
                promptCalls += 1
                return { data: { parts: [{ type: "text", text: "should not happen" }] } }
            },
        },
    } as any)

    await assert.rejects(
        () => generator.generateSummary(buildRequest()),
        /Unable to create pruning summary worker session: create failed/,
    )
    assert.equal(promptCalls, 0)
})

test("session pruning summary generator requires session.create", async () => {
    const generator = createSessionPruningSummaryGenerator({
        session: {
            prompt: async () => ({
                data: { parts: [{ type: "text", text: "should not happen" }] },
            }),
        },
    } as any)

    await assert.rejects(
        () => generator.generateSummary(buildRequest()),
        /client\.session\.create is not available/,
    )
})
