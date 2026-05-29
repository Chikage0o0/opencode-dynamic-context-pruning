// These format schemas are kept separate from the editable compress prompts
// so they cannot be modified via custom prompt overrides. The schemas must
// match the tool's input validation and are not safe to change independently.

export const RANGE_FORMAT_EXTENSION = `
THE FORMAT OF COMPRESS

\`\`\`
{
  topic: string,           // Short label (3-5 words) - e.g., "Auth System Exploration"
  content: [               // One or more ranges to compress
    {
      startId: string,     // Boundary ID at range start: mNNNN or bN
      endId: string,       // Boundary ID at range end: mNNNN or bN
      summary: string      // Complete technical summary replacing all content in range
    }
  ]
}
\`\`\``

export const RANGE_PRUNING_MODEL_FORMAT_EXTENSION = `
Collapse one or more completed conversation ranges by selecting boundaries only.

SUMMARY DELEGATION
pruningModel is configured. Do not write, draft, or include replacement summaries in the tool call.
The configured pruning model will read the selected content and generate the replacement summaries.

BOUNDARY IDS
You specify boundaries by ID using the injected IDs visible in the conversation:

- \`mNNNN\` IDs identify raw messages
- \`bN\` IDs identify previously compressed blocks

Rules:

- Pick \`startId\` and \`endId\` directly from injected IDs in context.
- IDs must exist in the current visible context.
- \`startId\` must appear before \`endId\`.
- Do not invent IDs. Use only IDs that are present in context.

BATCHING
When multiple independent ranges are ready and their boundaries do not overlap, include all of them as separate entries in the \`content\` array of a single tool call.

THE FORMAT OF COMPRESS

When pruningModel is configured, do not write summaries. Select only the ranges;
the configured pruning model will generate the replacement summaries.

\`\`\`
{
  topic: string,           // Short label (3-5 words) - e.g., "Auth System Exploration"
  content: [               // One or more ranges to compress
    {
      startId: string,     // Boundary ID at range start: mNNNN or bN
      endId: string        // Boundary ID at range end: mNNNN or bN
    }
  ]
}
\`\`\``

export const MESSAGE_FORMAT_EXTENSION = `
THE FORMAT OF COMPRESS

\`\`\`
{
  topic: string,           // Short label (3-5 words) for the overall batch
  content: [               // One or more messages to compress independently
    {
      messageId: string,   // Raw message ID only: mNNNN (ignore metadata attributes like priority)
      topic: string,       // Short label (3-5 words) for this one message summary
      summary: string      // Complete technical summary replacing that one message
    }
  ]
}
\`\`\``

export const MESSAGE_PRUNING_MODEL_FORMAT_EXTENSION = `
Collapse one or more individual messages by selecting message IDs only.

SUMMARY DELEGATION
pruningModel is configured. Do not write, draft, or include replacement summaries in the tool call.
The configured pruning model will read each selected message and generate the replacement summaries.

MESSAGE IDS
Use raw injected message IDs only: \`mNNNN\`. Do not use compressed block IDs in message mode.

BATCHING
When multiple independent messages are ready, include all of them in the \`content\` array of a single tool call.

THE FORMAT OF COMPRESS

When pruningModel is configured, do not write summaries. Select only message IDs
and optional labels; the configured pruning model will generate the replacement
summaries.

\`\`\`
{
  topic: string,           // Short label (3-5 words) for the overall batch
  content: [               // One or more messages to compress independently
    {
      messageId: string,   // Raw message ID only: mNNNN (ignore metadata attributes like priority)
      topic?: string       // Optional short label (3-5 words) for this one message summary
    }
  ]
}
\`\`\``
