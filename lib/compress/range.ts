import { tool } from "@opencode-ai/plugin"
import type { ToolContext } from "./types"
import { countTokens } from "../token-utils"
import {
    RANGE_FORMAT_EXTENSION,
    RANGE_PRUNING_MODEL_FORMAT_EXTENSION,
} from "../prompts/extensions/tool"
import { finalizeSession, prepareSession, type NotificationEntry } from "./pipeline"
import {
    appendProtectedPromptInfo,
    appendProtectedTools,
    appendProtectedUserMessages,
} from "./protected-content"
import {
    appendMissingBlockSummaries,
    injectBlockPlaceholders,
    parseBlockPlaceholders,
    resolveRanges,
    validateArgs,
    validateNonOverlapping,
    validateSummaryPlaceholders,
} from "./range-utils"
import {
    COMPRESSED_BLOCK_HEADER,
    allocateBlockId,
    allocateRunId,
    applyCompressionState,
    wrapCompressedSummary,
} from "./state"
import type { CompressRangeToolArgs } from "./types"
import {
    buildPruningSummaryRequest,
    createSessionPruningSummaryGenerator,
    generatePruningSummary,
} from "./pruning-summary"

function buildSchema(usePruningModel: boolean) {
    const boundarySchema = {
        startId: tool.schema
            .string()
            .describe("Message or block ID marking the beginning of range (e.g. m0001, b2)"),
        endId: tool.schema
            .string()
            .describe("Message or block ID marking the end of range (e.g. m0012, b5)"),
    }
    const entrySchema = usePruningModel
        ? tool.schema.object(boundarySchema)
        : tool.schema.object({
              ...boundarySchema,
              summary: tool.schema
                  .string()
                  .describe("Complete technical summary replacing all content in range"),
          })

    return {
        topic: tool.schema
            .string()
            .describe("Short label (3-5 words) for display - e.g., 'Auth System Exploration'"),
        content: tool.schema
            .array(entrySchema)
            .describe(
                usePruningModel
                    ? "One or more ranges to compress. The configured pruning model generates summaries."
                    : "One or more ranges to compress, each with start/end boundaries and a summary",
            ),
    }
}

export function createCompressRangeTool(ctx: ToolContext): ReturnType<typeof tool> {
    ctx.prompts.reload()
    const runtimePrompts = ctx.prompts.getRuntimePrompts()
    const pruningModel = ctx.config.pruningModel
    const usePruningModel = typeof pruningModel === "string" && pruningModel.length > 0

    return tool({
        description: usePruningModel
            ? RANGE_PRUNING_MODEL_FORMAT_EXTENSION
            : runtimePrompts.compressRange + RANGE_FORMAT_EXTENSION,
        args: buildSchema(usePruningModel),
        async execute(args, toolCtx) {
            const input = args as CompressRangeToolArgs
            validateArgs(input, { requireSummary: !usePruningModel })
            const callId =
                typeof (toolCtx as unknown as { callID?: unknown }).callID === "string"
                    ? (toolCtx as unknown as { callID: string }).callID
                    : undefined

            const { rawMessages, searchContext } = await prepareSession(
                ctx,
                toolCtx,
                `Compress Range: ${input.topic}`,
            )
            const resolvedPlans = resolveRanges(input, searchContext, ctx.state)
            validateNonOverlapping(resolvedPlans)

            const notifications: NotificationEntry[] = []
            const pruningSummaryGenerator = usePruningModel
                ? (ctx.pruningSummaryGenerator ?? createSessionPruningSummaryGenerator(ctx.client))
                : undefined
            const preparedPlans: Array<{
                entry: (typeof resolvedPlans)[number]["entry"]
                selection: (typeof resolvedPlans)[number]["selection"]
                anchorMessageId: string
                finalSummary: string
                consumedBlockIds: number[]
            }> = []
            let totalCompressedMessages = 0

            for (const plan of resolvedPlans) {
                const planSummary = usePruningModel
                    ? await generatePruningSummary(
                          pruningSummaryGenerator!,
                          buildPruningSummaryRequest({
                              model: pruningModel!,
                              mode: "range",
                              sessionID: toolCtx.sessionID,
                              batchTopic: input.topic,
                              topic: input.topic,
                              selection: plan.selection,
                              searchContext,
                              state: ctx.state,
                          }),
                      )
                    : plan.entry.summary!
                const parsedPlaceholders = usePruningModel
                    ? []
                    : parseBlockPlaceholders(planSummary)
                const missingBlockIds = usePruningModel
                    ? []
                    : validateSummaryPlaceholders(
                          parsedPlaceholders,
                          plan.selection.requiredBlockIds,
                          plan.selection.startReference,
                          plan.selection.endReference,
                          searchContext.summaryByBlockId,
                      )

                const injected = usePruningModel
                    ? {
                          expandedSummary: planSummary,
                          consumedBlockIds: [...plan.selection.requiredBlockIds],
                      }
                    : injectBlockPlaceholders(
                          planSummary,
                          parsedPlaceholders,
                          searchContext.summaryByBlockId,
                          plan.selection.startReference,
                          plan.selection.endReference,
                      )
                const protectedAppendOptions = usePruningModel
                    ? { ignoredActiveBlockIds: injected.consumedBlockIds }
                    : undefined

                const summaryWithUsers = appendProtectedUserMessages(
                    injected.expandedSummary,
                    plan.selection,
                    searchContext,
                    ctx.state,
                    ctx.config.compress.protectUserMessages,
                    protectedAppendOptions,
                )

                const summaryWithPromptInfo = appendProtectedPromptInfo(
                    summaryWithUsers,
                    plan.selection,
                    searchContext,
                    ctx.state,
                    ctx.config.compress.protectTags,
                    protectedAppendOptions,
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
                    protectedAppendOptions,
                )

                const completedSummary = usePruningModel
                    ? {
                          expandedSummary: summaryWithTools,
                          consumedBlockIds: injected.consumedBlockIds,
                      }
                    : appendMissingBlockSummaries(
                          summaryWithTools,
                          missingBlockIds,
                          searchContext.summaryByBlockId,
                          injected.consumedBlockIds,
                      )

                preparedPlans.push({
                    entry: plan.entry,
                    selection: plan.selection,
                    anchorMessageId: plan.anchorMessageId,
                    finalSummary: completedSummary.expandedSummary,
                    consumedBlockIds: completedSummary.consumedBlockIds,
                })
            }

            const runId = allocateRunId(ctx.state)

            for (const preparedPlan of preparedPlans) {
                const blockId = allocateBlockId(ctx.state)
                const storedSummary = wrapCompressedSummary(blockId, preparedPlan.finalSummary)
                const summaryTokens = countTokens(storedSummary)

                const applied = applyCompressionState(
                    ctx.state,
                    {
                        topic: input.topic,
                        batchTopic: input.topic,
                        startId: preparedPlan.entry.startId,
                        endId: preparedPlan.entry.endId,
                        mode: "range",
                        runId,
                        compressMessageId: toolCtx.messageID,
                        compressCallId: callId,
                        summaryTokens,
                    },
                    preparedPlan.selection,
                    preparedPlan.anchorMessageId,
                    blockId,
                    storedSummary,
                    preparedPlan.consumedBlockIds,
                )

                totalCompressedMessages += applied.messageIds.length

                notifications.push({
                    blockId,
                    runId,
                    summary: preparedPlan.finalSummary,
                    summaryTokens,
                })
            }

            await finalizeSession(ctx, toolCtx, rawMessages, notifications, input.topic)

            return `Compressed ${totalCompressedMessages} messages into ${COMPRESSED_BLOCK_HEADER}.`
        },
    })
}
