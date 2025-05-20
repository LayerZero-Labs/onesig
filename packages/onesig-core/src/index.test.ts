import crypto from 'crypto'

import { expect, test } from '@jest/globals'
import { ethers } from 'ethers'

import {
    BaseLeafData,
    GenerateLeafsResult,
    Signature,
    SigningOptions,
    compareAddresses,
    encodeLeaf,
    getDigestToSign,
    makeOneSigTree,
    signOneSigTree,
} from '.'
import { getErrorFromCall } from './error'

type TestLeafData = BaseLeafData<Buffer, Buffer>
function testLeafGen(leafs: TestLeafData[]): GenerateLeafsResult<TestLeafData> {
    return {
        leafs: leafs,
        encodeCalls(calls) {
            return calls[0]
        },
        encodeAddress(address) {
            return address
        },
    }
}

function testHelperRandomBytes() {
    return crypto.randomBytes(32)
}

function getTestLeafs() {
    const testLeafs: TestLeafData[] = [
        {
            nonce: 0n,
            oneSigId: 5n,
            targetOneSigAddress: Buffer.alloc(32, 0),
            calls: [testHelperRandomBytes()],
        },
        {
            nonce: 1n,
            oneSigId: 5n,
            targetOneSigAddress: Buffer.alloc(32, 0),
            calls: [testHelperRandomBytes()],
        },
    ]

    return testLeafs
}

test('Basic Tree Generation', async function () {
    const initialLeafs = getTestLeafs()

    const gen = testLeafGen(initialLeafs)
    const tree = makeOneSigTree([gen])

    expect(tree.getLeafCount()).toEqual(2)

    const root = tree.getRoot()
    const firstLeafEncoded = encodeLeaf(gen, 0)
    const proof = tree.getProof(firstLeafEncoded)
    expect(tree.verify([proof[0].data], firstLeafEncoded, root)).toEqual(true)

    expect(
        await getErrorFromCall(async function () {
            const doubledNonceLeafs: TestLeafData[] = [...initialLeafs, initialLeafs[0]]

            makeOneSigTree([testLeafGen(doubledNonceLeafs)])
        })
    ).toEqual('NONCE_ID_SEEN_TWICE')
})

test('Address comparison', async function () {
    const regularAddress = '0xe0e0e0b359E02c157Ec84D1F9EaB0e38f02f66FA'
    const nullAddress = `0x${'0'.repeat(64)}`
    const maxAddress = `0x${'f'.repeat(64)}`
    const testCases: [string, string, -1 | 0 | 1][] = [
        [regularAddress, regularAddress, 0],
        [nullAddress, maxAddress, -1],
    ]

    for (const [aInput, bInput, outcome] of testCases) {
        for (const a of [aInput, aInput.toUpperCase(), aInput.toLowerCase()]) {
            for (const b of [bInput, bInput.toUpperCase(), bInput.toLowerCase()]) {
                expect(compareAddresses(a, b)).toEqual(outcome)

                const reversedOutcome = {
                    0: 0,
                    1: -1,
                    [-1]: 1,
                }[outcome]

                expect(compareAddresses(b, a)).toEqual(reversedOutcome)
            }
        }
    }
})

test('Signature Tests', async function () {
    {
        // Test basic invalid inputs for Signature class
        const invalidInputs = [Buffer.alloc(64, 0), 'f'.repeat(130)]

        for (const input of invalidInputs) {
            expect(
                await getErrorFromCall(async function () {
                    new Signature(input)
                })
            ).toEqual('INVALID_SIGNATURE_INPUT')
        }
    }

    const tree = makeOneSigTree([testLeafGen(getTestLeafs())])

    const signingOptions: SigningOptions = {
        expiry: Math.floor(Date.now() / 1000) + 5 * 1000,
        seed: `0x${testHelperRandomBytes().toString('hex')}`,
    }

    expect(
        await getErrorFromCall(async function () {
            await signOneSigTree(tree, [], signingOptions)
        })
    ).toEqual('ONE_SIGNER_REQUIRED')

    const signers: ethers.Wallet[] = []
    for (let i = 0; i < 3; i++) {
        signers.push(ethers.Wallet.createRandom())
    }

    const signatures = await Promise.all(
        signers.map(async function (signer) {
            const signed = await signOneSigTree(tree, [signer], signingOptions, 'signature')
            return signed
        })
    )

    for (const signature of signatures) {
        expect(signature instanceof Signature).toEqual(true)
        expect(signature.signatureCount).toEqual(1)

        const signatureBuf = signature.get()

        expect(signatureBuf.length).toEqual(65)

        const hexString = signature.toHexString()

        const reconstructions = [new Signature(signatureBuf), new Signature(hexString)]

        for (const reconstruction of reconstructions) {
            expect(reconstruction.get()).toEqual(signatureBuf)
            expect(reconstruction.toHexString()).toEqual(hexString)
        }
    }

    expect(
        await getErrorFromCall(async function () {
            Signature.concatenateSignatures(signatures, [])
        })
    ).toEqual('ADDRESS_SIGNATURE_LENGTH_MISMATCH')

    const unOrderedCombined = Signature.concatenateSignatures(signatures, false)
    expect(unOrderedCombined.get()).toEqual(Buffer.concat(signatures.map((sig) => sig.get())))

    const indexMapping = new Array(signers.length).fill(0).map((_, i) => i)
    indexMapping.sort((a, b) => compareAddresses(signers[a].address, signers[b].address))

    const orderedSignatures = indexMapping.map((i) => signatures[i])

    const signedDigest = getDigestToSign(tree, signingOptions)
    const orderedFromDigest = Signature.concatenateSignatures(signatures, signedDigest)
    const orderedFromAddresses = Signature.concatenateSignatures(
        signatures,
        signers.map((signer) => signer.address)
    )

    const expected = Signature.concatenateSignatures(orderedSignatures, false)
    expect(expected.signatureCount).toEqual(signatures.length)
    expect(orderedFromDigest.toHexString()).toEqual(expected.toHexString())
    expect(orderedFromAddresses.toHexString()).toEqual(expected.toHexString())

    expect(
        await getErrorFromCall(async function () {
            Signature.concatenateSignatures([expected], signedDigest)
        })
    ).toEqual('CANNOT_CONCAT_INPUT')
})
