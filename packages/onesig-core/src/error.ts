const codes = [
    'LEAF_SEEN_TWICE',
    'NONCE_ID_SEEN_TWICE',
    'INVALID_SIGNATURE_INPUT',
    'ONE_SIGNER_REQUIRED',
    'ADDRESS_SIGNATURE_LENGTH_MISMATCH',
    'CANNOT_CONCAT_INPUT',
] as const

export type OneSigCoreErrorCode = (typeof codes)[number]

export class OneSigCoreError extends Error {
    #code: OneSigCoreErrorCode

    constructor(code: OneSigCoreErrorCode, message: string) {
        super(`[${code}] ${message}`)
        this.#code = code
    }

    get code() {
        return this.#code
    }

    static is(input: unknown, code?: OneSigCoreErrorCode): input is OneSigCoreError {
        if (input instanceof OneSigCoreError) {
            if (code) {
                return input.code === code
            }

            return true
        } else {
            return false
        }
    }
}

export async function getErrorFromCall(method: () => Promise<unknown>) {
    try {
        await method()
    } catch (error) {
        if (OneSigCoreError.is(error)) {
            return error.code
        }

        throw error
    }

    return null
}
