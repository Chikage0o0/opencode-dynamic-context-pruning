import { tool } from "@opencode-ai/plugin"
import type { ToolContext } from "./types"
import { countTokens } from "../token-utils"
import {
    MESSAGE_FORMAT_EXTENSION,
    MESSAGE_PRUNING_MODEL_FORMAT_EXTENSION,
} from "../prompts/extensions/tool"
import { formatIssues, formatResult, resolveMessages, validateArgs } from "./message-utils"
import { finalizeSession, prepareSession, type NotificationEntry } from "./pipeline"
import { appendProtectedPromptInfo, appendProtectedTools } from "./protected-content"
import {
    allocateBlockId,
    allocateRunId,
    applyCompressionState,
    wrapCompressedSummary,
} from "./state"
import type { CompressMessageToolArgs } from "./types"
import {
    buildPruningSummaryRequest,
    createSessionPruningSummaryGenerator,
    generatePruningSummary,
} from "./pruning-summary"

function buildSchema(usePruningModel: boolean) {
    const messageIdSchema = tool.schema.string().describe("Raw message ID to compress (e.g. m0001)")
    const entrySchema = usePruningModel
        ? tool.schema.object({
              messageId: messageIdSchema,
              topic: tool.schema
                  .string()
                  .optional()
                  .describe("Optional short label (3-5 words) for this one message summary"),
          })
        : tool.schema.object({
              messageId: messageIdSchema,
              topic: tool.schema
                  .string()
                  .describe("Short label (3-5 words) for this one message summary"),
              summary: tool.schema
                  .string()
                  .describe("Complete technical summary replacing that one message"),
          })

    return {
        topic: tool.schema
            .string()
            .describe(
                "Short label (3-5 words) for the overall batch - e.g., 'Closed Research Notes'",
            ),
        content: tool.schema
            .array(entrySchema)
            .describe(
                usePruningModel
                    ? "Batch of individual messages to compress. The configured pruning model generates summaries."
                    : "Batch of individual message summaries to create in one tool call",
            ),
    }
}

export function createCompressMessageTool(ctx: ToolContext): ReturnType<typeof tool> {
    ctx.prompts.reload()
    const runtimePrompts = ctx.prompts.getRuntimePrompts()
    const pruningModel = ctx.config.pruningModel
    const usePruningModel = typeof pruningModel === "string" && pruningModel.length > 0

    return tool({
        description: usePruningModel
            ? MESSAGE_PRUNING_MODEL_FORMAT_EXTENSION
            : runtimePrompts.compressMessage + MESSAGE_FORMAT_EXTENSION,
        args: buildSchema(usePruningModel),
        async execute(args, toolCtx) {
            const input = args as CompressMessageToolArgs
            validateArgs(input, {
                requireSummary: !usePruningModel,
                requireTopic: !usePruningModel,
            })
            const callId =
                typeof (toolCtx as unknown as { callID?: unknown }).callID === "string"
                    ? (toolCtx as unknown as { callID: string }).callID
                    : undefined

            const { rawMessages, searchContext } = await prepareSession(
                ctx,
                toolCtx,
                `Compress Message: ${input.topic}`,
            )
            const { plans, skippedIssues, skippedCount } = resolveMessages(
                input,
                searchContext,
                ctx.state,
                ctx.config,
            )

            if (plans.length === 0 && skippedCount > 0) {
                throw new Error(formatIssues(skippedIssues, skippedCount))
            }

            const notifications: NotificationEntry[] = []
            const pruningSummaryGenerator = usePruningModel
                ? (ctx.pruningSummaryGenerator ?? createSessionPruningSummaryGenerator(ctx.client))
                : undefined

            const preparedPlans: Array<{
                plan: (typeof plans)[number]
                summaryWithTools: string
            }> = []

            for (const plan of plans) {
                const planSummary = usePruningModel
                    ? await generatePruningSummary(
                          pruningSummaryGenerator!,
                          buildPruningSummaryRequest({
                              model: pruningModel!,
                              mode: "message",
                              sessionID: toolCtx.sessionID,
                              batchTopic: input.topic,
                              topic: plan.entry.topic || input.topic,
                              selection: plan.selection,
                              searchContext,
                              state: ctx.state,
                          }),
                      )
                    : plan.entry.summary!

                const summaryWithPromptInfo = appendProtectedPromptInfo(
                    planSummary,
                    plan.selection,
                    searchContext,
                    ctx.state,
                    ctx.config.compress.protectTags,
                )

                const summaryWithTools = await appendProtectedTools(
                    ctx.client,
                    ctx.state,
                    ctx.config.experimental.allowSubAgents,
                    summaryWithPromptInfo,
                    plan.selection,
                    searchContext,
                    ctx.config.compress.protectedTools,
                    ctx.config.protectedFilePatterns,
                )

                preparedPlans.push({
                    plan,
                    summaryWithTools,
                })
            }

            const runId = allocateRunId(ctx.state)

            for (const { plan, summaryWithTools } of preparedPlans) {
                const blockId = allocateBlockId(ctx.state)
                const storedSummary = wrapCompressedSummary(blockId, summaryWithTools)
                const summaryTokens = countTokens(storedSummary)

                applyCompressionState(
                    ctx.state,
                    {
                        topic: plan.entry.topic || input.topic,
                        batchTopic: input.topic,
                        startId: plan.entry.messageId,
                        endId: plan.entry.messageId,
                        mode: "message",
                        runId,
                        compressMessageId: toolCtx.messageID,
                        compressCallId: callId,
                        summaryTokens,
                    },
                    plan.selection,
                    plan.anchorMessageId,
                    blockId,
                    storedSummary,
                    [],
                )

                notifications.push({
                    blockId,
                    runId,
                    summary: summaryWithTools,
                    summaryTokens,
                })
            }

            await finalizeSession(ctx, toolCtx, rawMessages, notifications, input.topic)

            return formatResult(plans.length, skippedIssues, skippedCount)
        },
    })
}
