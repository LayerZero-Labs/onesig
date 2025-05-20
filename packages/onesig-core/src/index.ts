import { BigNumber, TypedDataDomain, TypedDataField, ethers } from 'ethers'
import { MerkleTree } from 'merkletreejs'

import { OneSigCoreError } from './error'

import type { TypedDataSigner } from '@ethersproject/abstract-signer'

// Re-export MerkleTree and TypedDataSigner to avoid duplicate dependencies and version differences
export { MerkleTree, type TypedDataSigner }

export interface BaseLeafData<TargetAddressType = unknown, CallData = unknown> {
    nonce: bigint
    oneSigId: bigint
    targetOneSigAddress: TargetAddressType
    calls: CallData[]
}

export interface SigningOptions {
    seed: string | Uint8Array
    expiry: number | string | BigNumber
}

// We can use any here as it will be overriden by implementation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface GenerateLeafsResult<Leaf extends BaseLeafData = BaseLeafData<any, any>> {
    encodeCalls: (calls: Leaf['calls']) => Buffer
    encodeAddress: (address: Leaf['targetOneSigAddress']) => Buffer
    leafs: Leaf[]
}

function readByteFromHex(input: string, byteOffset: number) {
    const charOffset = byteOffset * 2
    const sub = input.substring(charOffset, charOffset + 2)
    return parseInt(sub, 16)
}

export function encodeLeafHeader({ targetOneSigAddress, oneSigId, nonce }: Omit<BaseLeafData<Buffer>, 'calls'>) {
    if (targetOneSigAddress.byteLength !== 32) {
        throw new Error('Contract address must be 32 bytes')
    }

    const storage = Buffer.alloc(49)
    storage[0] = 1

    const idStr = oneSigId.toString(16).padStart(16, '0')
    const nonceStr = nonce.toString(16).padStart(16, '0')

    for (let i = 0; i < 32; i++) {
        if (i < 8) {
            storage[i + 1] = readByteFromHex(idStr, i) // oneSigId
            storage[i + 41] = readByteFromHex(nonceStr, i) // nonce
        }

        storage[i + 9] = targetOneSigAddress[i] // target address
    }

    return storage
}

export function encodeLeaf(gen: GenerateLeafsResult, index: number) {
    const leaf = gen.leafs[index]

    if (!leaf) {
        throw new Error('Leaf does not exist')
    }

    const leafData = Buffer.concat([
        encodeLeafHeader({
            nonce: leaf.nonce,
            oneSigId: leaf.oneSigId,
            targetOneSigAddress: gen.encodeAddress(leaf.targetOneSigAddress),
        }) as unknown as Uint8Array,
        gen.encodeCalls(leaf.calls) as unknown as Uint8Array,
    ])

    return ethers.utils.keccak256(ethers.utils.keccak256(leafData))
}

export function makeOneSigTree(input: GenerateLeafsResult[]) {
    const encodedLeafs = []
    const seenNonceIds = new Set()

    for (const gen of input) {
        for (let i = 0; i < gen.leafs.length; i++) {
            const leaf = gen.leafs[i]

            // Ensure that two calls with the same nonce/oneSigId have not already been seen
            const nonceIdCombo = `${leaf.nonce}.${leaf.oneSigId}`
            if (seenNonceIds.has(nonceIdCombo)) {
                throw new OneSigCoreError(
                    'NONCE_ID_SEEN_TWICE',
                    'Two calls should not be made for the same chain/nonce twice'
                )
            }
            seenNonceIds.add(nonceIdCombo)

            encodedLeafs.push(encodeLeaf(gen, i))
        }
    }

    const tree = new MerkleTree(encodedLeafs, ethers.utils.keccak256, { sortPairs: true })

    return tree
}

export function compareAddresses(a: string, b: string): number {
    const aNumeric = BigInt(a)
    const bNumeric = BigInt(b)

    if (aNumeric === bNumeric) {
        return 0
    } else if (aNumeric < bNumeric) {
        return -1
    } else {
        return 1
    }
}

type HexStringLike = `0x${string}`
// XXX:TODO At some point this should be moved away
type SignatureLike = Buffer | string | Signature | HexStringLike

export class Signature {
    #value: Buffer

    constructor(input: SignatureLike) {
        let value = input
        if (value instanceof Signature) {
            value = value.get()
        }

        if (typeof value === 'string') {
            if (!value.startsWith('0x')) {
                throw new OneSigCoreError(
                    'INVALID_SIGNATURE_INPUT',
                    'Signature takes in hex encoded strings prefixed with 0x only'
                )
            }

            value = Buffer.from(value.substring(2), 'hex')
        }

        if (value.length % 65 !== 0) {
            throw new OneSigCoreError('INVALID_SIGNATURE_INPUT', 'Each signature must be 65 bytes long')
        }

        this.#value = value
    }

    get() {
        return this.#value
    }

    toHexString(): HexStringLike {
        return `0x${this.get().toString('hex')}`
    }

    get signatureCount() {
        const count = this.#value.length / 65
        if (Math.floor(count) !== count) {
            throw new Error('Count is not an int')
        }
        return count
    }

    /**
     * Concatenate signatures without changing ordering
     */
    static concatenateSignatures(input: SignatureLike[], sortMethod: false): Signature
    /**
     * Concatenate signatures based on addresses provided, with each signature corresponding to the address in the same index
     */
    static concatenateSignatures(input: SignatureLike[], addresses: string[]): Signature
    /**
     * Concatenate signatures based on the signature data, ordering based on the recovered address
     */
    static concatenateSignatures(input: SignatureLike[], digest: Buffer | string): Signature
    /**
     * Concatenate and order signatures based on data provided
     * @param input An array of signatures to concat
     * @param sortMethod Parameter specifing how to order each signature
     * @returns The concatenated signature
     */
    static concatenateSignatures(input: SignatureLike[], sortMethod: string[] | Buffer | false | string) {
        const signatureBuffers = input.map(function (singleInput) {
            const signature = new Signature(singleInput)

            if (signature.signatureCount !== 1) {
                throw new OneSigCoreError('CANNOT_CONCAT_INPUT', 'Cannot concatenate pre-concatenated signatures')
            }

            return signature.get()
        })

        let orderedSignatures

        if (sortMethod === false) {
            orderedSignatures = signatureBuffers
        } else {
            let addresses
            if (typeof sortMethod === 'string' || Buffer.isBuffer(sortMethod)) {
                addresses = []

                for (const signature of signatureBuffers) {
                    const recovered = ethers.utils.recoverAddress(sortMethod, signature)
                    addresses.push(recovered)
                }
            } else {
                addresses = sortMethod
            }

            if (addresses.length !== signatureBuffers.length) {
                throw new OneSigCoreError(
                    'ADDRESS_SIGNATURE_LENGTH_MISMATCH',
                    'Mismatch in addresses provided signatures'
                )
            }

            // Create an array with the same length of addresses with incrementing values ([0, 1, ... 5])
            const indexMapping = new Array(addresses.length)
                .fill(0)
                .map((_, i) => i)
                // Sort this array based on the references to the address array, so we can apply the same order to the signatures
                .sort(function (a, b) {
                    return compareAddresses(addresses[a], addresses[b])
                })

            orderedSignatures = indexMapping.map((index) => signatureBuffers[index])
        }

        // For some reason, the types of this are not being inferred correctly when building with tsup
        // @ts-ignore
        const combined = Buffer.concat(orderedSignatures)

        return new this(combined)
    }
}

const ONE_SIG_TYPED_DATA_DOMAIN: TypedDataDomain = {
    name: 'OneSig',
    version: '0.0.1',
    chainId: 1, // this is hardcoded to Ethereum mainnet
    verifyingContract: '0x000000000000000000000000000000000000dEaD', // this is hardcoded to a dead address
}

export function getOneSigTypedDataDomain(): TypedDataDomain {
    return ONE_SIG_TYPED_DATA_DOMAIN
}

const ONE_SIG_TYPED_DATA_DOMAIN_TYPES: Record<string, TypedDataField[]> = {
    EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
    ],
}

export function getOneSigTypedDataDomainTypes(): Record<string, TypedDataField[]> {
    return ONE_SIG_TYPED_DATA_DOMAIN_TYPES
}

const ONE_SIG_TYPED_DATA_PRIMARY_TYPES: Record<string, TypedDataField[]> = {
    SignMerkleRoot: [
        { name: 'seed', type: 'bytes32' },
        { name: 'merkleRoot', type: 'bytes32' },
        { name: 'expiry', type: 'uint256' },
    ],
}

export function getOneSigTypedDataPrimaryTypes(): Record<string, TypedDataField[]> {
    return ONE_SIG_TYPED_DATA_PRIMARY_TYPES
}

export function getSigningData(
    tree: MerkleTree,
    { seed, expiry }: SigningOptions
): Parameters<TypedDataSigner['_signTypedData']> {
    return [
        getOneSigTypedDataDomain(),
        getOneSigTypedDataPrimaryTypes(),
        {
            seed: seed,
            expiry: expiry,
            merkleRoot: tree.getHexRoot(),
        },
    ]
}

export function getDigestToSign(tree: MerkleTree, options: SigningOptions) {
    return ethers.utils._TypedDataEncoder.hash(...getSigningData(tree, options))
}

export async function signOneSigTree(
    tree: MerkleTree,
    signers: TypedDataSigner[],
    options: SigningOptions,
    enc?: 'string'
): Promise<string>
export async function signOneSigTree(
    tree: MerkleTree,
    signers: TypedDataSigner[],
    options: SigningOptions,
    enc: 'signature'
): Promise<Signature>
export async function signOneSigTree(
    tree: MerkleTree,
    signers: TypedDataSigner[],
    options: SigningOptions,
    enc: 'signature' | 'string' = 'string'
): Promise<Signature | string> {
    if (signers.length <= 0) {
        throw new OneSigCoreError('ONE_SIGNER_REQUIRED', '1+ signer must be provided')
    }

    const toSign = getSigningData(tree, options)

    const signatures = await Promise.all(
        signers.map(async function (signer): Promise<Signature> {
            const data = await signer._signTypedData(...toSign)
            return new Signature(data)
        })
    )

    const signingDigest = ethers.utils._TypedDataEncoder.hash(...toSign)

    const sig = Signature.concatenateSignatures(signatures, signingDigest)

    if (enc === 'signature') {
        return sig
    } else if (enc === 'string') {
        return sig.toHexString()
    } else {
        throw new Error('Invalid encoding')
    }
}
