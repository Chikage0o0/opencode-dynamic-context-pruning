import assert from "node:assert/strict"
import test from "node:test"
import { getInvalidConfigKeys, validateConfigTypes } from "../lib/config"

test("pruningModel accepts opencode provider/model strings", () => {
    const config = {
        pruningModel: "anthropic/claude-3-5-haiku-latest",
    }

    assert.deepEqual(getInvalidConfigKeys(config), [])
    assert.deepEqual(validateConfigTypes(config), [])
})

test("pruningModel rejects non-model strings", () => {
    const errors = validateConfigTypes({ pruningModel: "claude-3-5-haiku-latest" })

    assert.deepEqual(errors, [
        {
            key: "pruningModel",
            expected: '"providerID/modelID"',
            actual: '"claude-3-5-haiku-latest"',
        },
    ])
})

test("pruningModel rejects whitespace around provider or model ids", () => {
    for (const pruningModel of ["openai/ gpt-4o", "openai/gpt 4o", " openai/gpt-4o"]) {
        const errors = validateConfigTypes({ pruningModel })
        assert.deepEqual(errors, [
            {
                key: "pruningModel",
                expected: '"providerID/modelID"',
                actual: JSON.stringify(pruningModel),
            },
        ])
    }
})
