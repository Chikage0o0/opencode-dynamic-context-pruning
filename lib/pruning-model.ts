export const PRUNING_MODEL_FORMAT = '"providerID/modelID"'

const OPENCODE_MODEL_STRING_PATTERN = /^[^/\s]+\/\S+$/

export function isPruningModelString(value: unknown): value is string {
    return typeof value === "string" && OPENCODE_MODEL_STRING_PATTERN.test(value)
}

export function parsePruningModelString(model: string): { providerID: string; modelID: string } {
    if (!isPruningModelString(model)) {
        throw new Error(`pruningModel must use the ${PRUNING_MODEL_FORMAT} format`)
    }

    const separatorIndex = model.indexOf("/")
    return {
        providerID: model.slice(0, separatorIndex),
        modelID: model.slice(separatorIndex + 1),
    }
}
